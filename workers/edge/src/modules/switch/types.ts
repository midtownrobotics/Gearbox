export const MAX_SWITCH_SOUND_BYTES = 10 * 1024 * 1024;

export interface SwitchSound {
  name: string;
  size: number;
}

export interface SwitchClipSettings {
  delaySeconds: number;
  volumePercent: number;
}

export interface SwitchPlaybackSettings {
  soundSettings: Record<string, SwitchClipSettings>;
  volumePercent: number;
  delaySeconds: number;
  selectedSounds: string[];
}

export interface SwitchState extends SwitchPlaybackSettings {
  input: "gpio" | "placeholder";
  gpio: string | null;
  audioDevice: string;
  closedWhenGrounded: true;
  rawGrounded: boolean;
  grounded: boolean;
  triggerCount: number;
  lastTriggeredAt: number | null;
  lastSound: string | null;
  lastError: string | null;
  sounds: SwitchSound[];
}

export function validSwitchSoundName(name: string) {
  return name.length >= 5 && name.length <= 100 && /^[A-Za-z0-9][A-Za-z0-9._ -]*\.wav$/i.test(name);
}

export function isWaveFile(data: Uint8Array) {
  if (data.length < 12) return false;
  const text = new TextDecoder("ascii");
  return (
    text.decode(data.subarray(0, 4)) === "RIFF" && text.decode(data.subarray(8, 12)) === "WAVE"
  );
}

export interface SwitchSubmission {
  id: string;
  name: string;
  userId: string;
  submittedBy: string;
  size: number;
  submittedAt: number;
  status: "pending" | "approved" | "rejected";
  reviewedBy: string | null;
}
