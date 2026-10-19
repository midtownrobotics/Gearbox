import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SwitchSound, SwitchState } from "@g3/worker-edge/switch-types";
import { createSwitchModule } from ".";
import type { AgentConfig } from "../../core/config";
import type { WorkerClient } from "../../core/worker-client";
import { SoundStoppedError } from "./player";

const wave = new Uint8Array([
  0x52, 0x49, 0x46, 0x46, 0x24, 0, 0, 0, 0x57, 0x41, 0x56, 0x45, 0x66, 0x6d, 0x74, 0x20, 0x10, 0, 0,
  0, 1, 0, 1, 0, 0x40, 0x1f, 0, 0, 0x40, 0x1f, 0, 0, 1, 0, 8, 0, 0x64, 0x61, 0x74, 0x61, 0, 0, 0, 0,
]);

describe("switch module integration", () => {
  test("uploads and tests audio, then repeats it while the door is open and stops on close", async () => {
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
    const volumes: (number | undefined)[] = [];
    const paths: (string | undefined)[] = [];
    let stopped = 0;
    let finishManual = () => {};
    let manualFinished = false;
    // The door's sound plays until it's finished or stopped, like aplay.
    let finishDoor = () => {};
    let stopDoor = () => {};
    const module = createSwitchModule(
      {
        config,
        db,
        worker: {} as WorkerClient,
        sync: { applied: 0 },
      },
      {
        async play(path, volume) {
          volumes.push(volume);
          played++;
          paths.push(path);
          if (played === 1) {
            await new Promise<void>((resolve) => {
              finishManual = resolve;
            });
            manualFinished = true;
          }
          if (played > 1) {
            await new Promise<void>((resolve, reject) => {
              finishDoor = resolve;
              stopDoor = () => reject(new SoundStoppedError());
            });
          }
          return path ?? join(soundDir, "welcome.wav");
        },
        stop() {
          stopped++;
          stopDoor();
        },
      },
    );
    if (!module.routes) throw new Error("Switch routes are missing.");

    const routes = module.routes;
    try {
      await module.start();
      const upload = await module.routes.request("/sounds?name=welcome.wav", {
        method: "POST",
        body: wave,
      });
      expect(upload.status).toBe(200);
      const uploaded = (await upload.json()) as { sounds: SwitchSound[] };
      expect(uploaded.sounds).toEqual([{ name: "welcome.wav", size: wave.length }]);

      const settings = (body: unknown) =>
        routes.request("/settings", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
      expect((await settings({ delaySeconds: -1, selectedSounds: [] })).status).toBe(400);
      expect((await settings({ delaySeconds: 0, selectedSounds: ["missing.wav"] })).status).toBe(
        400,
      );
      expect(
        (await settings({ delaySeconds: 0, selectedSounds: ["welcome.wav", "welcome.wav"] }))
          .status,
      ).toBe(400);
      expect((await settings({ delaySeconds: 0, selectedSounds: ["welcome.wav"] })).status).toBe(
        200,
      );
      expect(
        (await settings({ delaySeconds: 0, selectedSounds: [], volumePercent: 101 })).status,
      ).toBe(400);
      expect(
        (
          await settings({
            selectedSounds: [],
            soundSettings: {
              "welcome.wav": {
                delaySeconds: -1,
                volumePercent: 20,
                increaseVolume: true,
                volumeIncreasePercent: 35,
              },
            },
          })
        ).status,
      ).toBe(400);
      expect(
        (
          await settings({
            selectedSounds: [],
            soundSettings: {
              "missing.wav": {
                delaySeconds: 0,
                volumePercent: 20,
              },
            },
          })
        ).status,
      ).toBe(400);
      stopped = 0;
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

      // The sound ends with the door still open: it starts again.
      finishDoor();
      await Bun.sleep(1_100);
      expect(played).toBe(3);

      await module.routes.request("/input", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ grounded: true }),
      });
      await Bun.sleep(30);
      const closed = (await (await module.routes.request("/state")).json()) as SwitchState;
      expect(closed.grounded).toBe(true);
      expect(closed.triggerCount).toBe(1);
      expect(stopped).toBe(1);
      // Closed: it stopped, and nothing starts again.
      await Bun.sleep(1_100);
      expect(played).toBe(3);

      await module.routes.request("/input", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ grounded: false }),
      });
      await Bun.sleep(30);
      const reopened = (await (await module.routes.request("/state")).json()) as SwitchState;
      expect(reopened.grounded).toBe(false);
      expect(reopened.triggerCount).toBe(2);
      expect(played).toBe(4);

      // Stop sound ends the repeat too.
      expect((await module.routes.request("/stop", { method: "POST" })).status).toBe(200);
      await Bun.sleep(1_100);
      expect(played).toBe(4);

      // Closing during the opening delay cancels playback, including after the wait expires.
      expect((await settings({ delaySeconds: 0.1, selectedSounds: ["welcome.wav"] })).status).toBe(
        200,
      );
      const input = (grounded: boolean) =>
        routes.request("/input", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ grounded }),
        });
      await input(true);
      await Bun.sleep(30);
      await input(false);
      await Bun.sleep(30);
      expect(played).toBe(4);
      await input(true);
      await Bun.sleep(30);
      await Bun.sleep(150);
      expect(played).toBe(4);

      await input(false);
      await Bun.sleep(30);
      expect(played).toBe(4);
      await Bun.sleep(120);
      expect(played).toBe(5);
      await input(true);
      await Bun.sleep(30);

      // The playlist starts from the first selection on each opening.
      await module.routes.request("/sounds?name=second.wav", { method: "POST", body: wave });
      expect(
        (
          await settings({
            delaySeconds: 0,
            selectedSounds: ["second.wav", "welcome.wav"],
            soundSettings: {
              "second.wav": {
                delaySeconds: 0.1,
                volumePercent: 40,
                increaseVolume: true,
                volumeIncreasePercent: 35,
              },
              "welcome.wav": {
                delaySeconds: 0.2,
                volumePercent: 20,
              },
            },
            volumePercent: 40,
          })
        ).status,
      ).toBe(200);
      await input(false);
      await Bun.sleep(30);
      expect(played).toBe(5);
      await Bun.sleep(120);
      expect(played).toBe(6);
      // Each clip has its own pause before playback.
      await Bun.sleep(1000);
      finishDoor();
      await Bun.sleep(50);
      expect(played).toBe(6);
      await Bun.sleep(220);
      expect(played).toBe(7);
      expect(paths.slice(5, 7)).toEqual([
        join(soundDir, "second.wav"),
        join(soundDir, "welcome.wav"),
      ]);
      expect(volumes.slice(5, 7)).toEqual([40, 20]);
      finishDoor();
      await Bun.sleep(1250);
      expect(volumes[7]).toBe(40);
      await input(true);
      await Bun.sleep(30);
      await input(false);
      await Bun.sleep(30);
      expect(played).toBe(8);
      await Bun.sleep(120);
      expect(volumes[8]).toBe(40);
      finishDoor();
      await Bun.sleep(1250);
      expect(played).toBe(10);
      // Close in the first clip's next leading pause; the playlist must not restart.
      await Bun.sleep(1000);
      finishDoor();
      await Bun.sleep(50);
      expect(played).toBe(10);
      await input(true);
      await Bun.sleep(400);
      expect(played).toBe(10);
      expect((await settings({ delaySeconds: 0, selectedSounds: [] })).status).toBe(200);
      await input(false);
      await Bun.sleep(30);
      expect(played).toBe(10);
      await input(true);
      await Bun.sleep(30);
      // Renaming keeps playlist position and per-clip settings, including after reload.
      await settings({ selectedSounds: ["second.wav", "welcome.wav"] });
      const rename = (name: string, next: string) =>
        routes.request(`/sounds/${encodeURIComponent(name)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: next }),
        });
      expect((await rename("welcome.wav", "second.wav")).status).toBe(400);
      expect((await rename("welcome.wav", "../bad.wav")).status).toBe(400);
      expect((await rename("welcome.wav", "Greeting.wav")).status).toBe(200);
      const renamed = (await (await routes.request("/state")).json()) as SwitchState;
      expect(renamed.selectedSounds).toEqual(["second.wav", "Greeting.wav"]);
      expect(renamed.soundSettings["Greeting.wav"]).toEqual({
        delaySeconds: 0.2,
        volumePercent: 20,
      });
      expect(renamed.soundSettings["welcome.wav"]).toBeUndefined();
      expect(renamed.sounds.map((sound) => sound.name)).toEqual(["Greeting.wav", "second.wav"]);
      const reloaded = createSwitchModule({
        config,
        db,
        worker: {} as WorkerClient,
        sync: { applied: 0 },
      });
      expect(reloaded.status().selectedSounds).toEqual(["second.wav", "Greeting.wav"]);
      expect(reloaded.status().soundSettings).toEqual(renamed.soundSettings);
      expect((await rename("Greeting.wav", "Greeting.wav")).status).toBe(200);
      expect((await rename("Greeting.wav", "welcome.wav")).status).toBe(200);
      await settings({ selectedSounds: [] });
      await module.routes.request("/sounds/second.wav", { method: "DELETE" });
      const restored = createSwitchModule({
        config,
        db,
        worker: {} as WorkerClient,
        sync: { applied: 0 },
      });
      expect(restored.status().selectedSounds).toEqual([]);
      expect(restored.status().delaySeconds).toBe(0);
      expect(restored.status().volumePercent).toBe(40);
      expect(restored.status().soundSettings).toEqual({
        "welcome.wav": {
          delaySeconds: 0.2,
          volumePercent: 20,
        },
      });
      const remove = await module.routes.request("/sounds/welcome.wav", { method: "DELETE" });
      expect(remove.status).toBe(200);
      expect(((await remove.json()) as { sounds: SwitchSound[] }).sounds).toEqual([]);
    } finally {
      await module.stop();
      db.close();
      await rm(soundDir, { recursive: true, force: true });
    }
  }, 15_000);
});
