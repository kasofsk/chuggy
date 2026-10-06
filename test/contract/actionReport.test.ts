import assert from "node:assert/strict";
import test from "node:test";

import {
  actionReportDetailCharsMax,
  actionReportDocumentSchema,
  actionReportInstantCharsMax,
  actionReportLinkCharsMax,
  actionReportResponseSchema,
  actionReportVersion,
  allActionReportOutcomes,
  allActionReportResults,
  isActionReportLink,
} from "../../src/contract/actionReport.ts";

const least = {
  version: actionReportVersion,
  commit: "a".repeat(40),
  outcome: "Succeeded",
};

const whole = {
  ...least,
  observedAt: "2026-10-05T22:45:50Z",
  detail: "run chuggy-release-x7k2p",
  link: "https://grafana.example.test/d/release?var-run=x7k2p",
};

function admitted(value: unknown): boolean {
  return actionReportDocumentSchema.safeParse(value).success;
}

/** A link of exactly `chars` characters. */
function linkOf(chars: number): string {
  return "https://example.test/".padEnd(chars, "x");
}

test("a report says a commit and an outcome, and may say when, what and where to read more", () => {
  assert.deepEqual(actionReportDocumentSchema.parse(least), least);
  assert.deepEqual(actionReportDocumentSchema.parse(whole), whole);
});

test("a field the document has no place for is refused rather than dropped", () => {
  for (const extra of [
    { action: "build" },
    { reporter: "rig-build" },
    { receivedAt: "2026-10-05T22:45:50Z" },
    { ordinal: 1 },
  ])
    assert.equal(
      admitted({ ...whole, ...extra }),
      false,
      JSON.stringify(extra),
    );
});

test("a report without its version, its commit or its outcome is refused, and each optional field may be left out", () => {
  for (const field of ["version", "commit", "outcome"] as const) {
    const rest: Record<string, unknown> = { ...whole };
    delete rest[field];
    assert.equal(admitted(rest), false, field);
  }
  for (const field of ["observedAt", "detail", "link"] as const) {
    const rest: Record<string, unknown> = { ...whole };
    delete rest[field];
    assert.equal(admitted(rest), true, field);
    assert.equal(admitted({ ...whole, [field]: null }), false, field);
  }
});

test("only the one version is read", () => {
  for (const version of [0, 2, "1", null])
    assert.equal(admitted({ ...least, version }), false, String(version));
});

test("a commit is an object id at either width git writes one, in lower case", () => {
  for (const commit of ["a".repeat(40), "0123456789abcdef".repeat(4)])
    assert.equal(admitted({ ...least, commit }), true, commit);
  for (const commit of [
    "a".repeat(39),
    "a".repeat(41),
    "a".repeat(63),
    "a".repeat(65),
    "A".repeat(40),
    "g".repeat(40),
    `${"a".repeat(40)}\n`,
    ` ${"a".repeat(40)}`,
    "main",
    "",
  ])
    assert.equal(admitted({ ...least, commit }), false, commit);
});

test("an outcome is one of the two a reporter can say", () => {
  assert.deepEqual(allActionReportOutcomes, ["Succeeded", "Failed"]);
  for (const outcome of allActionReportOutcomes)
    assert.equal(admitted({ ...least, outcome }), true, outcome);
  for (const outcome of ["RolledBack", "succeeded", "Unknown", "", null, true])
    assert.equal(admitted({ ...least, outcome }), false, String(outcome));
});

test("an instant states its offset and is bounded", () => {
  const fraction = (digits: number) =>
    `2026-10-05T22:45:50.${"1".repeat(digits)}Z`;
  const atBound = actionReportInstantCharsMax - fraction(0).length;
  for (const observedAt of [
    "2026-10-05T22:45:50Z",
    "2026-10-05T22:45:50.250Z",
    "2026-10-05T22:45:50+02:00",
    "2026-10-05T22:45:50-00:00",
    fraction(atBound),
  ])
    assert.equal(admitted({ ...least, observedAt }), true, observedAt);
  for (const observedAt of [
    "2026-10-05T22:45:50",
    "2026-10-05 22:45:50Z",
    "2026-10-05",
    "2023-02-29T00:00:00Z",
    "2026-10-05T24:00:00Z",
    "yesterday",
    "",
    1_791_240_350_000,
    fraction(atBound + 1),
  ])
    assert.equal(admitted({ ...least, observedAt }), false, String(observedAt));
});

test("every instant a report may state is one a clock can be read from", () => {
  for (const observedAt of [
    "0000-01-01T00:00:00Z",
    "9999-12-31T23:59:59.999Z",
    "2024-02-29T00:00:00+23:59",
    "2026-10-05T22:45:50.1+14:00",
  ]) {
    assert.equal(admitted({ ...least, observedAt }), true, observedAt);
    assert.ok(Number.isFinite(Date.parse(observedAt)), observedAt);
  }
});

test("a detail is text a row can hold, to its bound", () => {
  const astral = "\u{1F680}";
  for (const detail of ["x", astral.repeat(actionReportDetailCharsMax)])
    assert.equal(admitted({ ...least, detail }), true);
  for (const detail of [
    "",
    "x".repeat(actionReportDetailCharsMax + 1),
    astral.repeat(actionReportDetailCharsMax + 1),
    "a\u0000b",
    "a\ud800b",
    7,
  ])
    assert.equal(admitted({ ...least, detail }), false);
});

const linksAdmitted = [
  "https://x",
  "https://grafana.example.test/d/release?var-run=x7k2p&from=now-1h#panel-2",
  "https://example.test:8443/a/@run",
  "https://example.test?at=@",
  "https://example.test#@",
  'https://example.test/a%20run/{"x":1}|~',
  linkOf(actionReportLinkCharsMax),
];

test("a link is https, bounded, written as it travels and carries no credential", () => {
  for (const link of linksAdmitted) {
    assert.equal(isActionReportLink(link), true, link.slice(0, 80));
    assert.equal(admitted({ ...least, link }), true, link.slice(0, 80));
  }
  for (const link of [
    linkOf(actionReportLinkCharsMax + 1),
    "http://example.test/",
    "HTTPS://example.test/",
    "ftp://example.test/",
    "example.test/run",
    "//example.test/run",
    "javascript:alert(1)",
    "https://",
    "",
    "https://example.test/a run",
    "https://example.test/é",
    "https://example.test/\n",
    " https://example.test/",
    "https://example.test/\u007f",
    "https://user@example.test/",
    "https://user:secret@example.test/",
    "https://:secret@example.test/",
    "https://@example.test/",
    "https://example.test\\@elsewhere.test/",
    "https://[",
    "https://%zz/",
    "https://:443/",
  ]) {
    assert.equal(isActionReportLink(link), false, link.slice(0, 80));
    assert.equal(admitted({ ...least, link }), false, link.slice(0, 80));
  }
});

test("no link a report may carry reads as holding a credential", () => {
  for (const link of linksAdmitted) {
    const read = new URL(link);
    assert.equal(read.protocol, "https:", link.slice(0, 80));
    assert.equal(read.username + read.password, "", link.slice(0, 80));
  }
});

test("a report is answered as a row or as a repeat of the newest", () => {
  assert.deepEqual(allActionReportResults, ["Recorded", "Repeated"]);
  for (const report of allActionReportResults)
    assert.deepEqual(actionReportResponseSchema.parse({ report }), { report });
  for (const report of ["Undeclared", "NotFound", ""])
    assert.equal(
      actionReportResponseSchema.safeParse({ report }).success,
      false,
      report,
    );
});
