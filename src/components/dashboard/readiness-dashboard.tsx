"use client";

import { useState } from "react";

type RepositoryFact = {
  key: string;
  value: string;
  confidence: number;
  evidence: {
    source: string;
    path: string;
    description: string;
  }[];
};

type RemoteScanResult = {
  repository: {
    owner: string;
    name: string;
    fullName: string;
    url: string;
  };
  scan: {
    scannedAt: string;
    facts: RepositoryFact[];
  };
};

type CheckResult = {
  id: string;
  category: string;
  name: string;
  status: "passed" | "failed" | "skipped" | "error";
  skipReason?: string;
  summary: string;
};

type ReadinessReport = {
  generatedAt: string;

  architecture?: {
    summary: string;
    architectureType: string;
    recommendedChecks: string[];
  };

  checks: CheckResult[];

  readiness: {
    score: number;
    coverage: number;
    passed: number;
    failed: number;
    skipped: number;
    errors: number;
    readinessGaps: string[];
    notApplicableCategories: string[];
  };

  remediation: {
    category: string;
    priority: "low" | "medium" | "high";
    title: string;
    recommendation: string;
  }[];
};

function getStatusLabel(check: CheckResult) {
  if (
    check.status === "skipped" &&
    check.skipReason === "not_applicable"
  ) {
    return "Not applicable";
  }

  if (
    check.status === "skipped" &&
    check.skipReason === "not_configured"
  ) {
    return "Not configured";
  }

  return check.status;
}

export function ReadinessDashboard() {
  const [report, setReport] =
    useState<ReadinessReport | null>(null);

  const [loading, setLoading] =
    useState(false);

  const [error, setError] =
    useState<string | null>(null);


    const [repositoryUrl, setRepositoryUrl] =
  useState("");

const [remoteScan, setRemoteScan] =
  useState<RemoteScanResult | null>(null);

const [scanLoading, setScanLoading] =
  useState(false);

const [scanError, setScanError] =
  useState<string | null>(null);


async function scanRepository() {
  setScanLoading(true);
  setScanError(null);
  setRemoteScan(null);

  try {
    const response = await fetch(
      "/api/repositories/scan",
      {
        method: "POST",
        headers: {
          "Content-Type":
            "application/json",
        },
        body: JSON.stringify({
          repositoryUrl,
        }),
      }
    );

    const data = await response.json();

    if (!response.ok || !data.ok) {
      throw new Error(
        data.error ??
          "Repository scan failed."
      );
    }

    setRemoteScan({
      repository: data.repository,
      scan: data.scan,
    });
  } catch (scanError) {
    setScanError(
      scanError instanceof Error
        ? scanError.message
        : "Unknown repository scan error."
    );
  } finally {
    setScanLoading(false);
  }
}


  async function runAssessment() {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch(
        "/api/assessment",
        {
          method: "POST",
        }
      );

      const data = await response.json();

      if (!response.ok || !data.ok) {
        throw new Error(
          data.error ??
            "Assessment failed."
        );
      }

      setReport(data.report);
    } catch (assessmentError) {
      setError(
        assessmentError instanceof Error
          ? assessmentError.message
          : "Unknown assessment error."
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100">
      <div className="mx-auto max-w-6xl px-6 py-16">
        <header className="mb-12">
          <p className="mb-3 text-sm font-medium uppercase tracking-[0.2em] text-zinc-500">
            DeployGuard AI
          </p>

          <h1 className="max-w-3xl text-4xl font-semibold tracking-tight md:text-5xl">
            Production readiness,
            backed by evidence.
          </h1>

          <p className="mt-5 max-w-2xl text-lg leading-8 text-zinc-400">
            Inspect build quality,
            security, testing,
            deployment readiness and
            architecture before code
            reaches production.
          </p>


<div className="mt-8 max-w-3xl rounded-2xl border border-zinc-800 bg-zinc-900 p-5">
  <label
    htmlFor="repository-url"
    className="text-sm font-medium text-zinc-300"
  >
    GitHub Repository
  </label>

  <div className="mt-3 flex flex-col gap-3 sm:flex-row">
    <input
      id="repository-url"
      type="url"
      value={repositoryUrl}
      onChange={(event) =>
        setRepositoryUrl(
          event.target.value
        )
      }
      placeholder="https://github.com/owner/repository"
      className="min-w-0 flex-1 rounded-xl border border-zinc-700 bg-zinc-950 px-4 py-3 text-sm text-zinc-100 outline-none transition placeholder:text-zinc-600 focus:border-zinc-500"
    />

    <button
      type="button"
      onClick={scanRepository}
      disabled={
        scanLoading ||
        !repositoryUrl.trim()
      }
      className="rounded-xl bg-white px-5 py-3 font-medium text-zinc-950 transition hover:bg-zinc-200 disabled:cursor-not-allowed disabled:opacity-50"
    >
      {scanLoading
        ? "Scanning..."
        : "Scan Repository"}
    </button>
  </div>

  <p className="mt-3 text-xs leading-5 text-zinc-500">
    Static inspection only. Repository
    code is not executed during this
    scan.
  </p>

  {scanError && (
    <p className="mt-3 text-sm text-red-400">
      {scanError}
    </p>
  )}
</div>



          <button
            type="button"
            onClick={runAssessment}
            disabled={loading}
            className="mt-8 rounded-xl bg-white px-5 py-3 font-medium text-zinc-950 transition hover:bg-zinc-200 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading
              ? "Running assessment..."
              : "Run Assessment"}
          </button>

          {error && (
            <p className="mt-4 text-sm text-red-400">
              {error}
            </p>
          )}
        </header>


          {remoteScan && (
  <section className="mb-10 space-y-5">
    <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-6">
      <p className="text-sm text-zinc-500">
        Repository
      </p>

      <h2 className="mt-2 text-xl font-semibold">
        {
          remoteScan.repository
            .fullName
        }
      </h2>

      <p className="mt-2 text-sm text-zinc-500">
        Static repository evidence
        collected successfully.
      </p>
    </div>

    <div>
      <h2 className="mb-4 text-xl font-semibold">
        Detected Technology
      </h2>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {remoteScan.scan.facts.map(
          (fact) => (
            <article
              key={`${fact.key}-${fact.value}`}
              className="rounded-2xl border border-zinc-800 bg-zinc-900 p-5"
            >
              <p className="text-xs uppercase tracking-wide text-zinc-500">
                {fact.key}
              </p>

              <p className="mt-2 text-lg font-medium">
                {fact.value}
              </p>

              <p className="mt-2 text-xs text-zinc-600">
                Confidence{" "}
                {Math.round(
                  fact.confidence *
                    100
                )}
                %
              </p>
            </article>
          )
        )}
      </div>
    </div>

    <div>
      <h2 className="mb-4 text-xl font-semibold">
        Evidence
      </h2>

      <div className="space-y-3">
        {remoteScan.scan.facts.flatMap(
          (fact) =>
            fact.evidence.map(
              (
                evidence,
                index
              ) => (
                <article
                  key={`${fact.key}-${evidence.path}-${index}`}
                  className="rounded-2xl border border-zinc-800 bg-zinc-900 p-5"
                >
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="font-medium">
                        {
                          evidence.path
                        }
                      </p>

                      <p className="mt-1 text-sm text-zinc-500">
                        {
                          evidence.description
                        }
                      </p>
                    </div>

                    <span className="rounded-full border border-zinc-700 px-3 py-1 text-xs text-zinc-400">
                      {fact.key}
                    </span>
                  </div>
                </article>
              )
            )
        )}
      </div>
    </div>
  </section>
)}



        {report && (
          <div className="space-y-8">
            <section className="grid gap-4 md:grid-cols-2">
              <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-6">
                <p className="text-sm text-zinc-400">
                  Readiness Score
                </p>

                <p className="mt-2 text-5xl font-semibold">
                  {report.readiness.score}
                  <span className="text-2xl text-zinc-500">
                    /100
                  </span>
                </p>
              </div>

              <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-6">
                <p className="text-sm text-zinc-400">
                  Assessment Coverage
                </p>

                <p className="mt-2 text-5xl font-semibold">
                  {report.readiness.coverage}
                  <span className="text-2xl text-zinc-500">
                    %
                  </span>
                </p>
              </div>
            </section>

            <section>
              <h2 className="mb-4 text-xl font-semibold">
                Verification Checks
              </h2>

              <div className="grid gap-4 md:grid-cols-2">
                {report.checks.map(
                  (check) => (
                    <article
                      key={check.id}
                      className="rounded-2xl border border-zinc-800 bg-zinc-900 p-5"
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <p className="font-medium">
                            {check.name}
                          </p>

                          <p className="mt-2 text-sm leading-6 text-zinc-400">
                            {check.summary}
                          </p>
                        </div>

                        <span className="rounded-full border border-zinc-700 px-3 py-1 text-xs capitalize text-zinc-300">
                          {getStatusLabel(
                            check
                          )}
                        </span>
                      </div>
                    </article>
                  )
                )}
              </div>
            </section>

            {report.architecture && (
              <section className="rounded-2xl border border-zinc-800 bg-zinc-900 p-6">
                <p className="text-sm text-zinc-500">
                  NVIDIA Nemotron
                </p>

                <h2 className="mt-2 text-xl font-semibold">
                  AI Architecture Analysis
                </h2>

                <p className="mt-4 text-zinc-300">
                  {
                    report.architecture
                      .summary
                  }
                </p>

                <p className="mt-3 text-sm text-zinc-500">
                  {
                    report.architecture
                      .architectureType
                  }
                </p>
              </section>
            )}

            <section>
              <h2 className="mb-4 text-xl font-semibold">
                Remediation Plan
              </h2>

              {report.remediation.length ===
              0 ? (
                <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-6 text-zinc-400">
                  No remediation items
                  were generated.
                </div>
              ) : (
                <div className="space-y-3">
                  {report.remediation.map(
                    (item, index) => (
                      <article
                        key={`${item.category}-${index}`}
                        className="rounded-2xl border border-zinc-800 bg-zinc-900 p-5"
                      >
                        <div className="flex flex-wrap items-center gap-3">
                          <h3 className="font-medium">
                            {item.title}
                          </h3>

                          <span className="rounded-full border border-zinc-700 px-2.5 py-1 text-xs uppercase tracking-wide text-zinc-400">
                            {item.priority}
                          </span>
                        </div>

                        <p className="mt-3 text-sm leading-6 text-zinc-400">
                          {
                            item.recommendation
                          }
                        </p>
                      </article>
                    )
                  )}
                </div>
              )}
            </section>
          </div>
        )}
      </div>
    </main>
  );
}