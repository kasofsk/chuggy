/**
 * What a ticket replaces of a catalog's workloads, written out whole and read
 * back: that the two are one override, and that the text is refused where it
 * could not be one.
 */

import { expect, test } from "vitest";

import {
  workloadOverrideRead,
  workloadsEffectiveCanonicalOf,
  workloadsOverriddenOf,
} from "../app/core/workloadOverrides.ts";
import type { WorkloadOverride } from "../../../src/contract/configurationOverrides.ts";
import { creationCatalogCanonical } from "./ticketCreationFixture.ts";

function overrideOf(name: string, written: unknown): WorkloadOverride {
  const read = workloadOverrideRead(creationCatalogCanonical, name, written);
  if (read.read !== "Override") throw new Error(read.message);
  return read.override;
}

function writtenOf(name: string, override: WorkloadOverride): unknown {
  return workloadsOverriddenOf(creationCatalogCanonical, { [name]: override })[
    name
  ];
}

test("a workload written back as the catalog holds it overrides nothing", () => {
  const written = writtenOf("quick", {});
  expect(overrideOf("quick", written)).toStrictEqual({});
});

test("a replaced field is held alone, and writes back as the same override", () => {
  const override: WorkloadOverride = { commands: ["npm run lint"] };
  expect(writtenOf("gates", override)).toStrictEqual({
    runner: "Commands",
    commands: ["npm run lint"],
  });
  expect(overrideOf("gates", writtenOf("gates", override))).toStrictEqual(
    override,
  );
});

test("a prompt names new text or another stored file's path, and a path is written as the path alone", () => {
  const text: WorkloadOverride = { prompt: { text: "Do it slowly." } };
  expect(overrideOf("quick", writtenOf("quick", text))).toStrictEqual(text);
  const path: WorkloadOverride = { prompt: { path: ".chug/prompts/work.md" } };
  expect(writtenOf("quick", path)).toMatchObject({
    prompt: { path: ".chug/prompts/work.md" },
  });
  expect(overrideOf("quick", writtenOf("quick", path))).toStrictEqual(path);
  expect(overrideOf("build", writtenOf("build", {}))).toStrictEqual({});
});

test("an image and an execution requirement are one placement: naming one replaces the other, naming neither keeps the catalog's image", () => {
  const requirement: WorkloadOverride = {
    executionRequirement: {
      mode: "Capability",
      operatingSystem: "Linux",
      architecture: "Amd64",
      capabilities: ["gpu"],
    },
  };
  const written = writtenOf("quick", requirement);
  expect(written).toMatchObject({
    executionRequirement: { capabilities: ["gpu"] },
  });
  expect(written).not.toHaveProperty("image");
  expect(overrideOf("quick", written)).toStrictEqual(requirement);
  const imaged = writtenOf("quick", { image: "other" });
  expect(imaged).toMatchObject({ image: "other" });
  expect(overrideOf("quick", imaged)).toStrictEqual({ image: "other" });
  const both = { ...(written as object), image: "other" };
  expect(
    workloadOverrideRead(creationCatalogCanonical, "quick", both).read,
  ).toBe("Refused");
});

test("a workload naming another runner is the whole override and keeps none of the catalog's fields", () => {
  const override: WorkloadOverride = {
    runner: "Commands",
    commands: ["npm test"],
  };
  const written = writtenOf("quick", override);
  expect(written).toStrictEqual({ runner: "Commands", commands: ["npm test"] });
  expect(overrideOf("quick", written)).toStrictEqual(override);
  const effective = JSON.parse(
    workloadsEffectiveCanonicalOf(creationCatalogCanonical, {
      quick: overrideOf("quick", written),
    }),
  ) as { workloads: { quick: unknown } };
  expect(effective.workloads.quick).toStrictEqual(written);
});

test("a field the catalog holds and the text leaves out is refused, naming the field", () => {
  const read = workloadOverrideRead(creationCatalogCanonical, "quick", {
    runner: "Agent",
    worker: { mode: { type: "SingleAgent", agent: "Claude", arguments: [] } },
  });
  expect(read).toMatchObject({ read: "Refused" });
  expect(read.read === "Refused" && read.message).toContain("`prompt`");
});

test("a workload the catalog lacks, or one not written as a map, is refused", () => {
  expect(
    workloadOverrideRead(creationCatalogCanonical, "nothing", {}).read,
  ).toBe("Refused");
  expect(
    workloadOverrideRead(creationCatalogCanonical, "quick", "text").read,
  ).toBe("Refused");
});
