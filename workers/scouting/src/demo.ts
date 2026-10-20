import { withTeam } from "@g3/auth";
import { DEMO_PEOPLE, DEMO_STUDENTS, type DemoPerson, SAFE_TEXT, vocabularyOf } from "@g3/demo";
import { site } from "@g3/site-config";
import type { Db } from "./db";
import {
  autoRoutines,
  manualEvents,
  manualMatches,
  manualTeams,
  playoffMatches,
  playoffReports,
  playoffSessions,
  scoutingFormSubmissions,
  scoutingForms,
  scoutingMatchAssignments,
  serviceTickets,
  strategyAdmins,
  strategyAnnouncements,
  strategyEventConfig,
  teamComments,
  tierLists,
} from "./db/schema";
import { resolveBracket } from "./playoff-bracket";
import { STARTER_FIELDS, fieldsForSlot } from "./playoffs";

// The public demo's Scouting (roadmap 5.3), loaded after its nightly reset: an event in progress
// with a schedule entered by hand (so nothing depends on The Blue Alliance), match and pit
// forms with reports from the first matches, a pick list, comments, an auto routine, scouting
// assignments for the next matches, an announcement and a breakdown ticket. The other teams at
// the event have made-up five-digit numbers, so none is a real team.

const HOUR = 60 * 60 * 1000;

const OTHER_TEAMS = [
  "Practice Field Robotics",
  "The Sample Bots",
  "Demo Robotics",
  "Gear Grinders",
  "Circuit Breakers",
  "Torque Team",
  "Bolt Brigade",
  "Iron Owls",
  "Spark Plugs",
  "Wire Wizards",
  "Hex Shafts",
  "Brushless Bears",
  "Chain Reaction",
  "Pneumatic Pandas",
  "Swerve Swans",
  "Gusset Gang",
  "Rivet Raccoons",
];

/** The teams at the event: the demo team, and the made-up others. */
const TEAMS = [
  { number: String(site.demo.teamNumber), name: site.demo.name },
  ...OTHER_TEAMS.map((name, i) => ({ number: String(99901 + i), name })),
];

const EVENT_NAME = "Demo District Event";
const MATCHES = 24;
/** The match being played now: reports are in for the ones before it. */
const CURRENT_MATCH = 9;

const MATCH_FIELDS = [
  {
    id: "auto_left",
    label: "Did they leave the starting zone?",
    type: "mcq",
    options: ["Yes", "No"],
  },
  { id: "auto_pieces", label: "How many pieces in auto?", type: "counter", min: 0, max: 10 },
  { id: "teleop_pieces", label: "Pieces scored in teleop", type: "counter", min: 0, max: 30 },
  { id: "climb", label: "Climb level", type: "mcq", options: ["None", "Low", "Mid", "High"] },
  { id: "defense", label: "Defense rating", type: "slider", min: 0, max: 5, step: 1 },
  { id: "notes", label: "Notes", type: "longText" },
].map((field) => ({
  required: false,
  options: [] as string[],
  min: 0,
  max: 10,
  step: 1,
  ...field,
}));

const PIT_FIELDS = [
  { id: "drivetrain", label: "Drivetrain", type: "mcq", options: ["Swerve", "Tank", "Mecanum"] },
  { id: "climb", label: "Can they climb?", type: "mcq", options: ["Yes", "No"] },
  { id: "notes", label: "Notes", type: "longText" },
].map((field) => ({
  required: false,
  options: [] as string[],
  min: 0,
  max: 10,
  step: 1,
  ...field,
}));

const TIERS = [
  { id: "first", name: "First pick", color: "#16a34a" },
  { id: "second", name: "Second pick", color: "#2563eb" },
  { id: "defense", name: "Defense", color: "#d97706" },
  { id: "backup", name: "Backup", color: "#6b7280" },
];

const AUTO = {
  name: "3-piece center",
  summary: "Starts in the middle and scores three pieces.",
  steps: ["Score the preload", "Drive to the center line", "Pick up and score two more"],
};

/** Who plays in a match: six teams, turning over so everyone plays several times. */
function lineup(match: number): string[] {
  return [0, 1, 2, 3, 4, 5].map((slot) => {
    const team = TEAMS[(match * 7 + slot * 3) % TEAMS.length] as (typeof TEAMS)[number];
    return team.number;
  });
}

/** One scout's made-up report on a team in a match, steady per team so averages mean something. */
function report(team: number, match: number) {
  const skill = (team % 7) + 1;
  return {
    auto_left: skill > 2 ? "Yes" : "No",
    auto_pieces: Math.min(4, Math.floor(skill / 2) + (match % 2)),
    teleop_pieces: skill * 2 + (match % 3),
    climb: ["None", "Low", "Mid", "High"][Math.min(3, Math.floor(skill / 2))],
    defense: (team + match) % 6,
    notes: SAFE_TEXT.observation[(team + match) % SAFE_TEXT.observation.length],
  };
}

export async function loadDemo(db: Db, teamId: string) {
  const now = Date.now();
  const mentor = DEMO_PEOPLE[1] as DemoPerson;
  const admin = DEMO_PEOPLE[2] as DemoPerson;
  const eventKey = `manual-${new Date(now).getUTCFullYear()}-demo`;
  const endsAt = now + 2 * 24 * HOUR;
  const firstMatch = now - CURRENT_MATCH * 0.2 * HOUR;

  await db.insert(manualEvents).values(
    withTeam(teamId, {
      event_key: eventKey,
      event_name: EVENT_NAME,
      ends_at: endsAt,
      delete_after: endsAt + 3 * 24 * HOUR,
      created_by: mentor.id,
      updated_at: now,
    }),
  );
  await db.insert(strategyEventConfig).values(
    withTeam(teamId, {
      id: 1,
      event_key: eventKey,
      current_match_number: CURRENT_MATCH,
      updated_by: mentor.id,
      updated_at: now,
      schedule_mode: "manual",
    }),
  );
  for (const team of TEAMS) {
    await db
      .insert(manualTeams)
      .values(
        withTeam(teamId, { event_key: eventKey, team_number: team.number, team_name: team.name }),
      );
  }
  for (let match = 1; match <= MATCHES; match++) {
    const [red1, red2, red3, blue1, blue2, blue3] = lineup(match) as [
      string,
      string,
      string,
      string,
      string,
      string,
    ];
    await db.insert(manualMatches).values(
      withTeam(teamId, {
        event_key: eventKey,
        match_key: `${eventKey}_qm${match}`,
        comp_level: "qm",
        set_number: 1,
        match_number: match,
        scheduled_at: firstMatch + (match - 1) * 0.2 * HOUR,
        red_1: red1,
        red_2: red2,
        red_3: red3,
        blue_1: blue1,
        blue_2: blue2,
        blue_3: blue3,
      }),
    );
  }

  for (const person of [mentor, admin]) {
    await db.insert(strategyAdmins).values(
      withTeam(teamId, {
        user_id: person.id,
        email: person.email,
        display_name: person.name,
        granted_by: admin.id,
        created_at: now,
      }),
    );
  }

  const forms = [
    { id: "form_scouting", name: "Scouting", kind: "scouting", fields: MATCH_FIELDS },
    { id: "form_pit_scouting", name: "Pit Scouting", kind: "pit", fields: PIT_FIELDS },
  ];
  for (const form of forms) {
    await db.insert(scoutingForms).values(
      withTeam(teamId, {
        id: form.id,
        name: form.name,
        description: "",
        fields_json: JSON.stringify(form.fields),
        form_kind: form.kind,
        is_active: 1,
        created_by: mentor.id,
        created_at: now - 7 * 24 * HOUR,
        updated_at: now - 7 * 24 * HOUR,
      }),
    );
  }

  // Match reports for the matches already played, one scout per robot.
  let reports = 0;
  for (let match = 1; match < CURRENT_MATCH; match++) {
    for (const [slot, number] of lineup(match).entries()) {
      const scout = DEMO_STUDENTS[(match + slot) % DEMO_STUDENTS.length] as DemoPerson;
      await db.insert(scoutingFormSubmissions).values(
        withTeam(teamId, {
          id: `demo-${match}-${slot}`,
          form_id: "form_scouting",
          answers_json: JSON.stringify(report(Number(number), match)),
          submitted_by: scout.id,
          submitted_by_name: scout.name,
          created_at: firstMatch + match * 0.2 * HOUR,
          team_name: number,
          event_key: eventKey,
          match_key: `${eventKey}_qm${match}`,
          match_number: match,
          fields_json: JSON.stringify(MATCH_FIELDS),
        }),
      );
      reports++;
    }
  }
  for (const [i, team] of TEAMS.slice(0, 8).entries()) {
    const scout = DEMO_STUDENTS[i % DEMO_STUDENTS.length] as DemoPerson;
    await db.insert(scoutingFormSubmissions).values(
      withTeam(teamId, {
        id: `demo-pit-${team.number}`,
        form_id: "form_pit_scouting",
        answers_json: JSON.stringify({
          drivetrain: ["Swerve", "Tank", "Mecanum"][i % 3],
          climb: i % 3 === 2 ? "No" : "Yes",
          notes: SAFE_TEXT.observation[i % SAFE_TEXT.observation.length],
        }),
        submitted_by: scout.id,
        submitted_by_name: scout.name,
        created_at: firstMatch - 2 * HOUR,
        team_name: team.number,
        event_key: eventKey,
        fields_json: JSON.stringify(PIT_FIELDS),
      }),
    );
  }

  // Who scouts the next few matches.
  for (let match = CURRENT_MATCH; match < CURRENT_MATCH + 4; match++) {
    for (const [slot, number] of lineup(match).entries()) {
      const scout = DEMO_STUDENTS[(match + slot) % DEMO_STUDENTS.length] as DemoPerson;
      await db
        .insert(scoutingMatchAssignments)
        .values(
          withTeam(teamId, {
            event_key: eventKey,
            match_number: match,
            user_id: scout.id,
            team_number: number,
            assigned_at: now,
          }),
        )
        .onConflictDoNothing();
    }
  }

  const ranked = TEAMS.slice(1).map((team) => team.number);
  await db.insert(tierLists).values(
    withTeam(teamId, {
      id: "demo-pick-list",
      name: "Pick list",
      description: "",
      tiers_json: JSON.stringify(
        TIERS.map((tier, i) => ({ ...tier, items: ranked.slice(i * 4, i * 4 + 4) })),
      ),
      created_by: mentor.id,
      created_at: now - HOUR,
      updated_at: now - HOUR,
    }),
  );

  for (const [i, number] of ranked.slice(0, 4).entries()) {
    const scout = DEMO_STUDENTS[i] as DemoPerson;
    await db.insert(teamComments).values(
      withTeam(teamId, {
        id: `demo-comment-${i}`,
        team_name: number,
        comment: SAFE_TEXT.strategy[i % SAFE_TEXT.strategy.length] as string,
        event_key: eventKey,
        created_by: scout.id,
        created_by_name: scout.name,
        created_at: now - (i + 1) * HOUR,
      }),
    );
  }

  await db.insert(autoRoutines).values(
    withTeam(teamId, {
      id: "demo-auto",
      name: AUTO.name,
      robot_name: String(site.demo.teamNumber),
      summary: AUTO.summary,
      steps_json: JSON.stringify(AUTO.steps),
      tags_json: "[]",
      created_by: mentor.id,
      created_at: now - 3 * 24 * HOUR,
      updated_at: now - 3 * 24 * HOUR,
    }),
  );

  await db.insert(strategyAnnouncements).values(
    withTeam(teamId, {
      id: "demo-announcement",
      message: "Scouts for the next four matches are posted. Check your assignments.",
      created_by: mentor.id,
      created_by_name: mentor.name,
      created_at: now - HOUR,
      expires_at: now + 12 * HOUR,
    }),
  );

  const reporter = DEMO_STUDENTS[2] as DemoPerson;
  await db.insert(serviceTickets).values(
    withTeam(teamId, {
      id: "demo-ticket",
      team_name: ranked[5] as string,
      issue_type: "electrical",
      description: SAFE_TEXT.issue[1] as string,
      status: "open",
      created_by: reporter.id,
      created_by_name: reporter.name,
      created_at: now - 0.5 * HOUR,
      updated_at: now - 0.5 * HOUR,
      event_key: eventKey,
    }),
  );
  await loadDemoPlayoffs(db, teamId, now);
  return { matches: MATCHES, reports };
}

const PLAYOFF_EVENT = "Demo Offseason Event";
/** The last event's playoffs, with the demo team on alliance 2. */
const PLAYOFF_ALLIANCES = [
  [1, 2, 3],
  [0, 4, 5],
  [6, 7, 8],
  [9, 10, 11],
].map((picks, index) => ({
  seed: index + 1,
  teams: picks.map((pick) => (TEAMS[pick] as (typeof TEAMS)[number]).number),
}));
const PLAYOFF_RESULTS = {
  M1: "red",
  M2: "red",
  M3: "blue",
  M4: "blue",
  M5: "red",
  F1: "red",
  F2: "red",
} as const;

/** A finished playoff session from the week before, with a few reports per match. */
async function loadDemoPlayoffs(db: Db, teamId: string, now: number) {
  const sessionId = "demo-playoffs";
  const startedAt = now - 7 * 24 * HOUR;
  const mentor = DEMO_PEOPLE[1] as DemoPerson;
  await db.insert(playoffSessions).values(
    withTeam(teamId, {
      id: sessionId,
      event_name: PLAYOFF_EVENT,
      format: "double4",
      status: "finished",
      alliances_json: JSON.stringify(PLAYOFF_ALLIANCES),
      created_by: mentor.id,
      created_at: startedAt - HOUR,
      started_at: startedAt,
      finished_at: startedAt + 4 * HOUR,
      updated_at: startedAt + 4 * HOUR,
    }),
  );
  const bracket = resolveBracket("double4", PLAYOFF_RESULTS);
  for (const [index, match] of bracket.filter((item) => item.winner).entries()) {
    const at = startedAt + index * 0.4 * HOUR;
    await db.insert(playoffMatches).values(
      withTeam(teamId, {
        session_id: sessionId,
        match_id: match.id,
        started_at: at,
        winner: match.winner,
        decided_at: at + 0.2 * HOUR,
      }),
    );
    // The whole red alliance and one robot on each side.
    const slots = (["red", "blue"] as const).flatMap((side) => {
      const seed = match[side] as number;
      const team = PLAYOFF_ALLIANCES[seed - 1]?.teams[index % 3] as string;
      return side === "red"
        ? [
            { slot: "red:overall", seed, team: "" },
            { slot: `red:${team}`, seed, team },
          ]
        : [{ slot: `blue:${team}`, seed, team }];
    });
    for (const [n, slot] of slots.entries()) {
      const scout = DEMO_STUDENTS[(index + n) % DEMO_STUDENTS.length] as DemoPerson;
      const fields = fieldsForSlot(STARTER_FIELDS, slot.slot);
      const pick = (list: readonly string[], k: number) =>
        list[(index + n + k) % list.length] as string;
      await db.insert(playoffReports).values(
        withTeam(teamId, {
          id: `demo-playoff-${match.id}-${n}`,
          session_id: sessionId,
          match_id: match.id,
          slot: slot.slot,
          alliance_seed: slot.seed,
          team_number: slot.team,
          answers_json: JSON.stringify({
            ...(slot.team ? { bay: String(((index + n) % 3) + 1) } : {}),
            auto: pick(SAFE_TEXT.observation, 0),
            strategy: pick(SAFE_TEXT.strategy, 1),
          }),
          fields_json: JSON.stringify(fields),
          submitted_by: scout.id,
          submitted_by_name: scout.name,
          created_at: at + 0.15 * HOUR,
          updated_at: at + 0.15 * HOUR,
        }),
      );
    }
  }
}

/** The words in the demo's Scouting data, for the gateway. */
export const demoWords = (): string[] =>
  vocabularyOf(TEAMS, EVENT_NAME, MATCH_FIELDS, PIT_FIELDS, TIERS, AUTO, "Pick list", [
    "Scouts for the next four matches are posted. Check your assignments.",
    "Scouting Pit",
    PLAYOFF_EVENT,
    ...STARTER_FIELDS.map((field) => field.label),
  ]);
