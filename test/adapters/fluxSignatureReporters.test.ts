/**
 * The `FluxSignature` scheme against real files and a clock each case sets:
 * every term a request is verified by, taken one at a time, and what a
 * verified event is read as.
 *
 * EVERY EVENT HERE IS WRITTEN AND SIGNED BY ITS CASE, so one term can be wrong
 * while every other holds. What Flux itself sent is the suite of deliveries.
 *
 * NO CASE READS THIS MACHINE'S CLOCK. The scheme is handed an instant, and an
 * event is as far from it as its case says.
 */

import assert from "node:assert/strict";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test, type TestContext } from "node:test";

import {
  fluxSignatureReporters,
  fluxSignatureToleranceSecs,
} from "../../src/adapters/reporters/fluxSignature.ts";
import {
  actionReportDetailCharsMax,
  actionReportLinkCharsMax,
  isActionReportLink,
} from "../../src/contract/actionReport.ts";
import { isBoundedText, textCodePointsCount } from "../../src/contract/http.ts";
import type {
  ActionReport,
  ActionReportRequest,
  ActionReportSaid,
} from "../../src/interpreter/actionReport.ts";
import { asGitObjectId } from "../../src/interpreter/finalizer.ts";
import { fluxDeliverySignature, fluxKeyFile } from "./fluxDeliveryFixtures.ts";

const key = "k3y-a1b2c3";
const nowMs = Date.UTC(2026, 9, 5, 22, 45, 50);
const toleranceMs = fluxSignatureToleranceSecs * 1_000;
const commit = "5c720e5ca64a2fc7cda1bd8b9b2e72132353eac6";
const elsewhere = "9dad53825aeca52f6a0add96c36e97be747047e5";
const revision = `1791240292.0.0@sha256:${"5d".repeat(32)}`;
const message = "Reconciliation finished in 5.1s, next run in 5m0s";

type Fields = Readonly<Record<string, unknown>>;

/** A Kustomization's reconciliation succeeding at the suite's instant, each field a case names changed and each it names as nothing left out. */
function event(fields: Fields = {}, metadata: Fields = {}): string {
  return JSON.stringify({
    involvedObject: { kind: "Kustomization", name: "chuggy" },
    severity: "info",
    timestamp: new Date(nowMs).toISOString(),
    message,
    reason: "ReconciliationSucceeded",
    metadata: { originRevision: `main@sha1:${commit}`, revision, ...metadata },
    reportingController: "kustomize-controller",
    ...fields,
  });
}

/** The report of the suite's event with nothing describing it. */
function undescribed(outcome: ActionReport["outcome"]): ActionReport {
  return { commit: asGitObjectId(commit), outcome, observedAtMs: nowMs };
}

function reportOf(changed: Partial<ActionReport> = {}): ActionReportSaid {
  return {
    said: "Report",
    report: { ...undescribed("Succeeded"), detail: revision, ...changed },
  };
}

const succeeded = reportOf();
const failed = reportOf({ outcome: "Failed", detail: message });

function bytes(written: string | Uint8Array): Uint8Array {
  return typeof written === "string"
    ? new TextEncoder().encode(written)
    : written;
}

/** One request to the action, carrying the body and the signature header a case chooses. */
function request(
  body: string | Uint8Array,
  signature: string | readonly string[] | undefined,
): ActionReportRequest {
  return {
    tenant: "vteng",
    project: "chuggy",
    action: "rig",
    headers: signature === undefined ? {} : { "x-signature": signature },
    body: bytes(body),
  };
}

/** What the scheme makes of a body signed under `signedWith`, read at `atMs` against the key file at `path`. */
function asked(
  path: string,
  body: string | Uint8Array,
  signedWith: string | Uint8Array = key,
  atMs: number = nowMs,
): Promise<ActionReportSaid | undefined> {
  return fluxSignatureReporters(() => atMs).said(
    path,
    request(body, fluxDeliverySignature(bytes(body), signedWith)),
  );
}

/** What the scheme makes of an event under the suite's key and at its instant. */
function read(
  t: TestContext,
  written: string | Uint8Array,
): Promise<ActionReportSaid | undefined> {
  return asked(fluxKeyFile(t, key), written);
}

test("a request signed as Flux signs, under the file's key, says what its event says", async (t) => {
  assert.deepEqual(await read(t, event()), succeeded);
});

test("a signature is `sha256=` and the digest in lower-case hex, written no other way and presented once", async (t) => {
  const path = fluxKeyFile(t, key);
  const body = event();
  const signature = fluxDeliverySignature(bytes(body), key);
  const hex = signature.slice("sha256=".length);
  assert.match(hex, /[a-f]/u);
  const presenting = (presented: string | readonly string[] | undefined) =>
    fluxSignatureReporters(() => nowMs).said(path, request(body, presented));

  assert.deepEqual(await presenting(signature), succeeded);
  for (const presented of [
    undefined,
    "",
    "sha256=",
    hex,
    `=${hex}`,
    `SHA256=${hex}`,
    `sha1=${hex}`,
    `sha512=${hex}`,
    `sha256:${hex}`,
    `sha256 ${hex}`,
    `sha256==${hex}`,
    ` ${signature}`,
    `${signature} `,
    `${signature}\n`,
    `x${signature}`,
    `sha256=${hex.toUpperCase()}`,
    `sha256=${hex.slice(0, -1)}`,
    `sha256=${hex}0`,
    `sha256=${hex}${hex}`,
    `sha256=${hex.slice(0, -1)}g`,
    `sha256=0x${hex.slice(2)}`,
    `sha256=${Buffer.from(hex, "hex").toString("base64")}`,
    `${signature}, ${signature}`,
    [signature],
    [signature, signature],
  ])
    assert.equal(
      await presenting(presented),
      undefined,
      JSON.stringify(presented),
    );
});

test("a signature is of its own body under the file's key: another body's, or another key's, is nobody's", async (t) => {
  const path = fluxKeyFile(t, key);
  const body = event();
  const signature = fluxDeliverySignature(bytes(body), key);
  const scheme = fluxSignatureReporters(() => nowMs);
  const flipped = `${signature.slice(0, -1)}${signature.endsWith("0") ? "1" : "0"}`;

  assert.equal(await scheme.said(path, request(body, flipped)), undefined);
  for (const other of [`${body} `, ` ${body}`, body.slice(0, -1), ""])
    assert.equal(
      await scheme.said(path, request(other, signature)),
      undefined,
      JSON.stringify(other).slice(0, 40),
    );
  for (const signedWith of [`${key}x`, key.slice(0, -1), key.toUpperCase()])
    assert.equal(await asked(path, body, signedWith), undefined, signedWith);
});

/** Each character Unicode calls white space, which is each Go's `unicode.IsSpace` holds. */
const whiteSpace = Array.from({ length: 0x110000 }, (_, point) => point)
  .filter((point) => point < 0xd800 || point > 0xdfff)
  .map((point) => String.fromCodePoint(point))
  .filter((char) => /^\p{White_Space}$/u.test(char));

test("the white space at a key's two ends is no part of it, as it is none of the key Flux signs with", async (t) => {
  assert.ok(whiteSpace.includes(String.fromCodePoint(0x85)));
  for (const blank of whiteSpace)
    for (const held of [
      `${blank}${key}`,
      `${key}${blank}`,
      `${blank}${blank}${key}${blank}${blank}`,
      ` ${blank}\n${key}\t${blank}\r\n`,
    ]) {
      const path = fluxKeyFile(t, held);
      const point = (blank.codePointAt(0) ?? 0).toString(16);
      assert.deepEqual(await asked(path, event(), key), succeeded, point);
      assert.equal(await asked(path, event(), held), undefined, point);
    }
});

test("white space inside a key is part of it, and so is each byte at its end that only resembles white space", async (t) => {
  const inside = fluxKeyFile(t, " two\twords \n");
  assert.deepEqual(await asked(inside, event(), "two\twords"), succeeded);
  for (const signedWith of ["twowords", "two words", "two", "words"])
    assert.equal(await asked(inside, event(), signedWith), undefined);

  const within = Buffer.from(key);
  for (const resembling of [
    [0x1c],
    [0x1f],
    [0x7f],
    [0x85],
    [0xa0],
    [0xc2],
    [0xe2, 0x80],
    [0xc0, 0xa0],
    [...Buffer.from(String.fromCodePoint(0x180e))],
    [...Buffer.from(String.fromCodePoint(0x200b))],
    [...Buffer.from(String.fromCodePoint(0x2060))],
    [...Buffer.from(String.fromCodePoint(0xfeff))],
  ])
    for (const written of [
      Buffer.from([...within, ...resembling]),
      Buffer.from([...resembling, ...within]),
    ]) {
      const path = fluxKeyFile(
        t,
        Buffer.concat([Buffer.from("\n"), written, Buffer.from("\n")]),
      );
      const hex = written.toString("hex");
      assert.deepEqual(await asked(path, event(), written), succeeded, hex);
      assert.equal(await asked(path, event(), within), undefined, hex);
    }
});

test("a file holding no key verifies nobody, whatever a request is signed with", async (t) => {
  const absent = fluxKeyFile(t, "");
  rmSync(absent);
  const folder = join(dirname(fluxKeyFile(t, "")), "folder");
  mkdirSync(folder);
  for (const [path, held, why] of [
    [absent, "", "absent"],
    [folder, "", "not a file"],
    [fluxKeyFile(t, ""), "", "empty"],
    [fluxKeyFile(t, "\n"), "\n", "a line end"],
    [fluxKeyFile(t, " \t\r\n "), " \t\r\n ", "blanks"],
    [fluxKeyFile(t, whiteSpace.join("")), whiteSpace.join(""), "white space"],
  ] as const)
    for (const signedWith of ["", held, key])
      assert.equal(
        await asked(path, event(), signedWith),
        undefined,
        `${why}: signed with ${JSON.stringify(signedWith)}`,
      );
});

test("an event's timestamp stands within the tolerance of the clock, on either side, or its request is nobody's", async (t) => {
  const path = fluxKeyFile(t, key);
  const progressing = event({ reason: "Progressing" });
  for (const [atMs, verifies] of [
    [nowMs, true],
    [nowMs + toleranceMs, true],
    [nowMs + toleranceMs + 1, false],
    [nowMs - toleranceMs, true],
    [nowMs - toleranceMs - 1, false],
    [Number.NaN, false],
    [Number.POSITIVE_INFINITY, false],
  ] as const) {
    assert.deepEqual(
      await asked(path, event(), key, atMs),
      verifies ? succeeded : undefined,
      String(atMs - nowMs),
    );
    assert.deepEqual(
      await asked(path, progressing, key, atMs),
      verifies ? { said: "Ignored" } : undefined,
      `an event that is ignored, ${String(atMs - nowMs)}`,
    );
  }
});

test("an event states when it happened as an instant with an offset, which is what its report is observed at", async (t) => {
  for (const [timestamp, observedAtMs] of [
    ["2026-10-05T22:45:50Z", nowMs],
    ["2026-10-06T00:45:50+02:00", nowMs],
    ["2026-10-05T22:45:50.250Z", nowMs + 250],
    ["2026-10-05T22:44:10Z", nowMs - 100_000],
  ] as const)
    assert.deepEqual(
      await read(t, event({ timestamp })),
      reportOf({ observedAtMs }),
      timestamp,
    );
});

test("a signed body that states no instant is not verified, whatever else it says", async (t) => {
  for (const timestamp of [
    undefined,
    null,
    nowMs,
    "",
    "now",
    "2026-10-05",
    "2026-10-05T22:45:50",
    "2026-10-05 22:45:50Z",
    "2026-02-30T22:45:50Z",
    [new Date(nowMs).toISOString()],
  ])
    for (const reason of ["ReconciliationSucceeded", "Progressing"])
      assert.equal(
        await read(t, event({ timestamp, reason })),
        undefined,
        `${JSON.stringify(timestamp)} ${reason}`,
      );
  for (const body of [
    "",
    "null",
    "[]",
    `[${event()}]`,
    JSON.stringify(event()),
    event().slice(0, -1),
    Uint8Array.from([...bytes(event().slice(0, -1)), 0xff, 0x7d]),
  ])
    assert.equal(await read(t, body), undefined, body.toString().slice(0, 40));
});

test("a Kustomization that reconciled succeeded, described by the revision it applied", async (t) => {
  assert.deepEqual(await read(t, event()), succeeded);
  for (const absent of [undefined, null, 7, { digest: revision }])
    assert.deepEqual(
      await read(t, event({}, { revision: absent })),
      { said: "Report", report: undescribed("Succeeded") },
      JSON.stringify(absent),
    );
});

test("a Kustomization's error failed, whatever its reason, described by its message", async (t) => {
  for (const reason of [
    "HealthCheckFailed",
    "ReconciliationFailed",
    "BuildFailed",
    "ArtifactFailed",
    "DependencyNotReady",
    "ReconciliationSucceeded",
    "",
    undefined,
    7,
  ])
    assert.deepEqual(
      await read(t, event({ severity: "error", reason })),
      failed,
      JSON.stringify(reason),
    );
  assert.deepEqual(
    await read(t, event({ severity: "error", message: undefined })),
    { said: "Report", report: undescribed("Failed") },
  );
});

test("every other event is ignored, and is asked for no commit", async (t) => {
  const kustomization = { kind: "Kustomization" };
  for (const [involvedObject, severity, reason] of [
    [kustomization, "info", "Progressing"],
    [kustomization, "info", "DependencyNotReady"],
    [kustomization, "info", "reconciliationsucceeded"],
    [kustomization, "info", "ReconciliationSucceeded "],
    [kustomization, "info", undefined],
    [kustomization, "info", 7],
    [kustomization, "Info", "ReconciliationSucceeded"],
    [kustomization, "warning", "ReconciliationSucceeded"],
    [kustomization, "trace", "ReconciliationSucceeded"],
    [kustomization, undefined, "ReconciliationSucceeded"],
    [kustomization, "ERROR", "HealthCheckFailed"],
    [kustomization, "errors", "HealthCheckFailed"],
    [kustomization, 3, "HealthCheckFailed"],
    [{ kind: "kustomization" }, "info", "ReconciliationSucceeded"],
    [{ kind: "HelmRelease" }, "info", "ReconciliationSucceeded"],
    [{ kind: "HelmRelease" }, "error", "UpgradeFailed"],
    [{ kind: "OCIRepository" }, "info", "NewArtifact"],
    [{ kind: "GitRepository" }, "error", "GitOperationFailed"],
    [{ kind: ["Kustomization"] }, "info", "ReconciliationSucceeded"],
    [{ name: "chuggy" }, "info", "ReconciliationSucceeded"],
    ["Kustomization", "info", "ReconciliationSucceeded"],
    [undefined, "error", "HealthCheckFailed"],
  ] as const)
    for (const originRevision of [`main@sha1:${commit}`, undefined])
      assert.deepEqual(
        await read(
          t,
          event({ involvedObject, severity, reason }, { originRevision }),
        ),
        { said: "Ignored" },
        JSON.stringify([involvedObject, severity, reason, originRevision]),
      );
});

test("the commit is the one the origin revision ends in after `sha1:`, behind a pointer's name or alone, and is looked for nowhere else", async (t) => {
  const named = `main@sha1:${elsewhere}`;
  const alone = `sha1:${elsewhere}`;
  const quoting = `stored artifact, origin revision '${named}'`;
  for (const severity of ["info", "error"]) {
    const outcome = severity === "info" ? succeeded : failed;
    for (const originRevision of [
      `main@sha1:${commit}`,
      `refs/tags/v1.2.3@sha1:${commit}`,
      `feature/a@b@sha1:${commit}`,
      `main@sha1:${elsewhere}@sha1:${commit}`,
      `@sha1:${commit}`,
      `sha1:${commit}`,
      `sha1:${elsewhere}@sha1:${commit}`,
    ])
      assert.deepEqual(
        await read(t, event({ severity }, { originRevision })),
        outcome,
        originRevision,
      );
    for (const [fields, metadata] of [
      [{ message: quoting }, {}],
      [{ message: named }, {}],
      [{ message: alone }, {}],
      [{}, { revision: named }],
      [{}, { revision: alone }],
      [{}, { "kustomize.toolkit.fluxcd.io/originRevision": named }],
      [{}, { OriginRevision: named, origin_revision: named }],
      [{ originRevision: named, revision: named }, {}],
      [
        { involvedObject: { kind: "Kustomization", originRevision: named } },
        {},
      ],
    ] as const) {
      assert.deepEqual(
        await read(
          t,
          event(
            { severity, ...fields },
            { originRevision: undefined, ...metadata },
          ),
        ),
        { said: "Refused" },
        `no origin revision: ${JSON.stringify([fields, metadata])}`,
      );
      const beside = await read(t, event({ severity, ...fields }, metadata));
      assert.equal(
        beside?.said === "Report" ? beside.report.commit : undefined,
        commit,
        `beside the origin revision: ${JSON.stringify([fields, metadata])}`,
      );
    }
  }
});

test("an outcome whose origin revision names no commit after a `sha1:` at its start or behind an `@` is refused", async (t) => {
  for (const originRevision of [
    undefined,
    null,
    7,
    "",
    "main",
    commit,
    `main:${commit}`,
    `main/sha1:${commit}`,
    `mainsha1:${commit}`,
    `main-sha1:${commit}`,
    `main.sha1:${commit}`,
    `main:sha1:${commit}`,
    `main@ sha1:${commit}`,
    ` sha1:${commit}`,
    `\nsha1:${commit}`,
    `main\nsha1:${commit}`,
    `sha1:${commit.slice(0, -1)}`,
    `sha1:${commit}0`,
    `sha1:${commit.toUpperCase()}`,
    `SHA1:${commit}`,
    `sha256:${commit}${commit.slice(0, 24)}`,
    `sha1:${commit}\n`,
    `sha1:${commit} `,
    `sha1: ${commit}`,
    `sha1${commit}`,
    `main@${commit}`,
    `main@sha1:${commit.slice(0, -1)}`,
    `main@sha1:${commit}0`,
    `main@sha1:${commit.toUpperCase()}`,
    `main@sha1:${commit.slice(0, -1)}g`,
    `main@SHA1:${commit}`,
    `main@sha256:${commit}${commit.slice(0, 24)}`,
    `main@sha1:${commit}\n`,
    `main@sha1:${commit} `,
    `main@sha1:${commit}/`,
    `main@sha1:${commit}@`,
    `main@sha1: ${commit}`,
    [`main@sha1:${commit}`],
  ])
    for (const severity of ["info", "error"])
      assert.deepEqual(
        await read(t, event({ severity }, { originRevision })),
        { said: "Refused" },
        `${severity} ${JSON.stringify(originRevision)}`,
      );
  for (const metadata of [undefined, null, "", `main@sha1:${commit}`, [], 7]) {
    assert.deepEqual(
      await read(t, event({ metadata })),
      { said: "Refused" },
      `metadata ${JSON.stringify(metadata)}`,
    );
    assert.deepEqual(
      await read(t, event({ metadata, reason: "Progressing" })),
      { said: "Ignored" },
      `metadata ${JSON.stringify(metadata)} of an event no outcome is read in`,
    );
  }
});

const replacement = String.fromCodePoint(0xfffd);
const nul = String.fromCodePoint(0);
const high = String.fromCharCode(0xd83d);
const low = String.fromCharCode(0xde80);
const astral = String.fromCodePoint(0x1f680);

/** The detail a failing event described by `described` is recorded with, or nothing where it is recorded with none. */
async function detailOf(
  t: TestContext,
  described: string,
): Promise<string | undefined> {
  const said = await read(t, event({ severity: "error", message: described }));
  assert.equal(said?.said, "Report");
  return said?.said === "Report" ? said.report.detail : undefined;
}

test("a detail is cut to the bound a row holds, counted in characters and never through one", async (t) => {
  const bound = actionReportDetailCharsMax;
  for (const [described, held] of [
    ["x".repeat(bound), "x".repeat(bound)],
    ["x".repeat(bound + 1), "x".repeat(bound)],
    [astral.repeat(bound), astral.repeat(bound)],
    [astral.repeat(bound + 1), astral.repeat(bound)],
    [`${"x".repeat(bound - 1)}${astral}y`, `${"x".repeat(bound - 1)}${astral}`],
    [`${"x".repeat(bound)}${astral}`, "x".repeat(bound)],
    [astral.repeat(4 * bound), astral.repeat(bound)],
    [nul.repeat(bound + 1), replacement.repeat(bound)],
    [high.repeat(bound + 1), replacement.repeat(bound)],
  ] as const) {
    const detail = await detailOf(t, described);
    assert.equal(detail, held, `${String(described.length)} units`);
    assert.equal(textCodePointsCount(detail ?? ""), bound);
    assert.ok(isBoundedText(detail ?? "", bound));
  }
  const cut = reportOf({ detail: "5".repeat(bound) });
  assert.deepEqual(
    await read(t, event({}, { revision: "5".repeat(bound + 1) })),
    cut,
    "a revision is cut as a message is",
  );
});

test("a detail holds nothing a text column cannot: a NUL, an unpaired surrogate and a byte that is no text are each replaced", async (t) => {
  for (const [described, held] of [
    [`a${nul}b`, `a${replacement}b`],
    [nul, replacement],
    [`${nul}${nul}`, `${replacement}${replacement}`],
    [`a${high}b`, `a${replacement}b`],
    [`a${low}b`, `a${replacement}b`],
    [`a${low}${high}b`, `a${replacement}${replacement}b`],
    [`a${high}`, `a${replacement}`],
    [`${low}a`, `${replacement}a`],
    [`a${astral}b`, `a${astral}b`],
    [`${high}${astral}${low}`, `${replacement}${astral}${replacement}`],
    ["line one\nline two\r\n\tindented", "line one\nline two\r\n\tindented"],
    [" ", " "],
  ] as const) {
    const detail = await detailOf(t, described);
    assert.equal(detail, held, JSON.stringify(described));
    assert.ok(isBoundedText(detail ?? "", actionReportDetailCharsMax));
  }
  assert.equal(await detailOf(t, ""), undefined, "nothing said is no detail");
  const marked = bytes(event({ severity: "error", message: "a~b" }));
  assert.equal(marked.filter((byte) => byte === 0x7e).length, 1);
  assert.deepEqual(
    await read(
      t,
      marked.map((byte) => (byte === 0x7e ? 0xff : byte)),
    ),
    reportOf({ outcome: "Failed", detail: `a${replacement}b` }),
    "a byte no UTF-8 holds",
  );
});

test("a link the one link rule admits is carried, and one it refuses is left out with its report kept", async (t) => {
  const link = "https://grafana.example.test/d/release?orgId=1#panel-4";
  for (const severity of ["info", "error"]) {
    const outcome = severity === "info" ? succeeded : failed;
    assert.ok(outcome.said === "Report");
    assert.deepEqual(await read(t, event({ severity }, { link })), {
      said: "Report",
      report: { ...outcome.report, link },
    });
    for (const refusedLink of [
      "http://grafana.example.test/d/release",
      "https://user:secret@grafana.example.test/",
      "https:///grafana.example.test/",
      "https://grafana.example.test\\@evil.example.test/",
      `https://grafana.example.test/${"d".repeat(actionReportLinkCharsMax)}`,
      `https://grafana.example.test/d/${astral}`,
      "https://grafana.example.test/a b",
      " https://grafana.example.test/",
      "grafana.example.test/d/release",
      "javascript:alert(1)",
      "",
    ]) {
      assert.ok(!isActionReportLink(refusedLink), refusedLink.slice(0, 60));
      assert.deepEqual(
        await read(t, event({ severity }, { link: refusedLink })),
        outcome,
        refusedLink.slice(0, 60),
      );
    }
    for (const unread of [null, 7, [link], { href: link }])
      assert.deepEqual(
        await read(t, event({ severity }, { link: unread })),
        outcome,
        JSON.stringify(unread),
      );
  }
});

test("a key is read for each request: one that arrives verifies, one that changes or goes stops", async (t) => {
  const path = fluxKeyFile(t, "");
  rmSync(path);
  const scheme = fluxSignatureReporters(() => nowMs);
  const signedWith = (signing: string) =>
    scheme.said(
      path,
      request(event(), fluxDeliverySignature(bytes(event()), signing)),
    );

  assert.equal(await signedWith(key), undefined);
  writeFileSync(path, `${key}\n`);
  assert.deepEqual(await signedWith(key), succeeded);
  writeFileSync(path, "rotated-d4e5f6\n");
  assert.equal(await signedWith(key), undefined);
  assert.deepEqual(await signedWith("rotated-d4e5f6"), succeeded);
  rmSync(path);
  assert.equal(await signedWith("rotated-d4e5f6"), undefined);
});
