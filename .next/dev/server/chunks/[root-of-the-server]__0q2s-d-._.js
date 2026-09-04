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
"[externals]/node:crypto [external] (node:crypto, cjs)", ((__turbopack_context__, module, exports) => {

var mod = __turbopack_context__.x("node:crypto", () => require("node:crypto"));

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
var __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$orchestration$2f$remote$2d$readiness$2d$orchestrator$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/src/lib/orchestration/remote-readiness-orchestrator.ts [app-route] (ecmascript)");
;
const runtime = "nodejs";
function encodeSseEvent(event, data) {
    return [
        `event: ${event}`,
        `data: ${JSON.stringify(data)}`,
        "",
        ""
    ].join("\n");
}
async function POST(request) {
    const encoder = new TextEncoder();
    let body;
    try {
        body = await request.json();
    } catch  {
        return Response.json({
            ok: false,
            error: "Request body must contain valid JSON."
        }, {
            status: 400
        });
    }
    const repositoryUrl = typeof body.repositoryUrl === "string" ? body.repositoryUrl.trim() : "";
    if (!repositoryUrl) {
        return Response.json({
            ok: false,
            error: "GitHub repository URL is required."
        }, {
            status: 400
        });
    }
    const stream = new ReadableStream({
        start (controller) {
            let closed = false;
            const send = (event, data)=>{
                if (closed) {
                    return;
                }
                try {
                    controller.enqueue(encoder.encode(encodeSseEvent(event, data)));
                } catch  {
                    closed = true;
                }
            };
            const close = ()=>{
                if (closed) {
                    return;
                }
                closed = true;
                try {
                    controller.close();
                } catch  {
                // Stream may already be closed.
                }
            };
            void (async ()=>{
                try {
                    send("started", {
                        repositoryUrl,
                        message: "DeployGuard assessment started."
                    });
                    const result = await (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$orchestration$2f$remote$2d$readiness$2d$orchestrator$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["runRemoteReadinessAssessment"])(repositoryUrl, async (progress)=>{
                        send("progress", progress);
                    });
                    send("result", {
                        ok: true,
                        assessment: result
                    });
                } catch (error) {
                    const message = error instanceof Error ? error.message : "Unknown assessment error.";
                    console.error("DeployGuard remote assessment failed:", error);
                    send("assessment-error", {
                        ok: false,
                        error: message
                    });
                } finally{
                    close();
                }
            })();
        }
    });
    return new Response(stream, {
        status: 200,
        headers: {
            "Content-Type": "text/event-stream; charset=utf-8",
            "Cache-Control": "no-cache, no-transform",
            Connection: "keep-alive",
            "X-Accel-Buffering": "no"
        }
    });
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
} // export interface ArchitectureRisk {
 //   title: string;
 //   severity: RiskSeverity;
 //   reason: string;
 //   evidenceKeys: string[];
 //   inference: boolean;
 // }
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
"[project]/src/lib/agents/sandbox-build-agent.ts [app-route] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "runSandboxBuildAgent",
    ()=>runSandboxBuildAgent
]);
var __TURBOPACK__imported__module__$5b$externals$5d2f$node$3a$fs__$5b$external$5d$__$28$node$3a$fs$2c$__cjs$29$__ = __turbopack_context__.i("[externals]/node:fs [external] (node:fs, cjs)");
var __TURBOPACK__imported__module__$5b$externals$5d2f$node$3a$path__$5b$external$5d$__$28$node$3a$path$2c$__cjs$29$__ = __turbopack_context__.i("[externals]/node:path [external] (node:path, cjs)");
var __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$sandbox$2f$docker$2d$sandbox$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/src/lib/sandbox/docker-sandbox.ts [app-route] (ecmascript)");
;
;
;
async function runSandboxBuildAgent(repositoryPath) {
    const packageJsonPath = (0, __TURBOPACK__imported__module__$5b$externals$5d2f$node$3a$path__$5b$external$5d$__$28$node$3a$path$2c$__cjs$29$__["join"])(repositoryPath, "package.json");
    if (!(0, __TURBOPACK__imported__module__$5b$externals$5d2f$node$3a$fs__$5b$external$5d$__$28$node$3a$fs$2c$__cjs$29$__["existsSync"])(packageJsonPath)) {
        return {
            id: "build",
            category: "build",
            name: "Production Build",
            status: "skipped",
            skipReason: "not_applicable",
            summary: "No package.json was detected."
        };
    }
    const packageJson = JSON.parse((0, __TURBOPACK__imported__module__$5b$externals$5d2f$node$3a$fs__$5b$external$5d$__$28$node$3a$fs$2c$__cjs$29$__["readFileSync"])(packageJsonPath, "utf8"));
    if (!packageJson.scripts?.build) {
        return {
            id: "build",
            category: "build",
            name: "Production Build",
            status: "skipped",
            skipReason: "not_configured",
            summary: "No build script is configured."
        };
    }
    const result = await (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$sandbox$2f$docker$2d$sandbox$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["runDockerSandboxCommand"])({
        repositoryPath,
        command: [
            "npm",
            "run",
            "build"
        ],
        // Repository code executes with
        // no external network access.
        network: "none",
        environment: {
            NODE_ENV: "production",
            CI: "true",
            HOME: "/tmp/deployguard-home"
        },
        user: typeof process.getuid === "function" && typeof process.getgid === "function" ? `${process.getuid()}:${process.getgid()}` : "1000:1000",
        limits: {
            memoryMb: 2048,
            cpus: 1,
            timeoutMs: 5 * 60 * 1000
        }
    });
    if (result.status === "timed_out") {
        return {
            id: "build",
            category: "build",
            name: "Production Build",
            status: "error",
            command: "npm run build",
            exitCode: result.exitCode,
            durationMs: result.durationMs,
            summary: "Production build exceeded the sandbox timeout.",
            stdout: result.stdout,
            stderr: result.stderr
        };
    }
    const combinedOutput = `${result.stdout}\n${result.stderr}`;
    const networkDependencyFailure = /Failed to fetch|fonts\.googleapis\.com|network|ENOTFOUND|ECONNRESET|ETIMEDOUT|ECONNREFUSED/i.test(combinedOutput);
    return {
        id: "build",
        category: "build",
        name: "Production Build",
        // status:
        //   result.status === "passed"
        //     ? "passed"
        //     : "failed",
        status: result.status === "passed" ? "passed" : networkDependencyFailure ? "error" : "failed",
        command: "npm run build",
        exitCode: result.exitCode,
        durationMs: result.durationMs,
        summary: result.status === "passed" ? "Production build passed inside the sandbox." : networkDependencyFailure ? "Production build requires external network access that is blocked by the sandbox." : "Production build failed inside the sandbox.",
        stdout: result.stdout,
        stderr: result.stderr
    };
}
}),
"[project]/src/lib/agents/sandbox-lint-agent.ts [app-route] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "runSandboxLintAgent",
    ()=>runSandboxLintAgent
]);
var __TURBOPACK__imported__module__$5b$externals$5d2f$node$3a$fs__$5b$external$5d$__$28$node$3a$fs$2c$__cjs$29$__ = __turbopack_context__.i("[externals]/node:fs [external] (node:fs, cjs)");
var __TURBOPACK__imported__module__$5b$externals$5d2f$node$3a$path__$5b$external$5d$__$28$node$3a$path$2c$__cjs$29$__ = __turbopack_context__.i("[externals]/node:path [external] (node:path, cjs)");
var __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$sandbox$2f$docker$2d$sandbox$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/src/lib/sandbox/docker-sandbox.ts [app-route] (ecmascript)");
;
;
;
async function runSandboxLintAgent(repositoryPath) {
    const packageJsonPath = (0, __TURBOPACK__imported__module__$5b$externals$5d2f$node$3a$path__$5b$external$5d$__$28$node$3a$path$2c$__cjs$29$__["join"])(repositoryPath, "package.json");
    if (!(0, __TURBOPACK__imported__module__$5b$externals$5d2f$node$3a$fs__$5b$external$5d$__$28$node$3a$fs$2c$__cjs$29$__["existsSync"])(packageJsonPath)) {
        return {
            id: "lint",
            category: "lint",
            name: "Lint",
            status: "skipped",
            skipReason: "not_applicable",
            summary: "No package.json was detected."
        };
    }
    const packageJson = JSON.parse((0, __TURBOPACK__imported__module__$5b$externals$5d2f$node$3a$fs__$5b$external$5d$__$28$node$3a$fs$2c$__cjs$29$__["readFileSync"])(packageJsonPath, "utf8"));
    if (!packageJson.scripts?.lint) {
        return {
            id: "lint",
            category: "lint",
            name: "Lint",
            status: "skipped",
            skipReason: "not_configured",
            summary: "No lint script is configured."
        };
    }
    const result = await (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$sandbox$2f$docker$2d$sandbox$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["runDockerSandboxCommand"])({
        repositoryPath,
        command: [
            "npm",
            "run",
            "lint"
        ],
        network: "none",
        environment: {
            CI: "true",
            HOME: "/tmp/deployguard-home"
        },
        user: typeof process.getuid === "function" && typeof process.getgid === "function" ? `${process.getuid()}:${process.getgid()}` : "1000:1000",
        limits: {
            memoryMb: 2048,
            cpus: 1,
            timeoutMs: 5 * 60 * 1000
        }
    });
    if (result.status === "timed_out") {
        return {
            id: "lint",
            category: "lint",
            name: "Lint",
            status: "error",
            command: "npm run lint",
            exitCode: result.exitCode,
            durationMs: result.durationMs,
            summary: "Linting exceeded the sandbox timeout.",
            stdout: result.stdout,
            stderr: result.stderr
        };
    }
    return {
        id: "lint",
        category: "lint",
        name: "Lint",
        status: result.status === "passed" ? "passed" : "failed",
        command: "npm run lint",
        exitCode: result.exitCode,
        durationMs: result.durationMs,
        summary: result.status === "passed" ? "Linting passed inside the sandbox." : "Linting failed inside the sandbox.",
        stdout: result.stdout,
        stderr: result.stderr
    };
}
}),
"[project]/src/lib/agents/sandbox-security-agent.ts [app-route] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "runSandboxSecurityAgent",
    ()=>runSandboxSecurityAgent
]);
var __TURBOPACK__imported__module__$5b$externals$5d2f$node$3a$fs__$5b$external$5d$__$28$node$3a$fs$2c$__cjs$29$__ = __turbopack_context__.i("[externals]/node:fs [external] (node:fs, cjs)");
var __TURBOPACK__imported__module__$5b$externals$5d2f$node$3a$path__$5b$external$5d$__$28$node$3a$path$2c$__cjs$29$__ = __turbopack_context__.i("[externals]/node:path [external] (node:path, cjs)");
var __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$sandbox$2f$docker$2d$sandbox$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/src/lib/sandbox/docker-sandbox.ts [app-route] (ecmascript)");
;
;
;
async function runSandboxSecurityAgent(repositoryPath) {
    const packageLockPath = (0, __TURBOPACK__imported__module__$5b$externals$5d2f$node$3a$path__$5b$external$5d$__$28$node$3a$path$2c$__cjs$29$__["join"])(repositoryPath, "package-lock.json");
    if (!(0, __TURBOPACK__imported__module__$5b$externals$5d2f$node$3a$fs__$5b$external$5d$__$28$node$3a$fs$2c$__cjs$29$__["existsSync"])(packageLockPath)) {
        return {
            id: "security",
            category: "security",
            name: "Dependency Security",
            status: "skipped",
            skipReason: "not_applicable",
            summary: "No npm package-lock.json was detected."
        };
    }
    const result = await (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$sandbox$2f$docker$2d$sandbox$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["runDockerSandboxCommand"])({
        repositoryPath,
        command: [
            "npm",
            "audit",
            "--audit-level=high",
            "--json"
        ],
        // Security auditing requires
        // registry access.
        network: "bridge",
        environment: {
            CI: "true",
            HOME: "/tmp/deployguard-home",
            npm_config_cache: "/tmp/npm-cache"
        },
        user: typeof process.getuid === "function" && typeof process.getgid === "function" ? `${process.getuid()}:${process.getgid()}` : "1000:1000",
        limits: {
            memoryMb: 1024,
            cpus: 1,
            timeoutMs: 2 * 60 * 1000
        }
    });
    if (result.status === "timed_out") {
        return {
            id: "security",
            category: "security",
            name: "Dependency Security",
            status: "error",
            command: "npm audit --audit-level=high --json",
            exitCode: result.exitCode,
            durationMs: result.durationMs,
            summary: "Dependency security audit exceeded the sandbox timeout.",
            stdout: result.stdout,
            stderr: result.stderr
        };
    }
    if (result.status === "passed") {
        return {
            id: "security",
            category: "security",
            name: "Dependency Security",
            status: "passed",
            command: "npm audit --audit-level=high --json",
            exitCode: result.exitCode,
            durationMs: result.durationMs,
            summary: "No high-severity dependency vulnerabilities were reported.",
            stdout: result.stdout,
            stderr: result.stderr
        };
    }
    const combinedOutput = `${result.stdout}\n${result.stderr}`;
    const looksLikeInfrastructureFailure = /ECONNRESET|ENOTFOUND|ETIMEDOUT|ECONNREFUSED|network|registry/i.test(combinedOutput);
    if (looksLikeInfrastructureFailure) {
        return {
            id: "security",
            category: "security",
            name: "Dependency Security",
            status: "error",
            command: "npm audit --audit-level=high --json",
            exitCode: result.exitCode,
            durationMs: result.durationMs,
            summary: "Dependency security audit could not be completed because of a network or registry error.",
            stdout: result.stdout,
            stderr: result.stderr
        };
    }
    return {
        id: "security",
        category: "security",
        name: "Dependency Security",
        status: "failed",
        command: "npm audit --audit-level=high --json",
        exitCode: result.exitCode,
        durationMs: result.durationMs,
        summary: "High-severity dependency vulnerabilities were reported.",
        stdout: result.stdout,
        stderr: result.stderr
    };
}
}),
"[project]/src/lib/agents/sandbox-test-agent.ts [app-route] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "runSandboxTestAgent",
    ()=>runSandboxTestAgent
]);
var __TURBOPACK__imported__module__$5b$externals$5d2f$node$3a$fs__$5b$external$5d$__$28$node$3a$fs$2c$__cjs$29$__ = __turbopack_context__.i("[externals]/node:fs [external] (node:fs, cjs)");
var __TURBOPACK__imported__module__$5b$externals$5d2f$node$3a$path__$5b$external$5d$__$28$node$3a$path$2c$__cjs$29$__ = __turbopack_context__.i("[externals]/node:path [external] (node:path, cjs)");
var __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$sandbox$2f$docker$2d$sandbox$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/src/lib/sandbox/docker-sandbox.ts [app-route] (ecmascript)");
;
;
;
async function runSandboxTestAgent(repositoryPath) {
    const packageJsonPath = (0, __TURBOPACK__imported__module__$5b$externals$5d2f$node$3a$path__$5b$external$5d$__$28$node$3a$path$2c$__cjs$29$__["join"])(repositoryPath, "package.json");
    if (!(0, __TURBOPACK__imported__module__$5b$externals$5d2f$node$3a$fs__$5b$external$5d$__$28$node$3a$fs$2c$__cjs$29$__["existsSync"])(packageJsonPath)) {
        return {
            id: "test",
            category: "test",
            name: "Tests",
            status: "skipped",
            skipReason: "not_applicable",
            summary: "No package.json was detected."
        };
    }
    const packageJson = JSON.parse((0, __TURBOPACK__imported__module__$5b$externals$5d2f$node$3a$fs__$5b$external$5d$__$28$node$3a$fs$2c$__cjs$29$__["readFileSync"])(packageJsonPath, "utf8"));
    if (!packageJson.scripts?.test) {
        return {
            id: "test",
            category: "test",
            name: "Tests",
            status: "skipped",
            skipReason: "not_configured",
            summary: "No test script is configured."
        };
    }
    const result = await (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$sandbox$2f$docker$2d$sandbox$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["runDockerSandboxCommand"])({
        repositoryPath,
        command: [
            "npm",
            "test",
            "--",
            "--runInBand"
        ],
        network: "none",
        environment: {
            CI: "true",
            HOME: "/tmp/deployguard-home"
        },
        user: typeof process.getuid === "function" && typeof process.getgid === "function" ? `${process.getuid()}:${process.getgid()}` : "1000:1000",
        limits: {
            memoryMb: 2048,
            cpus: 1,
            timeoutMs: 5 * 60 * 1000
        }
    });
    if (result.status === "timed_out") {
        return {
            id: "test",
            category: "test",
            name: "Tests",
            status: "error",
            command: "npm test -- --runInBand",
            exitCode: result.exitCode,
            durationMs: result.durationMs,
            summary: "Test execution exceeded the sandbox timeout.",
            stdout: result.stdout,
            stderr: result.stderr
        };
    }
    return {
        id: "test",
        category: "test",
        name: "Tests",
        status: result.status === "passed" ? "passed" : "failed",
        command: "npm test -- --runInBand",
        exitCode: result.exitCode,
        durationMs: result.durationMs,
        summary: result.status === "passed" ? "Tests passed inside the sandbox." : "Tests failed inside the sandbox.",
        stdout: result.stdout,
        stderr: result.stderr
    };
}
}),
"[project]/src/lib/agents/sandbox-typecheck-agent.ts [app-route] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "runSandboxTypecheckAgent",
    ()=>runSandboxTypecheckAgent
]);
var __TURBOPACK__imported__module__$5b$externals$5d2f$node$3a$fs__$5b$external$5d$__$28$node$3a$fs$2c$__cjs$29$__ = __turbopack_context__.i("[externals]/node:fs [external] (node:fs, cjs)");
var __TURBOPACK__imported__module__$5b$externals$5d2f$node$3a$path__$5b$external$5d$__$28$node$3a$path$2c$__cjs$29$__ = __turbopack_context__.i("[externals]/node:path [external] (node:path, cjs)");
var __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$sandbox$2f$docker$2d$sandbox$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/src/lib/sandbox/docker-sandbox.ts [app-route] (ecmascript)");
;
;
;
async function runSandboxTypecheckAgent(repositoryPath) {
    const tsconfigPath = (0, __TURBOPACK__imported__module__$5b$externals$5d2f$node$3a$path__$5b$external$5d$__$28$node$3a$path$2c$__cjs$29$__["join"])(repositoryPath, "tsconfig.json");
    if (!(0, __TURBOPACK__imported__module__$5b$externals$5d2f$node$3a$fs__$5b$external$5d$__$28$node$3a$fs$2c$__cjs$29$__["existsSync"])(tsconfigPath)) {
        return {
            id: "types",
            category: "types",
            name: "TypeScript",
            status: "skipped",
            skipReason: "not_applicable",
            summary: "No tsconfig.json was detected."
        };
    }
    const result = await (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$sandbox$2f$docker$2d$sandbox$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["runDockerSandboxCommand"])({
        repositoryPath,
        command: [
            "./node_modules/.bin/tsc",
            "--noEmit"
        ],
        network: "none",
        environment: {
            CI: "true",
            HOME: "/tmp/deployguard-home"
        },
        user: typeof process.getuid === "function" && typeof process.getgid === "function" ? `${process.getuid()}:${process.getgid()}` : "1000:1000",
        limits: {
            memoryMb: 2048,
            cpus: 1,
            timeoutMs: 5 * 60 * 1000
        }
    });
    if (result.status === "timed_out") {
        return {
            id: "types",
            category: "types",
            name: "TypeScript",
            status: "error",
            command: "./node_modules/.bin/tsc --noEmit",
            exitCode: result.exitCode,
            durationMs: result.durationMs,
            summary: "TypeScript validation exceeded the sandbox timeout.",
            stdout: result.stdout,
            stderr: result.stderr
        };
    }
    return {
        id: "types",
        category: "types",
        name: "TypeScript",
        status: result.status === "passed" ? "passed" : "failed",
        command: "./node_modules/.bin/tsc --noEmit",
        exitCode: result.exitCode,
        durationMs: result.durationMs,
        summary: result.status === "passed" ? "TypeScript validation passed inside the sandbox." : "TypeScript validation failed inside the sandbox.",
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
"[project]/src/lib/ai/nebius.ts [app-route] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "NEBIUS_MODELS",
    ()=>NEBIUS_MODELS,
    "getNebiusClient",
    ()=>getNebiusClient
]);
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
"[project]/src/lib/orchestration/remote-readiness-orchestrator.ts [app-route] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "runRemoteReadinessAssessment",
    ()=>runRemoteReadinessAssessment
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$agents$2f$architect$2d$agent$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/src/lib/agents/architect-agent.ts [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$agents$2f$deployment$2d$agent$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/src/lib/agents/deployment-agent.ts [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$agents$2f$environment$2d$agent$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/src/lib/agents/environment-agent.ts [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$agents$2f$sandbox$2d$build$2d$agent$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/src/lib/agents/sandbox-build-agent.ts [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$agents$2f$sandbox$2d$lint$2d$agent$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/src/lib/agents/sandbox-lint-agent.ts [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$agents$2f$sandbox$2d$security$2d$agent$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/src/lib/agents/sandbox-security-agent.ts [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$agents$2f$sandbox$2d$test$2d$agent$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/src/lib/agents/sandbox-test-agent.ts [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$agents$2f$sandbox$2d$typecheck$2d$agent$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/src/lib/agents/sandbox-typecheck-agent.ts [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$agents$2f$verifier$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/src/lib/agents/verifier.ts [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$repository$2f$github$2d$repository$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/src/lib/repository/github-repository.ts [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$repository$2f$repository$2d$ingestion$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/src/lib/repository/repository-ingestion.ts [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$reporting$2f$readiness$2d$report$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/src/lib/reporting/readiness-report.ts [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$scanner$2f$repository$2d$scanner$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/src/lib/scanner/repository-scanner.ts [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$scoring$2f$readiness$2d$score$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/src/lib/scoring/readiness-score.ts [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$sandbox$2f$workspace$2d$preparation$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/src/lib/sandbox/workspace-preparation.ts [app-route] (ecmascript)");
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
function createUnavailableCheck(id, category, name, summary) {
    return {
        id,
        category,
        name,
        status: "error",
        summary
    };
}
async function runRemoteReadinessAssessment(repositoryUrl, onProgress) {
    const assessmentStartedAt = Date.now();
    const emitProgress = async (stage, label, status, message)=>{
        await onProgress?.({
            stage,
            label,
            status,
            message,
            elapsedMs: Date.now() - assessmentStartedAt
        });
    };
    await emitProgress("repository", "Repository", "running", "Cloning repository...");
    const repository = (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$repository$2f$github$2d$repository$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["parseGitHubRepositoryUrl"])(repositoryUrl);
    const ingested = await (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$repository$2f$repository$2d$ingestion$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["ingestGitHubRepository"])(repository);
    await emitProgress("repository", "Repository", "passed", "Repository cloned successfully.");
    try {
        await emitProgress("scan", "Repository Scan", "running", "Inspecting repository structure...");
        const scan = await (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$scanner$2f$repository$2d$scanner$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["scanRepository"])(ingested.repositoryPath);
        await emitProgress("scan", "Repository Scan", "passed", `Repository scan completed with ${scan.facts.length} detected facts.`);
        const checks = [];
        /*
     * Static checks do not execute
     * repository code.
     */ checks.push(await (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$agents$2f$environment$2d$agent$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["runEnvironmentAgent"])(scan));
        checks.push(await (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$agents$2f$deployment$2d$agent$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["runDeploymentAgent"])(scan));
        /*
     * Dependency preparation is performed
     * exactly once for this assessment.
     *
     * Installation has controlled network
     * access and lifecycle scripts disabled.
     */ await emitProgress("preparation", "Sandbox Preparation", "running", "Installing dependencies in the isolated workspace...");
        const preparation = await (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$sandbox$2f$workspace$2d$preparation$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["prepareSandboxWorkspace"])(ingested.repositoryPath);
        await emitProgress("preparation", "Sandbox Preparation", preparation.status === "passed" ? "passed" : "error", preparation.summary);
        // if (preparation.status === "passed") {
        //   /*
        //    * Execute repository-controlled checks
        //    * sequentially against the same disposable
        //    * workspace.
        //    *
        //    * These checks run without network access.
        //    */
        //   checks.push(
        //     await runSandboxTypecheckAgent(
        //       ingested.repositoryPath
        //     )
        //   );
        //   checks.push(
        //     await runSandboxLintAgent(
        //       ingested.repositoryPath
        //     )
        //   );
        //   checks.push(
        //     await runSandboxTestAgent(
        //       ingested.repositoryPath
        //     )
        //   );
        //   checks.push(
        //     await runSandboxBuildAgent(
        //       ingested.repositoryPath
        //     )
        //   );
        //   /*
        //    * npm audit is a controlled command
        //    * requiring registry access.
        //    */
        //   checks.push(
        //     await runSandboxSecurityAgent(
        //       ingested.repositoryPath
        //     )
        //   );
        // } else {
        //   const preparationSummary =
        //     preparation.summary;
        //   checks.push(
        //     createUnavailableCheck(
        //       "types",
        //       "types",
        //       "TypeScript",
        //       preparationSummary
        //     ),
        //     createUnavailableCheck(
        //       "lint",
        //       "lint",
        //       "Lint",
        //       preparationSummary
        //     ),
        //     createUnavailableCheck(
        //       "test",
        //       "test",
        //       "Tests",
        //       preparationSummary
        //     ),
        //     createUnavailableCheck(
        //       "build",
        //       "build",
        //       "Production Build",
        //       preparationSummary
        //     ),
        //     createUnavailableCheck(
        //       "security",
        //       "security",
        //       "Dependency Security",
        //       preparationSummary
        //     )
        //   );
        // }
        if (preparation.status === "passed") {
            // TypeScript
            await emitProgress("types", "TypeScript", "running", "Running TypeScript validation...");
            const typecheck = await (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$agents$2f$sandbox$2d$typecheck$2d$agent$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["runSandboxTypecheckAgent"])(ingested.repositoryPath);
            checks.push(typecheck);
            await emitProgress("types", "TypeScript", toProgressStatus(typecheck.status), typecheck.summary);
            // Lint
            await emitProgress("lint", "Lint", "running", "Running lint validation...");
            const lint = await (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$agents$2f$sandbox$2d$lint$2d$agent$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["runSandboxLintAgent"])(ingested.repositoryPath);
            checks.push(lint);
            await emitProgress("lint", "Lint", toProgressStatus(lint.status), lint.summary);
            // Tests
            await emitProgress("test", "Tests", "running", "Running automated tests...");
            const tests = await (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$agents$2f$sandbox$2d$test$2d$agent$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["runSandboxTestAgent"])(ingested.repositoryPath);
            checks.push(tests);
            await emitProgress("test", "Tests", toProgressStatus(tests.status), tests.summary);
            // Production Build
            await emitProgress("build", "Production Build", "running", "Running production build...");
            const build = await (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$agents$2f$sandbox$2d$build$2d$agent$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["runSandboxBuildAgent"])(ingested.repositoryPath);
            checks.push(build);
            await emitProgress("build", "Production Build", toProgressStatus(build.status), build.summary);
            // Dependency Security
            await emitProgress("security", "Dependency Security", "running", "Running dependency security audit...");
            const security = await (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$agents$2f$sandbox$2d$security$2d$agent$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["runSandboxSecurityAgent"])(ingested.repositoryPath);
            checks.push(security);
            await emitProgress("security", "Dependency Security", toProgressStatus(security.status), security.summary);
        } else {
            const preparationSummary = preparation.summary;
            const unavailableChecks = [
                createUnavailableCheck("types", "types", "TypeScript", preparationSummary),
                createUnavailableCheck("lint", "lint", "Lint", preparationSummary),
                createUnavailableCheck("test", "test", "Tests", preparationSummary),
                createUnavailableCheck("build", "build", "Production Build", preparationSummary),
                createUnavailableCheck("security", "security", "Dependency Security", preparationSummary)
            ];
            checks.push(...unavailableChecks);
            for (const check of unavailableChecks){
                await emitProgress(check.category, check.name, "error", check.summary);
            }
        }
        function toProgressStatus(status) {
            return status;
        }
        const readiness = (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$scoring$2f$readiness$2d$score$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["calculateReadinessScore"])(checks);
        let architecture;
        let verification;
        /*
     * AI analysis is optional.
     * Deterministic readiness reporting
     * must still work if the model is
     * unavailable.
     */ await emitProgress("architect", "Nemotron Analysis", "running", "Analyzing verified repository evidence...");
        try {
            const analysis = await (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$agents$2f$architect$2d$agent$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["runArchitectAgent"])(scan);
            const verified = (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$agents$2f$verifier$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["verifyArchitectureAnalysis"])(scan, analysis);
            architecture = {
                ...analysis,
                risks: verified.acceptedRisks
            };
            verification = {
                acceptedRisks: verified.acceptedRisks,
                rejectedRisks: verified.rejectedRisks
            };
            await emitProgress("architect", "Nemotron Analysis", "passed", "AI architecture analysis completed and verified.");
        } catch (error) {
            architecture = undefined;
            verification = undefined;
            const diagnostic = error instanceof Error ? error.message : "Unknown Nemotron analysis error.";
            console.error("[DeployGuard Architect Agent]", diagnostic);
            await emitProgress("architect", "Nemotron Analysis", "error", `AI architecture analysis was unavailable: ${diagnostic}`);
        }
        const report = (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$reporting$2f$readiness$2d$report$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["createProductionReadinessReport"])(scan, checks, readiness, architecture);
        await emitProgress("report", "Readiness Report", "running", "Calculating readiness and generating the final report...");
        /*
     * Do not expose the temporary filesystem
     * path in the public report.
     */ report.repository.path = repository.fullName;
        await emitProgress("report", "Readiness Report", "completed", `Assessment completed with readiness score ${readiness.score}/100.`);
        return {
            repository: {
                owner: repository.owner,
                name: repository.name,
                fullName: repository.fullName,
                url: repository.url
            },
            report,
            verification
        };
    } finally{
        ingested.cleanup();
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
"[project]/src/lib/repository/github-repository.ts [app-route] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "parseGitHubRepositoryUrl",
    ()=>parseGitHubRepositoryUrl
]);
function parseGitHubRepositoryUrl(input) {
    const value = input.trim();
    if (!value) {
        throw new Error("GitHub repository URL is required.");
    }
    let url;
    try {
        url = new URL(value);
    } catch  {
        throw new Error("Enter a valid GitHub repository URL.");
    }
    if (url.protocol !== "https:" || url.hostname.toLowerCase() !== "github.com") {
        throw new Error("Only HTTPS GitHub repository URLs are supported.");
    }
    const segments = url.pathname.split("/").filter(Boolean);
    if (segments.length !== 2) {
        throw new Error("The URL must point directly to a GitHub repository.");
    }
    const owner = segments[0];
    const name = segments[1].replace(/\.git$/i, "");
    if (!owner || !name) {
        throw new Error("The GitHub repository owner or name is missing.");
    }
    const fullName = `${owner}/${name}`;
    const canonicalUrl = `https://github.com/${fullName}`;
    return {
        owner,
        name,
        fullName,
        url: canonicalUrl,
        cloneUrl: `${canonicalUrl}.git`
    };
}
}),
"[project]/src/lib/repository/repository-ingestion.ts [app-route] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "ingestGitHubRepository",
    ()=>ingestGitHubRepository
]);
var __TURBOPACK__imported__module__$5b$externals$5d2f$node$3a$fs__$5b$external$5d$__$28$node$3a$fs$2c$__cjs$29$__ = __turbopack_context__.i("[externals]/node:fs [external] (node:fs, cjs)");
var __TURBOPACK__imported__module__$5b$externals$5d2f$node$3a$os__$5b$external$5d$__$28$node$3a$os$2c$__cjs$29$__ = __turbopack_context__.i("[externals]/node:os [external] (node:os, cjs)");
var __TURBOPACK__imported__module__$5b$externals$5d2f$node$3a$path__$5b$external$5d$__$28$node$3a$path$2c$__cjs$29$__ = __turbopack_context__.i("[externals]/node:path [external] (node:path, cjs)");
var __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$execution$2f$command$2d$runner$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/src/lib/execution/command-runner.ts [app-route] (ecmascript)");
;
;
;
;
const CLONE_ATTEMPTS = 3;
const CLONE_RETRY_DELAY_MS = 2000;
function delay(ms) {
    return new Promise((resolve)=>{
        setTimeout(resolve, ms);
    });
}
function formatDuration(startedAt) {
    return ((Date.now() - startedAt) / 1000).toFixed(2);
}
// async function tryArchiveDownload(
//   repository: GitHubRepository,
//   temporaryRoot: string,
//   repositoryPath: string
// ): Promise<boolean> {
//   const archivePath = join(
//     temporaryRoot,
//     "repository.tar.gz"
//   );
//   const archiveUrl =
//     `https://api.github.com/repos/` +
//     `${encodeURIComponent(repository.owner)}/` +
//     `${encodeURIComponent(repository.name)}/tarball`;
//   console.log(
//     "[Repository Ingestion] Trying GitHub archive..."
//   );
//   const archiveStartedAt = Date.now();
//   const download = await runCommand(
//     "curl",
//     [
//       "--fail",
//       "--location",
//       "--silent",
//       "--show-error",
//       "--connect-timeout",
//       "20",
//       "--max-time",
//       "180",
//       "--output",
//       archivePath,
//       archiveUrl,
//     ],
//     temporaryRoot
//   );
//   console.log(
//     `[Repository Ingestion] Archive download finished in ${formatDuration(
//       archiveStartedAt
//     )}s with status: ${download.status}`
//   );
//   if (
//     download.status !== "passed" ||
//     !existsSync(archivePath)
//   ) {
//     rmSync(archivePath, {
//       force: true,
//     });
//     console.log(
//       "[Repository Ingestion] Archive unavailable. Falling back to Git clone."
//     );
//     return false;
//   }
//   const extractionStartedAt =
//     Date.now();
//   console.log(
//     "[Repository Ingestion] Extracting GitHub archive..."
//   );
//   const extraction =
//     await runCommand(
//       "tar",
//       [
//         "-xzf",
//         archivePath,
//         "-C",
//         temporaryRoot,
//       ],
//       temporaryRoot
//     );
//   rmSync(archivePath, {
//     force: true,
//   });
//   if (
//     extraction.status !== "passed"
//   ) {
//     console.log(
//       "[Repository Ingestion] Archive extraction failed. Falling back to Git clone."
//     );
//     return false;
//   }
//   /*
//    * GitHub archives contain a generated
//    * top-level directory. Find it and move
//    * it into the standard repository path.
//    */
//   const extractedDirectory =
//     join(
//       temporaryRoot,
//       `${repository.owner}-${repository.name}`
//     );
//   /*
//    * Because GitHub appends a commit hash to
//    * the extracted directory name, using
//    * --strip-components during extraction is
//    * simpler and avoids depending on that name.
//    */
//   rmSync(extractedDirectory, {
//     recursive: true,
//     force: true,
//   });
//   /*
//    * Re-extract directly into repositoryPath
//    * with the generated GitHub directory removed.
//    */
//   const secondArchiveUrl =
//     archiveUrl;
//   const secondArchivePath =
//     join(
//       temporaryRoot,
//       "repository-second.tar.gz"
//     );
//   const secondDownload =
//     await runCommand(
//       "curl",
//       [
//         "--fail",
//         "--location",
//         "--silent",
//         "--show-error",
//         "--connect-timeout",
//         "20",
//         "--max-time",
//         "180",
//         "--output",
//         secondArchivePath,
//         secondArchiveUrl,
//       ],
//       temporaryRoot
//     );
//   if (
//     secondDownload.status !== "passed" ||
//     !existsSync(secondArchivePath)
//   ) {
//     rmSync(secondArchivePath, {
//       force: true,
//     });
//     return false;
//   }
//   const mkdir =
//     await runCommand(
//       "mkdir",
//       [
//         "-p",
//         repositoryPath,
//       ],
//       temporaryRoot
//     );
//   if (mkdir.status !== "passed") {
//     rmSync(secondArchivePath, {
//       force: true,
//     });
//     return false;
//   }
//   const finalExtraction =
//     await runCommand(
//       "tar",
//       [
//         "-xzf",
//         secondArchivePath,
//         "-C",
//         repositoryPath,
//         "--strip-components=1",
//       ],
//       temporaryRoot
//     );
//   rmSync(secondArchivePath, {
//     force: true,
//   });
//   if (
//     finalExtraction.status !==
//     "passed"
//   ) {
//     rmSync(repositoryPath, {
//       recursive: true,
//       force: true,
//     });
//     console.log(
//       "[Repository Ingestion] Archive extraction failed. Falling back to Git clone."
//     );
//     return false;
//   }
//   console.log(
//     `[Repository Ingestion] Archive extraction completed in ${formatDuration(
//       extractionStartedAt
//     )}s.`
//   );
//   console.log(
//     "[Repository Ingestion] GitHub archive fast-path succeeded."
//   );
//   return existsSync(
//     repositoryPath
//   );
// }
async function tryArchiveDownload(repository, temporaryRoot, repositoryPath) {
    const archivePath = (0, __TURBOPACK__imported__module__$5b$externals$5d2f$node$3a$path__$5b$external$5d$__$28$node$3a$path$2c$__cjs$29$__["join"])(temporaryRoot, "repository.tar.gz");
    const archiveUrl = `https://api.github.com/repos/` + `${encodeURIComponent(repository.owner)}/` + `${encodeURIComponent(repository.name)}/tarball`;
    console.log("[Repository Ingestion] Trying GitHub archive...");
    const archiveStartedAt = Date.now();
    const download = await (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$execution$2f$command$2d$runner$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["runCommand"])("curl", [
        "--fail",
        "--location",
        "--silent",
        "--show-error",
        "--connect-timeout",
        "20",
        "--max-time",
        "180",
        "--output",
        archivePath,
        archiveUrl
    ], temporaryRoot);
    console.log(`[Repository Ingestion] Archive download finished in ${formatDuration(archiveStartedAt)}s with status: ${download.status}`);
    if (download.status !== "passed" || !(0, __TURBOPACK__imported__module__$5b$externals$5d2f$node$3a$fs__$5b$external$5d$__$28$node$3a$fs$2c$__cjs$29$__["existsSync"])(archivePath)) {
        (0, __TURBOPACK__imported__module__$5b$externals$5d2f$node$3a$fs__$5b$external$5d$__$28$node$3a$fs$2c$__cjs$29$__["rmSync"])(archivePath, {
            force: true
        });
        console.log("[Repository Ingestion] Archive unavailable. Falling back to Git clone.");
        return false;
    }
    console.log("[Repository Ingestion] Extracting GitHub archive...");
    const extractionStartedAt = Date.now();
    const extraction = await (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$execution$2f$command$2d$runner$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["runCommand"])("tar", [
        "-xzf",
        archivePath,
        "-C",
        temporaryRoot,
        "--one-top-level=repository",
        "--strip-components=1"
    ], temporaryRoot);
    (0, __TURBOPACK__imported__module__$5b$externals$5d2f$node$3a$fs__$5b$external$5d$__$28$node$3a$fs$2c$__cjs$29$__["rmSync"])(archivePath, {
        force: true
    });
    console.log(`[Repository Ingestion] Archive extraction finished in ${formatDuration(extractionStartedAt)}s with status: ${extraction.status}`);
    if (extraction.status !== "passed" || !(0, __TURBOPACK__imported__module__$5b$externals$5d2f$node$3a$fs__$5b$external$5d$__$28$node$3a$fs$2c$__cjs$29$__["existsSync"])(repositoryPath)) {
        (0, __TURBOPACK__imported__module__$5b$externals$5d2f$node$3a$fs__$5b$external$5d$__$28$node$3a$fs$2c$__cjs$29$__["rmSync"])(repositoryPath, {
            recursive: true,
            force: true
        });
        console.log("[Repository Ingestion] Archive extraction failed. Falling back to Git clone.");
        return false;
    }
    console.log("[Repository Ingestion] GitHub archive fast-path succeeded.");
    return true;
}
async function cloneRepository(repository, temporaryRoot, repositoryPath) {
    console.log("[Repository Ingestion] Starting Git clone fallback...");
    const cloneStartedAt = Date.now();
    let cloneSucceeded = false;
    let lastError = "Repository clone failed.";
    for(let attempt = 1; attempt <= CLONE_ATTEMPTS; attempt += 1){
        if ((0, __TURBOPACK__imported__module__$5b$externals$5d2f$node$3a$fs__$5b$external$5d$__$28$node$3a$fs$2c$__cjs$29$__["existsSync"])(repositoryPath)) {
            (0, __TURBOPACK__imported__module__$5b$externals$5d2f$node$3a$fs__$5b$external$5d$__$28$node$3a$fs$2c$__cjs$29$__["rmSync"])(repositoryPath, {
                recursive: true,
                force: true
            });
        }
        console.log(`[Repository Ingestion] Git clone attempt ${attempt}/${CLONE_ATTEMPTS}...`);
        const result = await (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$execution$2f$command$2d$runner$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["runCommand"])("git", [
            "clone",
            "--depth",
            "1",
            "--no-tags",
            "--single-branch",
            "--filter=blob:none",
            repository.cloneUrl,
            repositoryPath
        ], temporaryRoot, {
            env: {
                ...process.env,
                GIT_TERMINAL_PROMPT: "0"
            }
        });
        if (result.status === "passed" && (0, __TURBOPACK__imported__module__$5b$externals$5d2f$node$3a$fs__$5b$external$5d$__$28$node$3a$fs$2c$__cjs$29$__["existsSync"])(repositoryPath)) {
            cloneSucceeded = true;
            console.log(`[Repository Ingestion] Git clone succeeded in ${formatDuration(cloneStartedAt)}s.`);
            break;
        }
        lastError = result.stderr || result.stdout || `Repository clone failed on attempt ${attempt}.`;
        console.log(`[Repository Ingestion] Git clone attempt ${attempt} failed.`);
        if (attempt < CLONE_ATTEMPTS) {
            await delay(CLONE_RETRY_DELAY_MS * attempt);
        }
    }
    if (!cloneSucceeded) {
        throw new Error([
            `Repository clone failed after ${CLONE_ATTEMPTS} attempts.`,
            lastError
        ].join("\n"));
    }
}
async function ingestGitHubRepository(repository) {
    const temporaryRoot = (0, __TURBOPACK__imported__module__$5b$externals$5d2f$node$3a$fs__$5b$external$5d$__$28$node$3a$fs$2c$__cjs$29$__["mkdtempSync"])((0, __TURBOPACK__imported__module__$5b$externals$5d2f$node$3a$path__$5b$external$5d$__$28$node$3a$path$2c$__cjs$29$__["join"])((0, __TURBOPACK__imported__module__$5b$externals$5d2f$node$3a$os__$5b$external$5d$__$28$node$3a$os$2c$__cjs$29$__["tmpdir"])(), "deployguard-repo-"));
    const repositoryPath = (0, __TURBOPACK__imported__module__$5b$externals$5d2f$node$3a$path__$5b$external$5d$__$28$node$3a$path$2c$__cjs$29$__["join"])(temporaryRoot, "repository");
    const ingestionStartedAt = Date.now();
    try {
        const archiveSucceeded = await tryArchiveDownload(repository, temporaryRoot, repositoryPath);
        if (!archiveSucceeded) {
            await cloneRepository(repository, temporaryRoot, repositoryPath);
        }
        if (!(0, __TURBOPACK__imported__module__$5b$externals$5d2f$node$3a$fs__$5b$external$5d$__$28$node$3a$fs$2c$__cjs$29$__["existsSync"])(repositoryPath)) {
            throw new Error("Repository ingestion reported success but the repository directory is missing.");
        }
        console.log(`[Repository Ingestion] Total ingestion time: ${formatDuration(ingestionStartedAt)}s.`);
        let cleanedUp = false;
        return {
            repository,
            repositoryPath,
            cleanup () {
                if (cleanedUp) {
                    return;
                }
                cleanedUp = true;
                (0, __TURBOPACK__imported__module__$5b$externals$5d2f$node$3a$fs__$5b$external$5d$__$28$node$3a$fs$2c$__cjs$29$__["rmSync"])(temporaryRoot, {
                    recursive: true,
                    force: true
                });
            }
        };
    } catch (error) {
        (0, __TURBOPACK__imported__module__$5b$externals$5d2f$node$3a$fs__$5b$external$5d$__$28$node$3a$fs$2c$__cjs$29$__["rmSync"])(temporaryRoot, {
            recursive: true,
            force: true
        });
        throw error;
    }
}
}),
"[project]/src/lib/sandbox/config.ts [app-route] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "DEFAULT_SANDBOX_LIMITS",
    ()=>DEFAULT_SANDBOX_LIMITS
]);
const DEFAULT_SANDBOX_LIMITS = {
    memoryMb: 2048,
    cpus: 1,
    timeoutMs: 5 * 60 * 1000
};
}),
"[project]/src/lib/sandbox/docker-sandbox.ts [app-route] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "runDockerSandboxCommand",
    ()=>runDockerSandboxCommand
]);
var __TURBOPACK__imported__module__$5b$externals$5d2f$node$3a$crypto__$5b$external$5d$__$28$node$3a$crypto$2c$__cjs$29$__ = __turbopack_context__.i("[externals]/node:crypto [external] (node:crypto, cjs)");
var __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$sandbox$2f$config$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/src/lib/sandbox/config.ts [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$execution$2f$command$2d$runner$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/src/lib/execution/command-runner.ts [app-route] (ecmascript)");
;
;
;
async function runDockerSandboxCommand(input) {
    const limits = input.limits ?? __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$sandbox$2f$config$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["DEFAULT_SANDBOX_LIMITS"];
    const containerName = `deployguard-${(0, __TURBOPACK__imported__module__$5b$externals$5d2f$node$3a$crypto__$5b$external$5d$__$28$node$3a$crypto$2c$__cjs$29$__["randomUUID"])()}`;
    const environmentArgs = Object.entries(input.environment ?? {}).flatMap(([key, value])=>[
            "--env",
            `${key}=${value}`
        ]);
    const userArgs = input.user ? [
        "--user",
        input.user
    ] : [];
    const additionalMountArgs = (input.mounts ?? []).flatMap((mount)=>[
            "--mount",
            [
                "type=bind",
                `source=${mount.source}`,
                `target=${mount.target}`,
                mount.readOnly ? "readonly" : undefined
            ].filter(Boolean).join(",")
        ]);
    const dockerArgs = [
        "run",
        "--rm",
        "--name",
        containerName,
        "--network",
        input.network ?? "none",
        "--memory",
        `${limits.memoryMb}m`,
        "--cpus",
        String(limits.cpus),
        "--pids-limit",
        "256",
        "--security-opt",
        "no-new-privileges",
        "--cap-drop",
        "ALL",
        "--read-only",
        "--tmpfs",
        "/tmp:rw,noexec,nosuid,size=256m",
        // ...userArgs,
        // ...environmentArgs,
        // "--mount",
        // `type=bind,source=${input.repositoryPath},target=/workspace`,
        ...userArgs,
        ...environmentArgs,
        "--mount",
        `type=bind,source=${input.repositoryPath},target=/workspace`,
        ...additionalMountArgs,
        "--workdir",
        "/workspace",
        "node:22-bookworm-slim",
        ...input.command
    ];
    const startedAt = Date.now();
    const executionPromise = (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$execution$2f$command$2d$runner$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["runCommand"])("docker", dockerArgs, input.repositoryPath);
    let timeoutHandle;
    const timeoutPromise = new Promise((resolve)=>{
        timeoutHandle = setTimeout(()=>{
            resolve("timeout");
        }, limits.timeoutMs);
    });
    const outcome = await Promise.race([
        executionPromise,
        timeoutPromise
    ]);
    if (outcome === "timeout") {
        try {
            await (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$execution$2f$command$2d$runner$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["runCommand"])("docker", [
                "kill",
                containerName
            ], input.repositoryPath);
        } catch  {
        /*
     * The container may already have
     * exited before Docker received
     * the kill request.
     */ }
        let terminatedResult;
        try {
            terminatedResult = await executionPromise;
        } catch  {
        /*
     * Docker itself may fail after
     * forced container termination.
     */ }
        return {
            status: "timed_out",
            exitCode: terminatedResult?.exitCode ?? null,
            stdout: terminatedResult?.stdout ?? "",
            stderr: [
                terminatedResult?.stderr,
                "Sandbox execution exceeded the configured timeout and the container was terminated."
            ].filter(Boolean).join("\n"),
            durationMs: Date.now() - startedAt
        };
    }
    if (timeoutHandle) {
        clearTimeout(timeoutHandle);
    }
    return {
        status: outcome.status === "passed" ? "passed" : "failed",
        exitCode: outcome.exitCode,
        stdout: outcome.stdout,
        stderr: outcome.stderr,
        durationMs: Date.now() - startedAt
    };
}
}),
"[project]/src/lib/sandbox/workspace-preparation.ts [app-route] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "prepareSandboxWorkspace",
    ()=>prepareSandboxWorkspace
]);
var __TURBOPACK__imported__module__$5b$externals$5d2f$node$3a$fs__$5b$external$5d$__$28$node$3a$fs$2c$__cjs$29$__ = __turbopack_context__.i("[externals]/node:fs [external] (node:fs, cjs)");
var __TURBOPACK__imported__module__$5b$externals$5d2f$node$3a$path__$5b$external$5d$__$28$node$3a$path$2c$__cjs$29$__ = __turbopack_context__.i("[externals]/node:path [external] (node:path, cjs)");
var __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$sandbox$2f$docker$2d$sandbox$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/src/lib/sandbox/docker-sandbox.ts [app-route] (ecmascript)");
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
async function prepareSandboxWorkspace(repositoryPath) {
    const packageManager = detectPackageManager(repositoryPath);
    const cacheRoot = (0, __TURBOPACK__imported__module__$5b$externals$5d2f$node$3a$path__$5b$external$5d$__$28$node$3a$path$2c$__cjs$29$__["resolve"])(process.cwd(), ".deployguard", "cache");
    const npmCachePath = (0, __TURBOPACK__imported__module__$5b$externals$5d2f$node$3a$path__$5b$external$5d$__$28$node$3a$path$2c$__cjs$29$__["join"])(cacheRoot, "npm");
    (0, __TURBOPACK__imported__module__$5b$externals$5d2f$node$3a$fs__$5b$external$5d$__$28$node$3a$fs$2c$__cjs$29$__["mkdirSync"])(npmCachePath, {
        recursive: true
    });
    if (!packageManager) {
        return {
            status: "failed",
            stdout: "",
            stderr: "",
            durationMs: 0,
            summary: "No supported package manager lockfile was detected."
        };
    }
    let command;
    switch(packageManager){
        case "npm":
            command = [
                "sh",
                "-c",
                [
                    "mkdir -p",
                    "/tmp/deployguard-home",
                    "&&",
                    "npm ci",
                    "--ignore-scripts",
                    "--no-audit",
                    "--no-fund",
                    "--prefer-offline"
                ].join(" ")
            ];
            break;
        case "pnpm":
            command = [
                "corepack",
                "pnpm",
                "install",
                "--frozen-lockfile",
                "--ignore-scripts"
            ];
            break;
        case "yarn":
            command = [
                "corepack",
                "yarn",
                "install",
                "--frozen-lockfile",
                "--ignore-scripts"
            ];
            break;
    }
    const uid = typeof process.getuid === "function" ? process.getuid() : 1000;
    const gid = typeof process.getgid === "function" ? process.getgid() : 1000;
    const result = await (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$sandbox$2f$docker$2d$sandbox$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["runDockerSandboxCommand"])({
        mounts: packageManager === "npm" ? [
            {
                source: npmCachePath,
                target: "/deployguard-cache/npm"
            }
        ] : [],
        repositoryPath,
        command,
        network: "bridge",
        user: `${uid}:${gid}`,
        environment: {
            HOME: "/tmp/deployguard-home",
            npm_config_cache: "/deployguard-cache/npm",
            CI: "true"
        },
        limits: {
            memoryMb: 2048,
            cpus: 1,
            timeoutMs: 10 * 60 * 1000
        }
    });
    const combinedOutput = `${result.stdout}\n${result.stderr}`;
    const networkFailure = /ECONNRESET|ENOTFOUND|ETIMEDOUT|ECONNREFUSED|network aborted|network connectivity/i.test(combinedOutput);
    return {
        status: result.status,
        packageManager,
        stdout: result.stdout,
        stderr: result.stderr,
        durationMs: result.durationMs,
        // summary:
        //   result.status === "passed"
        //     ? `Sandbox workspace prepared successfully using ${packageManager}.`
        //     : `Sandbox workspace preparation failed using ${packageManager}.`,
        summary: result.status === "passed" ? `Sandbox workspace prepared successfully using ${packageManager}.` : networkFailure ? `Sandbox workspace preparation could not complete because of a package registry or network error.` : `Sandbox workspace preparation failed using ${packageManager}.`
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
];

//# sourceMappingURL=%5Broot-of-the-server%5D__0q2s-d-._.js.map