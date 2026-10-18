// The one file in a multipart/form-data body (AdvantageScope's Upload Asset sends one, as "file"),
// as a view into the body: Request.formData() would keep a copy of it beside the body.

export type MultipartFile = { name: string; bytes: Uint8Array<ArrayBuffer> };

const encoder = new TextEncoder();

/** Where `needle` last starts in `bytes`, at or before `from`; -1 if it doesn't. */
function lastIndexOf(bytes: Uint8Array, needle: Uint8Array, from = bytes.length - needle.length) {
  outer: for (let i = Math.min(from, bytes.length - needle.length); i >= 0; i--) {
    for (let j = 0; j < needle.length; j++) if (bytes[i + j] !== needle[j]) continue outer;
    return i;
  }
  return -1;
}

function indexOf(bytes: Uint8Array, needle: Uint8Array, from = 0, to = bytes.length) {
  outer: for (let i = from; i <= Math.min(to, bytes.length) - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) if (bytes[i + j] !== needle[j]) continue outer;
    return i;
  }
  return -1;
}

/** The body's file part named `field`, or null when the body isn't one with exactly that. */
export function multipartFile(
  body: Uint8Array<ArrayBuffer>,
  contentType: string,
  field: string,
): MultipartFile | null {
  const boundary = /boundary=(?:"([^"]+)"|([^;\s]+))/i.exec(contentType);
  if (!/^multipart\/form-data/i.test(contentType) || !boundary) return null;
  const delimiter = encoder.encode(`--${boundary[1] ?? boundary[2]}`);
  if (indexOf(body, delimiter, 0, delimiter.length + 2) !== 0) return null;

  // The part's headers, up to the blank line (they're short: look in the first few KiB).
  const headersStart = delimiter.length + 2;
  const headersEnd = indexOf(body, encoder.encode("\r\n\r\n"), headersStart, 8192);
  if (headersEnd < 0) return null;
  const headers = new TextDecoder().decode(body.subarray(headersStart, headersEnd));
  const disposition = /content-disposition:([^\r\n]*)/i.exec(headers)?.[1] ?? "";
  const name = /\bname="([^"]*)"/i.exec(disposition)?.[1];
  const filename = /\bfilename="([^"]*)"/i.exec(disposition)?.[1];
  if (name !== field || filename === undefined) return null;

  // The data, up to the closing delimiter at the end of the body.
  const dataStart = headersEnd + 4;
  const close = encoder.encode(`\r\n--${boundary[1] ?? boundary[2]}--`);
  const dataEnd = lastIndexOf(body, close);
  if (dataEnd < dataStart) return null;
  return { name: filename, bytes: body.subarray(dataStart, dataEnd) };
}
