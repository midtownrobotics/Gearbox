import { MAX_SWITCH_SOUND_BYTES } from "@g3/worker-edge/switch-types";
import { Hono } from "hono";
import type { EdgeModule, ModuleContext } from "../../core/module";
import { SwitchDetector } from "./detector";
import { GpioSwitchInput, PlaceholderSwitchInput } from "./input";
import {
  type SoundPlayer,
  SoundStoppedError,
  createMockSoundPlayer,
  createSoundPlayer,
} from "./player";
import { SoundLibrary } from "./sounds";

export function createSwitchModule(ctx: ModuleContext, soundPlayer?: SoundPlayer): EdgeModule {
  const input = ctx.config.mock
    ? new PlaceholderSwitchInput()
    : new GpioSwitchInput(ctx.config.switchGpioValuePath);
  const detector = new SwitchDetector(ctx.config.switchDebounceMilliseconds);
  const library = new SoundLibrary(ctx.config.switchSoundDir, ctx.config.switchSounds);
  const availableSounds = () => library.paths();
  const player =
    soundPlayer ??
    (ctx.config.mock
      ? createMockSoundPlayer(availableSounds)
      : createSoundPlayer(
          ctx.config.switchAudioPlayer,
          ctx.config.switchAudioDevice,
          availableSounds,
        ));
  let timer: ReturnType<typeof setInterval> | null = null;
  let triggerCount = 0;
  let lastTriggeredAt: number | null = null;
  let lastSound: string | null = null;
  let lastError: string | null = null;
  let reading = false;

  async function play(path?: string) {
    try {
      const sound = await player.play(path);
      lastSound = sound;
      lastError = null;
      console.log(`[switch] played ${sound}`);
      return sound;
    } catch (error) {
      if (error instanceof SoundStoppedError) throw error;
      lastError = error instanceof Error ? error.message : String(error);
      console.error(`[switch] ${lastError}`);
      throw error;
    }
  }

  function poll() {
    if (reading) return;
    reading = true;
    let grounded: boolean;
    try {
      grounded = input.readGrounded();
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      return;
    } finally {
      reading = false;
    }
    const wasRawGrounded = detector.state().rawGrounded;
    const event = detector.sample(grounded);
    // Silence the player on the first grounded reading; only openings need debounce.
    if (grounded && !wasRawGrounded) player.stop();
    if (!event.triggered) return;

    triggerCount++;
    lastTriggeredAt = Math.floor(Date.now() / 1000);
    console.log("[switch] door opened");
    void play().catch(() => {});
  }

  const status = () => ({
    input: input.type,
    gpio: input.type === "gpio" ? "GPIO2_D4 (physical pin 22, GPIO 92)" : null,
    audioDevice: ctx.config.switchAudioDevice,
    closedWhenGrounded: true,
    ...detector.state(),
    triggerCount,
    lastTriggeredAt,
    lastSound,
    lastError,
  });

  const routes = new Hono()
    .get("/state", async (c) => c.json({ ...status(), sounds: await library.list() }))
    .post("/input", async (c) => {
      if (!(input instanceof PlaceholderSwitchInput)) {
        return c.json({ error: "The software input is only available in mock mode." }, 400);
      }
      const body = (await c.req.json().catch(() => null)) as { grounded?: unknown } | null;
      if (typeof body?.grounded !== "boolean") {
        return c.json({ error: 'Expected JSON body { "grounded": boolean }.' }, 400);
      }
      input.setGrounded(body.grounded);
      poll();
      return c.json({ ok: true, ...status() });
    })
    .get("/sounds", async (c) => c.json({ sounds: await library.list() }))
    .post("/sounds", async (c) => {
      const name = c.req.query("name") ?? "";
      try {
        const contentLength = Number(c.req.header("Content-Length") ?? 0);
        if (contentLength > MAX_SWITCH_SOUND_BYTES) {
          throw new Error("WAV files must be between 1 byte and 10 MB.");
        }
        await library.upload(name, new Uint8Array(await c.req.arrayBuffer()));
        return c.json({ ok: true, sounds: await library.list() });
      } catch (error) {
        return c.json({ error: error instanceof Error ? error.message : String(error) }, 400);
      }
    })
    .post("/sounds/:name/test", async (c) => {
      try {
        const sound = library.soundPath(c.req.param("name"));
        // A sound can outlast the worker's request deadline. Acknowledge the
        // test immediately; playback errors remain visible in /state.
        void play(sound).catch(() => {});
        return c.json({ ok: true, sound });
      } catch (error) {
        return c.json({ error: error instanceof Error ? error.message : String(error) }, 400);
      }
    })
    .delete("/sounds/:name", async (c) => {
      try {
        await library.remove(c.req.param("name"));
        return c.json({ ok: true, sounds: await library.list() });
      } catch (error) {
        return c.json({ error: error instanceof Error ? error.message : String(error) }, 400);
      }
    });

  return {
    name: "switch",
    routes,
    async start() {
      await library.ensureDirectory();
      try {
        detector.reset(input.readGrounded());
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
        console.error(`[switch] ${lastError}`);
      }
      timer = setInterval(poll, ctx.config.switchPollMilliseconds);
      console.log(`[switch] door microswitch ${input.type} input ready (closed = grounded)`);
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = null;
      player.stop();
    },
    status,
  };
}
