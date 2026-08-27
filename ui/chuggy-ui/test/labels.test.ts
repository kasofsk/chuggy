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

import type { ExecutionSummary } from "../../../src/contract/responses.ts";
import {
  configurationCommitShort,
  configurationLabel,
  executionRequirementLabel,
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

const containerExecution: ExecutionSummary = {
  execution: "e1",
  ticket: 1,
  task: 1,
  taskKind: "Work",
  cluster: "rig",
  configurationRevision: revision,
  requirementIdentity: "requirement-a",
  requirement: {
    mode: "Container",
    operatingSystem: "Linux",
    architecture: "Amd64",
    image: digestImage,
  },
  requirementDigest: "b".repeat(64),
  requirementSource: "TicketDefault",
  platformDefaultVersion: 1,
  status: "Running",
  retriesSpent: 0,
  registeredAt: "2026-08-26T10:00:00.000Z",
};

test("a container execution names its platform and its worker, and keeps the image", () => {
  expect(
    executionRequirementLabel({
      ...containerExecution,
      worker: { name: "chuggy-worker", version: "v3" },
    }),
  ).toEqual({
    text: "Linux/Amd64 chuggy-worker v3",
    title: digestImage,
  });
  expect(executionRequirementLabel(containerExecution)).toEqual({
    text: "Linux/Amd64 worker@sha256:9949c442",
    title: digestImage,
  });
});

test("a native execution names the toolchain floor it asked for", () => {
  const drawn = executionRequirementLabel({
    ...containerExecution,
    requirement: {
      mode: "Native",
      architecture: "Arm64",
      driver: "XcodeTesting",
      xcodeVersionMin: 16,
      sdkVersionMin: 18,
    },
  });
  expect(drawn.text).toBe("Arm64 XcodeTesting, xcode ≥ 16, sdk ≥ 18");
  expect(drawn.title).toBe(drawn.text);
});
