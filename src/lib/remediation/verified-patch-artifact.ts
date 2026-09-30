import {
  createHash,
} from "node:crypto";

import type {
  VerifiedPatch,
  VerifiedPatchFile,
} from "@/lib/remediation/verified-patch";

export interface VerifiedPatchArtifact {
  format: "unified_diff";
  content: string;
  sha256: string;
  byteSize: number;
}

function splitFileLines(content: string): string[] {
  if (content === "") return [];
  // Remove only the split sentinel. Blank file lines and CR bytes are content.
  const lines = content.split("\n");
  if (content.endsWith("\n")) lines.pop();
  return lines;
}

function createFilePatch(file: VerifiedPatchFile): string {
  if (file.changeType === "modified" && file.before === file.after) return "";
  const before = file.before ?? "";
  const after = file.after ?? "";
  const beforeLines = splitFileLines(before);
  const afterLines = splitFileLines(after);
  const lines = [`diff --git a/${file.path} b/${file.path}`];

  // Mode headers also represent creation/deletion of an empty file, which has
  // no text hunk. The snapshot contract describes regular text file contents.
  if (file.changeType === "added") lines.push("new file mode 100644");
  if (file.changeType === "deleted") lines.push("deleted file mode 100644");

  if (beforeLines.length || afterLines.length) {
    lines.push(
      `--- ${file.changeType === "added" ? "/dev/null" : `a/${file.path}`}`,
      `+++ ${file.changeType === "deleted" ? "/dev/null" : `b/${file.path}`}`,
      `@@ -${beforeLines.length ? 1 : 0},${beforeLines.length} +${afterLines.length ? 1 : 0},${afterLines.length} @@`,
    );
    // Emit the complete bounded before/after representation, retaining exact
    // content bytes. EOF markers describe either side independently and are
    // not counted as hunk lines.
    const append = (content: string, fileLines: string[], prefix: string) => {
      fileLines.forEach((line, index) => {
        lines.push(`${prefix}${line}`);
        if (index === fileLines.length - 1 && !content.endsWith("\n")) {
          lines.push("\\ No newline at end of file");
        }
      });
    };
    append(before, beforeLines, "-");
    append(after, afterLines, "+");
  }
  // Patch syntax itself must be LF-terminated, even when source content is not.
  return lines.join("\n") + "\n";
}

export function createVerifiedPatchArtifact(
  patch: VerifiedPatch
): VerifiedPatchArtifact {
  const content =
    patch.files
      .map(createFilePatch)
      .join("");

  const byteSize =
    Buffer.byteLength(
      content,
      "utf8"
    );

  const sha256 =
    createHash("sha256")
      .update(content)
      .digest("hex");

  return {
    format: "unified_diff",
    content,
    sha256,
    byteSize,
  };
}