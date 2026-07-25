import type { RecorderColmapModel } from './model.js';

/** The three required COLMAP text payloads, represented before ZIP concerns. */
export interface ColmapTextFiles {
  readonly cameras: Uint8Array;
  readonly images: Uint8Array;
  readonly points3D: Uint8Array;
}

/** Pure text/model boundary; parsing and serialization are implemented later. */
export interface RecorderColmapTextCodec {
  parse(files: ColmapTextFiles): RecorderColmapModel;
  serialize(model: RecorderColmapModel): ColmapTextFiles;
}
