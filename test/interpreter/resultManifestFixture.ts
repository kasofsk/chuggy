/**
 * The report bodies the manifest suites hand the reader, and the binding they
 * hand it under. They are one fixture because both the reader's own suite and
 * the contract's agreement suite read them, and a body built twice is a case
 * one of them stops seeing.
 */

import { createHash } from "node:crypto";

import {
  acceptResultManifest,
  artifactBytesMax,
  artifactPathCharsMax,
  artifactPathSegmentCharsMax,
  artifactPathSegmentsMax,
  manifestBytesMax,
  manifestDiagnosticsMax,
  manifestHandoffsMax,
  asResultManifestId,
  type CanonicalManifest,
  type ManifestAccepted,
  type ManifestAttemptBinding,
  type ManifestRejection,
} from "../../src/interpreter/resultManifest.ts";
import { resultManifestTextCharsMax } from "../../src/contract/workerDocuments.ts";
import {
  asAttemptId,
  asExecutionId,
} from "../../src/interpreter/schedulerIdentity.ts";
import { asProjectId, asTenantId } from "../../src/interpreter/projectStore.ts";

export const binding: ManifestAttemptBinding = {
  partition: {
    tenant: asTenantId("tenant-one"),
    project: asProjectId("project-one"),
  },
  execution: asExecutionId("execution-one"),
  attempt: asAttemptId("attempt-one"),
};

export const manifestId = asResultManifestId("manifest-one");

/** The digest the suites hand the boundary, which is the one a deployment hands it too. */
export function digestOf(canonical: CanonicalManifest): string {
  return createHash("sha256").update(canonical).digest("hex");
}

/** Accepts the body under the shared binding, which every case starts from. */
export function accept(text: string): ManifestAccepted {
  return acceptResultManifest(binding, manifestId, text, digestOf);
}

/** One artifact digest that differs per label, so two rows are never accidentally equal. */
export function digestFor(label: string): string {
  return createHash("sha256").update(label).digest("hex");
}

/** One row of the wire form, which is what a worker actually sends. */
export function row(path: string, bytes = 1): Record<string, unknown> {
  return { path, digest: digestFor(path), bytes };
}

/** One report body with the named lists, so a case varies one thing. */
export function report(
  verdict: string,
  handoffs: readonly Record<string, unknown>[],
  diagnostics: readonly Record<string, unknown>[] = [],
): string {
  return JSON.stringify({ version: 1, verdict, handoffs, diagnostics });
}

/** One version-two report carrying the candidate branch instead of changed files. */
export function sourceReport(
  verdict: string,
  source: unknown,
  handoffs: readonly Record<string, unknown>[] = [],
): string {
  return JSON.stringify({
    version: 2,
    verdict,
    handoffs,
    diagnostics: [],
    source,
  });
}

/** One current report carrying the summary later evaluations receive. */
export function currentReport(verdict: string, report: unknown): string {
  return JSON.stringify({
    version: 3,
    verdict,
    report,
    handoffs: [],
    diagnostics: [],
    source: null,
  });
}

/**
 * The document `images/worker/entrypoint.mjs` builds, whose `source` key is
 * absent rather than null whenever there is no source handoff. The shape is
 * restated rather than imported: that module runs its own entrypoint on import
 * and carries no types this suite could be checked against.
 */
export function workerReport(verdict: string, source?: unknown): string {
  return JSON.stringify({
    version: 3,
    verdict,
    report: "the review the evaluator wrote",
    handoffs: [],
    ...(source === undefined ? {} : { source }),
    diagnostics: [row("log/session.json")],
  });
}

export const source = {
  repository: "repository-one",
  ref: "refs/heads/chuggy/tickets/ticket-one/attempts/attempt-one",
  commit: "a".repeat(40),
  base: "b".repeat(40),
};

/** One path per path rejection, which is what makes both roster claims decidable. */
export const pathCases: readonly (readonly [string, ManifestRejection])[] = [
  ["out/\ud800", "PathNotWellFormed"],
  ["", "PathEmpty"],
  ["o".repeat(artifactPathCharsMax + 1), "PathTooLong"],
  [`out/e${String.fromCharCode(0x301)}`, "PathNotNormalForm"],
  [`out/a${String.fromCharCode(1)}b`, "PathHasControlCharacter"],
  ["out\\a", "PathHasBackslash"],
  ["/out/a", "PathAbsolute"],
  ["out//a", "PathEmptySegment"],
  ["out/../a", "PathDotSegment"],
  [
    Array.from({ length: artifactPathSegmentsMax + 1 }, () => "a").join("/"),
    "PathTooDeep",
  ],
  [`out/${"a".repeat(artifactPathSegmentCharsMax + 1)}`, "PathSegmentTooLong"],
  ["out/ a", "PathHasEdgeWhitespace"],
];

/** The body one path reaches the boundary in. */
export function pathReport(path: string): string {
  return report("Pass", [{ path, digest: digestFor(path), bytes: 1 }]);
}

/** The bodies the envelope alone refuses, which is where a version and a key set are read. */
function manifestBodiesRefusedInEnvelope(): readonly string[] {
  return [
    "x".repeat(resultManifestTextCharsMax + 1),
    "not json",
    JSON.stringify({
      version: 2,
      verdict: "Pass",
      handoffs: [],
      diagnostics: [],
      source: null,
      extra: 1,
    }),
    JSON.stringify({
      version: 3,
      verdict: "Pass",
      handoffs: [],
      diagnostics: [],
    }),
    JSON.stringify({
      version: 4,
      verdict: "Pass",
      handoffs: [],
      diagnostics: [],
    }),
    report("Skip", []),
  ];
}

/** A body for every rejection the roster names, each refused for its own reason. */
export function manifestBodiesRefused(): readonly string[] {
  const handoffs = Array.from({ length: manifestHandoffsMax }, (_unused, at) =>
    row(`out/${String(at)}`),
  );
  const large = Array.from(
    { length: Math.floor(manifestBytesMax / artifactBytesMax) + 1 },
    (_unused, at) => row(`out/${String(at)}`, artifactBytesMax),
  );
  return [
    ...pathCases.map(([path]) => pathReport(path)),
    ...manifestBodiesRefusedInEnvelope(),
    report("Pass", [{ ...row("out/a"), extra: 1 }]),
    JSON.stringify({
      version: 1,
      verdict: "Pass",
      handoffs: ["out/a"],
      diagnostics: [],
    }),
    currentReport("Pass", ""),
    sourceReport("Pass", { ...source, commit: "not-an-object" }),
    sourceReport("Fail", source),
    sourceReport("Pass", source, [row("out/a")]),
    report("Pass", [...handoffs, row("out/extra")]),
    report(
      "Pass",
      [],
      Array.from({ length: manifestDiagnosticsMax + 1 }, (_unused, at) =>
        row(`log/${String(at)}`),
      ),
    ),
    report("Fail", [row("out/a")]),
    report("Pass", [row("out/a", -1)]),
    report("Pass", [row("out/a", artifactBytesMax + 1)]),
    report("Pass", large),
    report("Pass", [
      { path: "out/a", digest: digestFor("out/a").toUpperCase(), bytes: 1 },
    ]),
    report("Pass", [row("out/a"), row("out/a")]),
  ];
}
