import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SwitchSound, SwitchState } from "@g3/worker-edge/switch-types";
import { createSwitchModule } from ".";
import type { AgentConfig } from "../../core/config";
import type { WorkerClient } from "../../core/worker-client";

const wave = new Uint8Array([
  0x52, 0x49, 0x46, 0x46, 0x24, 0, 0, 0, 0x57, 0x41, 0x56, 0x45, 0x66, 0x6d, 0x74, 0x20, 0x10, 0, 0,
  0, 1, 0, 1, 0, 0x40, 0x1f, 0, 0, 0x40, 0x1f, 0, 0, 1, 0, 8, 0, 0x64, 0x61, 0x74, 0x61, 0, 0, 0, 0,
]);

describe("switch module integration", () => {
  test("uploads and tests audio, then plays it on a debounced door opening", async () => {
    const soundDir = await mkdtemp(join(tmpdir(), "g3-switch-integration-"));
    const config: AgentConfig = {
      workerUrl: "http://unused",
      agentKey: "test",
      dbPath: ":memory:",
      httpPort: 8700,
      mock: true,
      wanInterface: "wan0",
      lanInterface: "lan0",
      lanIp: "192.168.50.1",
      leasesPath: "unused",
      dnsmasqConfPath: "unused",
      dnsLogPath: "unused",
      collectIntervalSeconds: 300,
      driveDir: "unused",
      driveHost: "127.0.0.1",
      drivePort: 8780,
      switchPollMilliseconds: 5,
      switchDebounceMilliseconds: 10,
      switchSounds: [],
      switchAudioPlayer: "unused",
      switchAudioDevice: "bluealsa",
      switchSoundDir: soundDir,
      switchGpioValuePath: "unused",
    };
    const db = new Database(":memory:");
    let played = 0;
    let stopped = 0;
    let finishManual = () => {};
    let manualFinished = false;
    const module = createSwitchModule(
      {
        config,
        db,
        worker: {} as WorkerClient,
        sync: { applied: 0 },
      },
      {
        async play(path) {
          played++;
          if (path) {
            await new Promise<void>((resolve) => {
              finishManual = resolve;
            });
            manualFinished = true;
          }
          return path ?? join(soundDir, "welcome.wav");
        },
        stop() {
          stopped++;
        },
      },
    );
    if (!module.routes) throw new Error("Switch routes are missing.");

    try {
      await module.start();
      const upload = await module.routes.request("/sounds?name=welcome.wav", {
        method: "POST",
        body: wave,
      });
      expect(upload.status).toBe(200);
      const uploaded = (await upload.json()) as { sounds: SwitchSound[] };
      expect(uploaded.sounds).toEqual([{ name: "welcome.wav", size: wave.length }]);

      const play = await module.routes.request("/sounds/welcome.wav/test", { method: "POST" });
      expect(play.status).toBe(200);
      expect(((await play.json()) as { sound: string }).sound).toEndWith("welcome.wav");
      expect(manualFinished).toBe(false);
      finishManual();
      await Bun.sleep(0);
      expect(manualFinished).toBe(true);

      await module.routes.request("/input", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ grounded: false }),
      });
      await Bun.sleep(30);

      const state = (await (await module.routes.request("/state")).json()) as SwitchState;
      expect(state.grounded).toBe(false);
      expect(state.triggerCount).toBe(1);
      expect(state.lastSound).toEndWith("welcome.wav");
      expect(played).toBe(2); // Manual test plus one door opening.

      await module.routes.request("/input", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ grounded: true }),
      });
      await Bun.sleep(30);
      const closed = (await (await module.routes.request("/state")).json()) as SwitchState;
      expect(closed.grounded).toBe(true);
      expect(closed.triggerCount).toBe(1);
      expect(played).toBe(2);
      expect(stopped).toBe(1);

      await module.routes.request("/input", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ grounded: false }),
      });
      await Bun.sleep(30);
      const reopened = (await (await module.routes.request("/state")).json()) as SwitchState;
      expect(reopened.grounded).toBe(false);
      expect(reopened.triggerCount).toBe(2);
      expect(played).toBe(3);

      const remove = await module.routes.request("/sounds/welcome.wav", { method: "DELETE" });
      expect(remove.status).toBe(200);
      expect(((await remove.json()) as { sounds: SwitchSound[] }).sounds).toEqual([]);
    } finally {
      await module.stop();
      db.close();
      await rm(soundDir, { recursive: true, force: true });
    }
  });
});
