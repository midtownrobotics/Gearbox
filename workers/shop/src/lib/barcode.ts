import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

/**
 * Code 128 bar/space width patterns for symbol values 0-106.
 * Each digit is a run length in modules, alternating bar/space and starting with a bar.
 * Values 0-102 are data, 103-105 are start codes, 106 is stop.
 */
const CODE128_PATTERNS = [
  "212222",
  "222122",
  "222221",
  "121223",
  "121322",
  "131222",
  "122213",
  "122312",
  "132212",
  "221213",
  "221312",
  "231212",
  "112232",
  "122132",
  "122231",
  "113222",
  "123122",
  "123221",
  "223211",
  "221132",
  "221231",
  "213212",
  "223112",
  "312131",
  "311222",
  "321122",
  "321221",
  "312212",
  "322112",
  "322211",
  "212123",
  "212321",
  "232121",
  "111323",
  "131123",
  "131321",
  "112313",
  "132113",
  "132311",
  "211313",
  "231113",
  "231311",
  "112133",
  "112331",
  "132131",
  "113123",
  "113321",
  "133121",
  "313121",
  "211331",
  "231131",
  "213113",
  "213311",
  "213131",
  "311123",
  "311321",
  "331121",
  "312113",
  "312311",
  "332111",
  "314111",
  "221411",
  "431111",
  "111224",
  "111422",
  "121124",
  "121421",
  "141122",
  "141221",
  "112214",
  "112412",
  "122114",
  "122411",
  "142112",
  "142211",
  "241211",
  "221114",
  "413111",
  "241112",
  "134111",
  "111242",
  "121142",
  "121241",
  "114212",
  "124112",
  "124211",
  "411212",
  "421112",
  "421211",
  "212141",
  "214121",
  "412121",
  "111143",
  "111341",
  "131141",
  "114113",
  "114311",
  "411113",
  "411311",
  "113141",
  "114131",
  "311141",
  "411131",
  "211412",
  "211214",
  "211232",
  "2331112",
];

const START_B = 104;
const STOP = 106;

/** Quiet zone required on each side of the symbol, in modules. */
const QUIET_ZONE_MODULES = 10;

/**
 * Encodes text as Code 128 subset B and returns the run lengths in modules.
 * Even indices are bars, odd indices are spaces.
 */
export function encodeCode128B(text: string): number[] {
  if (text.length === 0) {
    throw new Error("Cannot encode an empty string as Code 128");
  }

  const symbols: number[] = [START_B];
  for (const char of text) {
    const code = char.charCodeAt(0);
    if (code < 32 || code > 126) {
      throw new Error(`Character "${char}" is not encodable in Code 128 subset B`);
    }
    symbols.push(code - 32);
  }

  // Checksum: start value plus each data value weighted by its 1-based position, mod 103.
  let checksum = START_B;
  for (let i = 1; i < symbols.length; i++) {
    checksum += symbols[i] * i;
  }
  symbols.push(checksum % 103);
  symbols.push(STOP);

  const runs: number[] = [];
  for (const symbol of symbols) {
    for (const digit of CODE128_PATTERNS[symbol]) {
      runs.push(Number(digit));
    }
  }
  return runs;
}

/** Total width of an encoded symbol in modules, excluding quiet zones. */
function moduleCount(runs: number[]): number {
  return runs.reduce((sum, run) => sum + run, 0);
}

export type BarcodeLayout = {
  /**
   * Width of one narrow module, in points. This is the single number that decides whether a
   * scanner can read the symbol: camera-based decoders need roughly 2px per narrow module and
   * want 3+, so 1.9pt (0.67mm) keeps the barcode readable from a screenshot or a phone photo,
   * not just from a 300dpi print.
   */
  moduleWidth: number;
  /** Height of the bars, in points. */
  barHeight: number;
  /** Font size of the human-readable text below the bars. */
  fontSize: number;
  /** Gap between the bars and the text, in points. */
  textGap: number;
  /** White padding around the whole block, in points. */
  padding: number;
  /** Bottom edge of the block, in points from the page bottom. */
  bottom: number;
  /** Horizontal band the block is centered within: [left, right] in points. */
  centerWithin: [number, number];
};

/**
 * Defaults measured from the OnShape 792x612pt (11" x 8.5") drawing template:
 * border frame at 27.4pt inset, title block occupying x 327.2-764.6 / y 27.4-135.4.
 * The bottom-left gap (x 27.4-327.2, y 27.4-157) is empty on these sheets.
 */
export const DEFAULT_LAYOUT: BarcodeLayout = {
  moduleWidth: 1.9,
  barHeight: 55,
  fontSize: 11,
  textGap: 4,
  padding: 6,
  bottom: 39.4,
  centerWithin: [27.4, 327.2],
};

/** Never shrink below this: 0.33mm is the practical floor for a 300dpi print. */
const MIN_MODULE_WIDTH = 0.94;

const TEMPLATE_WIDTH = 792;
const TEMPLATE_HEIGHT = 612;

/**
 * Builds the value encoded on a drawing: the part number and the revision it was released at,
 * e.g. "P-0042-A". A drawing is specific to one revision, so the barcode identifies the sheet
 * rather than just the part, and a stale printout scans differently from the current one.
 */
export function drawingBarcodeValue(partNumber: string, revision: string): string {
  return `${partNumber}-${revision}`;
}

/**
 * Draws a Code 128 barcode for `value` into the bottom-left corner of the first page,
 * in the gap between the sheet border and the title block. The same string is printed
 * underneath in human-readable form, so a failed scan can be typed in instead.
 */
export async function stampBarcode(
  pdfBytes: ArrayBuffer | Uint8Array,
  value: string,
  layout: Partial<BarcodeLayout> = {},
): Promise<Uint8Array> {
  const opts: BarcodeLayout = { ...DEFAULT_LAYOUT, ...layout };

  const pdf = await PDFDocument.load(pdfBytes);
  const page = pdf.getPages()[0];
  if (!page) {
    throw new Error("Cannot stamp a barcode: PDF has no pages");
  }

  const { width: pageWidth, height: pageHeight } = page.getSize();
  const rotation = page.getRotation().angle;
  if (rotation % 360 !== 0) {
    console.warn(
      `[Barcode] Page rotated ${rotation}deg; placement is computed in unrotated page space.`,
    );
  }

  // The anchors above are measured from the standard sheet. If a drawing comes through at a
  // different size, scale the anchor box proportionally but keep the barcode itself at its
  // physical size — module width is what determines whether a scanner can read it.
  const scaleX = pageWidth / TEMPLATE_WIDTH;
  const scaleY = pageHeight / TEMPLATE_HEIGHT;
  const bandLeft = opts.centerWithin[0] * scaleX;
  const bandRight = opts.centerWithin[1] * scaleX;
  const blockBottom = opts.bottom * scaleY;

  const runs = encodeCode128B(value);
  const modules = moduleCount(runs);

  // Shrink the module width if the symbol would otherwise overrun the gap.
  const bandWidth = bandRight - bandLeft;
  const totalModules = modules + QUIET_ZONE_MODULES * 2;
  let moduleWidth = opts.moduleWidth;
  if (totalModules * moduleWidth + opts.padding * 2 > bandWidth) {
    moduleWidth = Math.max((bandWidth - opts.padding * 2) / totalModules, MIN_MODULE_WIDTH);
    console.warn(
      `[Barcode] "${value}" does not fit at the default density; ` +
        `reduced module width to ${moduleWidth.toFixed(3)}pt.`,
    );
  }

  const symbolWidth = modules * moduleWidth;
  const quietZone = QUIET_ZONE_MODULES * moduleWidth;
  const blockWidth = symbolWidth + quietZone * 2 + opts.padding * 2;
  const blockHeight = opts.padding * 2 + opts.fontSize + opts.textGap + opts.barHeight;
  const blockLeft = bandLeft + (bandWidth - blockWidth) / 2;

  const textBaseline = blockBottom + opts.padding;
  const barsBottom = textBaseline + opts.fontSize + opts.textGap;
  const barsLeft = blockLeft + opts.padding + quietZone;

  // White backing gives the symbol its quiet zone regardless of what is underneath.
  page.drawRectangle({
    x: blockLeft,
    y: blockBottom,
    width: blockWidth,
    height: blockHeight,
    color: rgb(1, 1, 1),
  });

  let x = barsLeft;
  for (let i = 0; i < runs.length; i++) {
    const runWidth = runs[i] * moduleWidth;
    if (i % 2 === 0) {
      page.drawRectangle({
        x,
        y: barsBottom,
        width: runWidth,
        height: opts.barHeight,
        color: rgb(0, 0, 0),
      });
    }
    x += runWidth;
  }

  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const textWidth = font.widthOfTextAtSize(value, opts.fontSize);
  page.drawText(value, {
    x: blockLeft + (blockWidth - textWidth) / 2,
    y: textBaseline,
    size: opts.fontSize,
    font,
    color: rgb(0, 0, 0),
  });

  return pdf.save();
}
