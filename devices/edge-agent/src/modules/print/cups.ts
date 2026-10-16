import { appTitle } from "@g3/site-config";
import type {
  DiscoveredPrinter,
  JobState,
  PrintJob,
  PrintOptions,
  Printer,
} from "@g3/worker-edge/print-types";
import { type Attrs, OP, VALUE, ippRequest, serverUri } from "./ipp";

/** A problem the caller can fix (bad printer name, printer rejected the job, ...). */
export class PrintError extends Error {}

export interface AddPrinter {
  name: string;
  uri: string;
  description?: string;
  location?: string;
  makeDefault?: boolean;
}

export interface PrintBackend {
  printers(): Promise<Printer[]>;
  jobs(): Promise<PrintJob[]>;
  discover(): Promise<DiscoveredPrinter[]>;
  addPrinter(p: AddPrinter): Promise<void>;
  removePrinter(name: string): Promise<void>;
  setDefault(name: string): Promise<void>;
  /** Re-enables a printer CUPS stopped after an error, and accepts jobs again. */
  resume(name: string): Promise<void>;
  testPrint(name: string): Promise<number>;
  submit(options: PrintOptions, data: Uint8Array): Promise<{ jobId: number; printer: string }>;
  cancel(jobId: number): Promise<void>;
}

/**
 * CUPS commands normally answer within seconds, but one waiting on a stuck
 * printer could hang a request forever; give up after this long.
 */
const COMMAND_TIMEOUT_MS = 75_000;

async function run(cmd: string, args: string[], stdin?: Uint8Array) {
  const proc = Bun.spawn([cmd, ...args], {
    stdin: stdin ?? "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    proc.kill();
  }, COMMAND_TIMEOUT_MS);
  const [out, err, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]).finally(() => clearTimeout(timer));
  if (timedOut) {
    throw new PrintError(
      `CUPS didn't respond in time (${cmd}). The printer may be stuck; check it and try again.`,
    );
  }
  if (code !== 0) {
    // CUPS tools prefix errors with "<tool>: "; drop it for the UI.
    throw new PrintError(err.trim().replace(/^\w+: /, "") || `${cmd} failed (exit ${code})`);
  }
  return out;
}

const PRINTER_STATES = { 3: "idle", 4: "processing", 5: "stopped" } as const;
const JOB_STATES: Record<number, JobState> = {
  3: "pending",
  4: "held",
  5: "processing",
  6: "stopped",
  7: "canceled",
  8: "aborted",
  9: "completed",
};

const first = <T>(a: Attrs, key: string) => (a[key]?.[0] ?? null) as T | null;
const reasons = (a: Attrs, key: string) =>
  (a[key] ?? []).filter((r): r is string => typeof r === "string" && r !== "none");

export function toPrinter(a: Attrs, defaultName: string | null): Printer {
  const name = first<string>(a, "printer-name") ?? "";
  const names = (a["marker-names"] ?? []) as string[];
  const colors = (a["marker-colors"] ?? []) as string[];
  const levels = (a["marker-levels"] ?? []) as number[];
  return {
    name,
    description: first(a, "printer-info"),
    location: first<string>(a, "printer-location") || null,
    makeAndModel: first(a, "printer-make-and-model"),
    deviceUri: first(a, "device-uri"),
    isDefault: name === defaultName,
    state: PRINTER_STATES[first<number>(a, "printer-state") as 3 | 4 | 5] ?? "stopped",
    acceptingJobs: first<boolean>(a, "printer-is-accepting-jobs") ?? false,
    stateReasons: reasons(a, "printer-state-reasons"),
    stateMessage: first<string>(a, "printer-state-message") || null,
    markers: names.map((n, i) => ({ name: n, color: colors[i] ?? null, level: levels[i] ?? -1 })),
  };
}

export function toJob(a: Attrs): PrintJob {
  const printerUri = first<string>(a, "job-printer-uri") ?? "";
  const user = first<string>(a, "job-originating-user-name");
  return {
    id: first<number>(a, "job-id") ?? 0,
    printer: decodeURIComponent(printerUri.split("/").pop() ?? ""),
    title: first(a, "job-name"),
    user,
    state: JOB_STATES[first<number>(a, "job-state") ?? 0] ?? "pending",
    stateReasons: reasons(a, "job-state-reasons"),
    createdAt: first(a, "time-at-creation"),
    completedAt: first(a, "time-at-completed"),
    pages: first(a, "job-media-sheets-completed"),
  };
}

/**
 * Parses `lpinfo -l -v` output: blocks of "Device: uri = ..." followed by
 * indented "key = value" lines. Keeps network devices only.
 */
export function parseLpinfo(out: string): Omit<DiscoveredPrinter, "addedAs">[] {
  const devices: Record<string, string>[] = [];
  for (const line of out.split("\n")) {
    const m = /^\s*(Device: )?([\w-]+) = (.*)$/.exec(line);
    if (!m) continue;
    if (m[1]) devices.push({});
    const current = devices.at(-1);
    if (current) current[m[2]] = m[3].trim();
  }
  return devices
    .filter((d) => d.uri && d.class === "network" && /^(dnssd|ipps?|socket|lpd):\/\//.test(d.uri))
    .map((d) => ({
      uri: d.uri,
      info: d.info || null,
      makeAndModel:
        d["make-and-model"] && d["make-and-model"] !== "Unknown" ? d["make-and-model"] : null,
      location: d.location || null,
    }));
}

const PRINTER_ATTRS = [
  "printer-name",
  "printer-info",
  "printer-location",
  "printer-make-and-model",
  "device-uri",
  "printer-state",
  "printer-state-reasons",
  "printer-state-message",
  "printer-is-accepting-jobs",
  "marker-names",
  "marker-colors",
  "marker-levels",
];
const JOB_ATTRS = [
  "job-id",
  "job-name",
  "job-originating-user-name",
  "job-printer-uri",
  "job-state",
  "job-state-reasons",
  "time-at-creation",
  "time-at-completed",
  "job-media-sheets-completed",
];

/** The real thing: the CUPS server on the box. */
export function cupsBackend(): PrintBackend {
  async function defaultPrinter() {
    const res = await ippRequest(OP.cupsGetDefault, [
      [VALUE.keyword, "requested-attributes", ["printer-name"]],
    ]);
    return (
      (res.groups.find((g) => g.attrs["printer-name"])?.attrs["printer-name"]?.[0] as string) ??
      null
    );
  }

  async function printers() {
    const [res, def] = await Promise.all([
      ippRequest(OP.cupsGetPrinters, [[VALUE.keyword, "requested-attributes", PRINTER_ATTRS]]),
      defaultPrinter(),
    ]);
    return res.groups
      .filter((g) => g.tag === 0x04)
      .map((g) => toPrinter(g.attrs, def))
      .sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || a.name.localeCompare(b.name));
  }

  async function jobsWhich(which: "not-completed" | "completed", limit: number) {
    const res = await ippRequest(OP.getJobs, [
      [VALUE.uri, "printer-uri", [serverUri()]],
      [VALUE.keyword, "which-jobs", [which]],
      [VALUE.integer, "limit", [limit]],
      [VALUE.keyword, "requested-attributes", JOB_ATTRS],
    ]);
    return res.groups.filter((g) => g.tag === 0x02).map((g) => toJob(g.attrs));
  }

  return {
    printers,
    async jobs() {
      const [active, done] = await Promise.all([
        jobsWhich("not-completed", 100),
        jobsWhich("completed", 50),
      ]);
      return [...active, ...done].sort((a, b) => b.id - a.id);
    },
    async discover() {
      const [out, existing] = await Promise.all([
        run("lpinfo", [
          "-l",
          "--include-schemes",
          "dnssd,ipp,ipps,socket",
          "--timeout",
          "10",
          "-v",
        ]),
        printers(),
      ]);
      const byUri = new Map(existing.map((p) => [p.deviceUri, p.name]));
      return parseLpinfo(out).map((d) => ({ ...d, addedAs: byUri.get(d.uri) ?? null }));
    },
    async addPrinter(p) {
      // -m everywhere: driverless (IPP Everywhere / AirPrint); CUPS asks the printer for its capabilities.
      const args = ["-p", p.name, "-E", "-v", p.uri, "-m", "everywhere"];
      if (p.description) args.push("-D", p.description);
      if (p.location) args.push("-L", p.location);
      await run("lpadmin", args);
      if (p.makeDefault) await run("lpadmin", ["-d", p.name]);
    },
    async removePrinter(name) {
      await run("lpadmin", ["-x", name]);
    },
    async setDefault(name) {
      await run("lpadmin", ["-d", name]);
    },
    async resume(name) {
      await run("cupsenable", [name]);
      await run("cupsaccept", [name]);
    },
    async testPrint(name) {
      const out = await run("lp", [
        "-d",
        name,
        "-t",
        `${appTitle("Edge")} test page`,
        "/usr/share/cups/data/testprint",
      ]);
      return parseRequestId(out);
    },
    async submit(options, data) {
      const printer = options.printer ?? (await defaultPrinter());
      if (!printer)
        throw new PrintError("No default printer is set. Add one on the Printers page.");
      const args = ["-d", printer, "-t", options.title];
      if (options.user) args.push("-U", options.user);
      if (options.copies) args.push("-n", String(options.copies));
      if (options.sides) args.push("-o", `sides=${options.sides}`);
      if (options.color) args.push("-o", `print-color-mode=${options.color}`);
      if (options.media) args.push("-o", `media=${options.media}`);
      if (options.pageRanges) args.push("-o", `page-ranges=${options.pageRanges}`);
      // The document goes to lp on stdin: nothing is written to disk here.
      const out = await run("lp", args, data);
      return { jobId: parseRequestId(out), printer };
    },
    async cancel(jobId) {
      await run("cancel", [String(jobId)]);
    },
  };
}

/** "request id is Brother-12 (1 file(s))" → 12 */
export function parseRequestId(out: string) {
  const m = /request id is \S+-(\d+)/.exec(out);
  if (!m) throw new PrintError(`Unexpected lp output: ${out.trim()}`);
  return Number(m[1]);
}
