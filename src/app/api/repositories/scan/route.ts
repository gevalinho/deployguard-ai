import { NextResponse } from "next/server";

import {
  parseGitHubRepositoryUrl,
} from "@/lib/repository/github-repository";

import {
  ingestGitHubRepository,
} from "@/lib/repository/repository-ingestion";

import {
  scanRepository,
} from "@/lib/scanner/repository-scanner";

export const runtime = "nodejs";

interface ScanRequest {
  repositoryUrl?: string;
}

export async function POST(
  request: Request
) {
  let body: ScanRequest;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      {
        ok: false,
        error:
          "A valid JSON request body is required.",
      },
      {
        status: 400,
      }
    );
  }

  try {
    const repository =
      parseGitHubRepositoryUrl(
        body.repositoryUrl ?? ""
      );

    const ingested =
      await ingestGitHubRepository(
        repository
      );

    try {
      const scan = scanRepository(
        ingested.repositoryPath
      );

      /*
       * Do not expose our temporary server
       * filesystem path to API consumers.
       */
      return NextResponse.json({
        ok: true,

        repository: {
          owner: repository.owner,
          name: repository.name,
          fullName: repository.fullName,
          url: repository.url,
        },

        scan: {
          scannedAt: scan.scannedAt,
          facts: scan.facts,
        },
      });
    } finally {
      ingested.cleanup();
    }
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Repository scan failed.";

    console.error(
      "Remote repository scan failed:",
      error
    );

    return NextResponse.json(
      {
        ok: false,
        error: message,
      },
      {
        status: 400,
      }
    );
  }
}