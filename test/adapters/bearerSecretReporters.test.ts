/**
 * The `BearerSecret` scheme against real files: what a request must present to
 * be its reporter's, and every way a file can hold no secret.
 *
 * THE NEGATIVE SPACE IS THE POINT. A file that holds nothing must verify
 * nobody rather than whoever presents nothing, a file bigger than a secret may
 * be must be refused rather than truncated into a different one, and a secret
 * must be read afresh for every request rather than remembered from the first.
 */

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";

import { bearerSecretReporters } from "../../src/adapters/reporters/bearerSecret.ts";
import { reporterSecretBytesMax } from "../../src/adapters/reporters/secretFile.ts";
import type {
  ActionReportRequest,
  ActionReportSaid,
} from "../../src/interpreter/actionReport.ts";
import { asGitObjectId } from "../../src/interpreter/finalizer.ts";

const secret = "s3cr3t-a1b2c3";
const commit = "a".repeat(40);
const said: ActionReportSaid = {
  said: "Report",
  report: { commit: asGitObjectId(commit), outcome: "Succeeded" },
};

function directory(t: TestContext): string {
  const made = mkdtempSync(join(tmpdir(), "chuggy-reporters-"));
  t.after(() => {
    rmSync(made, { recursive: true, force: true });
  });
  return made;
}

/** A file holding what a case writes, in a directory of the case's own. */
function fileHolding(t: TestContext, held: string | Uint8Array): string {
  const path = join(directory(t), "token");
  writeFileSync(path, held);
  return path;
}

const document = JSON.stringify({ version: 1, commit, outcome: "Succeeded" });

/** One report of the action, carrying the authorization and the body a case chooses. */
function request(
  authorization: string | readonly string[] | undefined,
  body: string | Uint8Array = document,
): ActionReportRequest {
  return {
    tenant: "vteng",
    project: "chuggy",
    action: "publish",
    headers: authorization === undefined ? {} : { authorization },
    body: typeof body === "string" ? new TextEncoder().encode(body) : body,
  };
}

function asked(
  path: string,
  authorization: string | readonly string[] | undefined,
): Promise<ActionReportSaid | undefined> {
  return bearerSecretReporters().said(path, request(authorization));
}

test("a request presenting the file's secret as a bearer says what its document says", async (t) => {
  const path = fileHolding(t, secret);
  assert.deepEqual(await asked(path, `Bearer ${secret}`), said);
  assert.deepEqual(await asked(path, `bearer ${secret}`), said);
});

test("a verified request says what its document says, each field it leaves out left out", async (t) => {
  const path = fileHolding(t, secret);
  assert.deepEqual(
    await bearerSecretReporters().said(
      path,
      request(
        `Bearer ${secret}`,
        JSON.stringify({
          version: 1,
          commit: "b".repeat(64),
          outcome: "Failed",
          observedAt: "2026-10-05T22:45:50.250+02:00",
          detail: "run chuggy-release-x7k2p",
          link: "https://grafana.example.test/d/release",
        }),
      ),
    ),
    {
      said: "Report",
      report: {
        commit: "b".repeat(64),
        outcome: "Failed",
        observedAtMs: Date.UTC(2026, 9, 5, 20, 45, 50, 250),
        detail: "run chuggy-release-x7k2p",
        link: "https://grafana.example.test/d/release",
      },
    },
  );
});

test("a verified request whose body is not the document is refused rather than unverified", async (t) => {
  const path = fileHolding(t, secret);
  const text = (written: string) => new TextEncoder().encode(written);
  for (const [why, body] of [
    ["no bytes", ""],
    ["cut short", document.slice(0, -1)],
    ["two documents", `${document}${document}`],
    ["a list", `[${document}]`],
    ["null", "null"],
    ["a field too many", document.replace("}", ',"action":"publish"}')],
    ["no outcome", JSON.stringify({ version: 1, commit })],
    ["a commit that is no object", document.replace(commit, "main")],
    [
      "bytes that are not text",
      Uint8Array.from([
        ...text(document.replace("}", ',"detail":"')),
        0xff,
        ...text('"}'),
      ]),
    ],
  ] as const)
    assert.deepEqual(
      await bearerSecretReporters().said(
        path,
        request(`Bearer ${secret}`, body),
      ),
      { said: "Refused" },
      why,
    );
});

test("a request presenting anything but the secret is not the reporter's", async (t) => {
  const path = fileHolding(t, secret);
  for (const authorization of [
    undefined,
    "",
    "Bearer",
    "Bearer ",
    `Bearer ${secret}x`,
    `Bearer ${secret.slice(0, -1)}`,
    `Bearer x${secret}`,
    `Bearer ${secret.toUpperCase()}`,
    `Bearer ${secret} ${secret}`,
    `Bearer  ${secret}`,
    `Basic ${secret}`,
    `NotBearer ${secret}`,
    secret,
    [`Bearer ${secret}`],
    [`Bearer ${secret}`, `Bearer ${secret}`],
  ])
    assert.equal(
      await asked(path, authorization),
      undefined,
      JSON.stringify(authorization),
    );
});

test("a bearer is one token, so a secret written with a blank inside it is one nobody presents", async (t) => {
  const path = fileHolding(t, "two words\n");
  for (const authorization of [
    "Bearer two words",
    "Bearer two",
    "Bearer words",
  ])
    assert.equal(await asked(path, authorization), undefined, authorization);
});

test("the blanks around a file's secret are not part of it", async (t) => {
  for (const held of [`${secret}\n`, `  ${secret}\r\n`, `\n${secret}\t`]) {
    const path = fileHolding(t, held);
    assert.deepEqual(await asked(path, `Bearer ${secret}`), said, held);
  }
});

test("a file that holds no secret verifies nobody, whatever is presented", async (t) => {
  const root = directory(t);
  const folder = join(root, "folder");
  mkdirSync(folder);
  for (const [path, why] of [
    [join(root, "absent"), "absent"],
    [folder, "not a file"],
    [fileHolding(t, ""), "empty"],
    [fileHolding(t, "\n"), "a line end"],
    [fileHolding(t, " \t\r\n "), "blanks"],
  ] as const)
    for (const authorization of [
      undefined,
      "Bearer",
      "Bearer ",
      "Bearer \n",
      `Bearer ${secret}`,
    ])
      assert.equal(
        await asked(path, authorization),
        undefined,
        `${why}: ${JSON.stringify(authorization)}`,
      );
});

test("a file is read to the bound a secret may be and refused past it", async (t) => {
  const atBound = "s".repeat(reporterSecretBytesMax);
  assert.deepEqual(
    await asked(fileHolding(t, atBound), `Bearer ${atBound}`),
    said,
  );
  const past = `${atBound}s`;
  for (const presented of [past, atBound])
    assert.equal(
      await asked(fileHolding(t, past), `Bearer ${presented}`),
      undefined,
      String(presented.length),
    );
  assert.equal(
    await asked(fileHolding(t, `${atBound}\n`), `Bearer ${atBound}`),
    undefined,
    "a line end past the bound is past the bound",
  );
});

test("a secret is compared as the bytes it is written in", async (t) => {
  const written = Buffer.from("pässword-\u{1F511}", "utf8");
  const path = fileHolding(t, written);
  assert.deepEqual(
    await asked(path, `Bearer ${written.toString("latin1")}`),
    said,
  );
  assert.equal(await asked(path, "Bearer pässword-\u{1F511}"), undefined);
});

test("a secret is read for each request: one that arrives verifies, one that changes or goes stops", async (t) => {
  const path = join(directory(t), "token");
  const reporters = bearerSecretReporters();
  const presenting = (presented: string) =>
    reporters.said(path, request(`Bearer ${presented}`));

  assert.equal(await presenting(secret), undefined);
  writeFileSync(path, secret);
  assert.deepEqual(await presenting(secret), said);
  writeFileSync(path, "rotated-d4e5f6");
  assert.equal(await presenting(secret), undefined);
  assert.deepEqual(await presenting("rotated-d4e5f6"), said);
  rmSync(path);
  assert.equal(await presenting("rotated-d4e5f6"), undefined);
});
