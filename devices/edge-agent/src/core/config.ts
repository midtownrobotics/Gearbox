export interface AgentConfig {
  /** Base URL of workers/edge's API, e.g. https://edge.<domain>/api */
  workerUrl: string;
  /** Shared key; must match EDGE_AGENT_KEY on the worker. */
  agentKey: string;
  dbPath: string;
  httpPort: number;
  /** Use fake counters/leases instead of nft, sysfs, and dnsmasq (for local dev). */
  mock: boolean;
  wanInterface: string;
  lanInterface: string;
  /** The box's LAN address; clients' DNS is redirected here when hardening is on. */
  lanIp: string;
  leasesPath: string;
  /** Generated dnsmasq config (blocklist nftsets, hardening); dnsmasq restarts when it changes. */
  dnsmasqConfPath: string;
  /** dnsmasq query log (log-queries=extra), used to name the sites clients use. */
  dnsLogPath: string;
  collectIntervalSeconds: number;
  /** Shop drive storage: the mounted 10 GB image. */
  driveDir: string;
  /** Where the shop drive's web page listens: the box's LAN address only (never the tunnel). */
  driveHost: string;
  drivePort: number;
  /** DigiKey API app for part lookup; optional (DigiKey links fail without it). */
  digikeyClientId?: string;
  digikeyClientSecret?: string;
  /** Polling/debounce settings for the closed-to-ground door microswitch. */
  switchPollMilliseconds: number;
  switchDebounceMilliseconds: number;
  /** WAV files played in rotation whenever the switch changes from on to off. */
  switchSounds: string[];
  switchAudioPlayer: string;
  /** ALSA PCM target; defaults to the most recently connected BlueALSA A2DP device. */
  switchAudioDevice: string;
  /** Directory managed by the switch module for uploaded WAV files. */
  switchSoundDir: string;
  /** Linux sysfs value file for Orange Pi 5 GPIO2_D4 (GPIO 92). */
  switchGpioValuePath: string;
}

function required(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable ${name}`);
  return value;
}

function int(name: string, fallback: number) {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer`);
  return value;
}

/** Reads config from the environment (systemd loads /etc/g3-edge/agent.env). */
export function loadConfig(): AgentConfig {
  return {
    workerUrl: required("EDGE_WORKER_URL").replace(/\/$/, ""),
    agentKey: required("EDGE_AGENT_KEY"),
    dbPath: process.env.EDGE_DB_PATH ?? "/var/lib/g3-edge/agent.db",
    httpPort: int("EDGE_HTTP_PORT", 8700),
    mock: process.env.EDGE_MOCK === "1",
    wanInterface: process.env.EDGE_WAN_IF ?? "wan0",
    lanInterface: process.env.EDGE_LAN_IF ?? "lan0",
    lanIp: process.env.EDGE_LAN_IP ?? "192.168.50.1",
    leasesPath: process.env.EDGE_LEASES_PATH ?? "/var/lib/misc/dnsmasq.leases",
    dnsmasqConfPath: process.env.EDGE_DNSMASQ_CONF ?? "/var/lib/g3-edge/dnsmasq/g3-edge.conf",
    dnsLogPath: process.env.EDGE_DNS_LOG ?? "/run/g3-edge-dns/queries.log",
    collectIntervalSeconds: int("EDGE_COLLECT_INTERVAL", 300),
    driveDir: process.env.EDGE_DRIVE_DIR ?? "/srv/g3-drive",
    driveHost: process.env.EDGE_DRIVE_HOST ?? "192.168.50.1",
    drivePort: int("EDGE_DRIVE_PORT", 80),
    digikeyClientId: process.env.EDGE_DIGIKEY_CLIENT_ID || undefined,
    digikeyClientSecret: process.env.EDGE_DIGIKEY_CLIENT_SECRET || undefined,
    switchPollMilliseconds: int("EDGE_SWITCH_POLL_MS", 25),
    switchDebounceMilliseconds: int("EDGE_SWITCH_DEBOUNCE_MS", 75),
    switchSounds: (process.env.EDGE_SWITCH_SOUNDS ?? "/srv/g3-sounds/switch.wav")
      .split(",")
      .map((path) => path.trim())
      .filter(Boolean),
    switchAudioPlayer: process.env.EDGE_SWITCH_AUDIO_PLAYER ?? "aplay",
    switchAudioDevice: process.env.EDGE_SWITCH_AUDIO_DEVICE ?? "bluealsa",
    switchSoundDir: process.env.EDGE_SWITCH_SOUND_DIR ?? "/srv/g3-sounds",
    switchGpioValuePath: process.env.EDGE_SWITCH_GPIO_VALUE_PATH ?? "/sys/class/gpio/gpio92/value",
  };
}
