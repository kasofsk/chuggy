/**
 * The held-credentials answer as a pod reads it: a served credential either a
 * bundle of files and variables or the one-secret entry an older worker reads,
 * and the credentials asked for that it does not serve, each with its reason.
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  heldCredentialBundleFileBytesMax,
  heldCredentialBundleFilesMax,
  heldCredentialBundleVariablesMax,
  heldCredentialFilePlaceholder,
  heldCredentialFilesPlaced,
  workerHeldCredentialAbsences,
  workerHeldCredentialBundleSchema,
  workerHeldCredentialsAnswerSchema,
  workerHeldCredentialsMax,
} from "../../src/contract/workerPlane.ts";
import {
  isHeldCredentialValueVariable,
  isIssuedCredential,
  issuedCredentialPrefix,
} from "../../src/contract/workerEnvironment.ts";

const bundle = {
  credential: "chuggy.github",
  files: [
    { file: "token", content: { kind: "Secret", secret: "ghs_s" } },
    {
      file: "hosts.yml",
      content: {
        kind: "Text",
        text: `github.com:\n  oauth_token_file: ${heldCredentialFilePlaceholder("token")}\n`,
      },
    },
  ],
  variables: [
    { kind: "Path", variable: "GH_TOKEN_FILE", file: "token" },
    {
      kind: "Value",
      variable: "GH_CONFIG_DIR",
      value: `${heldCredentialFilePlaceholder("hosts.yml")}/..`,
    },
    { kind: "Value", variable: "GH_HOST", value: "github.com" },
  ],
  expiresAtMs: 1_800_000_000_000,
};

const legacy = {
  credential: "track-record",
  variable: "TRACK_RECORD_TOKEN_FILE",
  secret: "s",
};

test("an answer serves bundles beside the one-secret entry, and names what it does not serve with its reason", () => {
  const answer = {
    credentials: [bundle, legacy],
    absent: workerHeldCredentialAbsences.map((reason, index) => ({
      credential: `absent-${String(index)}`,
      reason,
    })),
  };
  assert.deepEqual(workerHeldCredentialsAnswerSchema.parse(answer), answer);
  const unexpiring = {
    credentials: [
      {
        credential: bundle.credential,
        files: bundle.files,
        variables: bundle.variables,
      },
    ],
  };
  assert.deepEqual(
    workerHeldCredentialsAnswerSchema.parse(unexpiring),
    unexpiring,
  );
});

test("an absence naming a reason outside the roster is refused", () => {
  assert.ok(
    !workerHeldCredentialsAnswerSchema.safeParse({
      credentials: [],
      absent: [{ credential: "x", reason: "Forgotten" }],
    }).success,
  );
});

test("a placeholder names the file it was made for, each in the order the text names them", () => {
  assert.deepEqual(
    heldCredentialFilesPlaced(
      `${heldCredentialFilePlaceholder("a")}:${heldCredentialFilePlaceholder("b.pem")}`,
    ),
    ["a", "b.pem"],
  );
  assert.deepEqual(heldCredentialFilesPlaced("{file:a} {{ file }}"), []);
});

test("a bundle naming a file it does not hold, or one file or variable twice in any case, is refused", () => {
  const refused = [
    {
      ...bundle,
      variables: [{ kind: "Path", variable: "A_FILE", file: "missing" }],
    },
    {
      ...bundle,
      variables: [
        {
          kind: "Value",
          variable: "A",
          value: heldCredentialFilePlaceholder("missing"),
        },
      ],
    },
    {
      ...bundle,
      files: [
        ...bundle.files,
        {
          file: "x",
          content: {
            kind: "Text",
            text: heldCredentialFilePlaceholder("missing"),
          },
        },
      ],
    },
    { ...bundle, files: [...bundle.files, bundle.files[0]] },
    {
      ...bundle,
      files: [
        ...bundle.files,
        { file: "Token", content: { kind: "Secret", secret: "s" } },
      ],
    },
    { ...bundle, variables: [...bundle.variables, bundle.variables[0]] },
    { ...bundle, variables: [] },
  ];
  for (const offered of refused)
    assert.ok(
      !workerHeldCredentialBundleSchema.safeParse(offered).success,
      JSON.stringify(offered),
    );
});

test("a bundle's file is named inside its directory in lower case, never by a path, and never ending in a dot", () => {
  const named = (file: string) =>
    workerHeldCredentialBundleSchema.safeParse({
      ...bundle,
      files: [{ file, content: { kind: "Secret", secret: "s" } }],
      variables: [{ kind: "Path", variable: "A_FILE", file }],
    }).success;
  for (const file of ["a", "9", "hosts.yml", "a_b-c.d0", "x".repeat(64)])
    assert.ok(named(file), file);
  for (const file of [
    "../token",
    "a/b",
    ".hidden",
    "",
    "x".repeat(65),
    "Token",
    "token.",
    "token-",
  ])
    assert.ok(!named(file), file);
});

test("a bundle is held to its bounds on files, variables and the bytes of each file and value", () => {
  const files = (count: number) =>
    Array.from({ length: count }, (_, index) => ({
      file: `f${String(index)}`,
      content: { kind: "Text", text: "" },
    }));
  const variables = (count: number) =>
    Array.from({ length: count }, (_, index) => ({
      kind: "Value",
      variable: `V${String(index)}`,
      value: "",
    }));
  const held = (offered: object) =>
    workerHeldCredentialBundleSchema.safeParse({
      credential: "chuggy.github",
      files: [],
      variables: variables(1),
      ...offered,
    }).success;
  assert.ok(held({ files: files(heldCredentialBundleFilesMax) }));
  assert.ok(!held({ files: files(heldCredentialBundleFilesMax + 1) }));
  assert.ok(held({ variables: variables(heldCredentialBundleVariablesMax) }));
  assert.ok(
    !held({ variables: variables(heldCredentialBundleVariablesMax + 1) }),
  );
  const filled = "\u00e9".repeat(heldCredentialBundleFileBytesMax / 2);
  const file = (content: object) => ({
    files: [{ file: "token", content }],
  });
  assert.ok(held(file({ kind: "Secret", secret: filled })));
  assert.ok(!held(file({ kind: "Secret", secret: `${filled}x` })));
  assert.ok(!held(file({ kind: "Secret", secret: "" })));
  assert.ok(held(file({ kind: "Text", text: filled })));
  assert.ok(!held(file({ kind: "Text", text: `${filled}x` })));
  const value = (text: string) =>
    held({ variables: [{ kind: "Value", variable: "A", value: text }] });
  assert.ok(value(filled));
  assert.ok(!value(`${filled}x`));
});

test("an answer serves and names absent no more credentials than an attempt may ask for", () => {
  const absent = (count: number) =>
    Array.from({ length: count }, () => ({
      credential: "x",
      reason: "NotHeld",
    }));
  const served = (count: number) => Array.from({ length: count }, () => bundle);
  const held = (offered: object) =>
    workerHeldCredentialsAnswerSchema.safeParse({
      credentials: [],
      ...offered,
    }).success;
  assert.ok(held({ absent: absent(workerHeldCredentialsMax) }));
  assert.ok(!held({ absent: absent(workerHeldCredentialsMax + 1) }));
  assert.ok(held({ credentials: served(workerHeldCredentialsMax) }));
  assert.ok(!held({ credentials: served(workerHeldCredentialsMax + 1) }));
});

test("a bundle's path is set under a _FILE variable and its plain value under any other, neither in a reserved prefix", () => {
  const path = (variable: string) =>
    workerHeldCredentialBundleSchema.safeParse({
      ...bundle,
      variables: [{ kind: "Path", variable, file: "token" }],
    }).success;
  const value = (variable: string) =>
    workerHeldCredentialBundleSchema.safeParse({
      ...bundle,
      variables: [{ kind: "Value", variable, value: "v" }],
    }).success;
  assert.ok(path("GH_TOKEN_FILE"));
  assert.ok(!path("GH_TOKEN"));
  assert.ok(value("GH_HOST"));
  assert.ok(!value("GH_TOKEN_FILE"));
});

test("a plain value is written under a variable not ending _FILE, and never under one chuggy, its agent or git reads", () => {
  for (const variable of ["GH_HOST", "A", "X9", "FILE", "A_FILES"])
    assert.ok(isHeldCredentialValueVariable(variable), variable);
  for (const variable of [
    "A_FILE",
    "_A",
    "9A",
    "gh_host",
    "GH-HOST",
    "GH_HOST ",
    "",
    "CHUG_HOST",
    "CLAUDE_HOST",
    "GIT_HOST",
  ])
    assert.ok(!isHeldCredentialValueVariable(variable), variable);
});

test("a name chuggy issues begins with its reserved prefix, and one a deployment holds need not", () => {
  assert.equal(issuedCredentialPrefix, "chuggy.");
  assert.ok(isIssuedCredential("chuggy.github"));
  for (const credential of ["github", "chuggy-github", "Chuggy.github"])
    assert.ok(!isIssuedCredential(credential), credential);
});
