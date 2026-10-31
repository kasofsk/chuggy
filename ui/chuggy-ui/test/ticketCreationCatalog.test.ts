/**
 * A ticket composed under a catalog: the selection draws its program, is sent
 * in place of overrides, survives the YAML editor, an edit and a duplicate,
 * and names only what the catalog holds.
 */

import { expect, test } from "vitest";

import {
  configurationFollowings,
  type ConfigurationFollowing,
} from "../../../src/contract/configurationDocument.ts";
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

/** The catalog offer with its defaults naming the revision its tickets follow. */
function followingOffers(defaulted: ConfigurationFollowing) {
  const offer = creationCatalogOffer();
  const { configuration } = offer.initialization;
  const catalog = JSON.parse(configuration.canonical) as {
    readonly defaults: object;
  };
  return [
    {
      ...offer,
      initialization: {
        ...offer.initialization,
        configuration: {
          ...configuration,
          canonical: JSON.stringify({
            ...catalog,
            defaults: { ...catalog.defaults, configuration: defaulted },
          }),
        },
      },
    },
  ];
}

test("the revision a ticket follows is sent, written and read back as it named it, the catalog's default among them", () => {
  for (const defaulted of configurationFollowings) {
    const following = followingOffers(defaulted);
    const over = { ...context, offers: following };
    for (const configuration of configurationFollowings) {
      const form = creationSelectionChosen(
        { ...catalogForm(), selection: { configuration } },
        following,
        { work: "quick", configuration },
        bound,
      );
      const sent = creationBodyFrom(following, form, bound);
      expect(sent.assembled === "Body" && sent.body.selection).toStrictEqual({
        work: "quick",
        configuration,
      });
      const text = ticketYamlOf(form, over);
      expect(text).toContain(`  configuration: ${configuration}\n`);
      const read = ticketYamlRead(text, over);
      expect(read.problems).toStrictEqual([]);
      expect(read.form).toStrictEqual(form);
    }
  }
});

test("a ticket naming no revision writes none and reads back naming none", () => {
  for (const defaulted of configurationFollowings) {
    const following = followingOffers(defaulted);
    const over = { ...context, offers: following };
    const form = creationSelectionChosen(
      catalogForm(),
      following,
      { work: "quick" },
      bound,
    );
    const text = ticketYamlOf(form, over);
    expect(text).not.toContain("  configuration:");
    const read = ticketYamlRead(text, over);
    expect(read.form?.selection).toStrictEqual({ work: "quick" });
  }
});

test("a revision other than Pinned or Latest is refused at its value, and the vocabulary offers those two", () => {
  const text = "title: t\nintent: i\nselection:\n  configuration: Newest\n";
  const read = ticketYamlRead(text, context);
  expect(read.form).toBe(undefined);
  expect(read.problems.map((problem) => problem.message)).toStrictEqual([
    "name one of Pinned, Latest",
  ]);
  expect(text.slice(read.problems[0]?.from, read.problems[0]?.to)).toBe(
    "Newest",
  );
  const offered = ticketYamlVocabulary(context.base, context).find(
    (key) => key.key === "configuration" && key.place === "Workload",
  );
  expect(offered?.values.map((value) => value.label)).toStrictEqual([
    "Pinned",
    "Latest",
  ]);
});

test("an edit keeps the revision the draft follows", () => {
  const draft = {
    ...creationDraft,
    configurationRevision: "c1",
    selection: { configuration: "Pinned" as const },
  };
  expect(editFormFrom(draft, bound, "c1").selection).toStrictEqual({
    configuration: "Pinned",
  });
});
