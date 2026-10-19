import { requireAdmin, requireAuth, requireMentor, requireOAuthSession } from "@g3/auth";
import { type Context, Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { AgentError, agentFetch } from "../../lib/agent";
import type { AppEnv } from "../../types";
import {
  MAX_SWITCH_SOUND_BYTES,
  type SwitchSound,
  type SwitchState,
  type SwitchSubmission,
  isWaveFile,
  validSwitchSoundName,
} from "./types";

type Ctx = Context<AppEnv>;

async function relay<T>(c: Ctx, path: string, init?: Parameters<typeof agentFetch>[3]) {
  try {
    const res = await agentFetch(c.env, c.get("teamId"), `/switch${path}`, init);
    const body = (await res.json().catch(() => ({}))) as T & { error?: string };
    if (!res.ok) {
      return {
        error: body.error ?? `Door switch error (HTTP ${res.status}).`,
        status: res.status === 400 ? 400 : 502,
      } as const;
    }
    return { data: body } as const;
  } catch (error) {
    if (error instanceof AgentError) return { error: error.message, status: error.status } as const;
    throw error;
  }
}

function soundName(c: Ctx) {
  const name = c.req.param("name") ?? c.req.query("name") ?? "";
  return validSwitchSoundName(name) ? name : null;
}

const soundLimit = bodyLimit({
  maxSize: MAX_SWITCH_SOUND_BYTES,
  onError: (c) => c.json({ error: "WAV files must be between 1 byte and 10 MB." }, 400),
});

export const switchRouter = new Hono<AppEnv>()
  .get("/submissions", requireAuth, requireOAuthSession, async (c) => {
    const query = c.get("userIsAdmin") ? "" : `?userId=${encodeURIComponent(c.get("userId"))}`;
    const result = await relay<{ submissions: SwitchSubmission[] }>(c, `/submissions${query}`);
    if ("error" in result) return c.json({ error: result.error }, result.status);
    return c.json(result.data);
  })
  .post("/submissions", requireAuth, requireOAuthSession, soundLimit, async (c) => {
    const name = soundName(c);
    if (!name)
      return c.json(
        {
          error:
            "Use a WAV filename with letters, numbers, spaces, dots, dashes or underscores (5-100 characters).",
        },
        400,
      );
    const audio = new Uint8Array(await c.req.arrayBuffer());
    if (!audio.length || audio.length > MAX_SWITCH_SOUND_BYTES || !isWaveFile(audio))
      return c.json({ error: "Upload a valid WAV file up to 10 MB." }, 400);
    const params = new URLSearchParams({
      name,
      userId: c.get("userId"),
      submittedBy: c.get("userDisplayName"),
    });
    const result = await relay<{ submission: SwitchSubmission }>(
      c,
      `/submissions?${params.toString()}`,
      { method: "POST", headers: { "Content-Type": "audio/wav" }, body: audio, timeoutMs: 60_000 },
    );
    if ("error" in result) return c.json({ error: result.error }, result.status);
    return c.json(result.data, 201);
  })
  .post("/submissions/:id/:action", requireAdmin, async (c) => {
    const id = c.req.param("id");
    const action = c.req.param("action");
    if (!/^[0-9a-f-]{36}$/.test(id) || !["approve", "reject", "test"].includes(action))
      return c.json({ error: "Invalid review action." }, 400);
    const result = await relay<{ ok?: true; submission?: SwitchSubmission }>(
      c,
      `/submissions/${id}/${action}?reviewedBy=${encodeURIComponent(c.get("userId"))}`,
      { method: "POST" },
    );
    if ("error" in result) return c.json({ error: result.error }, result.status);
    return c.json(result.data);
  })
  .get("/state", requireMentor, async (c) => {
    const result = await relay<SwitchState>(c, "/state");
    if ("error" in result) return c.json({ error: result.error }, result.status);
    return c.json(result.data);
  })
  .put("/settings", requireMentor, async (c) => {
    const body = await c.req.json().catch(() => null);
    if (!body) return c.json({ error: "Expected playback settings." }, 400);
    const result = await relay<{ ok: true }>(c, "/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if ("error" in result) return c.json({ error: result.error }, result.status);
    return c.json(result.data);
  })
  .get("/sounds", requireMentor, async (c) => {
    const result = await relay<{ sounds: SwitchSound[] }>(c, "/sounds");
    if ("error" in result) return c.json({ error: result.error }, result.status);
    return c.json(result.data);
  })
  .post("/sounds", requireAdmin, async (c) => {
    const name = soundName(c);
    if (!name) {
      return c.json(
        {
          error:
            "Name must be 5-100 letters, numbers, spaces, dots, dashes, or underscores and end in .wav.",
        },
        400,
      );
    }
    const contentLength = Number(c.req.header("Content-Length") ?? 0);
    if (contentLength > MAX_SWITCH_SOUND_BYTES) {
      return c.json({ error: "WAV files must be between 1 byte and 10 MB." }, 400);
    }
    const data = new Uint8Array(await c.req.arrayBuffer());
    if (data.length === 0 || data.length > MAX_SWITCH_SOUND_BYTES) {
      return c.json({ error: "WAV files must be between 1 byte and 10 MB." }, 400);
    }
    if (!isWaveFile(data))
      return c.json({ error: "The file is not a valid RIFF/WAVE audio file." }, 400);

    const result = await relay<{ ok: true; sounds: SwitchSound[] }>(
      c,
      `/sounds?name=${encodeURIComponent(name)}`,
      {
        method: "POST",
        headers: { "Content-Type": "audio/wav" },
        body: data,
        timeoutMs: 60_000,
      },
    );
    if ("error" in result) return c.json({ error: result.error }, result.status);
    return c.json(result.data);
  })
  .patch("/sounds/:name", requireMentor, async (c) => {
    const name = soundName(c);
    const body = await c.req.json().catch(() => null);
    if (!name || typeof body?.name !== "string" || !validSwitchSoundName(body.name))
      return c.json(
        {
          error:
            "Use a WAV filename with letters, numbers, spaces, dots, dashes or underscores (5-100 characters).",
        },
        400,
      );
    const result = await relay<{ ok: true; sounds: SwitchSound[] }>(
      c,
      `/sounds/${encodeURIComponent(name)}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: body.name }),
      },
    );
    if ("error" in result) return c.json({ error: result.error }, result.status);
    return c.json(result.data);
  })
  .post("/sounds/:name/test", requireAdmin, async (c) => {
    const name = soundName(c);
    if (!name) return c.json({ error: "Invalid sound name." }, 400);
    const result = await relay<{ ok: true; sound: string }>(
      c,
      `/sounds/${encodeURIComponent(name)}/test`,
      { method: "POST" },
    );
    if ("error" in result) return c.json({ error: result.error }, result.status);
    return c.json(result.data);
  })
  .post("/stop", requireAdmin, async (c) => {
    const result = await relay<{ ok: true }>(c, "/stop", { method: "POST" });
    if ("error" in result) return c.json({ error: result.error }, result.status);
    return c.json(result.data);
  })
  .delete("/sounds/:name", requireAdmin, async (c) => {
    const name = soundName(c);
    if (!name) return c.json({ error: "Invalid sound name." }, 400);
    const result = await relay<{ ok: true; sounds: SwitchSound[] }>(
      c,
      `/sounds/${encodeURIComponent(name)}`,
      { method: "DELETE" },
    );
    if ("error" in result) return c.json({ error: result.error }, result.status);
    return c.json(result.data);
  });
