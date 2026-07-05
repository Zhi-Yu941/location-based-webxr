/**
 * Thin `CompressionStream`/`DecompressionStream` helpers for the QR payload
 * codecs (benchmark plan §6 P3). Runtime floor: browsers since Safari 16.4 /
 * Chrome 103 / Firefox 113; Node ≥ 21.2 for `'deflate-raw'` — hence the
 * package's `engines: >=22` (decision D3).
 *
 * `compressBytes` may reject only on programming errors (unknown format);
 * `decompressBytes` is TOTAL over its byte input — corrupt streams yield
 * `null`, never a throw, because printed QR codes deliver damaged payloads
 * forever.
 */

export async function compressBytes(
  bytes: Uint8Array,
  format: CompressionFormat
): Promise<Uint8Array> {
  return pipeBytesThrough(bytes, new CompressionStream(format));
}

export async function decompressBytes(
  bytes: Uint8Array,
  format: CompressionFormat
): Promise<Uint8Array | null> {
  try {
    return await pipeBytesThrough(bytes, new DecompressionStream(format));
  } catch {
    return null;
  }
}

async function pipeBytesThrough(
  bytes: Uint8Array,
  transform: CompressionStream | DecompressionStream
): Promise<Uint8Array> {
  // Explicit writer instead of Blob().stream().pipeThrough(): the DOM types
  // declare `writable: WritableStream<BufferSource>`, which pipeThrough's
  // variance rejects. Promise.all keeps a failing write/close from becoming
  // an unhandled rejection while the read side errors too.
  const writer = transform.writable.getWriter();
  // Fresh copy: `BufferSource` demands an ArrayBuffer-backed view, which a
  // caller's Uint8Array<ArrayBufferLike> cannot prove. Payloads are tiny.
  const writing = writer
    .write(new Uint8Array(bytes))
    .then(() => writer.close());
  const reading = new Response(transform.readable).arrayBuffer();
  const [, buffer] = await Promise.all([writing, reading]);
  return new Uint8Array(buffer);
}
