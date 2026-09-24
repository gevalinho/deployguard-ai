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

function normalizeLines(
  content: string
): string[] {
  return content
    .replace(/\r\n/g, "\n")
    .split("\n");
}

function createFilePatch(
  file: VerifiedPatchFile
): string {
  const oldPath =
    file.changeType === "added"
      ? "/dev/null"
      : `a/${file.path}`;

  const newPath =
    file.changeType === "deleted"
      ? "/dev/null"
      : `b/${file.path}`;

  const beforeLines =
    file.before !== undefined
      ? normalizeLines(file.before)
      : [];

  const afterLines =
    file.after !== undefined
      ? normalizeLines(file.after)
      : [];

  const lines: string[] = [
    `diff --git a/${file.path} b/${file.path}`,
    `--- ${oldPath}`,
    `+++ ${newPath}`,
    `@@ -1,${beforeLines.length} +1,${afterLines.length} @@`,
  ];

  /*
   * v1 intentionally emits the complete bounded
   * before/after representation rather than
   * attempting a minimal line-level diff.
   *
   * The workspace snapshot already limits file
   * size, and this artifact remains inside the
   * trusted remediation boundary.
   */

  for (const line of beforeLines) {
    lines.push(`-${line}`);
  }

  for (const line of afterLines) {
    lines.push(`+${line}`);
  }

  return lines.join("\n");
}

export function createVerifiedPatchArtifact(
  patch: VerifiedPatch
): VerifiedPatchArtifact {
  const content =
    patch.files
      .map(createFilePatch)
      .join("\n\n");

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