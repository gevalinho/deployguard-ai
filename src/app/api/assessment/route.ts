import { NextResponse } from "next/server";

import { runReadinessAssessment } from "@/lib/orchestration/readiness-orchestrator";

export const runtime = "nodejs";

export async function POST() {
  try {
    const repositoryPath = process.cwd();

    const report = await runReadinessAssessment(
      repositoryPath
    );

    return NextResponse.json(
      {
        ok: true,
        report,
      },
      {
        status: 200,
      }
    );
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Unknown assessment error";

    console.error(
      "DeployGuard assessment failed:",
      error
    );

    return NextResponse.json(
      {
        ok: false,
        error: message,
      },
      {
        status: 500,
      }
    );
  }
}