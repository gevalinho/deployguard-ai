# DeployGuard AI

### Production Readiness, Backed by Evidence

**DeployGuard AI** is an AI-powered production-readiness verification and controlled-remediation platform. It helps developers assess real GitHub repositories, identify engineering risks, execute applicable checks in isolated environments, and deliver independently verified fixes through GitHub pull requests.

Instead of simply asking AI whether code is ready to deploy, DeployGuard collects evidence through actual execution.

**Live application:** https://deployguard.theconduitbox.com

**Repository:** https://github.com/gevalinho/deployguard-ai

**Hackathon:** Nebius x NVIDIA Global AI Hackathon 2026

**Track:** Coding and Agentic Engineering

---

## The Problem

AI-assisted development has made building software faster, but verifying production readiness remains difficult.

Applications may contain vulnerable dependencies, failing builds, missing tests, incompatible configurations, and deployment risks that are not obvious from reviewing source code.

Small teams and independent developers often lack dedicated DevOps expertise to investigate these problems.

DeployGuard AI addresses this challenge by combining real verification, structured AI reasoning, controlled remediation, and proof-based delivery.

## Key Features

### Repository Assessment

- Analyze supported GitHub repositories
- Inspect project structure and dependencies
- Identify available verification capabilities
- Support GitHub authentication and repository authorization
- Track source repository and commit provenance

### Isolated Verification

DeployGuard uses Docker-based workspaces to execute applicable checks:

- Dependency installation and preparation
- TypeScript validation
- Lint checks
- Automated tests
- Production builds
- Dependency vulnerability analysis
- Environment configuration inspection
- Deployment configuration inspection

Checks are classified according to their actual outcomes, including passed, failed, blocked, skipped, and error states.

### Readiness Scoring

DeployGuard produces a deterministic readiness score alongside assessment coverage.

The dashboard includes category-level results, supporting evidence, prioritized findings, and AI-assisted interpretation.

A readiness score is not a guarantee of production safety. Coverage indicates the extent of the applicable assessment that was evaluated.

### NVIDIA Nemotron Reasoning

DeployGuard integrates **NVIDIA Nemotron 3 Super 120B A12B** through **Nebius Token Factory**.

Nemotron analyzes structured repository evidence to produce:

- Architectural observations
- Risk explanations
- Remediation guidance
- Recommended engineering actions

AI-generated recommendations are advisory. Deterministic verification remains authoritative for readiness scoring and remediation proof.

### Controlled Remediation

For supported issues, DeployGuard can:

1. Create an isolated remediation workspace.
2. Apply a bounded candidate fix.
3. Execute relevant regression checks.
4. Recheck the affected security or engineering findings.
5. Persist the verified remediation artifact.

The original source repository is not directly modified during remediation execution.

### Verified GitHub Delivery

After explicit developer confirmation, DeployGuard can:

- Verify persisted source and artifact provenance
- Prepare a dedicated remediation branch
- Push the verified changes using its GitHub App
- Create a pull request against the verified source branch
- Verify the pull request on GitHub

Branch delivery and pull request creation are separately authorized operations.

DeployGuard does not automatically merge pull requests.

---

## Architecture

```text
GitHub Repository
        |
        v
Repository Ingestion
        |
        v
Isolated Docker Verification
        |
        v
Structured Evidence
        |
        v
Deterministic Readiness Score
        |
        v
NVIDIA Nemotron
(Nebius Token Factory)
        |
        v
Architecture Analysis
and Remediation Guidance
        |
        v
Controlled Remediation
        |
        v
Regression Verification
        |
        v
Verified Artifact
        |
        v
GitHub App Delivery
        |
        v
Verified Pull Request
```

### Engineering Principles

**Evidence before reasoning:** AI analyzes observed findings rather than inventing verification outcomes.

**Verification before delivery:** A proposed fix must satisfy the relevant checks before becoming eligible for GitHub delivery.

**Explicit authorization:** GitHub write operations require developer confirmation and repository authorization.

**Source protection:** Candidate remediation runs inside disposable workspaces.

**Fail-closed delivery:** Provenance mismatches and uncertain GitHub mutations are not silently bypassed or automatically retried.

---

## Technology Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js 16, React 19, TypeScript |
| Backend | Next.js API Routes, Node.js |
| Database access | Prisma ORM |
| Verification | Docker-based isolated execution |
| AI reasoning | NVIDIA Nemotron 3 Super 120B A12B |
| Model inference | Nebius Token Factory |
| External research | Tavily API |
| Source integration | GitHub OAuth, GitHub App, GitHub API |
| Testing | Vitest |
| Styling | Tailwind CSS |
| Production hosting | Oracle Cloud VM, Nginx, systemd |

## NVIDIA Nemotron and Nebius Integration

### Why Nemotron?

Production-readiness analysis requires reasoning over technical evidence such as dependency vulnerabilities, build failures, configuration findings, and architectural signals.

We selected NVIDIA Nemotron 3 Super 120B A12B for evidence-grounded technical reasoning and structured remediation guidance.

### How We Use Nebius Token Factory

DeployGuard accesses Nemotron through the hosted Nebius Token Factory inference API.

The backend prepares compact, structured evidence from completed verification checks and sends it to Nemotron for architecture analysis and remediation guidance.

We use:

- Specialized prompts for architecture and remediation
- Evidence compaction to reduce unnecessary context
- Strict JSON-schema-constrained responses
- Local response validation
- Bounded request timeouts
- Failure-tolerant handling when AI guidance is unavailable

### How Token Factory Accelerated Development

Nebius Token Factory allowed us to integrate a large NVIDIA reasoning model without deploying and maintaining dedicated GPU inference infrastructure.

This enabled us to focus on the engineering components that differentiate DeployGuard: sandbox verification, deterministic scoring, safe remediation, provenance verification, and authenticated GitHub delivery.

### Other Nebius Services

Our primary Nebius integration is **Token Factory for Nemotron inference**.

The web application itself is hosted on an Oracle Cloud virtual machine. We do not claim that the application or Docker verification environment runs on Nebius GPU infrastructure.

---

## Local Development

### Prerequisites

- Node.js 24
- npm
- Docker Engine with a running Docker daemon
- PostgreSQL database accessible through the configured Prisma connection
- Nebius Token Factory API credentials
- GitHub App credentials for authenticated repository and delivery workflows
- Tavily API credentials if external research is enabled

### 1. Clone the Repository

```bash
git clone https://github.com/gevalinho/deployguard-ai.git
cd deployguard-ai
```

### 2. Install Dependencies

```bash
npm ci
```

### 3. Configure Environment Variables

Create a local environment file:

```bash
cp .env.example .env
```

Fill in the values needed for the workflows you intend to run. The example file lists the server-side configuration read by the application.

Relevant configuration names include:

```dotenv
NEBIUS_API_KEY=
TAVILY_API_KEY=

DATABASE_URL=
DEPLOYGUARD_SESSION_SECRET=

GITHUB_APP_CLIENT_ID=
GITHUB_APP_CLIENT_SECRET=
GITHUB_APP_ID=
GITHUB_APP_OAUTH_REDIRECT_URI=
GITHUB_APP_PRIVATE_KEY_PATH=
GITHUB_APP_SLUG=
```

These are configuration names only. Supply your own credentials and service endpoints. `GITHUB_APP_SLUG` is optional and enables the installation link in the UI. The session secret must be at least 32 bytes, and the OAuth redirect URI must point to `/api/auth/github/callback` over HTTPS outside local development.

Keep `.env`, GitHub App private keys, database credentials, and API secrets out of version control.

GitHub App OAuth and installation callbacks must be configured for the environment in which DeployGuard is running.

### 4. Prepare the Database

Generate the Prisma client:

```bash
npx prisma generate
```

Apply the repository's existing database migrations where available:

```bash
npx prisma migrate deploy
```

Use a development database, not the production database, when testing locally.

### 5. Start Development Server

```bash
npm run dev
```

Open:

http://localhost:3000

### 6. Run Quality Checks

```bash
npx tsc --noEmit
npm run lint
npm test
npm run build
```

### 7. Production Start

After successful configuration and build:

```bash
npm run build
npm run start
```

The full verification and GitHub delivery workflows require their corresponding external services, permissions, Docker runtime, and credentials.

---

## Using DeployGuard AI

1. Open the application.
2. Enter a supported GitHub repository URL.
3. Select **Assess Repository**.
4. Observe the live verification pipeline.
5. Review readiness score, assessment coverage, and supporting evidence.
6. Inspect Nemotron architecture analysis and remediation guidance.
7. For eligible findings, initiate Controlled Remediation.
8. Review the remediation proof and verified artifact.
9. Authenticate with GitHub and authorize the relevant repository.
10. Explicitly confirm branch delivery and, separately, pull request creation.

Not every finding is automatically remediable. Unsupported or higher-risk issues may require manual engineering work.

---

## Real-World End-to-End Validation

We validated DeployGuard AI against an existing application repository.

### Initial Assessment

| Metric | Result |
|---|---|
| Readiness score | 40/100 |
| Assessment coverage | 88% |
| High-severity dependency findings | 10 |
| Production build | Passed |

### Controlled Remediation

DeployGuard executed a dependency remediation inside an isolated workspace and reran relevant verification checks.

| Metric | Result |
|---|---|
| Remediation | Proven |
| High-severity findings after remediation | 0 reported |
| Production build regression | Passed |
| Evaluated post-remediation score | 100/100 |
| Changed files | 2 |

The post-remediation score applies to the evaluated readiness criteria at the reported coverage, not every conceivable production risk.

### GitHub Delivery

DeployGuard successfully delivered the verified remediation through its GitHub App.

- Repository: `gevalinho/lih-wellcare-companion`
- Source branch: `master`
- Remediation branch: `deployguard/remediation-4adaa365ad96`
- Changed files: `package.json`, `package-lock.json`
- Pull request: **#2 — Verified DeployGuard remediation**
- Status at validation: Open and ready to merge
- Independent GitGuardian check: Succeeded; no secrets detected in the scanned commit

**View verified pull request:**

https://github.com/gevalinho/lih-wellcare-companion/pull/2

This demonstrates the full workflow from real repository assessment through independently proven remediation and verified GitHub delivery.

---

## Current Limitations

DeployGuard AI is an evolving developer platform.

Current limitations include:

- Controlled remediation supports selected classes of findings, not arbitrary software changes.
- Monorepo and complex multi-service assessment require further development.
- Mobile and native framework verification is not yet comprehensive.
- Readiness coverage depends on available project capabilities and supported checks.
- AI-generated guidance is advisory and may require developer review.
- Assessment history and persistent remediation task management are planned enhancements.

## Roadmap

Following the hackathon, planned improvements include:

- Persistent assessment history
- Repository readiness trends
- Actionable remediation workspaces
- Structured, trackable engineering tasks
- Expanded framework and monorepo support
- Additional controlled remediation capabilities
- CI/CD integrations
- Team collaboration and reporting
- Comparative branch readiness analysis

---

## Security

DeployGuard executes repository code in isolated environments. Repository execution and GitHub write access are security-sensitive operations.

Use trusted infrastructure, appropriately scoped credentials, and approved repository permissions.

Never commit API keys, session secrets, private keys, or database connection credentials.

Verified remediation delivery is deliberately separate from merge authorization. Developers remain responsible for reviewing pull requests before merging.

## License

DeployGuard AI is licensed under the [Apache License 2.0](LICENSE).

---

**DeployGuard AI — Production readiness, backed by evidence.**
