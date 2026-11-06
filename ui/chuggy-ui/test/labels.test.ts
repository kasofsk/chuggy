/**
 * The names drawn for a configuration and for a worker, and what each of them
 * falls back to.
 *
 * Every branch is asked for twice over: the text a reader sees, and the value
 * in full that hovering it reveals. A label that dropped the identity would
 * read as a name and be unrecoverable, and one that dropped the name would be
 * the identity this slice exists to stop showing.
 */

import { expect, test } from "vitest";

import {
  configurationCommitShort,
  configurationLabel,
  creatorEmailsOf,
  creatorLabel,
  digestShortened,
  imageShortened,
  workerLabel,
} from "../app/core/labels.ts";

const revision = "repository:cfaca0a0f14ec03845a4e01458ac6c3a56d52a23:chuggy";

const digestImage =
  "registry.chuggy.internal/chuggy/worker@sha256:9949c442a2f0a5cd0f0a5b1c8b6e0a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f";

test("a configuration the server numbered is drawn as its name and number", () => {
  expect(configurationLabel(revision, { name: "chuggy", number: 12 })).toEqual({
    text: "chuggy #12",
    title: revision,
  });
});

test("an authored revision is drawn as the identity its author chose", () => {
  expect(configurationLabel("hand-written-one", undefined)).toEqual({
    text: "hand-written-one",
    title: "hand-written-one",
  });
});

test("a revision carrying no version is drawn as its identity, never blank", () => {
  const drawn = configurationLabel(revision, undefined);
  expect(drawn.text).toBe(revision);
  expect(drawn.text).not.toBe("");
});

test("a repository revision offers its commit short, and an authored one none", () => {
  expect(
    configurationCommitShort({
      source: "Repository",
      repository: "kasofsk/chuggy",
      commit: "cfaca0a0f14ec03845a4e01458ac6c3a56d52a23",
      path: "configurations/chuggy.json",
      name: "chuggy",
    }),
  ).toBe("cfaca0a");
  expect(configurationCommitShort({ source: "Authored" })).toBeUndefined();
});

test("a catalogued image is drawn as the worker's name and version", () => {
  expect(
    workerLabel({ name: "chuggy-worker", version: "v3" }, digestImage),
  ).toEqual({ text: "chuggy-worker v3", title: digestImage });
});

test("an uncatalogued digest reference is cut to its repository and digest head", () => {
  expect(workerLabel(undefined, digestImage)).toEqual({
    text: "worker@sha256:9949c442",
    title: digestImage,
  });
});

/** A tag names nothing a prefix of it would name, so the cut a digest gets is
 * one this branch must not take — however long the tag is. */
test("an uncatalogued tag reference is kept whole, however long the tag", () => {
  expect(
    workerLabel(undefined, "registry.chuggy.internal/chuggy/worker:v1"),
  ).toEqual({
    text: "worker:v1",
    title: "registry.chuggy.internal/chuggy/worker:v1",
  });
  expect(
    imageShortened("registry.chuggy.internal/chuggy/worker:2026-08-27-release"),
  ).toBe("worker:2026-08-27-release");
});

test("a reference with neither path nor digest is drawn as it stands", () => {
  expect(imageShortened("worker")).toBe("worker");
  expect(imageShortened("chuggy/worker@notadigest")).toBe("worker@notadigest");
});

test("a long digest is cut to a head and a tail, with the middle marked missing", () => {
  expect(digestShortened("c".repeat(64))).toBe(
    `${"c".repeat(12)}…${"c".repeat(6)}`,
  );
});

test("a digest already short enough is kept whole", () => {
  expect(digestShortened("abcd")).toBe("abcd");
});

test("a creator is drawn as the subject its issuer gave them, the whole authority kept for the hover", () => {
  expect(creatorLabel("23:https://issuer.example/alice")).toEqual({
    text: "alice",
    title: "23:https://issuer.example/alice",
  });
});

test("a creator with no issuer prefix, or one naming nothing past it, is drawn whole", () => {
  expect(creatorLabel("harness")).toEqual({
    text: "harness",
    title: "harness",
  });
  expect(creatorLabel("9:issuer/")).toEqual({
    text: "9:issuer/",
    title: "9:issuer/",
  });
});

test("a creator the project's people name an email for is drawn as it, and by subject otherwise", () => {
  const principal = "23:https://issuer.example/alice";
  const emails = creatorEmailsOf([
    { subject: "alice", email: "alice@example.com" },
    { subject: "bob" },
  ]);
  expect([...emails.keys()]).toEqual(["alice"]);
  expect(creatorLabel(principal, emails)).toEqual({
    text: "alice@example.com",
    title: principal,
  });
  expect(creatorLabel("23:https://issuer.example/bob", emails).text).toBe(
    "bob",
  );
});
