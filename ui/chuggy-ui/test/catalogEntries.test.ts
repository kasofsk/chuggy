/**
 * A catalog as the Catalog page lists it: its entries grouped, a prompt file
 * an entry of its own, and every reference drawn from both ends.
 */

import { expect, test } from "vitest";

import { catalogEntrySource } from "../app/browser/catalog/catalogSource.ts";
import {
  catalogEntriesOf,
  catalogEntryFields,
  catalogEntryKey,
  catalogEntrySummary,
} from "../app/core/catalogEntries.ts";
import type { CatalogEntries } from "../app/core/catalogEntries.ts";
import { configurationCatalogOf } from "../app/core/configurationCatalog.ts";
import { creationCatalogCanonical } from "./ticketCreationFixture.ts";

function entriesOf(canonical: string): CatalogEntries {
  const catalog = configurationCatalogOf(canonical);
  if (catalog === undefined) throw new Error("no catalog");
  return catalogEntriesOf(catalog);
}

function entryOf(entries: CatalogEntries, key: string) {
  const entry = entries.byKey.get(key);
  if (entry === undefined) throw new Error(`no ${key}`);
  return entry;
}

const entries = entriesOf(creationCatalogCanonical);

test("the groups are listed workloads, plans, finalizers, then the prompt files the workloads name", () => {
  expect(
    entries.groups.map((group) => [
      group.kind,
      group.entries.map((entry) => entry.name),
    ]),
  ).toStrictEqual([
    ["Workload", ["build", "quick", "gates", "review"]],
    ["Plan", ["review", "gated"]],
    ["Finalizer", ["land", "approved"]],
    ["Prompt", ["prompts/build.md"]],
  ]);
});

test("a workload and a plan of one name are two entries", () => {
  expect(entryOf(entries, "workloads/review").detail.kind).toBe("Workload");
  expect(entryOf(entries, "plans/review").detail.kind).toBe("Plan");
});

test("each default is a badge on the entry it names, and no use", () => {
  expect(entryOf(entries, "workloads/build").defaults).toStrictEqual(["work"]);
  expect(entryOf(entries, "plans/review").defaults).toStrictEqual([
    "evaluation",
  ]);
  expect(entryOf(entries, "finalizers/land").defaults).toStrictEqual([
    "finalization",
  ]);
  expect(entries.usedBy.get("finalizers/land")).toBeUndefined();
});

test("a plan uses each evaluator once per stage, and the workload says which plans run it", () => {
  expect(entries.uses.get("plans/gated")).toStrictEqual([
    { key: "workloads/review", name: "review", field: "stage 1 · review" },
    { key: "workloads/gates", name: "gates", field: "stage 2 · gates" },
  ]);
  expect(entries.usedBy.get("workloads/review")).toStrictEqual([
    { key: "plans/review", name: "review", field: "stage 1 · review" },
    { key: "plans/gated", name: "gated", field: "stage 1 · review" },
  ]);
});

test("a workload naming a prompt file uses that file's entry, and an inline prompt is no entry", () => {
  const prompt = catalogEntryKey("Prompt", "prompts/build.md");
  expect(entries.uses.get("workloads/build")).toStrictEqual([
    { key: prompt, name: "prompts/build.md", field: "prompt.path" },
  ]);
  expect(entries.usedBy.get(prompt)).toStrictEqual([
    { key: "workloads/build", name: "build", field: "prompt.path" },
  ]);
  expect(entries.uses.get("workloads/quick")).toStrictEqual([]);
});

test("two workloads naming one prompt file share its entry", () => {
  const shared = JSON.parse(creationCatalogCanonical) as {
    workloads: Record<string, Record<string, unknown>>;
  };
  shared.workloads["quick"] = {
    ...shared.workloads["quick"],
    prompt: { path: "prompts/build.md", text: "Build it.\nTest it." },
  };
  const read = entriesOf(JSON.stringify(shared));
  expect(
    read.groups.find((group) => group.kind === "Prompt")?.entries,
  ).toHaveLength(1);
  expect(
    read.usedBy.get("prompts/prompts/build.md")?.map((by) => by.name),
  ).toStrictEqual(["build", "quick"]);
});

test("each entry says in a line what it is", () => {
  expect(catalogEntrySummary(entryOf(entries, "workloads/gates"))).toBe(
    "Commands · npm test",
  );
  expect(catalogEntrySummary(entryOf(entries, "plans/gated"))).toBe(
    "review → gates",
  );
  expect(catalogEntrySummary(entryOf(entries, "finalizers/approved"))).toBe(
    "Approved first",
  );
  expect(
    catalogEntrySummary(entryOf(entries, "prompts/prompts/build.md")),
  ).toBe("Build it.");
});

test("a workload read from a file names it first among its fields, and one with no file kept names none", () => {
  const catalog = configurationCatalogOf(creationCatalogCanonical);
  if (catalog === undefined) throw new Error("no catalog");
  const kept = catalogEntriesOf(catalog, {
    review: ".chug/workloads/review.json",
  });
  expect(
    catalogEntryFields(entryOf(kept, "workloads/review"))[0],
  ).toStrictEqual(["File", ".chug/workloads/review.json"]);
  expect(
    catalogEntryFields(entryOf(kept, "workloads/build")).map(
      ([label]) => label,
    ),
  ).not.toContain("File");
});

test("a plan's fields are its stages, each with the evaluators it runs", () => {
  expect(catalogEntryFields(entryOf(entries, "plans/gated"))).toStrictEqual([
    ["Stage 1 · review", "review, review"],
    ["Stage 2 · gates", "gates"],
  ]);
});

test("a workload naming a prompt file is written with the path alone, an empty list left out, and the file as its text", () => {
  expect(
    catalogEntrySource(
      creationCatalogCanonical,
      entryOf(entries, "workloads/build"),
    ),
  ).toBe(
    "runner: Agent\nprompt:\n  path: prompts/build.md\nworker:\n  mode:\n    type: SingleAgent\n    agent: Claude\n",
  );
  expect(
    catalogEntrySource(
      creationCatalogCanonical,
      entryOf(entries, "prompts/prompts/build.md"),
    ),
  ).toBe("Build it.\nTest it.");
});
