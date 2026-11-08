/**
 * A catalog's canonical bytes read for the console: what it holds, what a
 * selection runs, and the initialization that selection draws a form under.
 */

import { expect, test } from "vitest";

import {
  configurationCatalogChoices,
  configurationCatalogInitialization,
  configurationCatalogOf,
  configurationCatalogSelected,
  configurationCatalogSelection,
} from "../app/core/configurationCatalog.ts";
import { copyTextEn } from "../app/copy/catalog.ts";
import { configurationFollowings } from "../../../src/contract/configurationDocument.ts";
import {
  creationCatalogCanonical,
  creationCatalogOffer,
  creationCatalogStagesNamedCanonical,
  creationInitialization,
} from "./ticketCreationFixture.ts";

function catalog() {
  const read = configurationCatalogOf(creationCatalogCanonical);
  if (read === undefined) throw new Error("the fixture is a catalog");
  return read;
}

test("a catalog reads as its workloads, plans, finalizers and defaults", () => {
  const read = catalog();
  expect(read.workloads.map((workload) => workload.name)).toStrictEqual([
    "build",
    "quick",
    "gates",
    "review",
  ]);
  expect(read.workloads[0]).toMatchObject({
    runner: "Agent",
    prompt: "Build it.\nTest it.",
    promptPath: "prompts/build.md",
  });
  expect(read.workloads[2]).toMatchObject({
    runner: "Commands",
    model: undefined,
    commands: ["npm test"],
  });
  expect([...read.plans.keys()]).toStrictEqual(["review", "gated"]);
  expect(read.finalizers).toStrictEqual([
    { name: "land", approvalRequired: false },
    { name: "approved", approvalRequired: true },
  ]);
  expect(read.defaults).toStrictEqual({
    work: "build",
    evaluation: "review",
    finalization: "land",
  });
});

/** The catalog fixture as data, for a case to write other finalizers into. */
const written = JSON.parse(creationCatalogCanonical) as Record<string, unknown>;

test("a version 3 catalog reads each finalizer's finalization whole, policy and all", () => {
  const read = configurationCatalogOf(
    JSON.stringify({
      ...written,
      version: 3,
      finalizers: {
        merge: {
          finalization: {
            kind: "GitMerge",
            mode: "PullRequestMerge",
            target: "refs/heads/release",
            policy: "Serialized",
          },
        },
        proposal: {
          approvalRequired: true,
          finalization: { kind: "PullRequest", target: "refs/heads/main" },
        },
        nothing: { finalization: { kind: "None" } },
        written: { landing: { mode: "Push" } },
      },
    }),
  );
  expect(read?.defaults.work).toBe("build");
  expect(read?.finalizers).toStrictEqual([
    {
      name: "merge",
      approvalRequired: false,
      finalization: {
        kind: "GitMerge",
        mode: "PullRequestMerge",
        target: "refs/heads/release",
        policy: "Serialized",
      },
    },
    {
      name: "proposal",
      approvalRequired: true,
      finalization: { kind: "PullRequest", target: "refs/heads/main" },
    },
    {
      name: "nothing",
      approvalRequired: false,
      finalization: { kind: "None" },
    },
    { name: "written", approvalRequired: false },
  ]);
});

test("a version 2 catalog's landing reads forward to its kind, a git merge ordered Direct", () => {
  expect(
    configurationCatalogOf(
      JSON.stringify({
        ...written,
        finalizers: {
          landed: { landing: { mode: "Push", target: "refs/heads/release" } },
          proposed: { landing: { mode: "PullRequest" } },
          nothing: { landing: { mode: "None" } },
          written: { finalization: { kind: "None" } },
        },
      }),
    )?.finalizers,
  ).toStrictEqual([
    {
      name: "landed",
      approvalRequired: false,
      finalization: {
        kind: "GitMerge",
        mode: "Push",
        target: "refs/heads/release",
        policy: "Direct",
      },
    },
    {
      name: "proposed",
      approvalRequired: false,
      finalization: { kind: "PullRequest" },
    },
    {
      name: "nothing",
      approvalRequired: false,
      finalization: { kind: "None" },
    },
    { name: "written", approvalRequired: false },
  ]);
});

test("a version 1 document, and bytes that are no JSON, are no catalog", () => {
  expect(configurationCatalogOf(JSON.stringify({ version: 1 }))).toBe(
    undefined,
  );
  expect(configurationCatalogOf("{")).toBe(undefined);
});

test("a selection runs its defaults where it names nothing, and holds only what differs from them", () => {
  const read = catalog();
  expect(configurationCatalogSelected(read, undefined)).toStrictEqual({
    work: "build",
    evaluation: "review",
    finalization: "land",
    configuration: undefined,
  });
  const selected = configurationCatalogSelected(read, {
    work: "quick",
    finalization: "land",
  });
  expect(configurationCatalogSelection(read, selected)).toStrictEqual({
    work: "quick",
  });
});

/** The fixture catalog with its defaults naming the revision its tickets follow. */
function catalogFollowing(configuration: unknown) {
  const parsed = JSON.parse(creationCatalogCanonical) as {
    readonly defaults: object;
  };
  return configurationCatalogOf(
    JSON.stringify({
      ...parsed,
      defaults: { ...parsed.defaults, configuration },
    }),
  );
}

test("a catalog reads the revision its tickets follow, and a value it cannot read as none", () => {
  for (const configuration of configurationFollowings)
    expect(catalogFollowing(configuration)?.defaults.configuration).toBe(
      configuration,
    );
  expect(catalogFollowing("Newest")?.defaults).toStrictEqual(
    catalog().defaults,
  );
});

test("a selection keeps the revision it follows as it named it through a rebuild, the catalog's default among them, and names none where it named none", () => {
  for (const defaulted of configurationFollowings) {
    const read = catalogFollowing(defaulted);
    if (read === undefined) throw new Error("the fixture is a catalog");
    for (const configuration of configurationFollowings)
      expect(
        configurationCatalogSelection(read, {
          ...configurationCatalogSelected(read, { configuration }),
          work: "quick",
        }),
      ).toStrictEqual({ work: "quick", configuration });
    expect(
      configurationCatalogSelection(read, {
        ...configurationCatalogSelected(read, {}),
        work: "quick",
      }),
    ).toStrictEqual({ work: "quick" });
  }
});

test("a selected plan draws the program, its length and the stage its commands run in", () => {
  const drawn = configurationCatalogInitialization(
    creationCatalogOffer().initialization,
    { evaluation: "gated" },
  );
  expect(drawn.defaults.program).toStrictEqual([
    { key: 1, evaluators: [{ key: 1 }, { key: 2 }] },
    { key: 2, evaluators: [{ key: 1 }] },
  ]);
  expect(drawn.choices.programStagesMax).toBe(2);
  expect(drawn.commandedCheckStage).toBe(2);
  const plain = configurationCatalogInitialization(
    creationCatalogOffer().initialization,
    {},
  );
  expect(plain.choices.programStagesMax).toBe(1);
  expect("commandedCheckStage" in plain).toBe(false);
});

test("a selected plan drops the note the server wrote of the plan it read", () => {
  const read = creationCatalogOffer().initialization;
  const drawn = configurationCatalogInitialization(
    { ...read, commandedCheckStageNote: "No stage takes checks." },
    { evaluation: "gated" },
  );
  expect(drawn.commandedCheckStage).toBe(2);
  expect("commandedCheckStageNote" in drawn).toBe(false);
});

test("an initialization whose configuration is no catalog is left as read", () => {
  expect(
    configurationCatalogInitialization(creationInitialization, {
      evaluation: "gated",
    }),
  ).toBe(creationInitialization);
});

test("a plan's choice draws its stages by the names they are written under, spaces and all", () => {
  const read = configurationCatalogOf(creationCatalogStagesNamedCanonical);
  if (read === undefined) throw new Error("the fixture is a catalog");
  expect(
    configurationCatalogChoices(read, copyTextEn).evaluation.map(
      (choice) => choice.text,
    ),
  ).toStrictEqual([
    "review (default) · review",
    "gated · Code Review → Checks · étape 2",
  ]);
});

test("each choice marks the catalog's default", () => {
  const choices = configurationCatalogChoices(catalog(), copyTextEn);
  expect(choices.work.map((choice) => choice.text)[0]).toMatch(
    /^build \(default\) · /u,
  );
  expect(choices.evaluation.map((choice) => choice.text)).toStrictEqual([
    "review (default) · review",
    "gated · review → gates",
  ]);
  expect(choices.finalization.map((choice) => choice.value)).toStrictEqual([
    "land",
    "approved",
  ]);
  expect(choices.finalization.map((choice) => choice.text)).toStrictEqual([
    "land (default) · lands unapproved",
    "approved · approved first",
  ]);
});
