// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, test } from "bun:test";
import { isValidDeviceUri, parsePrintOptions, printerAlerts } from "@g3/worker-edge/print-types";
import { parseLpinfo, parseRequestId, toJob, toPrinter } from "./cups";
import { OP, VALUE, decodeResponse, encodeRequest } from "./ipp";

// Captured from `lpinfo -l --include-schemes dnssd,ipp,ipps,socket -v` (CUPS 2.4), uuid redacted.
const LPINFO = `Device: uri = ipp
        class = network
        info = Internet Printing Protocol (ipp)
        make-and-model = Unknown
        device-id =
        location =
Device: uri = socket
        class = network
        info = AppSocket/HP JetDirect
        make-and-model = Unknown
        device-id =
        location =
Device: uri = dnssd://Brother%20HL-L3290CDW%20series._ipp._tcp.local/?uuid=00000000-0000-0000-0000-000000000000
        class = network
        info = Brother HL-L3290CDW series
        make-and-model = Brother HL-L3290CDW series
        device-id = MFG:Brother;MDL:HL-L3290CDW series;CMD:PJL,PCL,PCLXL,URF;
        location =
Device: uri = usb://Canon/LBP?serial=1
        class = direct
        info = Canon LBP
        make-and-model = Canon LBP
        device-id =
        location =
`;

describe("parseLpinfo", () => {
  test("keeps network printers with a real address, drops scheme placeholders and USB", () => {
    expect(parseLpinfo(LPINFO)).toEqual([
      {
        uri: "dnssd://Brother%20HL-L3290CDW%20series._ipp._tcp.local/?uuid=00000000-0000-0000-0000-000000000000",
        info: "Brother HL-L3290CDW series",
        makeAndModel: "Brother HL-L3290CDW series",
        location: null,
      },
    ]);
  });
});

describe("parseRequestId", () => {
  test("reads the job number from lp output", () => {
    expect(parseRequestId("request id is Brother_HL-12 (1 file(s))\n")).toBe(12);
    expect(() => parseRequestId("lp: something odd")).toThrow();
  });
});

/** Builds an IPP response (header + one group per entry) for decode tests. */
function response(
  groups: [
    tag: number,
    attrs: [tag: number, name: string, values: (string | number | boolean)[]][],
  ][],
) {
  // Reuse the encoder for attribute bytes: encode each group as a request and splice its body.
  const parts: number[] = [0x02, 0x00, 0x00, 0x00, 0, 0, 0, 1];
  for (const [tag, attrs] of groups) {
    const body = encodeRequest(0, 1, attrs);
    // Skip header (8), operation group tag (1), and the 3 default attributes; keep up to the end tag.
    const start = findAfterDefaults(body);
    parts.push(tag, ...body.subarray(start, body.length - 1));
  }
  parts.push(0x03);
  return new Uint8Array(parts);
}

function findAfterDefaults(body: Uint8Array) {
  // Walk past charset, natural-language (first two attributes after the group tag).
  let i = 9;
  for (let n = 0; n < 2; n++) {
    const nameLen = (body[i + 1] << 8) | body[i + 2];
    const valueLen = (body[i + 3 + nameLen] << 8) | body[i + 4 + nameLen];
    i += 5 + nameLen + valueLen;
  }
  return i;
}

describe("IPP", () => {
  test("encodes a request with charset, language, attributes, and the requesting user", () => {
    const req = encodeRequest(OP.cupsGetPrinters, 7, [
      [VALUE.keyword, "requested-attributes", ["printer-name", "printer-state"]],
    ]);
    expect([...req.subarray(0, 8)]).toEqual([2, 0, 0x40, 0x02, 0, 0, 0, 7]);
    const text = new TextDecoder().decode(req);
    expect(text).toContain("attributes-charset");
    expect(text).toContain("printer-state");
    expect(text).toContain("requesting-user-name");
    expect(req.at(-1)).toBe(0x03);
  });

  test("decodes printer groups, multi-valued attributes, and booleans", () => {
    const buf = response([
      [
        0x04,
        [
          [VALUE.name, "printer-name", ["Shop"]],
          [VALUE.enum, "printer-state", [3]],
          [VALUE.keyword, "printer-state-reasons", ["none"]],
          [VALUE.boolean, "printer-is-accepting-jobs", [true]],
          [VALUE.name, "marker-names", ["Black Toner", "Cyan Toner"]],
          [VALUE.integer, "marker-levels", [62, -1]],
        ],
      ],
      [
        0x04,
        [
          [VALUE.name, "printer-name", ["Other"]],
          [VALUE.enum, "printer-state", [5]],
          [VALUE.keyword, "printer-state-reasons", ["paused", "media-empty-error"]],
        ],
      ],
    ]);
    const res = decodeResponse(buf);
    expect(res.status).toBe(0);
    const printers = res.groups
      .filter((g) => g.tag === 0x04)
      .map((g) => toPrinter(g.attrs, "Shop"));
    expect(
      printers.map((p) => [p.name, p.isDefault, p.state, p.acceptingJobs, p.stateReasons]),
    ).toEqual([
      ["Shop", true, "idle", true, []],
      ["Other", false, "stopped", false, ["paused", "media-empty-error"]],
    ]);
    expect(printers[0].markers).toEqual([
      { name: "Black Toner", color: null, level: 62 },
      { name: "Cyan Toner", color: null, level: -1 },
    ]);
  });

  test("decodes jobs", () => {
    const res = decodeResponse(
      response([
        [
          0x02,
          [
            [VALUE.integer, "job-id", [12]],
            [VALUE.name, "job-name", ["Drawing.pdf"]],
            [VALUE.name, "job-originating-user-name", ["abc123"]],
            [VALUE.uri, "job-printer-uri", ["ipp://localhost/printers/Shop"]],
            [VALUE.enum, "job-state", [9]],
            [VALUE.keyword, "job-state-reasons", ["job-completed-successfully"]],
            [VALUE.integer, "time-at-creation", [1790000000]],
          ],
        ],
      ]),
    );
    expect(toJob(res.groups[0].attrs)).toEqual({
      id: 12,
      printer: "Shop",
      title: "Drawing.pdf",
      user: "abc123",
      state: "completed",
      stateReasons: ["job-completed-successfully"],
      createdAt: 1790000000,
      completedAt: null,
      pages: null,
    });
  });
});

describe("print options", () => {
  test("validates and normalizes", () => {
    expect(
      parsePrintOptions({
        title: " A.pdf ",
        copies: "2",
        sides: "two-sided-long-edge",
        color: "monochrome",
        pageRanges: "1-3, 5",
      }),
    ).toEqual({
      title: "A.pdf",
      copies: 2,
      sides: "two-sided-long-edge",
      color: "monochrome",
      pageRanges: "1-3,5",
    });
    expect(parsePrintOptions({})).toEqual({ title: "Untitled" });
    expect(parsePrintOptions({ copies: "0" })).toBeString();
    expect(parsePrintOptions({ sides: "both" })).toBeString();
    expect(parsePrintOptions({ printer: "bad name; rm -rf" })).toBeString();
    expect(parsePrintOptions({ pageRanges: "1-3;x" })).toBeString();
  });

  test("only network printer addresses", () => {
    expect(isValidDeviceUri("ipp://192.168.50.140/ipp/print")).toBe(true);
    expect(isValidDeviceUri("dnssd://Brother%20HL._ipp._tcp.local/?uuid=x")).toBe(true);
    expect(isValidDeviceUri("file:///etc/passwd")).toBe(false);
    expect(isValidDeviceUri("usb://Canon/LBP")).toBe(false);
    expect(isValidDeviceUri("ipp://x/ y")).toBe(false);
  });
});

describe("printerAlerts", () => {
  test("what the shop printer reported when it ran out of paper", () => {
    expect(printerAlerts(["media-empty-error", "media-needed-error"])).toEqual([
      { severity: "error", message: "Out of paper" },
    ]);
  });

  test("errors first, warnings kept, internal and unknown non-errors dropped", () => {
    expect(
      printerAlerts([
        "none",
        "toner-low-warning",
        "cups-waiting-for-job-completed",
        "media-jam-error",
        "something-odd-report",
        "door-open-report",
        "weird-thing-error",
      ]),
    ).toEqual([
      { severity: "error", message: "Paper jam" },
      { severity: "error", message: "A door is open" },
      { severity: "error", message: "weird thing" },
      { severity: "warning", message: "Toner is low" },
    ]);
  });

  test("nothing to report", () => {
    expect(printerAlerts([])).toEqual([]);
    expect(printerAlerts(["none"])).toEqual([]);
  });
});
