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
    bound,
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

test("selecting a finalizer that names a landing seeds the form with it, and a landing the reader moved stands", () => {
  const offer = creationCatalogOffer();
  const { configuration } = offer.initialization;
  const catalog = JSON.parse(configuration.canonical) as {
    finalizers: Record<string, unknown>;
  };
  catalog.finalizers["proposed"] = {
    landing: { mode: "PullRequest", target: "refs/heads/release" },
  };
  const landed = [
    {
      ...offer,
      initialization: {
        ...offer.initialization,
        configuration: { ...configuration, canonical: JSON.stringify(catalog) },
      },
    },
  ];
  const form = creationFormFrom(landed, bound);
  expect([form.landingMode, form.targetBranchName]).toStrictEqual(["Push", ""]);
  const proposed = creationSelectionChosen(
    form,
    landed,
    { finalization: "proposed" },
    bound,
  );
  expect([proposed.landingMode, proposed.targetBranchName]).toStrictEqual([
    "PullRequest",
    "release",
  ]);
  const back = creationSelectionChosen(proposed, landed, {}, bound);
  expect([back.landingMode, back.targetBranchName]).toStrictEqual(["Push", ""]);
  const moved = creationSelectionChosen(
    { ...form, landingMode: "None" },
    landed,
    { finalization: "proposed" },
    bound,
  );
  expect(moved.landingMode).toBe("None");
});

test("a reader who may not skip planned evaluations is refused a program running less than its plan, and one who may is not", () => {
  const form = creationSelectionChosen(
    catalogForm(),
    offers,
    { evaluation: "gated" },
    bound,
  );
  const whole = creationBodyFrom(offers, form, bound, {
    mayOverride: true,
    maySkipPlanned: false,
  });
  expect(whole.assembled).toBe("Body");
  const [first, second] = form.program;
  if (first === undefined || second === undefined) return;
  const narrowed = { ...first, evaluators: first.evaluators.slice(0, 1) };
  for (const program of [[first], [narrowed, second]]) {
    const short = { ...form, program };
    const refused = creationBodyFrom(offers, short, bound, {
      mayOverride: true,
      maySkipPlanned: false,
    });
    const faults = refused.assembled === "Faults" ? refused.faults : [];
    expect(faults.map((fault) => fault.field)).toStrictEqual(["authoring"]);
    expect(faults[0]?.reason).toMatch(/may not leave out part of the plan/u);
    for (const standing of [
      { mayOverride: true, maySkipPlanned: true },
      { mayOverride: true },
      undefined,
    ])
      expect(creationBodyFrom(offers, short, bound, standing).assembled).toBe(
        "Body",
      );
  }
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
  const form = creationSelectionChosen(
    catalogForm(),
    offers,
    {
      evaluation: "gated",
      finalization: "approved",
    },
    [],
  );
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
