import assert from "node:assert/strict";

import type {
  CheckResult,
} from "@/lib/checks/types";

import {
  sanitizeCheckForPublic,
} from "@/lib/reporting/public-report";

const SECRET_STDOUT =
  "DEPLOYGUARD_SECRET_STDOUT_DO_NOT_EXPOSE";

const SECRET_STDERR =
  "DEPLOYGUARD_SECRET_STDERR_DO_NOT_EXPOSE";

function main(): void {
  console.log(
    "Testing public report boundary..."
  );

  const internalCheck: CheckResult = {
    id: "boundary-test",
    category: "build",
    name: "Boundary Test",
    status: "failed",
    command: "npm run build",
    exitCode: 1,
    durationMs: 1234,
    summary:
      "Build failed with normalized evidence.",

    stdout: SECRET_STDOUT,
    stderr: SECRET_STDERR,

    evidence: [
      {
        kind: "error",
        message:
          "Normalized build failure.",
        file: "src/app/page.tsx",
        line: 10,
        column: 5,
      },
    ],
  };

  const publicCheck =
    sanitizeCheckForPublic(
      internalCheck
    );

  const serialized =
    JSON.stringify(publicCheck);

  assert.equal(
    "stdout" in publicCheck,
    false,
    "Public check must not contain stdout"
  );

  assert.equal(
    "stderr" in publicCheck,
    false,
    "Public check must not contain stderr"
  );

  assert.equal(
    serialized.includes(
      SECRET_STDOUT
    ),
    false,
    "Serialized public check leaked stdout"
  );

  assert.equal(
    serialized.includes(
      SECRET_STDERR
    ),
    false,
    "Serialized public check leaked stderr"
  );

  assert.equal(
    publicCheck.evidence?.[0]
      ?.message,
    "Normalized build failure."
  );

  assert.equal(
    publicCheck.command,
    "npm run build"
  );

  console.log(
    "✓ Raw stdout excluded"
  );

  console.log(
    "✓ Raw stderr excluded"
  );

  console.log(
    "✓ Sensitive raw output absent from serialization"
  );

  console.log(
    "✓ Normalized evidence preserved"
  );

  console.log(
    "✓ Safe check metadata preserved"
  );

  console.log(
    "✓ Public report boundary passed"
  );
}

main();