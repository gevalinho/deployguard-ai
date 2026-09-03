import {
  runRemoteReadinessAssessment,
} from "../src/lib/orchestration/remote-readiness-orchestrator";

async function main() {
  console.log(
    "\n=== DeployGuard Remote Readiness Assessment ===\n"
  );

  const repositoryUrl =
    "https://github.com/gevalinho/deployguard-ai";

  console.log(
    `Repository: ${repositoryUrl}`
  );

  console.log(
    "\nRunning remote assessment..."
  );

  // const result =
  //   await runRemoteReadinessAssessment(
  //     repositoryUrl
  //   );

  const result =
  await runRemoteReadinessAssessment(
    repositoryUrl,
    (event) => {
      const elapsedSeconds =
        Math.floor(
          (event.elapsedMs ?? 0) / 1000
        );

      const minutes =
        Math.floor(elapsedSeconds / 60);

      const seconds =
        elapsedSeconds % 60;

      const elapsed =
        `${minutes}:${seconds
          .toString()
          .padStart(2, "0")}`;

      const symbol =
        event.status === "running"
          ? "⏳"
          : event.status === "passed"
            ? "✓"
            : event.status === "completed"
              ? "✓"
              : event.status === "skipped"
                ? "○"
                : event.status === "failed"
                  ? "✕"
                  : event.status === "error"
                    ? "!"
                    : "○";

      console.log(
        `[${elapsed}] ${symbol} ${event.label}: ${event.message ?? event.status}`
      );
    }
  );

  console.log(
    "\n=== Assessment Complete ===\n"
  );

  console.log(
    `Repository: ${result.repository.fullName}`
  );

  console.log(
    `Readiness Score: ${result.report.readiness.score}/100`
  );

  console.log(
    `Coverage: ${result.report.readiness.coverage}%`
  );

  console.log(
    "\nChecks:\n"
  );

  for (
    const check of result.report.checks
  ) {
    console.log(
      `${check.name}: ${check.status}`
    );

    console.log(
      `  ${check.summary}`
    );
  }

  console.log(
    "\nRemediation:\n"
  );

  if (
    result.report.remediation.length === 0
  ) {
    console.log(
      "No remediation items."
    );
  } else {
    for (
      const item of result.report.remediation
    ) {
      console.log(
        `[${item.priority}] ${item.title}`
      );

      console.log(
        `  ${item.recommendation}`
      );
    }
  }

  if (result.report.architecture) {
    console.log(
      "\nNemotron Architecture Analysis:\n"
    );

    console.log(
      result.report.architecture.summary
    );

    console.log(
      "\nVerified risks:"
    );

    if (
      result.report.architecture.risks
        .length === 0
    ) {
      console.log(
        "No verified architecture risks."
      );
    } else {
      for (
        const risk of
          result.report.architecture.risks
      ) {
        console.log(
          `- [${risk.severity}] ${risk.title}`
        );
      }
    }
  } else {
    console.log(
      "\nNemotron architecture analysis unavailable."
    );
  }

  if (result.verification) {
    console.log(
      `\nVerifier rejected ${result.verification.rejectedRisks.length} unsupported AI risk(s).`
    );
  }

  console.log(
    "\nTemporary repository cleaned up."
  );
}

main().catch((error) => {
  console.error(
    "\nRemote readiness assessment failed:",
    error
  );

  process.exit(1);
});