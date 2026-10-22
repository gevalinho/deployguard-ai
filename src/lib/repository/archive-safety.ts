import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createGunzip } from "node:zlib";
import { currentAssessmentExecution, remainingAssessmentMs } from "@/lib/orchestration/assessment-execution";

export const MAX_ARCHIVE_BYTES = 128 * 1024 * 1024;
const MAX_EXPANDED_BYTES = 512 * 1024 * 1024;
const MAX_ARCHIVE_ENTRIES = 50_000;

/** Reject links, special files, traversal, and unbounded expansion before tar sees the archive. */
export async function inspectRepositoryArchive(path: string): Promise<void> {
  if ((await stat(path)).size > MAX_ARCHIVE_BYTES) throw new Error("archive_size_limit");
  remainingAssessmentMs();
  const input = createReadStream(path);
  const unzip = createGunzip();
  const signal = currentAssessmentExecution()?.signal;
  const abort = () => { input.destroy(); unzip.destroy(new Error("archive_deadline_exceeded")); };
  signal?.addEventListener("abort", abort, { once: true });
  let buffer = Buffer.alloc(0);
  let skip = 0;
  let expanded = 0;
  let entries = 0;
  try {
    for await (const data of input.pipe(unzip)) {
      remainingAssessmentMs();
      buffer = Buffer.concat([buffer, data as Buffer]);
      while (buffer.length > 0) {
        if (skip > 0) {
          const consumed = Math.min(skip, buffer.length);
          skip -= consumed;
          buffer = buffer.subarray(consumed);
          continue;
        }
        if (buffer.length < 512) break;
        const header = buffer.subarray(0, 512);
        buffer = buffer.subarray(512);
        if (header.every((byte) => byte === 0)) return;
        entries += 1;
        if (entries > MAX_ARCHIVE_ENTRIES) throw new Error("archive_entry_limit");
        const name = header.subarray(0, 100).toString("utf8").split("\0", 1)[0];
        const prefix = header.subarray(345, 500).toString("utf8").split("\0", 1)[0];
        const pathname = prefix ? `${prefix}/${name}` : name;
        const segments = pathname.split("/");
        if (!pathname || pathname.startsWith("/") || segments.includes("..") ||
            segments.some((part) => part === "") && !pathname.endsWith("/"))
          throw new Error("archive_path_rejected");
        const type = header[156];
        if (type !== 0 && type !== 48 && type !== 53)
          throw new Error("archive_entry_type_rejected");
        const sizeText = header.subarray(124, 136).toString("ascii").split("\0", 1)[0].trim();
        if (!/^[0-7]+$/.test(sizeText)) throw new Error("archive_size_invalid");
        const size = Number.parseInt(sizeText, 8);
        if (!Number.isSafeInteger(size) || size < 0 || (type === 53 && size !== 0))
          throw new Error("archive_size_invalid");
        expanded += size;
        if (expanded > MAX_EXPANDED_BYTES) throw new Error("archive_expansion_limit");
        skip = Math.ceil(size / 512) * 512;
      }
    }
    if (skip !== 0 || buffer.length !== 0) throw new Error("archive_truncated");
  } finally {
    signal?.removeEventListener("abort", abort);
    input.destroy();
    unzip.destroy();
  }
}
