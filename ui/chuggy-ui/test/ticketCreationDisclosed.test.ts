/**
 * What the ticket form keeps under its disclosure, and when that disclosure
 * is marked: a value a fresh form under the same configuration, selection and
 * repository would not hold, judged by what a submit would send of it.
 */

import { expect, test } from "vitest";

import {
  creationDisclosedHeld,
  creationFieldDisclosed,
  creationFieldFirstFaulted,
  creationFieldsDrawn,
} from "../app/core/ticketCreationDisclosed.ts";
import type { TicketCreationForm } from "../app/core/ticketCreation.ts";
import {
  creationStageOf,
  creationRepositoryChosen,
} from "../app/core/ticketCreation.ts";
import {
  creationBinding,
  creationCatalogOffer,
  creationForm,
  creationNone,
  creationOffer,
  creationOffers,
  creationPullRequest,
} from "./ticketCreationFixture.ts";

const binding = creationBinding("https://forge.test/acme/atlas.git");
const requesting = creationBinding(
  "https://forge.test/acme/other.git",
  "PullRequest",
);
const repositories = [binding, requesting];

function held(
  over: Partial<TicketCreationForm>,
  drawn = { epic: true },
): boolean {
  return creationDisclosedHeld(
    creationOffers,
    repositories,
    creationForm(over, repositories),
    drawn,
  );
}

test("a fresh form holds nothing under the disclosure, whatever its essentials say", () => {
  expect(held({})).toBe(false);
  expect(held({ intent: "a whole paragraph of what it is for" })).toBe(false);
  expect(held({ repository: binding.repository })).toBe(false);
});

test.each<[string, Partial<TicketCreationForm>]>([
  ["a title", { title: "Ship it" }],
  ["a link", { links: ["https://forge.test/acme/atlas/issues/1"] }],
  ["an image", { images: ["artifact-1"] }],
  ["a branch", { branchName: "topic" }],
  ["another landing", { finalization: creationPullRequest }],
  ["a target", { targetBranchName: "release" }],
  ["an epic", { epic: "4" }],
  ["a dependency", { dependencies: [7] }],
  ["another program", { program: [creationStageOf(2, 1)] }],
])("%s under the disclosure marks it", (_, over) => {
  expect(held(over)).toBe(true);
});

test("a line typed nowhere but blanks holds nothing, as a submit sends none of it", () => {
  expect(held({ links: ["", "  "] })).toBe(false);
  expect(held({ title: "   ", branchName: " " })).toBe(false);
});

test("an epic the form does not ask about is nothing it could show", () => {
  expect(held({ epic: "4" }, { epic: false })).toBe(false);
});

test("a target under a landing that names none is nothing it could show", () => {
  const unlanded = [
    creationBinding("https://forge.test/acme/none.git", "None"),
  ];
  const form = creationForm({ targetBranchName: "release" }, unlanded);
  expect(form.finalization).toStrictEqual(creationNone);
  expect(
    creationDisclosedHeld(creationOffers, unlanded, form, { epic: true }),
  ).toBe(false);
});

test("the landing a repository seeds is its default, not a value of the reader's", () => {
  const moved = creationRepositoryChosen(
    creationForm({}, repositories),
    repositories,
    requesting.repository,
    creationOffers,
  );
  expect(moved.finalization).toStrictEqual(creationPullRequest);
  expect(
    creationDisclosedHeld(creationOffers, repositories, moved, { epic: true }),
  ).toBe(false);
});

test("check lines hold a value only under a configuration that commands a stage for them", () => {
  const checks = { checks: ["npm test"] };
  expect(held(checks)).toBe(false);
  const commanding = [creationOffer(undefined, { commandedCheckStage: 1 })];
  expect(
    creationDisclosedHeld(
      commanding,
      [],
      { ...creationForm({}, []), ...checks },
      { epic: true },
    ),
  ).toBe(true);
});

test("a catalog's selection marks the disclosure, and its defaults do not", () => {
  const offers = [creationCatalogOffer()];
  const [offer] = offers;
  if (offer === undefined) throw new Error("no offer");
  const fresh = {
    ...creationForm({}, []),
    configuration: offer.name,
    program: offer.initialization.defaults.program,
  };
  expect(creationDisclosedHeld(offers, [], fresh, { epic: true })).toBe(false);
  expect(
    creationDisclosedHeld(
      offers,
      [],
      { ...fresh, selection: { configuration: "Latest" } },
      { epic: true },
    ),
  ).toBe(true);
});

test("an override marks the disclosure under a configuration that is no catalog", () => {
  expect(held({ overrides: { "worker.mode": { type: "Default" } } })).toBe(
    true,
  );
});

test("a refusal is answered at the first field the form draws, the essentials first", () => {
  expect(creationFieldFirstFaulted(["title", "intent"])).toBe("intent");
  expect(creationFieldFirstFaulted(["target", "branch"])).toBe("branch");
  expect(creationFieldFirstFaulted(["fence"])).toBe("fence");
  expect(creationFieldFirstFaulted([])).toBeUndefined();
});

test("only the essentials and the fence are said outside the disclosure", () => {
  expect(
    creationFieldsDrawn.filter((field) => !creationFieldDisclosed(field)),
  ).toStrictEqual(["configuration", "intent", "repository", "fence"]);
});
