# Evidence-gated readiness verdict, version 1

Completed reports carry `readinessVerdict: { version: 1, status, reasonCodes,
affectedCategories }`. The server derives it from check results and the existing
readiness breakdown. The numeric score and coverage calculations remain unchanged.
AI-generated explanations have no input to the verdict.

## Required evidence

Every applicable category is mandatory. The existing weights are build 30,
types 15, lint 10, test 20, security 10, database 5, deployment 5, and
environment 5. A category is excluded only when **all** of its reported checks
are explicitly `skipped` with `skipReason: "not_applicable"`. A missing result,
an unsupported check, or a skip without an established reason does not prove
non-applicability. No coverage percentage threshold is used.

`ready` requires at least one evaluated category and passed evidence for every
applicable category. A confirmed failed check yields `not_ready`. A
`not_configured` result does so only when its trusted producer sets
`requiredForReadiness: true`; currently the sandbox build check sets this only
for a detected Next.js or Vite project lacking a build script, after its
existing direct-runtime and dependency-only exclusions.
Missing lint, test, deployment, or audit configuration has no such proof and
remains `undetermined`, although the unchanged numeric score still penalizes it.
Confirmed defects remain `not_ready` even when other evidence is missing. With
no such defect, missing, blocked,
errored, unsupported, or unknown evidence yields `undetermined`. Zero evaluated
weight also yields `undetermined`. Thus a 100/100 performance score with 5%
coverage is `undetermined`.

Interrupted assessments do not create completed reports, verdicts, or scores.
Older reports without a recognized version 1 verdict resolve to `undetermined`
with `legacy_report_missing_verdict`; their numeric fields remain available.

## Reason codes

| Code | Meaning |
| --- | --- |
| `all_applicable_checks_passed` | Every applicable category has passed evidence. |
| `confirmed_check_failure` | A repository check failed. |
| `required_check_not_configured` | An explicitly mandatory check lacks configuration. |
| `zero_evaluated_weight` | No category has evaluated evidence. |
| `required_evidence_missing` | An applicable category lacks complete passing evidence. |
| `required_evidence_blocked` | A required check was blocked. |
| `required_evidence_unsupported` | A required check is unsupported. |
| `required_evidence_error` | A required check errored without a confirmed repository defect. |
| `applicability_unknown` | A category is missing or its skip lacks an applicability reason. |
| `legacy_report_missing_verdict` | The report lacks a recognized version 1 verdict. |

The scanner records positive database evidence from a Prisma schema or declared
ORM, driver, or backend service. Remote assessments emit an explicit
`skipped/unsupported` database check for that evidence because they do not
validate the database. With no positive evidence, they emit a skip with unknown
applicability. A static-looking repository does not establish database absence:
the current scanner does not make a complete, trusted inventory of runtime code,
external API use, and deployment requirements. A future verifier must establish
that absence before emitting `not_applicable`. Database-backed repositories
need an isolated, bounded validation check before they can receive `ready`.

The sandbox TypeScript check now leaves applicability unknown when `tsconfig.json`
is absent; the scanner does not inspect every source file. The sandbox dependency
audit marks a Node package without a supported lockfile as `unsupported`, while
a repository with no Node package is outside that audit's scope.

## Dashboard evidence scope

The dashboard presents the server verdict as **Pre-deployment readiness based on
verified checks**, with **Verified Performance** and **Evidence Coverage** as
separate numeric metrics. Legacy reports without a recognized version 1 verdict
display `Undetermined`; their recorded numbers remain visible. An interrupted
assessment displays no completed verdict or score.

`Ready` means DeployGuard's applicable supported pre-deployment checks passed.
It does not certify production behavior. The remote database check currently
detects integrations but does not validate them. The deployment check confirms
that repository deployment or CI configuration exists; it does not execute a
deployment. Dependency audits inspect declared packages and do not prove
comprehensive application security. AI explanations never change the verdict.
