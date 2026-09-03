module.exports = [
"[externals]/next/dist/compiled/@opentelemetry/api [external] (next/dist/compiled/@opentelemetry/api, cjs)", ((__turbopack_context__, module, exports) => {

var mod = __turbopack_context__.x("next/dist/compiled/@opentelemetry/api", () => require("next/dist/compiled/@opentelemetry/api"));

module.exports = mod;
}),
"[externals]/next/dist/compiled/next-server/app-page-turbo.runtime.dev.js [external] (next/dist/compiled/next-server/app-page-turbo.runtime.dev.js, cjs)", ((__turbopack_context__, module, exports) => {

var mod = __turbopack_context__.x("next/dist/compiled/next-server/app-page-turbo.runtime.dev.js", () => require("next/dist/compiled/next-server/app-page-turbo.runtime.dev.js"));

module.exports = mod;
}),
"[externals]/next/dist/compiled/next-server/app-route-turbo.runtime.dev.js [external] (next/dist/compiled/next-server/app-route-turbo.runtime.dev.js, cjs)", ((__turbopack_context__, module, exports) => {

var mod = __turbopack_context__.x("next/dist/compiled/next-server/app-route-turbo.runtime.dev.js", () => require("next/dist/compiled/next-server/app-route-turbo.runtime.dev.js"));

module.exports = mod;
}),
"[externals]/next/dist/server/app-render/action-async-storage.external.js [external] (next/dist/server/app-render/action-async-storage.external.js, cjs)", ((__turbopack_context__, module, exports) => {

var mod = __turbopack_context__.x("next/dist/server/app-render/action-async-storage.external.js", () => require("next/dist/server/app-render/action-async-storage.external.js"));

module.exports = mod;
}),
"[externals]/next/dist/server/app-render/after-task-async-storage.external.js [external] (next/dist/server/app-render/after-task-async-storage.external.js, cjs)", ((__turbopack_context__, module, exports) => {

var mod = __turbopack_context__.x("next/dist/server/app-render/after-task-async-storage.external.js", () => require("next/dist/server/app-render/after-task-async-storage.external.js"));

module.exports = mod;
}),
"[externals]/next/dist/server/app-render/work-async-storage.external.js [external] (next/dist/server/app-render/work-async-storage.external.js, cjs)", ((__turbopack_context__, module, exports) => {

var mod = __turbopack_context__.x("next/dist/server/app-render/work-async-storage.external.js", () => require("next/dist/server/app-render/work-async-storage.external.js"));

module.exports = mod;
}),
"[externals]/next/dist/server/app-render/work-unit-async-storage.external.js [external] (next/dist/server/app-render/work-unit-async-storage.external.js, cjs)", ((__turbopack_context__, module, exports) => {

var mod = __turbopack_context__.x("next/dist/server/app-render/work-unit-async-storage.external.js", () => require("next/dist/server/app-render/work-unit-async-storage.external.js"));

module.exports = mod;
}),
"[externals]/next/dist/server/runtime-reacts.external.js [external] (next/dist/server/runtime-reacts.external.js, cjs)", ((__turbopack_context__, module, exports) => {

var mod = __turbopack_context__.x("next/dist/server/runtime-reacts.external.js", () => require("next/dist/server/runtime-reacts.external.js"));

module.exports = mod;
}),
"[externals]/next/dist/shared/lib/no-fallback-error.external.js [external] (next/dist/shared/lib/no-fallback-error.external.js, cjs)", ((__turbopack_context__, module, exports) => {

var mod = __turbopack_context__.x("next/dist/shared/lib/no-fallback-error.external.js", () => require("next/dist/shared/lib/no-fallback-error.external.js"));

module.exports = mod;
}),
"[externals]/node:child_process [external] (node:child_process, cjs)", ((__turbopack_context__, module, exports) => {

var mod = __turbopack_context__.x("node:child_process", () => require("node:child_process"));

module.exports = mod;
}),
"[externals]/node:fs [external] (node:fs, cjs)", ((__turbopack_context__, module, exports) => {

var mod = __turbopack_context__.x("node:fs", () => require("node:fs"));

module.exports = mod;
}),
"[externals]/node:os [external] (node:os, cjs)", ((__turbopack_context__, module, exports) => {

var mod = __turbopack_context__.x("node:os", () => require("node:os"));

module.exports = mod;
}),
"[externals]/node:path [external] (node:path, cjs)", ((__turbopack_context__, module, exports) => {

var mod = __turbopack_context__.x("node:path", () => require("node:path"));

module.exports = mod;
}),
"[externals]/node:stream [external] (node:stream, cjs)", ((__turbopack_context__, module, exports) => {

var mod = __turbopack_context__.x("node:stream", () => require("node:stream"));

module.exports = mod;
}),
"[project]/src/app/api/assessment/route.ts [app-route] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "POST",
    ()=>POST,
    "runtime",
    ()=>runtime
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$server$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/next/server.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$orchestration$2f$readiness$2d$orchestrator$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/src/lib/orchestration/readiness-orchestrator.ts [app-route] (ecmascript)");
;
;
const runtime = "nodejs";
async function POST() {
    try {
        const repositoryPath = process.cwd();
        const report = await (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$orchestration$2f$readiness$2d$orchestrator$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["runReadinessAssessment"])(repositoryPath);
        return __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$server$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["NextResponse"].json({
            ok: true,
            report
        }, {
            status: 200
        });
    } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown assessment error";
        console.error("DeployGuard assessment failed:", error);
        return __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$server$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["NextResponse"].json({
            ok: false,
            error: message
        }, {
            status: 500
        });
    }
}
}),
"[project]/src/lib/agents/architect-agent.ts [app-route] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "runArchitectAgent",
    ()=>runArchitectAgent
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$ai$2f$nebius$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/src/lib/ai/nebius.ts [app-route] (ecmascript)");
;
async function runArchitectAgent(scan) {
    const nebius = (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$ai$2f$nebius$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["getNebiusClient"])();
    const response = await nebius.chat.completions.create({
        model: __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$ai$2f$nebius$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["NEBIUS_MODELS"].architect,
        temperature: 0.1,
        messages: [
            {
                role: "system",
                content: `
You are the Architect Agent for DeployGuard AI.

Your job is to reason about VERIFIED repository evidence and recommend
production-readiness checks.

IMPORTANT RULES:

1. Treat the supplied repository facts as authoritative.
2. Do not invent technologies that are not supported by the evidence.
3. Do not override or reinterpret verified facts.
4. Clearly distinguish evidence from inference.
5. Recommend checks appropriate for the detected technology stack.
6. Only identify risks reasonably supported by the supplied evidence.
7. Do not claim that a check has passed or failed. You have not executed
   any commands yet.
8. Every risk must reference the repository fact keys that support it
   using evidenceKeys.

9. If a risk requires reasoning beyond the literal evidence,
   set inference to true.

10. Never treat missing evidence as proof that a technology,
    configuration, test suite, or security control is absent.

11. Do not make claims about whether a software version is current,
    outdated, vulnerable, or supported unless that information is
    explicitly present in the supplied evidence.

12. If there is insufficient evidence to support a risk, omit the risk.

Return ONLY valid JSON with this exact structure:

{
  "summary": "string",
  "architectureType": "string",
  "recommendedChecks": ["string"],
  "risks": [
    {
      "title": "string",
      "severity": "low | medium | high | critical",
      "reason": "string",
      "evidenceKeys": ["string"],
      "inference": true
    }
  ]
}
        `.trim()
            },
            {
                role: "user",
                content: `
Analyze these verified repository facts:

${JSON.stringify(scan.facts, null, 2)}
        `.trim()
            }
        ]
    });
    const content = response.choices[0]?.message?.content;
    if (!content) {
        throw new Error("Architect Agent returned no content.");
    }
    return JSON.parse(content);
}
}),
"[project]/src/lib/agents/build-agent.ts [app-route] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "runBuildAgent",
    ()=>runBuildAgent
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$execution$2f$command$2d$runner$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/src/lib/execution/command-runner.ts [app-route] (ecmascript)");
;
function getPackageManager(scan) {
    return scan.facts.find((fact)=>fact.key === "packageManager")?.value ?? null;
}
async function runBuildAgent(scan) {
    const packageManager = getPackageManager(scan);
    if (!packageManager) {
        return {
            id: "production-build",
            category: "build",
            name: "Production Build",
            status: "skipped",
            summary: "No verified package manager was detected."
        };
    }
    let command;
    let args;
    switch(packageManager){
        case "npm":
            command = "npm";
            args = [
                "run",
                "build"
            ];
            break;
        case "pnpm":
            command = "pnpm";
            args = [
                "run",
                "build"
            ];
            break;
        case "Yarn":
            command = "yarn";
            args = [
                "build"
            ];
            break;
        default:
            return {
                id: "production-build",
                category: "build",
                name: "Production Build",
                status: "skipped",
                summary: `Unsupported package manager: ${packageManager}`
            };
    }
    const result = await (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$execution$2f$command$2d$runner$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["runCommand"])(command, args, scan.repositoryPath, {
        env: {
            NODE_ENV: "production"
        }
    });
    return {
        id: "production-build",
        category: "build",
        name: "Production Build",
        status: result.status,
        command: [
            command,
            ...args
        ].join(" "),
        exitCode: result.exitCode,
        durationMs: result.durationMs,
        summary: result.status === "passed" ? "Production build completed successfully." : "Production build failed.",
        stdout: result.stdout,
        stderr: result.stderr
    };
}
}),
"[project]/src/lib/agents/database-agent.ts [app-route] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "runDatabaseAgent",
    ()=>runDatabaseAgent
]);
var __TURBOPACK__imported__module__$5b$externals$5d2f$node$3a$fs__$5b$external$5d$__$28$node$3a$fs$2c$__cjs$29$__ = __turbopack_context__.i("[externals]/node:fs [external] (node:fs, cjs)");
var __TURBOPACK__imported__module__$5b$externals$5d2f$node$3a$path__$5b$external$5d$__$28$node$3a$path$2c$__cjs$29$__ = __turbopack_context__.i("[externals]/node:path [external] (node:path, cjs)");
var __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$execution$2f$command$2d$runner$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/src/lib/execution/command-runner.ts [app-route] (ecmascript)");
;
;
;
function getFact(scan, key) {
    return scan.facts.find((fact)=>fact.key === key)?.value ?? null;
}
async function runDatabaseAgent(scan) {
    const orm = getFact(scan, "orm");
    if (!orm) {
        return {
            id: "database-readiness",
            category: "database",
            name: "Database Readiness",
            status: "skipped",
            skipReason: "not_applicable",
            summary: "No verified database or ORM configuration was detected."
        };
    }
    if (orm !== "Prisma") {
        return {
            id: "database-readiness",
            category: "database",
            name: "Database Readiness",
            status: "skipped",
            skipReason: "unsupported",
            summary: `Database validation is not yet implemented for ORM: ${orm}.`
        };
    }
    const schemaPath = __TURBOPACK__imported__module__$5b$externals$5d2f$node$3a$path__$5b$external$5d$__$28$node$3a$path$2c$__cjs$29$__["default"].join(scan.repositoryPath, "prisma", "schema.prisma");
    if (!__TURBOPACK__imported__module__$5b$externals$5d2f$node$3a$fs__$5b$external$5d$__$28$node$3a$fs$2c$__cjs$29$__["default"].existsSync(schemaPath)) {
        return {
            id: "database-readiness",
            category: "database",
            name: "Database Readiness",
            status: "failed",
            summary: "Prisma was detected, but prisma/schema.prisma is missing."
        };
    }
    const result = await (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$execution$2f$command$2d$runner$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["runCommand"])("npx", [
        "prisma",
        "validate"
    ], scan.repositoryPath);
    return {
        id: "database-readiness",
        category: "database",
        name: "Database Readiness",
        status: result.status,
        command: "npx prisma validate",
        exitCode: result.exitCode,
        durationMs: result.durationMs,
        summary: result.status === "passed" ? "Prisma schema validation completed successfully." : "Prisma schema validation failed.",
        stdout: result.stdout,
        stderr: result.stderr
    };
}
}),
"[project]/src/lib/agents/deployment-agent.ts [app-route] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "runDeploymentAgent",
    ()=>runDeploymentAgent
]);
async function runDeploymentAgent(scan) {
    const deploymentFacts = scan.facts.filter((fact)=>fact.key === "deployment");
    const ciFacts = scan.facts.filter((fact)=>fact.key === "ci");
    if (deploymentFacts.length === 0 && ciFacts.length === 0) {
        return {
            id: "deployment-readiness",
            category: "deployment",
            name: "Deployment Readiness",
            status: "skipped",
            skipReason: "not_configured",
            summary: "No verified deployment or CI configuration was detected in the repository."
        };
    }
    const detectedEvidence = [
        ...deploymentFacts.map((fact)=>fact.value),
        ...ciFacts.map((fact)=>fact.value)
    ];
    return {
        id: "deployment-readiness",
        category: "deployment",
        name: "Deployment Readiness",
        status: "passed",
        summary: `Verified deployment configuration detected: ${detectedEvidence.join(", ")}.`
    };
}
}),
"[project]/src/lib/agents/environment-agent.ts [app-route] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "runEnvironmentAgent",
    ()=>runEnvironmentAgent
]);
var __TURBOPACK__imported__module__$5b$externals$5d2f$node$3a$fs__$5b$external$5d$__$28$node$3a$fs$2c$__cjs$29$__ = __turbopack_context__.i("[externals]/node:fs [external] (node:fs, cjs)");
var __TURBOPACK__imported__module__$5b$externals$5d2f$node$3a$path__$5b$external$5d$__$28$node$3a$path$2c$__cjs$29$__ = __turbopack_context__.i("[externals]/node:path [external] (node:path, cjs)");
;
;
function extractVariableNames(content) {
    return content.split("\n").map((line)=>line.trim()).filter((line)=>line.length > 0 && !line.startsWith("#") && line.includes("=")).map((line)=>line.split("=")[0].trim()).filter(Boolean);
}
function readEnvironmentVariableNames(filePath) {
    if (!__TURBOPACK__imported__module__$5b$externals$5d2f$node$3a$fs__$5b$external$5d$__$28$node$3a$fs$2c$__cjs$29$__["default"].existsSync(filePath)) {
        return [];
    }
    const content = __TURBOPACK__imported__module__$5b$externals$5d2f$node$3a$fs__$5b$external$5d$__$28$node$3a$fs$2c$__cjs$29$__["default"].readFileSync(filePath, "utf-8");
    return extractVariableNames(content);
}
function looksSensitive(variableName) {
    const sensitivePatterns = [
        "SECRET",
        "TOKEN",
        "PASSWORD",
        "PRIVATE",
        "API_KEY",
        "DATABASE_URL"
    ];
    return sensitivePatterns.some((pattern)=>variableName.toUpperCase().includes(pattern));
}
async function runEnvironmentAgent(scan) {
    const envPath = __TURBOPACK__imported__module__$5b$externals$5d2f$node$3a$path__$5b$external$5d$__$28$node$3a$path$2c$__cjs$29$__["default"].join(scan.repositoryPath, ".env");
    const examplePath = __TURBOPACK__imported__module__$5b$externals$5d2f$node$3a$path__$5b$external$5d$__$28$node$3a$path$2c$__cjs$29$__["default"].join(scan.repositoryPath, ".env.example");
    const envExists = __TURBOPACK__imported__module__$5b$externals$5d2f$node$3a$fs__$5b$external$5d$__$28$node$3a$fs$2c$__cjs$29$__["default"].existsSync(envPath);
    const exampleExists = __TURBOPACK__imported__module__$5b$externals$5d2f$node$3a$fs__$5b$external$5d$__$28$node$3a$fs$2c$__cjs$29$__["default"].existsSync(examplePath);
    const envVariables = readEnvironmentVariableNames(envPath);
    const exampleVariables = readEnvironmentVariableNames(examplePath);
    const undocumentedVariables = envVariables.filter((variable)=>!exampleVariables.includes(variable));
    const exposedSensitiveVariables = envVariables.filter((variable)=>variable.startsWith("NEXT_PUBLIC_") && looksSensitive(variable));
    if (exposedSensitiveVariables.length > 0) {
        return {
            id: "environment-config",
            category: "environment",
            name: "Environment Configuration",
            status: "failed",
            summary: `Potentially sensitive public environment variables detected: ${exposedSensitiveVariables.join(", ")}.`
        };
    }
    if (!envExists) {
        return {
            id: "environment-config",
            category: "environment",
            name: "Environment Configuration",
            status: "skipped",
            summary: "No .env file was detected for environment validation."
        };
    }
    if (!exampleExists) {
        return {
            id: "environment-config",
            category: "environment",
            name: "Environment Configuration",
            status: "failed",
            summary: "Environment variables are configured, but .env.example is missing."
        };
    }
    if (undocumentedVariables.length > 0) {
        return {
            id: "environment-config",
            category: "environment",
            name: "Environment Configuration",
            status: "failed",
            summary: `Environment variables are not documented in .env.example: ${undocumentedVariables.join(", ")}.`
        };
    }
    return {
        id: "environment-config",
        category: "environment",
        name: "Environment Configuration",
        status: "passed",
        summary: "Environment configuration is documented and no obviously sensitive public variable names were detected."
    };
}
}),
"[project]/src/lib/agents/lint-agent.ts [app-route] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "runLintAgent",
    ()=>runLintAgent
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$execution$2f$command$2d$runner$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/src/lib/execution/command-runner.ts [app-route] (ecmascript)");
;
async function runLintAgent(scan) {
    const result = await (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$execution$2f$command$2d$runner$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["runCommand"])("npm", [
        "run",
        "lint"
    ], scan.repositoryPath);
    return {
        id: "lint-check",
        category: "lint",
        name: "Lint Check",
        status: result.status,
        command: "npm run lint",
        exitCode: result.exitCode,
        durationMs: result.durationMs,
        summary: result.status === "passed" ? "Lint validation completed successfully." : "Lint validation failed.",
        stdout: result.stdout,
        stderr: result.stderr
    };
}
}),
"[project]/src/lib/agents/security-agent.ts [app-route] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "runSecurityAgent",
    ()=>runSecurityAgent
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$execution$2f$command$2d$runner$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/src/lib/execution/command-runner.ts [app-route] (ecmascript)");
;
function getPackageManager(scan) {
    return scan.facts.find((fact)=>fact.key === "packageManager")?.value ?? null;
}
function isAuditExecutionError(stdout, stderr) {
    const output = `${stdout}\n${stderr}`.toLowerCase();
    return output.includes("audit endpoint returned an error") || output.includes("eai_again") || output.includes("enotfound") || output.includes("econnrefused") || output.includes("etimedout");
}
async function runSecurityAgent(scan) {
    const packageManager = getPackageManager(scan);
    if (!packageManager) {
        return {
            id: "dependency-security",
            category: "security",
            name: "Dependency Security Audit",
            status: "skipped",
            summary: "No verified package manager was detected."
        };
    }
    if (packageManager !== "npm") {
        return {
            id: "dependency-security",
            category: "security",
            name: "Dependency Security Audit",
            status: "skipped",
            summary: `Security audit is not yet implemented for ${packageManager}.`
        };
    }
    const result = await (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$execution$2f$command$2d$runner$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["runCommand"])("npm", [
        "audit",
        "--audit-level=high"
    ], scan.repositoryPath);
    if (isAuditExecutionError(result.stdout, result.stderr)) {
        return {
            id: "dependency-security",
            category: "security",
            name: "Dependency Security Audit",
            status: "error",
            command: "npm audit --audit-level=high",
            exitCode: result.exitCode,
            durationMs: result.durationMs,
            summary: "Dependency security audit could not be completed because the npm registry was unavailable.",
            stdout: result.stdout,
            stderr: result.stderr
        };
    }
    return {
        id: "dependency-security",
        category: "security",
        name: "Dependency Security Audit",
        status: result.status,
        command: "npm audit --audit-level=high",
        exitCode: result.exitCode,
        durationMs: result.durationMs,
        summary: result.status === "passed" ? "No high-severity dependency vulnerabilities were detected." : "High-severity dependency vulnerabilities were detected.",
        stdout: result.stdout,
        stderr: result.stderr
    };
}
}),
"[project]/src/lib/agents/test-agent.ts [app-route] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "runTestAgent",
    ()=>runTestAgent
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$execution$2f$command$2d$runner$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/src/lib/execution/command-runner.ts [app-route] (ecmascript)");
;
function getFact(scan, key) {
    return scan.facts.find((fact)=>fact.key === key)?.value ?? null;
}
async function runTestAgent(scan) {
    const packageManager = getFact(scan, "packageManager");
    const testScript = getFact(scan, "testScript");
    if (!testScript) {
        return {
            id: "test-suite",
            category: "test",
            name: "Test Suite",
            status: "skipped",
            skipReason: "not_configured",
            summary: "No verified test script was detected in package.json."
        };
    }
    if (!packageManager) {
        return {
            id: "test-suite",
            category: "test",
            name: "Test Suite",
            status: "skipped",
            summary: "A test script exists, but no verified package manager was detected."
        };
    }
    let command;
    let args;
    switch(packageManager){
        case "npm":
            command = "npm";
            args = [
                "test"
            ];
            break;
        case "pnpm":
            command = "pnpm";
            args = [
                "test"
            ];
            break;
        case "Yarn":
            command = "yarn";
            args = [
                "test"
            ];
            break;
        default:
            return {
                id: "test-suite",
                category: "test",
                name: "Test Suite",
                status: "skipped",
                summary: `Unsupported package manager: ${packageManager}`
            };
    }
    const result = await (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$execution$2f$command$2d$runner$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["runCommand"])(command, args, scan.repositoryPath);
    return {
        id: "test-suite",
        category: "test",
        name: "Test Suite",
        status: result.status,
        command: [
            command,
            ...args
        ].join(" "),
        exitCode: result.exitCode,
        durationMs: result.durationMs,
        summary: result.status === "passed" ? "Repository test suite completed successfully." : "Repository test suite failed.",
        stdout: result.stdout,
        stderr: result.stderr
    };
}
}),
"[project]/src/lib/agents/typecheck-agent.ts [app-route] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "runTypecheckAgent",
    ()=>runTypecheckAgent
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$execution$2f$command$2d$runner$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/src/lib/execution/command-runner.ts [app-route] (ecmascript)");
;
async function runTypecheckAgent(scan) {
    const result = await (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$execution$2f$command$2d$runner$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["runCommand"])("npx", [
        "tsc",
        "--noEmit"
    ], scan.repositoryPath);
    return {
        id: "typescript-check",
        category: "types",
        name: "TypeScript Check",
        status: result.status,
        command: "npx tsc --noEmit",
        exitCode: result.exitCode,
        durationMs: result.durationMs,
        summary: result.status === "passed" ? "TypeScript validation completed successfully." : "TypeScript validation failed.",
        stdout: result.stdout,
        stderr: result.stderr
    };
}
}),
"[project]/src/lib/agents/verifier.ts [app-route] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "verifyArchitectureAnalysis",
    ()=>verifyArchitectureAnalysis
]);
function verifyArchitectureAnalysis(scan, analysis) {
    const knownKeys = new Set(scan.facts.map((fact)=>fact.key));
    const acceptedRisks = [];
    const rejectedRisks = [];
    for (const risk of analysis.risks){
        const evidenceKeysAreValid = risk.evidenceKeys.length > 0 && risk.evidenceKeys.every((key)=>knownKeys.has(key));
        /*
     * DeployGuard's verified risk layer only accepts
     * risks directly supported by deterministic evidence.
     *
     * AI inference may still be useful for recommendations,
     * but it must not become a verified production risk.
     */ const isDirectlySupported = risk.inference === false;
        if (evidenceKeysAreValid && isDirectlySupported) {
            acceptedRisks.push(risk);
        } else {
            rejectedRisks.push(risk);
        }
    }
    return {
        acceptedRisks,
        rejectedRisks
    };
}
}),
"[project]/src/lib/agents/workspace-agent.ts [app-route] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "prepareAssessmentWorkspace",
    ()=>prepareAssessmentWorkspace
]);
var __TURBOPACK__imported__module__$5b$externals$5d2f$node$3a$fs__$5b$external$5d$__$28$node$3a$fs$2c$__cjs$29$__ = __turbopack_context__.i("[externals]/node:fs [external] (node:fs, cjs)");
var __TURBOPACK__imported__module__$5b$externals$5d2f$node$3a$path__$5b$external$5d$__$28$node$3a$path$2c$__cjs$29$__ = __turbopack_context__.i("[externals]/node:path [external] (node:path, cjs)");
var __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$execution$2f$command$2d$runner$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/src/lib/execution/command-runner.ts [app-route] (ecmascript)");
;
;
;
function detectPackageManager(repositoryPath) {
    if ((0, __TURBOPACK__imported__module__$5b$externals$5d2f$node$3a$fs__$5b$external$5d$__$28$node$3a$fs$2c$__cjs$29$__["existsSync"])((0, __TURBOPACK__imported__module__$5b$externals$5d2f$node$3a$path__$5b$external$5d$__$28$node$3a$path$2c$__cjs$29$__["join"])(repositoryPath, "package-lock.json"))) {
        return "npm";
    }
    if ((0, __TURBOPACK__imported__module__$5b$externals$5d2f$node$3a$fs__$5b$external$5d$__$28$node$3a$fs$2c$__cjs$29$__["existsSync"])((0, __TURBOPACK__imported__module__$5b$externals$5d2f$node$3a$path__$5b$external$5d$__$28$node$3a$path$2c$__cjs$29$__["join"])(repositoryPath, "pnpm-lock.yaml"))) {
        return "pnpm";
    }
    if ((0, __TURBOPACK__imported__module__$5b$externals$5d2f$node$3a$fs__$5b$external$5d$__$28$node$3a$fs$2c$__cjs$29$__["existsSync"])((0, __TURBOPACK__imported__module__$5b$externals$5d2f$node$3a$path__$5b$external$5d$__$28$node$3a$path$2c$__cjs$29$__["join"])(repositoryPath, "yarn.lock"))) {
        return "yarn";
    }
    return undefined;
}
async function prepareAssessmentWorkspace(repositoryPath) {
    const packageManager = detectPackageManager(repositoryPath);
    if (!packageManager) {
        return {
            status: "failed",
            summary: "No supported package manager lockfile was detected."
        };
    }
    let command;
    let args;
    switch(packageManager){
        case "npm":
            command = "npm";
            args = [
                "ci",
                "--ignore-scripts"
            ];
            break;
        case "pnpm":
            command = "pnpm";
            args = [
                "install",
                "--frozen-lockfile",
                "--ignore-scripts"
            ];
            break;
        case "yarn":
            command = "yarn";
            args = [
                "install",
                "--frozen-lockfile",
                "--ignore-scripts"
            ];
            break;
    }
    const result = await (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$execution$2f$command$2d$runner$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["runCommand"])(command, args, repositoryPath);
    return {
        status: result.status,
        packageManager,
        command: result,
        summary: result.status === "passed" ? `Workspace dependencies installed successfully using ${packageManager}.` : `Workspace dependency installation failed using ${packageManager}.`
    };
}
}),
"[project]/src/lib/ai/nebius.ts [app-route] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "NEBIUS_MODELS",
    ()=>NEBIUS_MODELS,
    "getNebiusClient",
    ()=>getNebiusClient
]);
// import OpenAI from "openai";
// const apiKey = process.env.NEBIUS_API_KEY;
// if (!apiKey) {
//   throw new Error("NEBIUS_API_KEY is missing.");
// }
// export const nebius = new OpenAI({
//   apiKey,
//   baseURL: "https://api.tokenfactory.us-central1.nebius.com/v1/",
// });
// export const NEBIUS_MODELS = {
//   architect: "nvidia/nemotron-3-super-120b-a12b",
// } as const;
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$openai$2f$index$2e$mjs__$5b$app$2d$route$5d$__$28$ecmascript$29$__$3c$locals$3e$__ = __turbopack_context__.i("[project]/node_modules/openai/index.mjs [app-route] (ecmascript) <locals>");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$openai$2f$client$2e$mjs__$5b$app$2d$route$5d$__$28$ecmascript$29$__$3c$export__OpenAI__as__default$3e$__ = __turbopack_context__.i("[project]/node_modules/openai/client.mjs [app-route] (ecmascript) <export OpenAI as default>");
;
const NEBIUS_MODELS = {
    architect: "nvidia/nemotron-3-super-120b-a12b"
};
function getNebiusClient() {
    const apiKey = process.env.NEBIUS_API_KEY;
    if (!apiKey) {
        throw new Error("NEBIUS_API_KEY is missing.");
    }
    return new __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$openai$2f$client$2e$mjs__$5b$app$2d$route$5d$__$28$ecmascript$29$__$3c$export__OpenAI__as__default$3e$__["default"]({
        apiKey,
        baseURL: "https://api.tokenfactory.us-central1.nebius.com/v1/"
    });
}
}),
"[project]/src/lib/execution/command-runner.ts [app-route] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "runCommand",
    ()=>runCommand
]);
// import { spawn } from "node:child_process";
// export interface CommandResult {
//   command: string;
//   args: string[];
//   exitCode: number | null;
//   stdout: string;
//   stderr: string;
//   durationMs: number;
//   status: "passed" | "failed";
// }
// export function runCommand(
//   command: string,
//   args: string[],
//   cwd: string
// ): Promise<CommandResult> {
//   return new Promise((resolve, reject) => {
//     const startedAt = Date.now();
//     const child = spawn(command, args, {
//       cwd,
//       shell: false,
//       env: process.env,
//     });
//     let stdout = "";
//     let stderr = "";
//     child.stdout.on("data", (chunk) => {
//       stdout += chunk.toString();
//     });
//     child.stderr.on("data", (chunk) => {
//       stderr += chunk.toString();
//     });
//     child.on("error", (error) => {
//       reject(error);
//     });
//     child.on("close", (exitCode) => {
//       resolve({
//         command,
//         args,
//         exitCode,
//         stdout,
//         stderr,
//         durationMs: Date.now() - startedAt,
//         status: exitCode === 0 ? "passed" : "failed",
//       });
//     });
//   });
// }
var __TURBOPACK__imported__module__$5b$externals$5d2f$node$3a$child_process__$5b$external$5d$__$28$node$3a$child_process$2c$__cjs$29$__ = __turbopack_context__.i("[externals]/node:child_process [external] (node:child_process, cjs)");
;
function runCommand(command, args, cwd, options = {}) {
    return new Promise((resolve, reject)=>{
        const startedAt = Date.now();
        const child = (0, __TURBOPACK__imported__module__$5b$externals$5d2f$node$3a$child_process__$5b$external$5d$__$28$node$3a$child_process$2c$__cjs$29$__["spawn"])(command, args, {
            cwd,
            shell: false,
            env: {
                ...process.env,
                ...options.env
            }
        });
        let stdout = "";
        let stderr = "";
        child.stdout.on("data", (chunk)=>{
            stdout += chunk.toString();
        });
        child.stderr.on("data", (chunk)=>{
            stderr += chunk.toString();
        });
        child.on("error", (error)=>{
            reject(error);
        });
        child.on("close", (exitCode)=>{
            resolve({
                command,
                args,
                exitCode,
                stdout,
                stderr,
                durationMs: Date.now() - startedAt,
                status: exitCode === 0 ? "passed" : "failed"
            });
        });
    });
}
}),
"[project]/src/lib/orchestration/readiness-orchestrator.ts [app-route] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "runReadinessAssessment",
    ()=>runReadinessAssessment
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$agents$2f$architect$2d$agent$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/src/lib/agents/architect-agent.ts [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$agents$2f$build$2d$agent$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/src/lib/agents/build-agent.ts [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$agents$2f$database$2d$agent$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/src/lib/agents/database-agent.ts [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$agents$2f$deployment$2d$agent$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/src/lib/agents/deployment-agent.ts [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$agents$2f$environment$2d$agent$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/src/lib/agents/environment-agent.ts [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$agents$2f$lint$2d$agent$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/src/lib/agents/lint-agent.ts [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$agents$2f$security$2d$agent$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/src/lib/agents/security-agent.ts [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$agents$2f$test$2d$agent$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/src/lib/agents/test-agent.ts [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$agents$2f$typecheck$2d$agent$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/src/lib/agents/typecheck-agent.ts [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$agents$2f$verifier$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/src/lib/agents/verifier.ts [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$agents$2f$workspace$2d$agent$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/src/lib/agents/workspace-agent.ts [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$reporting$2f$readiness$2d$report$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/src/lib/reporting/readiness-report.ts [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$scanner$2f$repository$2d$scanner$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/src/lib/scanner/repository-scanner.ts [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$scoring$2f$readiness$2d$score$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/src/lib/scoring/readiness-score.ts [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$workspace$2f$assessment$2d$workspace$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/src/lib/workspace/assessment-workspace.ts [app-route] (ecmascript)");
;
;
;
;
;
;
;
;
;
;
;
;
;
;
;
async function getVerifiedArchitectureAnalysis(scan) {
    try {
        const analysis = await (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$agents$2f$architect$2d$agent$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["runArchitectAgent"])(scan);
        const verification = (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$agents$2f$verifier$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["verifyArchitectureAnalysis"])(scan, analysis);
        return {
            ...analysis,
            risks: verification.acceptedRisks
        };
    } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown Architect Agent error";
        console.warn(`Architect Agent unavailable: ${message}`);
        return undefined;
    }
}
async function runReadinessAssessment(repositoryPath) {
    const workspace = (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$workspace$2f$assessment$2d$workspace$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["createAssessmentWorkspace"])(repositoryPath);
    try {
        const preparation = await (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$agents$2f$workspace$2d$agent$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["prepareAssessmentWorkspace"])(workspace.workspacePath);
        if (preparation.status !== "passed") {
            throw new Error(preparation.summary);
        }
        const scan = (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$scanner$2f$repository$2d$scanner$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["scanRepository"])(workspace.workspacePath);
        const [buildResult, typeResult, lintResult, testResult, securityResult, environmentResult, databaseResult, deploymentResult] = await Promise.all([
            (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$agents$2f$build$2d$agent$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["runBuildAgent"])(scan),
            (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$agents$2f$typecheck$2d$agent$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["runTypecheckAgent"])(scan),
            (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$agents$2f$lint$2d$agent$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["runLintAgent"])(scan),
            (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$agents$2f$test$2d$agent$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["runTestAgent"])(scan),
            (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$agents$2f$security$2d$agent$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["runSecurityAgent"])(scan),
            (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$agents$2f$environment$2d$agent$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["runEnvironmentAgent"])(scan),
            (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$agents$2f$database$2d$agent$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["runDatabaseAgent"])(scan),
            (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$agents$2f$deployment$2d$agent$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["runDeploymentAgent"])(scan)
        ]);
        const checks = [
            buildResult,
            typeResult,
            lintResult,
            testResult,
            securityResult,
            environmentResult,
            databaseResult,
            deploymentResult
        ];
        const readiness = (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$scoring$2f$readiness$2d$score$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["calculateReadinessScore"])(checks);
        const architecture = await getVerifiedArchitectureAnalysis(scan);
        const report = (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$reporting$2f$readiness$2d$report$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["createProductionReadinessReport"])(scan, checks, readiness, architecture);
        /*
     * The checks ran inside the isolated workspace,
     * but the report should identify the repository
     * the user actually submitted.
     */ report.repository.path = repositoryPath;
        return report;
    } finally{
        workspace.cleanup();
    }
}
}),
"[project]/src/lib/reporting/readiness-report.ts [app-route] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "createProductionReadinessReport",
    ()=>createProductionReadinessReport
]);
function getNotConfiguredRecommendation(check) {
    switch(check.category){
        case "test":
            return "Add and configure an automated test suite so DeployGuard " + "can execute and verify application tests.";
        case "deployment":
            return "Add a verified deployment configuration such as a Dockerfile, " + "Vercel configuration, or CI workflow so DeployGuard can " + "evaluate deployment readiness.";
        case "database":
            return "Configure the application's database or ORM integration " + "so DeployGuard can validate database readiness.";
        case "security":
            return "Configure the required security tooling so DeployGuard " + "can verify dependency and application security.";
        case "environment":
            return "Document the required environment configuration so DeployGuard " + "can verify production environment readiness.";
        default:
            return `Configure ${check.name.toLowerCase()} so DeployGuard ` + "can verify this readiness category.";
    }
}
function createRemediationItems(checks) {
    const items = [];
    for (const check of checks){
        if (check.status === "failed") {
            items.push({
                category: check.category,
                priority: "high",
                title: `${check.name} failed`,
                recommendation: `Resolve the failure reported by the ${check.name} check ` + "and run the assessment again."
            });
            continue;
        }
        if (check.status === "skipped" && check.skipReason === "not_configured") {
            items.push({
                category: check.category,
                priority: "medium",
                title: `${check.name} is not configured`,
                recommendation: getNotConfiguredRecommendation(check)
            });
            continue;
        }
        if (check.status === "skipped" && check.skipReason === "unsupported") {
            items.push({
                category: check.category,
                priority: "low",
                title: `${check.name} could not be evaluated`,
                recommendation: "This configuration is currently unsupported by DeployGuard " + "and requires manual verification."
            });
            continue;
        }
        if (check.status === "error") {
            items.push({
                category: check.category,
                priority: "medium",
                title: `${check.name} could not complete`,
                recommendation: "Resolve the execution or infrastructure problem and run " + "this check again."
            });
        }
    }
    return items;
}
function createProductionReadinessReport(scan, checks, readiness, architecture) {
    return {
        generatedAt: new Date().toISOString(),
        repository: {
            path: scan.repositoryPath,
            scannedAt: scan.scannedAt,
            facts: scan.facts
        },
        architecture,
        checks,
        readiness,
        remediation: createRemediationItems(checks)
    };
}
}),
"[project]/src/lib/scanner/repository-scanner.ts [app-route] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "scanRepository",
    ()=>scanRepository
]);
var __TURBOPACK__imported__module__$5b$externals$5d2f$node$3a$fs__$5b$external$5d$__$28$node$3a$fs$2c$__cjs$29$__ = __turbopack_context__.i("[externals]/node:fs [external] (node:fs, cjs)");
var __TURBOPACK__imported__module__$5b$externals$5d2f$node$3a$path__$5b$external$5d$__$28$node$3a$path$2c$__cjs$29$__ = __turbopack_context__.i("[externals]/node:path [external] (node:path, cjs)");
;
;
function fileExists(repositoryPath, file) {
    return __TURBOPACK__imported__module__$5b$externals$5d2f$node$3a$fs__$5b$external$5d$__$28$node$3a$fs$2c$__cjs$29$__["default"].existsSync(__TURBOPACK__imported__module__$5b$externals$5d2f$node$3a$path__$5b$external$5d$__$28$node$3a$path$2c$__cjs$29$__["default"].join(repositoryPath, file));
}
function directoryExists(repositoryPath, directory) {
    const targetPath = __TURBOPACK__imported__module__$5b$externals$5d2f$node$3a$path__$5b$external$5d$__$28$node$3a$path$2c$__cjs$29$__["default"].join(repositoryPath, directory);
    return __TURBOPACK__imported__module__$5b$externals$5d2f$node$3a$fs__$5b$external$5d$__$28$node$3a$fs$2c$__cjs$29$__["default"].existsSync(targetPath) && __TURBOPACK__imported__module__$5b$externals$5d2f$node$3a$fs__$5b$external$5d$__$28$node$3a$fs$2c$__cjs$29$__["default"].statSync(targetPath).isDirectory();
}
function readPackageJson(repositoryPath) {
    const packageJsonPath = __TURBOPACK__imported__module__$5b$externals$5d2f$node$3a$path__$5b$external$5d$__$28$node$3a$path$2c$__cjs$29$__["default"].join(repositoryPath, "package.json");
    if (!__TURBOPACK__imported__module__$5b$externals$5d2f$node$3a$fs__$5b$external$5d$__$28$node$3a$fs$2c$__cjs$29$__["default"].existsSync(packageJsonPath)) {
        return null;
    }
    try {
        const content = __TURBOPACK__imported__module__$5b$externals$5d2f$node$3a$fs__$5b$external$5d$__$28$node$3a$fs$2c$__cjs$29$__["default"].readFileSync(packageJsonPath, "utf-8");
        return JSON.parse(content);
    } catch  {
        return null;
    }
}
function hasDependency(packageJson, dependency) {
    return Boolean(packageJson.dependencies?.[dependency] || packageJson.devDependencies?.[dependency]);
}
function getDependencyVersion(packageJson, dependency) {
    return packageJson.dependencies?.[dependency] ?? packageJson.devDependencies?.[dependency] ?? null;
}
function createFact(key, value, source, evidencePath, description) {
    return {
        key,
        value,
        confidence: 1,
        evidence: [
            {
                source,
                path: evidencePath,
                description
            }
        ]
    };
}
function addFactIfMissing(facts, fact) {
    const exists = facts.some((existingFact)=>existingFact.key === fact.key && existingFact.value === fact.value);
    if (!exists) {
        facts.push(fact);
    }
}
function detectLanguage(repositoryPath, facts) {
    if (fileExists(repositoryPath, "tsconfig.json")) {
        facts.push(createFact("language", "TypeScript", "file", "tsconfig.json", "TypeScript configuration file detected"));
    }
}
function detectFramework(repositoryPath, facts) {
    const nextConfigFiles = [
        "next.config.ts",
        "next.config.js",
        "next.config.mjs"
    ];
    const configFile = nextConfigFiles.find((file)=>fileExists(repositoryPath, file));
    if (!configFile) {
        return;
    }
    facts.push(createFact("framework", "Next.js", "config", configFile, "Next.js configuration file detected"));
}
function detectPackageManager(repositoryPath, facts) {
    if (fileExists(repositoryPath, "pnpm-lock.yaml")) {
        facts.push(createFact("packageManager", "pnpm", "file", "pnpm-lock.yaml", "pnpm lockfile detected"));
        return;
    }
    if (fileExists(repositoryPath, "yarn.lock")) {
        facts.push(createFact("packageManager", "Yarn", "file", "yarn.lock", "Yarn lockfile detected"));
        return;
    }
    if (fileExists(repositoryPath, "package-lock.json")) {
        facts.push(createFact("packageManager", "npm", "file", "package-lock.json", "npm lockfile detected"));
    }
}
function detectOrm(repositoryPath, packageJson, facts) {
    if (fileExists(repositoryPath, "prisma/schema.prisma")) {
        addFactIfMissing(facts, createFact("orm", "Prisma", "config", "prisma/schema.prisma", "Prisma schema detected"));
    }
    if (packageJson && (hasDependency(packageJson, "prisma") || hasDependency(packageJson, "@prisma/client"))) {
        addFactIfMissing(facts, createFact("orm", "Prisma", "package", "package.json", "Prisma dependency detected"));
    }
}
function detectTestConfiguration(repositoryPath, packageJson, facts) {
    const vitestConfigFiles = [
        "vitest.config.ts",
        "vitest.config.js"
    ];
    const vitestConfig = vitestConfigFiles.find((file)=>fileExists(repositoryPath, file));
    if (vitestConfig) {
        addFactIfMissing(facts, createFact("testFramework", "Vitest", "config", vitestConfig, "Vitest configuration detected"));
    }
    if (!packageJson) {
        return;
    }
    if (hasDependency(packageJson, "vitest")) {
        addFactIfMissing(facts, createFact("testFramework", "Vitest", "package", "package.json", "Vitest dependency detected"));
    }
    if (hasDependency(packageJson, "jest")) {
        addFactIfMissing(facts, createFact("testFramework", "Jest", "package", "package.json", "Jest dependency detected"));
    }
    const testScript = packageJson.scripts?.test;
    if (testScript) {
        facts.push(createFact("testScript", testScript, "package", "package.json", `Test script detected: ${testScript}`));
    }
}
function detectPackageFacts(packageJson, facts) {
    if (!packageJson) {
        return;
    }
    const nextVersion = getDependencyVersion(packageJson, "next");
    if (nextVersion) {
        facts.push(createFact("frameworkVersion", nextVersion, "package", "package.json", `Next.js dependency version ${nextVersion} detected`));
    }
    const typescriptVersion = getDependencyVersion(packageJson, "typescript");
    if (typescriptVersion) {
        facts.push(createFact("languageVersion", typescriptVersion, "package", "package.json", `TypeScript dependency version ${typescriptVersion} detected`));
    }
    if (hasDependency(packageJson, "next-auth")) {
        facts.push(createFact("authentication", "NextAuth", "package", "package.json", "next-auth dependency detected"));
    }
}
function detectDeployment(repositoryPath, facts) {
    if (fileExists(repositoryPath, "Dockerfile")) {
        facts.push(createFact("deployment", "docker", "config", "Dockerfile", "Dockerfile detected in repository root"));
    }
    if (fileExists(repositoryPath, "vercel.json")) {
        facts.push(createFact("deployment", "vercel", "config", "vercel.json", "Vercel configuration file detected"));
    }
    const workflowsDirectory = ".github/workflows";
    if (!directoryExists(repositoryPath, workflowsDirectory)) {
        return;
    }
    const workflowPath = __TURBOPACK__imported__module__$5b$externals$5d2f$node$3a$path__$5b$external$5d$__$28$node$3a$path$2c$__cjs$29$__["default"].join(repositoryPath, workflowsDirectory);
    const workflowFiles = __TURBOPACK__imported__module__$5b$externals$5d2f$node$3a$fs__$5b$external$5d$__$28$node$3a$fs$2c$__cjs$29$__["default"].readdirSync(workflowPath).filter((file)=>file.endsWith(".yml") || file.endsWith(".yaml"));
    if (workflowFiles.length === 0) {
        return;
    }
    facts.push({
        key: "ci",
        value: "github-actions",
        confidence: 1,
        evidence: workflowFiles.map((file)=>({
                source: "config",
                path: `${workflowsDirectory}/${file}`,
                description: `GitHub Actions workflow detected: ${file}`
            }))
    });
}
function scanRepository(repositoryPath) {
    const facts = [];
    const packageJson = readPackageJson(repositoryPath);
    detectLanguage(repositoryPath, facts);
    detectFramework(repositoryPath, facts);
    detectPackageManager(repositoryPath, facts);
    detectPackageFacts(packageJson, facts);
    detectOrm(repositoryPath, packageJson, facts);
    detectTestConfiguration(repositoryPath, packageJson, facts);
    detectDeployment(repositoryPath, facts);
    return {
        repositoryPath,
        scannedAt: new Date().toISOString(),
        facts
    };
}
}),
"[project]/src/lib/scoring/readiness-score.ts [app-route] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "calculateReadinessScore",
    ()=>calculateReadinessScore
]);
const CATEGORY_WEIGHTS = {
    build: 30,
    types: 15,
    lint: 10,
    test: 20,
    security: 10,
    database: 5,
    deployment: 5,
    environment: 5
};
function calculateReadinessScore(checks) {
    const categories = Object.keys(CATEGORY_WEIGHTS);
    const totalWeight = Object.values(CATEGORY_WEIGHTS).reduce((total, weight)=>total + weight, 0);
    let applicableWeight = totalWeight;
    let evaluatedWeight = 0;
    let earnedWeight = 0;
    const readinessGaps = [];
    const unevaluatedCategories = [];
    const notApplicableCategories = [];
    for (const category of categories){
        const categoryChecks = checks.filter((check)=>check.category === category);
        if (categoryChecks.length === 0) {
            unevaluatedCategories.push(category);
            continue;
        }
        const weight = CATEGORY_WEIGHTS[category];
        const allNotApplicable = categoryChecks.every((check)=>check.status === "skipped" && check.skipReason === "not_applicable");
        if (allNotApplicable) {
            applicableWeight -= weight;
            notApplicableCategories.push(category);
            continue;
        }
        const hasNotConfigured = categoryChecks.some((check)=>check.status === "skipped" && check.skipReason === "not_configured");
        if (hasNotConfigured) {
            evaluatedWeight += weight;
            readinessGaps.push(category);
            continue;
        }
        const passedChecks = categoryChecks.filter((check)=>check.status === "passed").length;
        const failedChecks = categoryChecks.filter((check)=>check.status === "failed").length;
        const executableChecks = passedChecks + failedChecks;
        if (executableChecks === 0) {
            unevaluatedCategories.push(category);
            continue;
        }
        evaluatedWeight += weight;
        earnedWeight += weight * (passedChecks / executableChecks);
        if (failedChecks > 0) {
            readinessGaps.push(category);
        }
    }
    const score = evaluatedWeight === 0 ? 0 : Math.round(earnedWeight / evaluatedWeight * 100);
    const coverage = applicableWeight === 0 ? 100 : Math.round(evaluatedWeight / applicableWeight * 100);
    const passed = checks.filter((check)=>check.status === "passed").length;
    const failed = checks.filter((check)=>check.status === "failed").length;
    const skipped = checks.filter((check)=>check.status === "skipped").length;
    const errors = checks.filter((check)=>check.status === "error").length;
    return {
        score,
        coverage,
        earnedWeight,
        evaluatedWeight,
        applicableWeight,
        totalWeight,
        passed,
        failed,
        skipped,
        errors,
        totalChecks: checks.length,
        readinessGaps,
        unevaluatedCategories,
        notApplicableCategories
    };
}
}),
"[project]/src/lib/workspace/assessment-workspace.ts [app-route] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "createAssessmentWorkspace",
    ()=>createAssessmentWorkspace
]);
var __TURBOPACK__imported__module__$5b$externals$5d2f$node$3a$fs__$5b$external$5d$__$28$node$3a$fs$2c$__cjs$29$__ = __turbopack_context__.i("[externals]/node:fs [external] (node:fs, cjs)");
var __TURBOPACK__imported__module__$5b$externals$5d2f$node$3a$os__$5b$external$5d$__$28$node$3a$os$2c$__cjs$29$__ = __turbopack_context__.i("[externals]/node:os [external] (node:os, cjs)");
var __TURBOPACK__imported__module__$5b$externals$5d2f$node$3a$path__$5b$external$5d$__$28$node$3a$path$2c$__cjs$29$__ = __turbopack_context__.i("[externals]/node:path [external] (node:path, cjs)");
;
;
;
const IGNORED_ENTRIES = new Set([
    "node_modules",
    ".next",
    ".git"
]);
function createAssessmentWorkspace(sourcePath) {
    if (!(0, __TURBOPACK__imported__module__$5b$externals$5d2f$node$3a$fs__$5b$external$5d$__$28$node$3a$fs$2c$__cjs$29$__["existsSync"])(sourcePath)) {
        throw new Error(`Repository path does not exist: ${sourcePath}`);
    }
    const temporaryRoot = (0, __TURBOPACK__imported__module__$5b$externals$5d2f$node$3a$fs__$5b$external$5d$__$28$node$3a$fs$2c$__cjs$29$__["mkdtempSync"])((0, __TURBOPACK__imported__module__$5b$externals$5d2f$node$3a$path__$5b$external$5d$__$28$node$3a$path$2c$__cjs$29$__["join"])((0, __TURBOPACK__imported__module__$5b$externals$5d2f$node$3a$os__$5b$external$5d$__$28$node$3a$os$2c$__cjs$29$__["tmpdir"])(), "deployguard-"));
    const workspacePath = (0, __TURBOPACK__imported__module__$5b$externals$5d2f$node$3a$path__$5b$external$5d$__$28$node$3a$path$2c$__cjs$29$__["join"])(temporaryRoot, "repository");
    (0, __TURBOPACK__imported__module__$5b$externals$5d2f$node$3a$fs__$5b$external$5d$__$28$node$3a$fs$2c$__cjs$29$__["cpSync"])(sourcePath, workspacePath, {
        recursive: true,
        filter (source) {
            const parts = source.split("/");
            return !parts.some((part)=>IGNORED_ENTRIES.has(part));
        }
    });
    return {
        sourcePath,
        workspacePath,
        cleanup () {
            (0, __TURBOPACK__imported__module__$5b$externals$5d2f$node$3a$fs__$5b$external$5d$__$28$node$3a$fs$2c$__cjs$29$__["rmSync"])(temporaryRoot, {
                recursive: true,
                force: true
            });
        }
    };
}
}),
];

//# sourceMappingURL=%5Broot-of-the-server%5D__1k1ze4j._.js.map