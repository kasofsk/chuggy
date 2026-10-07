/**
 * Which configuration a ticket is drawn under: what a project offers out of
 * its listing, what each offer is called, what a form starts on, and what a
 * form naming one — or none — becomes.
 *
 * The listings are written newest first and, inside one commit, by name
 * descending, which is the order the API answers in and the order that made a
 * form taking the first ready row take the name sorting last.
 */

import { expect, test } from "vitest";

import type { ConfigurationSummary } from "../../../src/contract/responses.ts";
import {
  creationBodyFrom,
  creationConfigurationAsked,
  creationConfigurationChosen,
  creationConfigurationStart,
  creationConfigurationsDecided,
  creationConfigurationsOffered,
  creationFaultSentence,
  creationFormFrom,
  creationStageOf,
} from "../app/core/ticketCreation.ts";
import {
  creationBinding,
  creationDeclared as declared,
  creationForm,
  creationOffer,
  creationSummary,
} from "./ticketCreationFixture.ts";

const chuggy = "https://forge.test/kasofsk/chuggy";
const scratch = "https://forge.test/gdoteof/scratch";
const older = "0b5c1d0e9a7f4c3b2a1908f7e6d5c4b3a2f1e0d9";

const bound = [creationBinding(chuggy)];

/** One repository's listing across two imports, the older declaring a name
 * the newer dropped. */
const listing = [
  declared("n-sonnet", chuggy, "development-sonnet"),
  declared("n-development", chuggy, "development"),
  declared("n-basic", chuggy, "basic"),
  declared("o-opus", chuggy, "development-opus", "Ready", older),
  declared("o-development", chuggy, "development", "Ready", older),
  declared("o-basic", chuggy, "basic", "Ready", older),
];

function names(
  configurations: readonly ConfigurationSummary[],
  repositories = bound,
): readonly string[] {
  return creationConfigurationsOffered(configurations, repositories).map(
    (offered) => offered.name,
  );
}

function revisions(
  configurations: readonly ConfigurationSummary[],
  repositories = bound,
): readonly string[] {
  return creationConfigurationsOffered(configurations, repositories).map(
    (offered) => offered.listed.revision,
  );
}

test("the offer is what the newest imported commit declares, in name order", () => {
  expect(names(listing)).toStrictEqual([
    "basic",
    "development",
    "development-sonnet",
  ]);
  expect(revisions(listing)).toStrictEqual([
    "n-basic",
    "n-development",
    "n-sonnet",
  ]);
});

test("a name the newest commit dropped is not offered, though older commits list it", () => {
  expect(names(listing)).not.toContain("development-opus");
});

/** A ticket cannot name a retired binding's repository, so a configuration
 * only that repository declares is one no ticket could be released under. */
test("nothing a retired binding declared is offered", () => {
  const both = [
    declared("s-scratch", scratch, "scratch"),
    declared("c-chuggy", chuggy, "chuggy"),
  ];
  const repositories = [
    creationBinding(chuggy),
    creationBinding(scratch, "Push", "2026-09-14T00:00:00Z"),
  ];
  expect(names(both, repositories)).toStrictEqual(["chuggy"]);
});

test("a project where no repository declares one is offered its newest ready revision", () => {
  const authored = [
    creationSummary("r4", "Incomplete"),
    creationSummary("bootstrap", "Ready"),
    creationSummary("r2", "Ready"),
  ];
  expect(names(authored, [])).toStrictEqual(["bootstrap"]);
  expect(names(authored)).toStrictEqual(["bootstrap"]);
  expect(names([creationSummary("r4", "Incomplete")])).toStrictEqual([]);
});

/** Falling back to an older ready row here would be the guess among names
 * this rule exists to stop. */
test("a newest commit with nothing ready offers nothing, not an older commit's revision", () => {
  const unready = [
    declared("n-development", chuggy, "development", "Incomplete"),
    declared("o-development", chuggy, "development", "Ready", older),
  ];
  expect(names(unready)).toStrictEqual([]);
  const mixed = [
    declared("n-development", chuggy, "development", "Incomplete"),
    declared("n-basic", chuggy, "basic"),
  ];
  expect(names(mixed)).toStrictEqual(["basic"]);
});

test("a name two repositories declare is told apart by the repository beside it", () => {
  const shared = [
    declared("s-basic", scratch, "basic"),
    declared("c-development", chuggy, "development"),
    declared("c-basic", chuggy, "basic"),
  ];
  const repositories = [creationBinding(chuggy), creationBinding(scratch)];
  expect(names(shared, repositories)).toStrictEqual([
    "basic · gdoteof/scratch",
    "basic · kasofsk/chuggy",
    "development",
  ]);
});

test("two repositories that shorten alike are told apart by their whole address", () => {
  const mirror = "https://mirror.test/kasofsk/chuggy";
  const shared = [
    declared("m-basic", mirror, "basic"),
    declared("c-basic", chuggy, "basic"),
  ];
  const repositories = [creationBinding(chuggy), creationBinding(mirror)];
  expect(names(shared, repositories)).toStrictEqual([
    `basic · ${chuggy}`,
    `basic · ${mirror}`,
  ]);
});

/**
 * A walk stops at the first page that decides the offer, and a page ending
 * inside the newest commit has not: the rest of its declarations are on the
 * next one.
 */
test("a listing decides the offer once a row follows the newest commit's", () => {
  expect(creationConfigurationsDecided(listing.slice(0, 2), bound)).toBe(false);
  expect(creationConfigurationsDecided(listing.slice(0, 3), bound)).toBe(false);
  expect(creationConfigurationsDecided(listing.slice(0, 4), bound)).toBe(true);
});

test("a bound repository with no row read yet leaves the offer undecided", () => {
  const repositories = [creationBinding(chuggy), creationBinding(scratch)];
  expect(creationConfigurationsDecided(listing, repositories)).toBe(false);
  expect(
    creationConfigurationsDecided(
      [...listing, declared("s-scratch", scratch, "scratch")],
      repositories,
    ),
  ).toBe(false);
  expect(
    creationConfigurationsDecided(
      [
        ...listing,
        declared("s-scratch", scratch, "scratch"),
        creationSummary("bootstrap", "Ready"),
      ],
      repositories,
    ),
  ).toBe(true);
});

test("a project binding nothing is decided by its first ready revision", () => {
  expect(
    creationConfigurationsDecided([creationSummary("r4", "Incomplete")], []),
  ).toBe(false);
  expect(
    creationConfigurationsDecided(
      [creationSummary("r4", "Incomplete"), creationSummary("r3", "Ready")],
      [],
    ),
  ).toBe(true);
});

const development = creationOffer(
  declared("n-development", chuggy, "development"),
);
const sonnet = creationOffer(
  declared("n-sonnet", chuggy, "development-sonnet"),
  {
    fence: { projectSequence: 77, configurationDigest: "b".repeat(64) },
    defaults: {
      dependencies: [],
      program: [creationStageOf(2, 1), creationStageOf(1, 2)],
    },
  },
);
const several = [development, sonnet];

test("a form starts on the sole offer, and among several on the last choice or on none", () => {
  expect(creationConfigurationStart([development], undefined)).toBe(
    "development",
  );
  expect(creationConfigurationStart([development], "gone")).toBe("development");
  expect(creationConfigurationStart(several, "development-sonnet")).toBe(
    "development-sonnet",
  );
  expect(creationConfigurationStart(several, "gone")).toBe("");
  expect(creationConfigurationStart(several, undefined)).toBe("");
});

test("the form asks everywhere but where the one offer is the one it names", () => {
  expect(creationConfigurationAsked([development], "development")).toBe(false);
  expect(creationConfigurationAsked([development], "")).toBe(true);
  expect(creationConfigurationAsked(several, "development")).toBe(true);
  expect(creationConfigurationAsked(several, "")).toBe(true);
});

test("a form among several offers holds no configuration's defaults until one is chosen", () => {
  const unchosen = creationFormFrom(several, []);
  expect(unchosen.configuration).toBe("");
  expect(unchosen.program).toStrictEqual([]);
  const remembered = creationFormFrom(several, [], "development-sonnet");
  expect(remembered.configuration).toBe("development-sonnet");
  expect(remembered.program).toStrictEqual(
    sonnet.initialization.defaults.program,
  );
});

test("choosing a configuration takes its defaults and keeps what was typed", () => {
  const typed = {
    ...creationFormFrom(several, []),
    title: "Ship it",
    intent: "ship the thing",
    checks: ["npm test"],
  };
  const chosen = creationConfigurationChosen(typed, several, "development");
  expect(chosen).toStrictEqual({
    ...typed,
    configuration: "development",
    program: development.initialization.defaults.program,
  });
  const moved = creationConfigurationChosen(
    chosen,
    several,
    "development-sonnet",
  );
  expect(moved.program).toStrictEqual(sonnet.initialization.defaults.program);
  expect(moved.title).toBe("Ship it");
});

test("a program the reader moved stands under another configuration", () => {
  const widened = {
    ...creationFormFrom(several, [], "development"),
    program: [creationStageOf(3, 1)],
  };
  expect(
    creationConfigurationChosen(widened, several, "development-sonnet").program,
  ).toStrictEqual([creationStageOf(3, 1)]);
});

test("a form naming no configuration sends nothing, and says so beside every fault its brief earns", () => {
  const assembled = creationBodyFrom(
    several,
    { ...creationFormFrom(several, []), intent: "" },
    [],
  );
  expect(assembled.assembled === "Faults" && assembled.faults).toStrictEqual([
    {
      field: "configuration",
      reason: creationFaultSentence("configuration"),
    },
    { field: "intent", reason: creationFaultSentence("intent") },
  ]);
});

test("a name nothing offers is no configuration", () => {
  const assembled = creationBodyFrom(
    several,
    creationForm({ configuration: "development-opus" }),
    [],
  );
  expect(
    assembled.assembled === "Faults" &&
      assembled.faults.map((fault) => fault.field),
  ).toStrictEqual(["configuration"]);
});

test("the body is pinned and fenced by the offer the form names", () => {
  const assembled = creationBodyFrom(
    several,
    creationForm({ configuration: "development-sonnet" }),
    [],
  );
  expect(assembled.assembled === "Body" && assembled.body).toMatchObject({
    configurationRevision: "n-sonnet",
    configurationDigest: "b".repeat(64),
    expectedProjectSequence: 77,
  });
});
