import { Directory, File, Paths } from "expo-file-system";
import * as Legacy from "expo-file-system/legacy";

/**
 * The one module that touches expo-file-system for the AI Lens feature.
 * Everything above it (download orchestration, rehydration planning) speaks
 * this small PangramFs interface, so it all runs — and is tested — in Jest
 * with an in-memory fake.
 *
 * Layout on disk: <documents>/pangram/ holds the downloaded checkpoint files
 * plus the rehydrated ONNX weights file the engine memory-maps.
 */

export interface PangramFs {
  ensureDir(): Promise<void>;
  /** Absolute path for a file inside the pangram dir. */
  path(name: string): string;
  exists(name: string): boolean;
  fileSize(name: string): number | null;
  readText(name: string): Promise<string>;
  writeText(name: string, text: string): Promise<void>;
  readBytes(name: string, offset: number, length: number): Promise<Uint8Array>;
  /** Stream `bytes` from src@srcOffset to dst@dstOffset (dst grown as needed). */
  copyRange(
    src: string,
    dst: string,
    srcOffset: number,
    dstOffset: number,
    bytes: number,
  ): Promise<void>;
  /** Write raw bytes at an offset (file created/grown as needed). */
  writeBytes(name: string, offset: number, bytes: Uint8Array): Promise<void>;
  /** Copy an absolute/asset URI into the pangram dir (overwrites). */
  importFile(srcUri: string, name: string): Promise<void>;
  /** Download with auth headers + progress; resumable across retries. */
  downloadFile(
    url: string,
    name: string,
    headers: Record<string, string>,
    onProgress?: (writtenBytes: number, totalBytes: number) => void,
  ): Promise<void>;
  deleteFile(name: string): Promise<void>;
  deleteAll(): Promise<void>;
}

const DIR_NAME = "pangram";
const COPY_CHUNK = 8 * 1024 * 1024;

export function createPangramFs(): PangramFs {
  const dir = () => new Directory(Paths.document, DIR_NAME);
  // Names may be nested ("coreml.mlpackage/Data/.../weight.bin") — ensure
  // parent directories exist before any write-side File is created.
  const ensureParents = (name: string) => {
    const parts = name.split("/");
    if (parts.length < 2) return;
    const parent = new Directory(dir(), ...parts.slice(0, -1));
    if (!parent.exists) parent.create({ intermediates: true });
  };
  const file = (name: string) => new File(dir(), name);

  return {
    async ensureDir() {
      const d = dir();
      if (!d.exists) d.create({ intermediates: true });
    },
    path: (name) => file(name).uri.replace(/^file:\/\//, ""),
    exists: (name) => file(name).exists,
    fileSize(name) {
      const f = file(name);
      return f.exists ? (f.size ?? null) : null;
    },
    async readText(name) {
      return file(name).text();
    },
    async writeText(name, text) {
      ensureParents(name);
      const f = file(name);
      if (!f.exists) f.create();
      f.write(text);
    },
    async readBytes(name, offset, length) {
      const handle = file(name).open();
      try {
        handle.offset = offset;
        return handle.readBytes(length);
      } finally {
        handle.close();
      }
    },
    async copyRange(src, dst, srcOffset, dstOffset, bytes) {
      ensureParents(dst);
      const dstFile = file(dst);
      if (!dstFile.exists) dstFile.create();
      const from = file(src).open();
      const to = dstFile.open();
      try {
        let done = 0;
        while (done < bytes) {
          const n = Math.min(COPY_CHUNK, bytes - done);
          from.offset = srcOffset + done;
          const chunk = from.readBytes(n);
          if (chunk.length === 0)
            throw new Error(`copyRange: short read in ${src}`);
          to.offset = dstOffset + done;
          to.writeBytes(chunk);
          done += chunk.length;
        }
      } finally {
        from.close();
        to.close();
      }
    },
    async writeBytes(name, offset, bytes) {
      ensureParents(name);
      const f = file(name);
      if (!f.exists) f.create();
      const handle = f.open();
      try {
        handle.offset = offset;
        handle.writeBytes(bytes);
      } finally {
        handle.close();
      }
    },
    async importFile(srcUri, name) {
      ensureParents(name);
      const target = file(name);
      if (target.exists) target.delete();
      await Legacy.copyAsync({ from: srcUri, to: target.uri });
    },
    async downloadFile(url, name, headers, onProgress) {
      const target = file(name).uri;
      const resumable = Legacy.createDownloadResumable(
        url,
        target,
        { headers },
        onProgress
          ? (p) => onProgress(p.totalBytesWritten, p.totalBytesExpectedToWrite)
          : undefined,
      );
      const result = await resumable.downloadAsync();
      if (!result) throw new Error(`download of ${name} did not complete`);
      if (result.status !== 200 && result.status !== 206)
        throw new Error(`download of ${name} failed (HTTP ${result.status})`);
    },
    async deleteFile(name) {
      const f = file(name);
      if (f.exists) f.delete();
    },
    async deleteAll() {
      const d = dir();
      if (d.exists) d.delete();
    },
  };
}
