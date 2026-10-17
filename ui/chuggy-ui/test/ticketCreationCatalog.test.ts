/**
 * A ticket composed under a catalog: the selection draws its program, is sent
 * in place of overrides, survives the YAML editor, an edit and a duplicate,
 * and names only what the catalog holds.
 */

import { expect, test } from "vitest";

import type { TicketResponse } from "../../../src/contract/responses.ts";
import {
  ticketYamlOf,
  ticketYamlRead,
  ticketYamlVocabulary,
} from "../app/browser/editor/ticketYaml.ts";
import type { TicketYamlContext } from "../app/browser/editor/ticketYaml.ts";
import {
  creationBodyFrom,
  creationFormFrom,
  creationSelectionChosen,
} from "../app/core/ticketCreation.ts";
import { ticketDuplicateSeed } from "../app/core/ticketDuplicate.ts";
import { editFormFrom } from "../app/core/ticketEdit.ts";
import {
  creationBinding,
  creationCatalogOffer,
  creationDraft,
  creationOffers,
} from "./ticketCreationFixture.ts";
import { ticketInstants } from "./ticketInstants.ts";

const repository = "https://forge.test/kasofsk/chuggy";
const bound = [creationBinding(repository)];
const offers = [creationCatalogOffer()];

function catalogForm() {
  return {
    ...creationFormFrom(offers, bound),
    title: "Ship it",
    intent: "ship it",
    repository,
  };
}

test("selecting a plan draws its program, and the body sends the selection and no overrides", () => {
  const form = creationSelectionChosen(
    { ...catalogForm(), overrides: { practices: [] } },
    offers,
    { work: "quick", evaluation: "gated" },
  );
  expect(form.program.map((stage) => stage.evaluators.length)).toStrictEqual([
    2, 1,
  ]);
  const sent = creationBodyFrom(
    offers,
    { ...form, checks: ["npm test"] },
    bound,
  );
  expect(sent.assembled).toBe("Body");
  if (sent.assembled !== "Body") return;
  expect(sent.body.selection).toStrictEqual({
    work: "quick",
    evaluation: "gated",
  });
  expect("overrides" in sent.body).toBe(false);
});

test("a form selecting nothing sends no selection", () => {
  const sent = creationBodyFrom(offers, catalogForm(), bound);
  expect(sent.assembled === "Body" && "selection" in sent.body).toBe(false);
});

const context: TicketYamlContext = {
  base: { ...creationFormFrom(offers, bound), intent: "" },
  offers,
  repositories: bound,
  dependenciesLocked: false,
  images: [],
};

test("a selection written as YAML reads back as the same form", () => {
  const form = creationSelectionChosen(catalogForm(), offers, {
    evaluation: "gated",
    finalization: "approved",
  });
  const read = ticketYamlRead(ticketYamlOf(form, context), context);
  expect(read.problems).toStrictEqual([]);
  expect(read.form).toStrictEqual(form);
});

test("a selection naming what the catalog does not hold is refused at its value", () => {
  const text = "title: t\nintent: i\nselection:\n  work: nowhere\n";
  const read = ticketYamlRead(text, context);
  expect(read.form).toBe(undefined);
  expect(read.problems.map((problem) => problem.message)).toStrictEqual([
    "name one of build, quick, gates, review",
  ]);
  expect(text.slice(read.problems[0]?.from, read.problems[0]?.to)).toBe(
    "nowhere",
  );
});

test("a selection naming its defaults holds none of them", () => {
  const read = ticketYamlRead(
    "title: t\nintent: i\nselection:\n  work: build\n",
    context,
  );
  expect(read.form?.selection).toStrictEqual({});
});

test("a catalog draws selection where a document draws overrides", () => {
  const keys = (over: TicketYamlContext) =>
    ticketYamlVocabulary(over.base, over).map((key) => key.key);
  expect(keys(context)).toContain("selection");
  expect(keys(context)).not.toContain("overrides");
  const documented = {
    ...context,
    base: creationFormFrom(creationOffers, bound),
    offers: creationOffers,
  };
  expect(keys(documented)).toContain("overrides");
  expect(keys(documented)).not.toContain("selection");
});

test("an edit keeps the draft's selection, and a duplicate the released ticket's", () => {
  const draft = {
    ...creationDraft,
    configurationRevision: "c1",
    selection: { work: "quick" },
  };
  expect(editFormFrom(draft, bound, "c1").selection).toStrictEqual({
    work: "quick",
  });
  const ticket: TicketResponse = {
    ticket: draft.ticket,
    phase: "Escalated",
    sequence: 9,
    ...ticketInstants,
    selection: { evaluation: "gated" },
  };
  const seeded = ticketDuplicateSeed({
    draft,
    ticket,
    offers,
    bound,
    revoked: [],
    preferred: undefined,
    partial: false,
  });
  expect(seeded.form.selection).toStrictEqual({ evaluation: "gated" });
});
