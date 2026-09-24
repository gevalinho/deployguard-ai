import {
  createVerifiedPatchArtifact,
} from "@/lib/remediation/verified-patch-artifact";

import type {
  VerifiedPatch,
} from "@/lib/remediation/verified-patch";

const patch: VerifiedPatch = {
  fileCount: 2,

  files: [
    {
      path: "example.js",
      changeType: "modified",
      before:
        'const message = "old";\n',
      after:
        'const message = "new";\n',
    },

    {
      path: "added.txt",
      changeType: "added",
      after:
        "DeployGuard verified artifact\n",
    },
  ],
};

const artifact =
  createVerifiedPatchArtifact(
    patch
  );

if (
  artifact.format !==
  "unified_diff"
) {
  throw new Error(
    "Unexpected patch artifact format."
  );
}

if (
  !artifact.content.includes(
    "diff --git a/example.js b/example.js"
  )
) {
  throw new Error(
    "Modified file was not represented."
  );
}

if (
  !artifact.content.includes(
    "--- /dev/null"
  )
) {
  throw new Error(
    "Added file was not represented correctly."
  );
}

if (
  artifact.byteSize <= 0
) {
  throw new Error(
    "Artifact byte size was not calculated."
  );
}

if (
  !/^[0-9a-f]{64}$/.test(
    artifact.sha256
  )
) {
  throw new Error(
    "Artifact SHA-256 is invalid."
  );
}

console.log(
  "✓ Verified patch artifact generated."
);

console.log(
  `✓ Format: ${artifact.format}`
);

console.log(
  `✓ Size: ${artifact.byteSize} bytes`
);

console.log(
  `✓ SHA-256: ${artifact.sha256}`
);

console.log(
  "\n--- Artifact preview ---\n"
);

console.log(
  artifact.content
);