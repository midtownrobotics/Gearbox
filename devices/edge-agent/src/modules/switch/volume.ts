/** Attenuate uncompressed WAV samples without changing the uploaded file. */
export function scaleWaveVolume(source: Uint8Array, volumePercent: number): Uint8Array {
  if (!Number.isFinite(volumePercent) || volumePercent < 0 || volumePercent > 100)
    throw new Error("Volume must be between 0 and 100%.");
  const data = source.slice();
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const text = new TextDecoder("ascii");
  if (
    data.length < 12 ||
    text.decode(data.subarray(0, 4)) !== "RIFF" ||
    text.decode(data.subarray(8, 12)) !== "WAVE"
  )
    throw new Error("Invalid WAV file.");
  let format = 0;
  let bits = 0;
  const chunks: { start: number; size: number }[] = [];
  for (let offset = 12; offset + 8 <= data.length; ) {
    const name = text.decode(data.subarray(offset, offset + 4));
    const size = view.getUint32(offset + 4, true);
    const start = offset + 8;
    if (start + size > data.length) throw new Error("Truncated WAV file.");
    if (name === "fmt " && size >= 16) {
      format = view.getUint16(start, true);
      bits = view.getUint16(start + 14, true);
      if (format === 0xfffe && size >= 40) format = view.getUint16(start + 24, true);
    }
    if (name === "data") chunks.push({ start, size });
    offset = start + size + (size % 2);
  }
  if (
    !chunks.length ||
    !((format === 1 && [8, 16, 24, 32].includes(bits)) || (format === 3 && [32, 64].includes(bits)))
  )
    throw new Error("Volume control requires an uncompressed PCM or floating-point WAV file.");
  const gain = volumePercent / 100;
  const width = bits / 8;
  for (const { start, size } of chunks) {
    if (size % width !== 0) throw new Error("Invalid WAV sample data.");
    for (let offset = start; offset < start + size; offset += width) {
      if (format === 3) {
        if (bits === 32) view.setFloat32(offset, view.getFloat32(offset, true) * gain, true);
        else view.setFloat64(offset, view.getFloat64(offset, true) * gain, true);
      } else if (bits === 8)
        view.setUint8(offset, Math.round((view.getUint8(offset) - 128) * gain) + 128);
      else if (bits === 16)
        view.setInt16(offset, Math.round(view.getInt16(offset, true) * gain), true);
      else if (bits === 32)
        view.setInt32(offset, Math.round(view.getInt32(offset, true) * gain), true);
      else {
        const sample =
          ((view.getUint8(offset) |
            (view.getUint8(offset + 1) << 8) |
            (view.getUint8(offset + 2) << 16)) <<
            8) >>
          8;
        const scaled = Math.round(sample * gain);
        view.setUint8(offset, scaled & 255);
        view.setUint8(offset + 1, (scaled >> 8) & 255);
        view.setUint8(offset + 2, (scaled >> 16) & 255);
      }
    }
  }
  return data;
}
