/**
 * The catalog as a repository declares it: each repository once with what its
 * newest imported commit declares, the repository a revision was read from,
 * and the fragments the declared configurations hold, each said once with the
 * configurations holding it.
 */

import { expect, test } from "vitest";

import type { ConfigurationSummary } from "../../../src/contract/responses.ts";
import { catalogEntriesOf } from "../app/core/catalogEntries.ts";
import type { CatalogEntries } from "../app/core/catalogEntries.ts";
import {
  catalogFragmentsOf,
  catalogRepositoriesOf,
  catalogRepositoryHolding,
} from "../app/core/catalogRepositories.ts";
import type { CatalogDeclared } from "../app/core/catalogRepositories.ts";
import { configurationCatalogOf } from "../app/core/configurationCatalog.ts";
import { creationCatalogCanonical } from "./ticketCreationFixture.ts";

const chuggy = "https://forge.test/kasofsk/chuggy";
const elsewhere = "https://forge.test/kasofsk/elsewhere";

function summary(
  revision: string,
  repository: string,
  commit: string,
  name: string,
): ConfigurationSummary {
  return {
    revision,
    digest: "a".repeat(64),
    createdAt: `2026-10-0${revision.slice(1)}T00:00:00Z`,
    provenance: {
      source: "Repository",
      repository,
      commit: commit.repeat(40),
      path: `.chug/configurations/${name}.json`,
      name,
    },
    version: { name, number: 1 },
    readiness: "Ready",
    image: "an-image",
    practices: [],
    finalization: { approvalRequired: false },
    evaluationStagesCount: 1,
  };
}

/** Newest first, as the listing arrives. */
const listed: readonly ConfigurationSummary[] = [
  summary("r6", elsewhere, "e", "basic"),
  summary("r5", chuggy, "c", "development"),
  summary("r4", chuggy, "c", "basic"),
  summary("r3", chuggy, "b", "retired"),
  {
    ...summary("r2", chuggy, "b", "basic"),
    provenance: { source: "Authored" },
  },
];

test("each repository is listed once, the one imported last first, with what its newest commit declares", () => {
  expect(
    catalogRepositoriesOf(listed).map((repository) => [
      repository.repository,
      repository.commit,
      repository.importedAt,
      repository.declared.map((declared) => declared.revision),
    ]),
  ).toStrictEqual([
    [elsewhere, "e".repeat(40), "2026-10-06T00:00:00Z", ["r6"]],
    [chuggy, "c".repeat(40), "2026-10-05T00:00:00Z", ["r5", "r4"]],
  ]);
});

test("a listing holding no import from a repository holds no repository", () => {
  expect(catalogRepositoriesOf([])).toStrictEqual([]);
  expect(
    catalogRepositoriesOf(listed.filter((held) => held.revision === "r2")),
  ).toStrictEqual([]);
});

test("a revision is held by the repository an import read it from, and by none where no import made it", () => {
  expect(catalogRepositoryHolding(listed, "r3")).toBe(chuggy);
  expect(catalogRepositoryHolding(listed, "r6")).toBe(elsewhere);
  expect(catalogRepositoryHolding(listed, "r2")).toBeUndefined();
  expect(catalogRepositoryHolding(listed, "r9")).toBeUndefined();
});

function entriesOf(
  canonical: string,
  workloadPaths: Readonly<Record<string, string>> = {},
): CatalogEntries {
  const catalog = configurationCatalogOf(canonical);
  if (catalog === undefined) throw new Error("no catalog");
  return catalogEntriesOf(catalog, workloadPaths);
}

function declared(
  name: string,
  revision: string,
  entries: CatalogEntries | undefined,
): CatalogDeclared {
  return {
    name,
    revision,
    path: `.chug/configurations/${name}.json`,
    entries,
  };
}

const paths = { build: ".chug/workloads/ci.json" };

test("the fragments are grouped as a catalog groups its entries, each once with every configuration holding it", () => {
  const groups = catalogFragmentsOf([
    declared(
      "chuggy-development",
      "r5",
      entriesOf(creationCatalogCanonical, paths),
    ),
    declared("basic-coding", "r4", entriesOf(creationCatalogCanonical, paths)),
  ]);
  expect(
    groups.map((group) => [
      group.kind,
      group.fragments.map((fragment) => fragment.entry.name),
    ]),
  ).toStrictEqual([
    ["Workload", ["build", "quick", "gates", "review"]],
    ["Plan", ["review", "gated"]],
    ["Finalizer", ["land", "approved"]],
    ["Prompt", ["prompts/build.md"]],
  ]);
  const [build] = groups[0]?.fragments ?? [];
  expect(build?.file).toBe(".chug/workloads/ci.json");
  expect(build?.holders).toStrictEqual([
    {
      name: "chuggy-development",
      revision: "r5",
      path: ".chug/configurations/chuggy-development.json",
      key: "workloads/build",
    },
    {
      name: "basic-coding",
      revision: "r4",
      path: ".chug/configurations/basic-coding.json",
      key: "workloads/build",
    },
  ]);
});

test("a fragment written inline names no file, and a prompt file names its own", () => {
  const groups = catalogFragmentsOf([
    declared("chuggy-development", "r5", entriesOf(creationCatalogCanonical)),
  ]);
  const fragment = (kind: string, name: string) =>
    groups
      .find((group) => group.kind === kind)
      ?.fragments.find((held) => held.entry.name === name);
  expect(fragment("Workload", "quick")?.file).toBeUndefined();
  expect(fragment("Plan", "gated")?.file).toBeUndefined();
  expect(fragment("Prompt", "prompts/build.md")?.file).toBe("prompts/build.md");
});

test("one name saying otherwise in two configurations is two fragments, each held by its own", () => {
  const changed = JSON.stringify({
    ...(JSON.parse(creationCatalogCanonical) as object),
    finalizers: {
      land: { approvalRequired: true },
      approved: { approvalRequired: true },
    },
  });
  const groups = catalogFragmentsOf([
    declared("chuggy-development", "r5", entriesOf(creationCatalogCanonical)),
    declared("basic-coding", "r4", entriesOf(changed)),
  ]);
  const landings = groups.find((group) => group.kind === "Finalizer");
  expect(
    landings?.fragments.map((fragment) => [
      fragment.entry.name,
      fragment.holders.map((holder) => holder.name),
    ]),
  ).toStrictEqual([
    ["land", ["chuggy-development"]],
    ["approved", ["chuggy-development", "basic-coding"]],
    ["land", ["basic-coding"]],
  ]);
});

test("a configuration that is no catalog holds no fragment, and none holds no group", () => {
  expect(
    catalogFragmentsOf([declared("basic-coding", "r4", undefined)]),
  ).toStrictEqual([]);
  expect(catalogFragmentsOf([])).toStrictEqual([]);
});
