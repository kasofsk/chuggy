/**
 * The manifest boundary at the lowest tier that can express it: what an
 * untrusted report is refused for, and what its canonical bytes cover.
 *
 * EVERY REFUSAL IS ASSERTED AS A VALUE, never as a thrown error, because that
 * is the fail-closed contract: a worker controls this text, and a throw here
 * would be caught by whatever loop was reading reports and retried forever
 * against a report that can never become valid.
 */

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";

import {
  acceptResultManifest,
  allManifestRejections,
  artifactBytesMax,
  artifactPathCharsMax,
  artifactPathSegmentCharsMax,
  artifactPathSegmentsMax,
  asArtifactDigest,
  asArtifactPath,
  asResultManifestId,
  canonicalResultManifest,
  manifestBytesMax,
  manifestDiagnosticsMax,
  manifestHandoffsMax,
  manifestsAgree,
  resultDigestFold,
  resultDigestFoldHexChars,
  resultManifestTextCharsMax,
  type CanonicalManifest,
  type ManifestAccepted,
  type ManifestAttemptBinding,
  type ManifestRejection,
  type ResultManifest,
} from "../../src/interpreter/resultManifest.ts";
import {
  asAttemptId,
  asExecutionId,
} from "../../src/interpreter/schedulerIdentity.ts";
import { asProjectId, asTenantId } from "../../src/interpreter/projectStore.ts";

const binding: ManifestAttemptBinding = {
  partition: {
    tenant: asTenantId("tenant-one"),
    project: asProjectId("project-one"),
  },
  execution: asExecutionId("execution-one"),
  attempt: asAttemptId("attempt-one"),
};

const manifestId = asResultManifestId("manifest-one");

/** The digest this suite hands the boundary, which is the one a deployment hands it too. */
function digestOf(canonical: CanonicalManifest): string {
  return createHash("sha256").update(canonical).digest("hex");
}

/** One artifact digest that differs per label, so two rows are never accidentally equal. */
function digestFor(label: string): string {
  return createHash("sha256").update(label).digest("hex");
}

/** One row of the wire form, which is what a worker actually sends. */
function row(path: string, bytes = 1): Record<string, unknown> {
  return { path, digest: digestFor(path), bytes };
}

/** One report body with the named lists, so a case varies one thing. */
function report(
  verdict: string,
  handoffs: readonly Record<string, unknown>[],
  diagnostics: readonly Record<string, unknown>[] = [],
): string {
  return JSON.stringify({ version: 1, verdict, handoffs, diagnostics });
}

/** Accepts the body under the shared binding, which every case starts from. */
function accept(text: string): ManifestAccepted {
  return acceptResultManifest(binding, manifestId, text, digestOf);
}

/** The code a body is refused with, failing loudly when it was accepted instead. */
function rejection(text: string): ManifestRejection {
  const outcome = accept(text);
  if (outcome.accepted !== "Rejected")
    throw new Error("the manifest was accepted, so this case proves nothing");
  return outcome.code;
}

/** The sealed manifest a body produces, failing loudly when it was refused. */
function accepted(text: string): ResultManifest {
  const outcome = accept(text);
  if (outcome.accepted !== "Accepted")
    throw new Error(`the manifest was refused as ${outcome.code}`);
  return outcome.manifest;
}

test("an explicit empty manifest is accepted and is not the absence of one", () => {
  const empty = accepted(report("Pass", []));
  assert.deepEqual(empty.handoffs, []);
  assert.deepEqual(empty.diagnostics, []);
  assert.equal(rejection('{"version":1,"verdict":"Pass"}'), "UnexpectedField");
});

test("the schema version is read before any row is", () => {
  assert.equal(
    rejection(
      JSON.stringify({
        version: 2,
        verdict: "Pass",
        handoffs: [row("../escape")],
        diagnostics: [],
      }),
    ),
    "UnsupportedSchemaVersion",
  );
});

test("an unknown field is refused rather than ignored, at either level", () => {
  assert.equal(
    rejection(
      JSON.stringify({
        version: 1,
        verdict: "Pass",
        handoffs: [],
        diagnostics: [],
        extra: 1,
      }),
    ),
    "UnexpectedField",
  );
  assert.equal(
    rejection(report("Pass", [{ ...row("out/a"), extra: 1 }])),
    "UnexpectedField",
  );
});

test("text past the cap is refused without being parsed", () => {
  assert.equal(
    rejection("x".repeat(resultManifestTextCharsMax + 1)),
    "TextTooLong",
  );
  assert.equal(rejection("not json"), "TextUnreadable");
  assert.equal(rejection("[]"), "TextUnreadable");
});

test("a verdict outside the model's two is refused", () => {
  assert.equal(rejection(report("Skip", [])), "UnknownVerdict");
});

test("each list cap is accepted at the bound and refused one past it", () => {
  const handoffs = Array.from({ length: manifestHandoffsMax }, (_, at) =>
    row(`out/${String(at)}`),
  );
  assert.equal(
    accepted(report("Pass", handoffs)).handoffs.length,
    manifestHandoffsMax,
  );
  assert.equal(
    rejection(report("Pass", [...handoffs, row("out/extra")])),
    "TooManyHandoffs",
  );
  const diagnostics = Array.from(
    { length: manifestDiagnosticsMax + 1 },
    (_, at) => row(`log/${String(at)}`),
  );
  assert.equal(
    rejection(report("Pass", [], diagnostics)),
    "TooManyDiagnostics",
  );
});

test("a failed verdict may not declare handoffs", () => {
  assert.equal(
    rejection(report("Fail", [row("out/a")])),
    "HandoffsOnFailedVerdict",
  );
  assert.equal(accepted(report("Fail", [], [row("log/a")])).verdict, "Fail");
});

test("byte counts are refused when they are not counts, and when they are too large", () => {
  for (const bytes of [-1, 1.5, Number.MAX_VALUE]) {
    assert.equal(
      rejection(report("Pass", [row("out/a", bytes)])),
      "ArtifactBytesNotCounted",
    );
  }
  assert.equal(
    rejection(report("Pass", [row("out/a", artifactBytesMax + 1)])),
    "ArtifactTooLarge",
  );
  assert.equal(accepted(report("Pass", [row("out/a", 0)])).handoffs.length, 1);
});

test("rows each within the artifact cap may still exceed the manifest total", () => {
  const count = Math.floor(manifestBytesMax / artifactBytesMax) + 1;
  const handoffs = Array.from({ length: count }, (_, at) =>
    row(`out/${String(at)}`, artifactBytesMax),
  );
  assert.equal(rejection(report("Pass", handoffs)), "ManifestTooLarge");
});

test("a digest is refused unless it is lower-case hexadecimal of fixed width", () => {
  for (const digest of [
    digestFor("out/a").toUpperCase(),
    `sha256:${digestFor("out/a")}`,
    digestFor("out/a").slice(0, 63),
    `${digestFor("out/a")}0`,
  ]) {
    assert.equal(
      rejection(report("Pass", [{ path: "out/a", digest, bytes: 1 }])),
      "ArtifactDigestMalformed",
    );
  }
});

test("every path rejection is reachable and is reported in the checker's order", () => {
  const deep = Array.from({ length: artifactPathSegmentsMax + 1 }, () => "a");
  const cases: readonly [string, ManifestRejection][] = [
    ["out/\ud800", "PathNotWellFormed"],
    ["", "PathEmpty"],
    ["o".repeat(artifactPathCharsMax + 1), "PathTooLong"],
    [`out/e${String.fromCharCode(0x301)}`, "PathNotNormalForm"],
    [`out/a${String.fromCharCode(1)}b`, "PathHasControlCharacter"],
    ["out\\a", "PathHasBackslash"],
    ["/out/a", "PathAbsolute"],
    ["out//a", "PathEmptySegment"],
    ["out/../a", "PathDotSegment"],
    [deep.join("/"), "PathTooDeep"],
    [
      `out/${"a".repeat(artifactPathSegmentCharsMax + 1)}`,
      "PathSegmentTooLong",
    ],
    ["out/ a", "PathHasEdgeWhitespace"],
  ];
  for (const [path, code] of cases) {
    assert.equal(
      rejection(report("Pass", [{ path, digest: digestFor(path), bytes: 1 }])),
      code,
      `${JSON.stringify(path)} was not refused as ${code}`,
    );
  }
});

test("an absolute path that is also too deep is reported absolute, so the order is the algorithm's", () => {
  const path = `/${Array.from({ length: artifactPathSegmentsMax + 1 }, () => "a").join("/")}`;
  assert.equal(
    rejection(report("Pass", [{ path, digest: digestFor(path), bytes: 1 }])),
    "PathAbsolute",
  );
});

test("a path is refused rather than rewritten into normal form", () => {
  const decomposed = `out/e${String.fromCharCode(0x301)}`;
  assert.equal(
    rejection(
      report("Pass", [
        { path: decomposed, digest: digestFor(decomposed), bytes: 1 },
      ]),
    ),
    "PathNotNormalForm",
  );
  const composed = decomposed.normalize("NFC");
  assert.notEqual(composed, decomposed);
  assert.equal(
    accepted(report("Pass", [row(composed)])).handoffs[0]?.path,
    composed,
  );
});

test("a duplicate path is refused across both lists and across case", () => {
  assert.equal(
    rejection(report("Pass", [row("out/a"), row("out/a")])),
    "DuplicatePath",
  );
  assert.equal(
    rejection(report("Pass", [row("out/a")], [row("out/a")])),
    "DuplicatePath",
  );
  assert.equal(
    rejection(report("Pass", [row("out/a")], [row("OUT/A")])),
    "DuplicatePath",
  );
});

test("the rejection roster lists every code without repeating one", () => {
  assert.equal(
    new Set(allManifestRejections).size,
    allManifestRejections.length,
  );
  for (const code of [
    "TextTooLong",
    "TextUnreadable",
    "UnexpectedField",
    "UnsupportedSchemaVersion",
    "UnknownVerdict",
    "TooManyHandoffs",
    "TooManyDiagnostics",
    "HandoffsOnFailedVerdict",
    "ArtifactBytesNotCounted",
    "ArtifactTooLarge",
    "ManifestTooLarge",
    "ArtifactDigestMalformed",
    "DuplicatePath",
  ] as const) {
    assert.ok(
      allManifestRejections.includes(code),
      `${code} is not on the roster`,
    );
  }
});

test("the digest is a function of the set rather than of the order it arrived in", () => {
  const forward = accepted(report("Pass", [row("out/a"), row("out/b")]));
  const backward = accepted(report("Pass", [row("out/b"), row("out/a")]));
  assert.equal(forward.digest, backward.digest);
  assert.deepEqual(
    forward.handoffs.map((each) => each.path),
    ["out/a", "out/b"],
  );
  assert.equal(manifestsAgree(forward, backward), true);
});

test("moving one row between the lists changes the digest, because each list is counted", () => {
  const asHandoffs = accepted(report("Pass", [row("out/a"), row("out/b")]));
  const split = accepted(report("Pass", [row("out/a")], [row("out/b")]));
  assert.notEqual(asHandoffs.digest, split.digest);
  assert.equal(manifestsAgree(asHandoffs, split), false);
});

test("the same rows under another attempt or project digest differently", () => {
  const here = accepted(report("Pass", [row("out/a")]));
  for (const other of [
    {
      ...binding,
      partition: { ...binding.partition, project: asProjectId("project-two") },
    },
    {
      ...binding,
      partition: { ...binding.partition, tenant: asTenantId("tenant-two") },
    },
    { ...binding, execution: asExecutionId("execution-two") },
    { ...binding, attempt: asAttemptId("attempt-two") },
  ]) {
    const there = acceptResultManifest(
      other,
      manifestId,
      report("Pass", [row("out/a")]),
      digestOf,
    );
    assert.equal(there.accepted, "Accepted");
    if (there.accepted !== "Accepted") return;
    assert.notEqual(here.digest, there.manifest.digest);
    assert.equal(manifestsAgree(here, there.manifest), false);
  }
});

test("a partition identity the digest cannot separate is refused where it is branded", () => {
  const encoder = new TextEncoder();
  assert.deepEqual(
    encoder.encode("\uD800"),
    encoder.encode("\uFFFD"),
    "the two identities encode differently, so this proves nothing",
  );
  for (const brand of [asTenantId, asProjectId]) {
    assert.throws(
      () => brand("\uD800"),
      (error: unknown) => {
        assert.ok(error instanceof RangeError);
        assert.match(error.message, /unpaired surrogate/u);
        return true;
      },
    );
    assert.throws(() => brand("project\uDFFF-two"), RangeError);
  }
  assert.equal(asProjectId("\uFFFD").length, 1);
});

test("the digest handed back is the digest function applied to the canonical bytes", () => {
  const sealed = accepted(report("Pass", [row("out/a")], [row("log/a")]));
  assert.equal(sealed.digest, digestOf(canonicalResultManifest(sealed)));
});

test("a digest function answering with something else is refused rather than stored", () => {
  assert.throws(
    () =>
      acceptResultManifest(
        binding,
        manifestId,
        report("Pass", []),
        () => "nope",
      ),
    RangeError,
  );
});

test("the model-grain fold is positive, bounded and reads the digest's leading characters", () => {
  const lowest = asArtifactDigest("0".repeat(64));
  const highest = asArtifactDigest("f".repeat(64));
  assert.equal(resultDigestFold(lowest), 1);
  assert.equal(
    resultDigestFold(highest),
    Number.parseInt("f".repeat(resultDigestFoldHexChars), 16) + 1,
  );
  assert.ok(Number.isSafeInteger(resultDigestFold(highest)));
  assert.ok(resultDigestFold(highest) < Number.MAX_SAFE_INTEGER);
  assert.equal(
    resultDigestFold(asArtifactDigest(digestFor("out/a"))) >= 1,
    true,
  );
});

test("the trusted doors refuse exactly what the untrusted one refuses", () => {
  assert.throws(() => asArtifactPath("../escape"), RangeError);
  assert.throws(() => asArtifactPath("/absolute"), RangeError);
  assert.throws(() => asArtifactDigest("NOTHEX"), RangeError);
  assert.throws(() => asResultManifestId(""), RangeError);
  assert.equal(asArtifactPath("out/a"), "out/a");
  assert.equal(asArtifactDigest(digestFor("out/a")), digestFor("out/a"));
});
