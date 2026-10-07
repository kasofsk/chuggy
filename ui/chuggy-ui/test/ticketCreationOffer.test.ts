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

import type {
  ConfigurationSummary,
  ProjectRepositoryListedResponse,
} from "../../../src/contract/responses.ts";
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
  creationListed,
  creationOffer,
  creationSummary,
} from "./ticketCreationFixture.ts";

const chuggy = "https://forge.test/kasofsk/chuggy";
const scratch = "https://forge.test/gdoteof/scratch";
const older = "0b5c1d0e9a7f4c3b2a1908f7e6d5c4b3a2f1e0d9";
const retired = "2026-09-14T00:00:00Z";

/** A binding whose repository declared names into the project. */
function imported(repository: string, retiredAt?: string) {
  return creationListed(
    creationBinding(repository, "Push", retiredAt),
    "Imported",
  );
}

/** A binding whose repository declares nothing, the project holding a bootstrap. */
function bootstrapped(repository: string, retiredAt?: string) {
  return creationListed(
    creationBinding(repository, "Push", retiredAt),
    "Bootstrapped",
  );
}

/** A binding the project holds nothing for. */
function unheld(repository: string) {
  return creationListed(creationBinding(repository));
}

const bound = [imported(chuggy)];

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
  repositories: readonly ProjectRepositoryListedResponse[] = bound,
): readonly string[] {
  return creationConfigurationsOffered(configurations, repositories).map(
    (offered) => offered.name,
  );
}

/** The revision each offer's initialization is read by. */
function revisions(
  configurations: readonly ConfigurationSummary[],
  repositories: readonly ProjectRepositoryListedResponse[] = bound,
): readonly string[] {
  return creationConfigurationsOffered(configurations, repositories).map(
    (offered) => offered.revision,
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
test("nothing a retired binding declared is offered beside what a live one declares", () => {
  const declaredByEach = [
    declared("s-scratch", scratch, "scratch"),
    declared("c-chuggy", chuggy, "chuggy"),
  ];
  const repositories = [imported(chuggy), imported(scratch, retired)];
  expect(names(declaredByEach, repositories)).toStrictEqual(["chuggy"]);
});

/** The listing of a project where one repository declares, as far as a walk
 * of it reads: the bootstrap is no row of it. */
const mixed = [
  declared("n-sonnet", chuggy, "development-sonnet"),
  declared("n-development", chuggy, "development"),
  declared("o-development", chuggy, "development", "Ready", older),
];
const both = [imported(chuggy), bootstrapped(scratch)];

/**
 * A declared revision releases for its own repository alone, so without the
 * bootstrap no ticket for the second repository could be drawn at all. The
 * listing of bindings names it, and no row of the configurations stands for it.
 */
test("a binding that declares nothing is offered the bootstrap the project holds for it", () => {
  expect(names(mixed, both)).toStrictEqual([
    "bootstrap",
    "development",
    "development-sonnet",
  ]);
  expect(creationConfigurationsOffered(mixed, both)[0]).toStrictEqual({
    name: "bootstrap",
    revision: "bootstrap",
    listed: undefined,
  });
});

test("the bootstrap offered is the revision the binding's answer names, once however many name it", () => {
  const seeded = {
    ...bootstrapped(scratch),
    configurationsHeld: { result: "Bootstrapped" as const, revision: "seed" },
  };
  expect(revisions(mixed, [imported(chuggy), seeded])).toStrictEqual([
    "n-development",
    "n-sonnet",
    "seed",
  ]);
  expect(
    revisions(mixed, [
      imported(chuggy),
      bootstrapped(scratch),
      bootstrapped("https://forge.test/kasofsk/chuggy-fabric"),
    ]),
  ).toStrictEqual(["bootstrap", "n-development", "n-sonnet"]);
});

test("the bootstrap is not offered where no live binding holds one", () => {
  const declaring = ["development", "development-sonnet"];
  expect(names(mixed)).toStrictEqual(declaring);
  expect(
    names(mixed, [imported(chuggy), bootstrapped(scratch, retired)]),
  ).toStrictEqual(declaring);
  expect(names(mixed, [imported(chuggy), unheld(scratch)])).toStrictEqual(
    declaring,
  );
});

/**
 * A repository may declare a configuration under the bootstrap's own name. It
 * releases for that repository alone, so it is never the project's: beside the
 * project's it goes by its repository, and without one it is the row it is.
 */
test("a declared configuration named bootstrap is never taken for the project's own", () => {
  const row = declared("repository:0a1b2c3:bootstrap", chuggy, "bootstrap");
  const seeded = [row, ...mixed];
  expect(creationConfigurationsOffered(seeded, both).slice(0, 2)).toStrictEqual(
    [
      { name: "bootstrap", revision: "bootstrap", listed: undefined },
      {
        name: "bootstrap · kasofsk/chuggy",
        revision: "repository:0a1b2c3:bootstrap",
        listed: row,
      },
    ],
  );
  expect(creationConfigurationsOffered(seeded, bound)[0]).toStrictEqual({
    name: "bootstrap",
    revision: "repository:0a1b2c3:bootstrap",
    listed: row,
  });
});

const authored = [
  creationSummary("r4", "Incomplete"),
  creationSummary("r9", "Ready"),
  creationSummary("bootstrap", "Ready"),
];

/** What a repository declaring nothing is released under is the bootstrap, so
 * a newer revision of anything in the listing is not what it is offered. */
test("a project whose live bindings all declare nothing is offered the bootstrap alone", () => {
  expect(names(authored, [bootstrapped(scratch)])).toStrictEqual(["bootstrap"]);
  expect(names(listing, [bootstrapped(scratch)])).toStrictEqual(["bootstrap"]);
});

test("a project whose live bindings hold nothing is offered its newest ready revision", () => {
  expect(names(authored, [])).toStrictEqual(["r9"]);
  expect(names(authored, [unheld(chuggy)])).toStrictEqual(["r9"]);
  expect(names([creationSummary("r4", "Incomplete")], [])).toStrictEqual([]);
  expect(revisions(listing, [imported(chuggy, retired)])).toStrictEqual([
    "n-sonnet",
  ]);
  expect(revisions(listing, [bootstrapped(scratch, retired)])).toStrictEqual([
    "n-sonnet",
  ]);
});

/** Falling back to an older ready row here would be the guess among names
 * this rule exists to stop. */
test("a newest commit with nothing ready offers nothing, not an older commit's revision", () => {
  const unready = [
    declared("n-development", chuggy, "development", "Incomplete"),
    declared("o-development", chuggy, "development", "Ready", older),
  ];
  expect(names(unready)).toStrictEqual([]);
  const partly = [
    declared("n-development", chuggy, "development", "Incomplete"),
    declared("n-basic", chuggy, "basic"),
  ];
  expect(names(partly)).toStrictEqual(["basic"]);
});

test("a name two repositories declare is told apart by the repository beside it", () => {
  const shared = [
    declared("s-basic", scratch, "basic"),
    declared("c-development", chuggy, "development"),
    declared("c-basic", chuggy, "basic"),
  ];
  const repositories = [imported(chuggy), imported(scratch)];
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
  const repositories = [imported(chuggy), imported(mirror)];
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

test("every live binding that declares holds the walk open until its own rows are read", () => {
  const repositories = [imported(chuggy), imported(scratch)];
  const reached = [...listing, declared("s-scratch", scratch, "scratch")];
  expect(creationConfigurationsDecided(listing, repositories)).toBe(false);
  expect(creationConfigurationsDecided(reached, repositories)).toBe(false);
  expect(
    creationConfigurationsDecided(
      [...reached, creationSummary("bootstrap", "Ready")],
      repositories,
    ),
  ).toBe(true);
  expect(
    creationConfigurationsDecided(listing, [
      imported(chuggy),
      imported(scratch, retired),
    ]),
  ).toBe(true);
});

/**
 * The listing of bindings says which of them declare nothing, so none of
 * those is waited on, however long ago it was bound: the walk is as long as
 * the declaring binding's newest commit and no longer.
 */
test("a binding that declares nothing never holds the walk open", () => {
  for (const quiet of [bootstrapped(scratch), unheld(scratch)]) {
    const repositories = [imported(chuggy), quiet];
    expect(
      creationConfigurationsDecided(listing.slice(0, 3), repositories),
    ).toBe(false);
    expect(
      creationConfigurationsDecided(listing.slice(0, 4), repositories),
    ).toBe(true);
  }
});

/** Where a binding declares, the offer is its rows and the bootstrap, so no
 * ready row further on would change it. */
test("a project where a binding declares is decided by its rows, ready or not", () => {
  const unready = [
    declared("n-development", chuggy, "development", "Incomplete"),
    declared("o-development", chuggy, "development", "Incomplete", older),
  ];
  expect(creationConfigurationsDecided(unready, both)).toBe(true);
});

test("a project whose live bindings all declare nothing and hold a bootstrap needs no row", () => {
  const repositories = [bootstrapped(scratch)];
  expect(creationConfigurationsDecided([], repositories)).toBe(true);
  expect(
    creationConfigurationsDecided(
      [creationSummary("r4", "Incomplete")],
      repositories,
    ),
  ).toBe(true);
});

test("a project whose live bindings hold nothing is decided by its first ready revision", () => {
  const unready = [creationSummary("r4", "Incomplete")];
  const ready = [...unready, creationSummary("r3", "Ready")];
  for (const repositories of [[], [unheld(scratch)]]) {
    expect(creationConfigurationsDecided(unready, repositories)).toBe(false);
    expect(creationConfigurationsDecided(ready, repositories)).toBe(true);
  }
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

/** One offer of a read that may have missed others is not known to be the
 * only one, so it is taken where the reader chose it and nowhere else. */
test("a sole offer is not started on where the read may have missed others", () => {
  expect(creationConfigurationStart([development], undefined, true)).toBe("");
  expect(creationConfigurationStart([development], "gone", true)).toBe("");
  expect(creationConfigurationStart([development], "development", true)).toBe(
    "development",
  );
  expect(
    creationFormFrom([development], [], undefined, true).program,
  ).toStrictEqual([]);
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
