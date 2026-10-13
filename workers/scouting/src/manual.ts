import { inTeam, requestTeamId, withTeam } from "@g3/auth";
import { firstJsonObject, withTimeout } from "./utils";

import { sql } from "drizzle-orm";
import { type Context, Hono } from "hono";

import { type Db, type WriteQuery, all, batch, dbOf, first } from "./db";

import {
  manualEvents,
  manualMatches,
  manualScanCache,
  manualScanUsage,
  manualTeams,
  strategyEventConfig,
} from "./db/schema";

import { requireAuth } from "./middleware/auth";

import type { AppEnv } from "./types";

import { isStrategyAdmin } from "./roles";
import type { TbaMatch, TbaTeam } from "./types";
import { MAX_FRC_TEAM_NUMBER, parseJson, teamNumber, text } from "./utils";
const ourTeam = requestTeamId;
export async function purgeExpiredManualEvents(db: Db, teamId: string) {
  const expired = await all<{ event_key: string }>(
    db,
    sql`SELECT event_key FROM (SELECT * FROM ${manualEvents} WHERE ${inTeam(manualEvents, teamId)}) AS scoped_manual_events WHERE delete_after <= ${Date.now()}`,
  );
  for (const row of expired.results) {
    await batch(db, [
      db
        .delete(manualMatches)
        .where(inTeam(manualMatches, teamId, sql`event_key = ${row.event_key}`)),
      db.delete(manualTeams).where(inTeam(manualTeams, teamId, sql`event_key = ${row.event_key}`)),
      db
        .delete(manualEvents)
        .where(inTeam(manualEvents, teamId, sql`event_key = ${row.event_key}`)),
      db
        .update(strategyEventConfig)
        .set({
          event_key: "",
          current_match_number: null,
          schedule_mode: "tba",
          updated_at: Date.now(),
        })
        .where(
          inTeam(
            strategyEventConfig,
            teamId,
            sql`event_key = ${row.event_key} AND schedule_mode = 'manual'`,
          ),
        ),
    ]);
  }
}

export async function getManualMatches(c: Context<AppEnv>, eventKey: string) {
  await purgeExpiredManualEvents(dbOf(c), c.get("teamId"));
  const rows = await all<Record<string, unknown>>(
    dbOf(c),
    sql`SELECT match_key, comp_level, set_number, match_number, scheduled_at,
            red_1, red_2, red_3, blue_1, blue_2, blue_3
       FROM (SELECT * FROM ${manualMatches} WHERE ${inTeam(manualMatches, c.get("teamId"))}) AS scoped_manual_matches WHERE event_key = ${eventKey} ORDER BY match_number`,
  );
  return rows.results.map<TbaMatch>((row) => ({
    key: String(row.match_key),
    comp_level: String(row.comp_level),
    set_number: Number(row.set_number),
    match_number: Number(row.match_number),
    time: row.scheduled_at ? Math.floor(Number(row.scheduled_at) / 1000) : null,
    predicted_time: null,
    actual_time: null,
    alliances: {
      red: { team_keys: [row.red_1, row.red_2, row.red_3].map((n) => `frc${n}`), score: -1 },
      blue: { team_keys: [row.blue_1, row.blue_2, row.blue_3].map((n) => `frc${n}`), score: -1 },
    },
  }));
}

export const manualRoutes = new Hono<AppEnv>();
manualRoutes.post("/manual-mode", requireAuth, async (c) => {
  if (!(await isStrategyAdmin(c))) return c.json({ error: "Strategy lead access required." }, 403);
  const body = await c.req.json<Record<string, unknown>>();
  const eventName = text(body.eventName, 100);
  const endsAt = Number(body.endsAt);
  if (!eventName) return c.json({ error: "Event name is required." }, 400);
  if (!Number.isFinite(endsAt) || endsAt < Date.now() - 86_400_000)
    return c.json({ error: "Enter the competition end date." }, 400);
  const eventKey = `manual-${new Date().getFullYear()}-${crypto.randomUUID().slice(0, 8)}`;
  const deleteAfter = endsAt + 3 * 86_400_000;
  await batch(dbOf(c), [
    dbOf(c)
      .insert(manualEvents)
      .values(
        withTeam(c.get("teamId"), {
          event_key: eventKey,
          event_name: eventName,
          ends_at: endsAt,
          delete_after: deleteAfter,
          created_by: c.get("userId"),
          updated_at: Date.now(),
        }),
      ),
    dbOf(c)
      .insert(strategyEventConfig)
      .values(
        withTeam(c.get("teamId"), {
          id: 1,
          event_key: eventKey,
          current_match_number: null,
          updated_by: c.get("userId"),
          updated_at: Date.now(),
          schedule_mode: "manual",
        }),
      )
      .onConflictDoUpdate({
        target: [strategyEventConfig.teamId, strategyEventConfig.id],
        set: {
          event_key: sql`excluded.event_key`,
          current_match_number: null,
          updated_by: sql`excluded.updated_by`,
          updated_at: sql`excluded.updated_at`,
          schedule_mode: "manual",
        },
      }),
  ]);
  return c.json({ ok: true, eventKey, deleteAfter });
});

manualRoutes.delete("/manual-mode", requireAuth, async (c) => {
  if (!(await isStrategyAdmin(c))) return c.json({ error: "Strategy lead access required." }, 403);
  const config = await first<{ event_key: string }>(
    dbOf(c),
    sql`SELECT event_key FROM (SELECT * FROM ${strategyEventConfig} WHERE ${inTeam(strategyEventConfig, c.get("teamId"))}) AS scoped_strategy_event_config WHERE id = 1 AND schedule_mode = 'manual'`,
  );
  if (config?.event_key) {
    await batch(dbOf(c), [
      dbOf(c)
        .delete(manualMatches)
        .where(inTeam(manualMatches, c.get("teamId"), sql`event_key = ${config.event_key}`)),
      dbOf(c)
        .delete(manualTeams)
        .where(inTeam(manualTeams, c.get("teamId"), sql`event_key = ${config.event_key}`)),
      dbOf(c)
        .delete(manualEvents)
        .where(inTeam(manualEvents, c.get("teamId"), sql`event_key = ${config.event_key}`)),
      dbOf(c)
        .update(strategyEventConfig)
        .set({
          event_key: "",
          current_match_number: null,
          schedule_mode: "tba",
          updated_by: c.get("userId"),
          updated_at: Date.now(),
        })
        .where(inTeam(strategyEventConfig, c.get("teamId"), sql`id = 1`)),
    ]);
  }
  return c.json({ ok: true });
});

function validatedSchedule(value: unknown, allowPartial = false) {
  const input = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  const rawMatches = Array.isArray(value)
    ? value
    : Array.isArray(input.matches)
      ? input.matches
      : Array.isArray(input.schedule)
        ? input.schedule
        : [];
  const invalidRows: number[] = [];
  const matches = rawMatches.slice(0, 500).flatMap((item, index) => {
    const row = (item && typeof item === "object" ? item : {}) as Record<string, unknown>;
    const asTeamList = (value: unknown) =>
      Array.isArray(value)
        ? value
        : typeof value === "string"
          ? (value.match(/\d{1,6}/g) ?? [])
          : [];
    const red = Array.isArray(row.redTeams)
      ? row.redTeams
      : asTeamList(row.red).length
        ? asTeamList(row.red)
        : asTeamList(row.r).length
          ? asTeamList(row.r)
          : [row.red1 ?? row.red_1, row.red2 ?? row.red_2, row.red3 ?? row.red_3];
    const blue = Array.isArray(row.blueTeams)
      ? row.blueTeams
      : asTeamList(row.blue).length
        ? asTeamList(row.blue)
        : asTeamList(row.b).length
          ? asTeamList(row.b)
          : [row.blue1 ?? row.blue_1, row.blue2 ?? row.blue_2, row.blue3 ?? row.blue_3];
    const arrayRow = Array.isArray(item) ? item : [];
    const explicitTeams = asTeamList(row.teams).length ? asTeamList(row.teams) : asTeamList(row.a);
    const rawTeams = explicitTeams.length
      ? explicitTeams
      : arrayRow.length >= 7
        ? arrayRow.slice(-6)
        : arrayRow.length === 6
          ? arrayRow
          : [...red, ...blue];
    const visualTeams = rawTeams.map((team) => teamNumber(team, !allowPartial));
    const columnOrder = String(row.order ?? row.o ?? "").toLowerCase();
    const teams =
      columnOrder === "blue-red" && visualTeams.length === 6
        ? [...visualTeams.slice(3), ...visualTeams.slice(0, 3)]
        : visualTeams;
    const matchNumber = Number(
      row.matchNumber ?? row.match_number ?? row.match ?? row.number ?? row.n ?? index + 1,
    );
    const rawTime = row.scheduledAt ?? row.scheduled_time ?? row.time ?? row.t;
    const timeText = String(rawTime ?? "");
    const scheduledAt =
      typeof rawTime === "number" && rawTime > 946_684_800_000
        ? rawTime
        : /\b20\d{2}\b/.test(timeText)
          ? Date.parse(timeText)
          : null;
    if (
      !Number.isInteger(matchNumber) ||
      matchNumber < 1 ||
      teams.length !== 6 ||
      teams.some((n) => !n)
    ) {
      if (allowPartial) {
        invalidRows.push(
          Number.isInteger(matchNumber) && matchNumber > 0 ? matchNumber : index + 1,
        );
        if (!Number.isInteger(matchNumber) || matchNumber < 1) return [];
        const partialTeams = Array.from({ length: 6 }, (_, teamIndex) => teams[teamIndex] || "");
        return [
          {
            matchNumber,
            teams: partialTeams,
            scheduledAt: Number.isFinite(scheduledAt) ? scheduledAt : null,
          },
        ];
      }
      throw new Error(`Match ${index + 1} needs a positive number and exactly six valid teams.`);
    }
    return [{ matchNumber, teams, scheduledAt: Number.isFinite(scheduledAt) ? scheduledAt : null }];
  });
  const names = (
    input.teamNames && typeof input.teamNames === "object"
      ? input.teamNames
      : input.teams && !Array.isArray(input.teams) && typeof input.teams === "object"
        ? input.teams
        : {}
  ) as Record<string, unknown>;
  const teams = new Map<string, string>();
  for (const match of matches)
    for (const number of match.teams) if (number) teams.set(number, text(names[number], 120));
  return { matches, teams, invalidRows };
}

manualRoutes.put("/manual-schedule", requireAuth, async (c) => {
  if (!(await isStrategyAdmin(c))) return c.json({ error: "Strategy lead access required." }, 403);
  const config = await first<{ event_key: string }>(
    dbOf(c),
    sql`SELECT event_key FROM (SELECT * FROM ${strategyEventConfig} WHERE ${inTeam(strategyEventConfig, c.get("teamId"))}) AS scoped_strategy_event_config WHERE id = 1 AND schedule_mode = 'manual'`,
  );
  if (!config?.event_key) return c.json({ error: "Switch to all-manual mode first." }, 409);
  let schedule: ReturnType<typeof validatedSchedule>;
  try {
    schedule = validatedSchedule(await c.req.json());
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : "Invalid schedule." }, 400);
  }
  const cachedTeamRows = await all<{ teams_json: string }>(
    dbOf(c),
    sql`SELECT teams_json FROM tba_team_cache ORDER BY expires_at DESC LIMIT 20`,
  );
  const knownNames = new Map<string, string>();
  for (const row of cachedTeamRows.results) {
    for (const team of parseJson<TbaTeam[]>(row.teams_json, [])) {
      if (!knownNames.has(String(team.team_number)))
        knownNames.set(String(team.team_number), team.nickname || team.name || "");
    }
  }
  for (const [number, name] of Array.from(schedule.teams.entries())) {
    if (!name) schedule.teams.set(number, knownNames.get(number) || "");
  }
  const statements: WriteQuery[] = [
    dbOf(c)
      .delete(manualMatches)
      .where(inTeam(manualMatches, c.get("teamId"), sql`event_key = ${config.event_key}`)),
    dbOf(c)
      .delete(manualTeams)
      .where(inTeam(manualTeams, c.get("teamId"), sql`event_key = ${config.event_key}`)),
  ];
  for (const [number, name] of Array.from(schedule.teams.entries()))
    statements.push(
      dbOf(c)
        .insert(manualTeams)
        .values(
          withTeam(c.get("teamId"), {
            event_key: config.event_key,
            team_number: number,
            team_name: name,
          }),
        ),
    );
  for (const match of schedule.matches)
    statements.push(
      dbOf(c)
        .insert(manualMatches)
        .values(
          withTeam(c.get("teamId"), {
            event_key: config.event_key,
            match_key: `${config.event_key}_qm${match.matchNumber}`,
            match_number: match.matchNumber,
            scheduled_at: match.scheduledAt,
            red_1: match.teams[0],
            red_2: match.teams[1],
            red_3: match.teams[2],
            blue_1: match.teams[3],
            blue_2: match.teams[4],
            blue_3: match.teams[5],
          }),
        ),
    );
  await batch(dbOf(c), statements);
  return c.json({ ok: true, matchCount: schedule.matches.length, teamCount: schedule.teams.size });
});

manualRoutes.post("/manual-schedule/extract", requireAuth, async (c) => {
  if (!(await isStrategyAdmin(c))) return c.json({ error: "Strategy lead access required." }, 403);
  const form = await c.req.formData();
  const files = form.getAll("files").filter((value): value is File => value instanceof File);
  const legacyFile = form.get("file");
  if (!files.length && legacyFile instanceof File) files.push(legacyFile);
  if (!files.length)
    return c.json({ error: "Choose one or more schedule photos or documents." }, 400);
  if (files.length > 4) return c.json({ error: "Upload no more than four pages at once." }, 400);
  if (
    files.some((file) => file.size > 15_000_000) ||
    files.reduce((n, file) => n + file.size, 0) > 40_000_000
  )
    return c.json({ error: "Each file must be under 15 MB and the upload under 40 MB." }, 413);

  const prompt = `Read this FRC match schedule photo or screenshot. Transcribe every visible practice, qualification, or playoff match.
The page may be angled, rotated, wrinkled, dim, or contain tables side by side. Side-by-side blocks continue the schedule. Ignore rankings, page numbers, and sponsor text.
Copy the six team cells in their exact printed LEFT-TO-RIGHT order. Set "o" to "blue-red" when the headers show Blue 1-3 before Red 1-3, otherwise set it to "red-blue". Keep the match-number column separate: match 6 followed by team ${ourTeam(c).replace(/^frc/, "")} means ${ourTeam(c).replace(/^frc/, "")}, never 6${ourTeam(c).replace(/^frc/, "")}. Never guess an unreadable digit.
Inspect each row digit-by-digit. Always include every visible match row and use null only for an individual team cell that truly cannot be read; never omit the entire row.
Return ONLY compact JSON: {"matches":[{"n":1,"t":null,"o":"red-blue","a":[${ourTeam(c).replace(/^frc/, "")},1771,4910,2974,6829,8736]}]}. No names, markdown, or explanations.`;
  const visionOutput = async (result: unknown) => {
    const modelResult = result as {
      response?: string;
      description?: string;
      result?: string;
      choices?: { message?: { content?: string } }[];
    };
    return result instanceof Response
      ? await result.text()
      : result instanceof ReadableStream
        ? await new Response(result).text()
        : typeof result === "string"
          ? result
          : String(
              modelResult.response ??
                modelResult.description ??
                modelResult.result ??
                modelResult.choices?.[0]?.message?.content ??
                "",
            );
  };
  const runVision = (
    encodedImage: string,
    mimeType: string,
    requestPrompt: string,
    maxTokens = 768,
  ) =>
    withTimeout(
      c.env.AI.run("@cf/google/gemma-4-26b-a4b-it", {
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: requestPrompt },
              { type: "image_url", image_url: { url: `data:${mimeType};base64,${encodedImage}` } },
            ],
          },
        ],
        max_tokens: maxTokens,
        temperature: 0,
        chat_template_kwargs: { enable_thinking: false },
      } as never),
      30_000,
      "Image scan",
    );
  const combinedMatches = new Map<
    number,
    { matchNumber: number; scheduledAt: number | null; teams: string[] }
  >();
  const combinedTeams = new Map<string, string>();
  const warnings: string[] = [];
  const knownTeamNumbers = new Set<string>([ourTeam(c).replace(/^frc/, "")]);
  const cachedTeams = await all<{ teams_json: string }>(
    dbOf(c),
    sql`SELECT teams_json FROM tba_team_cache ORDER BY expires_at DESC LIMIT 20`,
  );
  for (const row of cachedTeams.results)
    for (const team of parseJson<TbaTeam[]>(row.teams_json, []))
      knownTeamNumbers.add(String(team.team_number));
  const isOneOcrEdit = (left: string, right: string) => {
    if (left === right) return true;
    if (left.length === right.length) {
      const differences = Array.from({ length: left.length }, (_, index) => index).filter(
        (index) => left[index] !== right[index],
      );
      return (
        differences.length === 1 ||
        (differences.length === 2 &&
          differences[1] === differences[0] + 1 &&
          left[differences[0]] === right[differences[1]] &&
          left[differences[1]] === right[differences[0]])
      );
    }
    const longer = left.length > right.length ? left : right;
    const shorter = left.length > right.length ? right : left;
    if (longer.length !== shorter.length + 1) return false;
    return Array.from({ length: longer.length }, (_, index) => index).some(
      (index) => longer.slice(0, index) + longer.slice(index + 1) === shorter,
    );
  };
  const normalizeScannedTeam = (number: string) => {
    if (!number) return "";
    if (knownTeamNumbers.has(number)) return number;
    const candidates = new Set<string>();
    for (const known of Array.from(knownTeamNumbers)) {
      if (Number(number) > MAX_FRC_TEAM_NUMBER) {
        if (isOneOcrEdit(number, known)) candidates.add(known);
        continue;
      }
      for (let index = 0; index < number.length - 1; index += 1) {
        const chars = number.split("");
        [chars[index], chars[index + 1]] = [chars[index + 1], chars[index]];
        if (chars.join("") === known) candidates.add(known);
      }
    }
    if (candidates.size === 1) return Array.from(candidates)[0];
    return Number(number) <= MAX_FRC_TEAM_NUMBER ? number : "";
  };
  let cachedPageCount = 0;
  const now = Date.now();
  const usageWindow = Math.floor(now / 3_600_000) * 3_600_000;
  await batch(dbOf(c), [
    dbOf(c)
      .delete(manualScanCache)
      .where(inTeam(manualScanCache, c.get("teamId"), sql`expires_at <= ${now}`)),
    dbOf(c)
      .delete(manualScanUsage)
      .where(
        inTeam(
          manualScanUsage,
          c.get("teamId"),
          sql`window_started_at < ${usageWindow - 86_400_000}`,
        ),
      ),
  ]);

  for (const file of files) {
    try {
      const buffer = await file.arrayBuffer();
      const digest = await crypto.subtle.digest("SHA-256", buffer);
      const contentHash = Array.from(new Uint8Array(digest), (byte) =>
        byte.toString(16).padStart(2, "0"),
      ).join("");
      const cached = await first<{ result_json: string }>(
        dbOf(c),
        sql`SELECT result_json FROM (SELECT * FROM ${manualScanCache} WHERE ${inTeam(manualScanCache, c.get("teamId"))}) AS scoped_manual_scan_cache WHERE content_hash = ${contentHash} AND expires_at > ${now}`,
      );
      let schedule: ReturnType<typeof validatedSchedule>;
      if (cached) {
        schedule = validatedSchedule(parseJson(cached.result_json, {}), true);
        cachedPageCount += 1;
        if (schedule.invalidRows.length)
          warnings.push(
            `${file.name}: match${schedule.invalidRows.length === 1 ? "" : "es"} ${schedule.invalidRows.join(", ")} still ${schedule.invalidRows.length === 1 ? "has" : "have"} a blank team cell for review`,
          );
        for (const match of schedule.matches) combinedMatches.set(match.matchNumber, match);
        for (const [number, name] of Array.from(schedule.teams.entries()))
          if (name || !combinedTeams.has(number)) combinedTeams.set(number, name);
        continue;
      }
      const usage = await first<{ page_count: number }>(
        dbOf(c),
        sql`SELECT page_count FROM (SELECT * FROM ${manualScanUsage} WHERE ${inTeam(manualScanUsage, c.get("teamId"))}) AS scoped_manual_scan_usage WHERE user_id = ${c.get("userId")} AND window_started_at = ${usageWindow}`,
      );
      if ((usage?.page_count ?? 0) >= 12)
        throw new Error(
          "hourly scan limit reached; try again next hour or enter this page manually",
        );
      await dbOf(c)
        .insert(manualScanUsage)
        .values(
          withTeam(c.get("teamId"), {
            user_id: c.get("userId"),
            window_started_at: usageWindow,
            page_count: 1,
          }),
        )
        .onConflictDoUpdate({
          target: [
            manualScanUsage.teamId,
            manualScanUsage.user_id,
            manualScanUsage.window_started_at,
          ],
          set: { page_count: sql`page_count + 1` },
        })
        .run();
      let result: unknown;
      let encodedImage: string | null = null;
      if (file.type.startsWith("image/")) {
        const bytes = new Uint8Array(buffer);
        let binary = "";
        for (let offset = 0; offset < bytes.length; offset += 32_768)
          binary += String.fromCharCode(...Array.from(bytes.subarray(offset, offset + 32_768)));
        encodedImage = btoa(binary);
        result = await runVision(
          encodedImage,
          file.type,
          prompt,
          file.name.includes("-photo-") ? 768 : 1536,
        );
      } else {
        const converted = await withTimeout(
          c.env.AI.toMarkdown({ name: file.name, blob: file }),
          30_000,
          "Document conversion",
        );
        const markdown = Array.isArray(converted) ? converted[0] : converted;
        if (!markdown || markdown.format === "error")
          throw new Error(markdown?.error || "could not be read");
        result = await withTimeout(
          c.env.AI.run("@cf/meta/llama-3.1-8b-instruct-fast", {
            prompt: `${prompt}\n\n${markdown.data}`,
          }),
          30_000,
          "Schedule extraction",
        );
      }
      const output = await visionOutput(result);
      const jsonText = firstJsonObject(output);
      if (!jsonText)
        throw new Error("the AI response was incomplete; try closer photos of smaller sections");
      const parsedVisionResult = JSON.parse(jsonText);
      schedule = validatedSchedule(parsedVisionResult, true);
      for (const match of schedule.matches) match.teams = match.teams.map(normalizeScannedTeam);
      for (const match of schedule.matches)
        if (
          match.teams.some((number) => !number) &&
          !schedule.invalidRows.includes(match.matchNumber)
        )
          schedule.invalidRows.push(match.matchNumber);
      if (encodedImage && schedule.invalidRows.length && (usage?.page_count ?? 0) < 11) {
        try {
          await dbOf(c)
            .update(manualScanUsage)
            .set({ page_count: sql`page_count + 1` })
            .where(
              inTeam(
                manualScanUsage,
                c.get("teamId"),
                sql`user_id = ${c.get("userId")} AND window_started_at = ${usageWindow}`,
              ),
            )
            .run();
          const recovery = await runVision(
            encodedImage,
            file.type,
            `Zoom in mentally and read ONLY FRC match row${schedule.invalidRows.length === 1 ? "" : "s"} ${schedule.invalidRows.join(", ")} from this schedule photo. Ignore every other row.
The first pass produced these partial Red-then-Blue cells: ${schedule.matches
              .filter((match) => schedule.invalidRows.includes(match.matchNumber))
              .map(
                (match) =>
                  `${match.matchNumber}=[${match.teams.map((team) => team || "?").join(",")}]`,
              )
              .join("; ")}.
Use the printed grid and column headers to fill the question marks and verify the other digits. Keep the match number separate from team numbers. Return ONLY JSON: {"matches":[{"n":1,"red":[${ourTeam(c).replace(/^frc/, "")},1771,4910],"blue":[2974,6829,8736]}]}. Return only the requested rows, exactly six teams per row.`,
            384,
          );
          const recoveryOutput = await visionOutput(recovery);
          const recoveryJson = firstJsonObject(recoveryOutput);
          if (recoveryJson) {
            const recovered = validatedSchedule(JSON.parse(recoveryJson), true);
            for (const match of recovered.matches) {
              const existing = schedule.matches.findIndex(
                (candidate) => candidate.matchNumber === match.matchNumber,
              );
              if (existing >= 0) {
                if (
                  match.teams.filter(Boolean).length >
                  schedule.matches[existing].teams.filter(Boolean).length
                )
                  schedule.matches[existing] = match;
              } else schedule.matches.push(match);
            }
            schedule.matches.sort((a, b) => a.matchNumber - b.matchNumber);
            const stillInvalid = new Set(recovered.invalidRows);
            const recoveredNumbers = new Set(
              recovered.matches
                .filter((match) => !stillInvalid.has(match.matchNumber))
                .map((match) => match.matchNumber),
            );
            schedule.invalidRows = schedule.invalidRows.filter(
              (matchNumber) => !recoveredNumbers.has(matchNumber),
            );
            for (const match of schedule.matches)
              for (const number of match.teams)
                if (!schedule.teams.has(number)) schedule.teams.set(number, "");
          }
        } catch {
          // Keep the valid first-pass rows; the review table lets an admin add the missing row.
        }
      }
      for (const match of schedule.matches) match.teams = match.teams.map(normalizeScannedTeam);
      for (const match of schedule.matches)
        if (
          match.teams.some((number) => !number) &&
          !schedule.invalidRows.includes(match.matchNumber)
        )
          schedule.invalidRows.push(match.matchNumber);
      schedule.invalidRows.sort((a, b) => a - b);
      if (schedule.invalidRows.length)
        warnings.push(
          `${file.name}: match${schedule.invalidRows.length === 1 ? "" : "es"} ${schedule.invalidRows.join(", ")} had an unreadable or unrealistic team number; the recognized cells were kept and the missing ${schedule.invalidRows.length === 1 ? "cell is" : "cells are"} blank for review`,
        );
      schedule.teams.clear();
      for (const match of schedule.matches)
        for (const number of match.teams) if (number) schedule.teams.set(number, "");
      const suspiciousMatches = schedule.matches.filter((match) => {
        const recognized = match.teams.filter(Boolean);
        return new Set(recognized).size !== recognized.length;
      });
      if (suspiciousMatches.length) {
        warnings.push(
          `${file.name}: skipped match${suspiciousMatches.length === 1 ? "" : "es"} ${suspiciousMatches.map((match) => match.matchNumber).join(", ")} because the scan repeated a team number`,
        );
        const suspiciousNumbers = new Set(suspiciousMatches.map((match) => match.matchNumber));
        schedule.matches = schedule.matches.filter(
          (match) => !suspiciousNumbers.has(match.matchNumber),
        );
      }
      if (!schedule.matches.length) throw new Error("no complete match rows were recognized");
      await dbOf(c)
        .insert(manualScanCache)
        .values(
          withTeam(c.get("teamId"), {
            content_hash: contentHash,
            result_json: JSON.stringify({
              matches: schedule.matches,
              teams: Object.fromEntries(schedule.teams),
            }),
            expires_at: now + 86_400_000,
          }),
        )
        .onConflictDoUpdate({
          target: [manualScanCache.teamId, manualScanCache.content_hash],
          set: { result_json: sql`excluded.result_json`, expires_at: sql`excluded.expires_at` },
        })
        .run();
      for (const match of schedule.matches) combinedMatches.set(match.matchNumber, match);
      for (const [number, name] of Array.from(schedule.teams.entries()))
        if (name || !combinedTeams.has(number)) combinedTeams.set(number, name);
    } catch (error) {
      warnings.push(
        `${file.name}: ${error instanceof Error ? error.message : "could not be read"}`,
      );
    }
  }
  const matches = Array.from(combinedMatches.values()).sort(
    (a, b) => a.matchNumber - b.matchNumber,
  );
  if (!matches.length)
    return c.json({ error: warnings.join(" ") || "No matches were recognized." }, 422);
  return c.json({
    matches: matches.map((match) => ({
      ...match,
      scheduledAt: match.scheduledAt ? new Date(match.scheduledAt).toISOString() : null,
    })),
    teams: Object.fromEntries(combinedTeams),
    warnings,
    pageCount: files.length,
    cachedPageCount,
  });
});
