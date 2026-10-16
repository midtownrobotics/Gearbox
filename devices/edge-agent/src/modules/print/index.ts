import {
  MAX_PRINT_BYTES,
  isValidDeviceUri,
  isValidPrinterName,
  parsePrintOptions,
  printerAlerts,
} from "@g3/worker-edge/print-types";
import { type Context, Hono } from "hono";
import type { EdgeModule, ModuleContext } from "../../core/module";
import { PrintError, cupsBackend } from "./cups";
import { mockBackend } from "./mock";

/**
 * Print module: the worker's print routes call these over the worker link
 * (/print/*, shared-key auth in core). CUPS on the box does the queueing;
 * documents go straight to `lp` and nothing is stored by the agent.
 */
export function createPrintModule(ctx: ModuleContext): EdgeModule {
  const backend = ctx.config.mock ? mockBackend() : cupsBackend();
  let lastError: string | null = null;

  async function handle(c: Context, fn: () => Promise<unknown>) {
    try {
      const result = await fn();
      lastError = null;
      return c.json(result ?? { ok: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (err instanceof PrintError) return c.json({ error: message }, 400);
      lastError = message;
      console.error(`[print] ${message}`);
      return c.json({ error: `Print server error: ${message}` }, 500);
    }
  }

  const printerName = (c: Context) => {
    const name = c.req.param("name") ?? "";
    if (!isValidPrinterName(name)) throw new PrintError("Invalid printer name.");
    return name;
  };

  const routes = new Hono()
    .get("/printers", (c) => handle(c, async () => ({ printers: await backend.printers() })))
    .get("/jobs", (c) => handle(c, async () => ({ jobs: await backend.jobs() })))
    .post("/discover", (c) => handle(c, async () => ({ printers: await backend.discover() })))
    .post("/printers", (c) =>
      handle(c, async () => {
        const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
        const { name, uri, description, location, makeDefault } = body;
        if (typeof name !== "string" || !isValidPrinterName(name)) {
          throw new PrintError("Name must be 1-64 letters, numbers, - or _.");
        }
        if (typeof uri !== "string" || !isValidDeviceUri(uri))
          throw new PrintError("Invalid printer address.");
        const text = (v: unknown) =>
          typeof v === "string" && v.trim() ? v.trim().slice(0, 100) : undefined;
        await backend.addPrinter({
          name,
          uri,
          description: text(description),
          location: text(location),
          makeDefault: makeDefault === true,
        });
      }),
    )
    .delete("/printers/:name", (c) => handle(c, () => backend.removePrinter(printerName(c))))
    .post("/printers/:name/default", (c) => handle(c, () => backend.setDefault(printerName(c))))
    .post("/printers/:name/resume", (c) => handle(c, () => backend.resume(printerName(c))))
    .post("/printers/:name/test", (c) =>
      handle(c, async () => ({ ok: true, jobId: await backend.testPrint(printerName(c)) })),
    )
    .post("/jobs", (c) =>
      handle(c, async () => {
        const options = parsePrintOptions(c.req.query());
        if (typeof options === "string") throw new PrintError(options);
        const data = new Uint8Array(await c.req.arrayBuffer());
        if (data.length === 0) throw new PrintError("The document is empty.");
        if (data.length > MAX_PRINT_BYTES)
          throw new PrintError("The document is too large (50 MB max).");
        const { jobId, printer } = await backend.submit(options, data);
        console.log(`[print] job ${jobId} "${options.title}" -> ${printer} (${data.length} bytes)`);
        // The job is queued either way; also report anything wrong with the printer
        // (out of paper, jam, ...) so whoever printed knows it won't come out yet.
        const alerts = await backend
          .printers()
          .then((all) => printerAlerts(all.find((p) => p.name === printer)?.stateReasons ?? []))
          .catch(() => []);
        return { ok: true, jobId, printer, alerts };
      }),
    )
    .delete("/jobs/:id", (c) =>
      handle(c, async () => {
        const id = Number(c.req.param("id"));
        if (!Number.isInteger(id) || id < 1) throw new PrintError("Invalid job id.");
        await backend.cancel(id);
      }),
    );

  return {
    name: "print",
    routes,
    start() {},
    stop() {},
    status() {
      return { mock: ctx.config.mock, lastError };
    },
  };
}
