import { appTitle } from "@g3/site-config";
import type { PrintJob, Printer } from "@g3/worker-edge/print-types";
import { type PrintBackend, PrintError } from "./cups";

/** In-memory printers and jobs for running the agent on a dev machine. Jobs finish after a few seconds. */
export function mockBackend(): PrintBackend {
  const printers = new Map<string, Printer>();
  const jobs: PrintJob[] = [];
  let nextJob = 1;
  let defaultName: string | null = null;

  const found = [
    {
      uri: "dnssd://Brother%20HL-L2350DW%20series._ipp._tcp.local/?uuid=mock-1",
      info: "Brother HL-L2350DW series",
      makeAndModel: "Brother HL-L2350DW series",
      location: "Shop",
    },
    {
      uri: "ipp://192.168.50.140/ipp/print",
      info: "HP LaserJet Pro M404",
      makeAndModel: "HP LaserJet Pro M404",
      location: null,
    },
  ];

  const get = (name: string) => {
    const p = printers.get(name);
    if (!p) throw new PrintError("The printer or class does not exist.");
    return p;
  };

  function addJob(printer: string, title: string, user: string | null) {
    const job: PrintJob = {
      id: nextJob++,
      printer,
      title,
      user,
      state: "processing",
      stateReasons: [],
      createdAt: Math.floor(Date.now() / 1000),
      completedAt: null,
      pages: null,
    };
    jobs.unshift(job);
    setTimeout(() => {
      if (job.state !== "processing") return;
      job.state = "completed";
      job.completedAt = Math.floor(Date.now() / 1000);
      job.pages = 1;
    }, 5000);
    return job.id;
  }

  return {
    async printers() {
      return [...printers.values()].map((p) => ({ ...p, isDefault: p.name === defaultName }));
    },
    async jobs() {
      return jobs.slice(0, 50);
    },
    async discover() {
      await new Promise((r) => setTimeout(r, 1500));
      const byUri = new Map([...printers.values()].map((p) => [p.deviceUri, p.name]));
      return found.map((d) => ({ ...d, addedAs: byUri.get(d.uri) ?? null }));
    },
    async addPrinter(p) {
      const model =
        found.find((d) => d.uri === p.uri)?.makeAndModel ?? "Mock IPP Everywhere printer";
      printers.set(p.name, {
        name: p.name,
        description: p.description ?? model,
        location: p.location ?? null,
        makeAndModel: model,
        deviceUri: p.uri,
        isDefault: false,
        state: "idle",
        acceptingJobs: true,
        // e.g. EDGE_MOCK_PRINTER_REASONS=media-empty-error to try the "out of paper" UI.
        stateReasons: (process.env.EDGE_MOCK_PRINTER_REASONS ?? "").split(",").filter(Boolean),
        stateMessage: null,
        markers: [{ name: "Black Toner", color: "#000000", level: 62 }],
      });
      if (p.makeDefault || !defaultName) defaultName = p.name;
    },
    async removePrinter(name) {
      get(name);
      printers.delete(name);
      if (defaultName === name) defaultName = null;
    },
    async setDefault(name) {
      get(name);
      defaultName = name;
    },
    async resume(name) {
      Object.assign(get(name), { state: "idle", acceptingJobs: true, stateReasons: [] });
    },
    async testPrint(name) {
      get(name);
      return addJob(name, `${appTitle("Edge")} test page`, null);
    },
    async submit(options) {
      const printer = options.printer ?? defaultName;
      if (!printer)
        throw new PrintError("No default printer is set. Add one on the Printers page.");
      get(printer);
      return { jobId: addJob(printer, options.title, options.user ?? null), printer };
    },
    async cancel(jobId) {
      const job = jobs.find((j) => j.id === jobId);
      if (!job) throw new PrintError(`Job ${jobId} does not exist.`);
      job.state = "canceled";
    },
  };
}
