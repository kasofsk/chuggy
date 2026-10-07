/**
 * What editing a Pending ticket decides: the form its draft reads back as, the
 * configuration it starts on, the revision that form becomes, the update that
 * releases it, and what the provenance says about the draft beside the live
 * revision.
 *
 * The revision is round-tripped through `draftRevisionSchema` by the assembler
 * itself, so what is checked here is its content: the version it is written
 * against and the dependencies it carries whatever the form holds.
 */

import { expect, test } from "vitest";

import type { DraftResponse } from "../../../src/contract/responses.ts";
import {
  creationBodyFrom,
  creationConfigurationsOffered,
} from "../app/core/ticketCreation.ts";
import {
  draftReleaseOf,
  draftUnreleasedLabel,
  editFormFrom,
  editOfferListed,
  editOffersFrom,
  editRevisionFrom,
  ticketUpdateMutation,
} from "../app/core/ticketEdit.ts";
import {
  creationBinding,
  creationDeclared,
  creationDraft,
  creationInitialization,
  creationOffer,
  creationOffers,
  creationSummary,
} from "./ticketCreationFixture.ts";
import { ticketInstants } from "./ticketInstants.ts";

const repository = "https://forge.test/kasofsk/chuggy";

/** A released draft as a ticket kept from before either field was read back. */
const unbriefed: DraftResponse = {
  ...creationDraft,
  state: "Released",
  authoringVersion: 5,
  authoring: {
    dependencies: [7],
    program: [{ key: 1, evaluators: [{ key: 1 }, { key: 2 }] }],
  },
};

const released: DraftResponse = {
  ...unbriefed,
  releasedAuthoringVersion: 5,
  brief: {
    title: "Ship it",
    intent: "ship the thing",
    links: ["https://example.test/one"],
    checks: ["npm test"],
    repository,
    branch: "refs/heads/topic/one",
    finalization: { mode: "PullRequest", target: "refs/heads/main" },
  },
};

test("a draft reads back as the form that would revise it to itself", () => {
  const form = editFormFrom(released, [creationBinding(repository)], "r3");
  expect(form).toStrictEqual({
    dependencies: [7],
    program: released.authoring.program,
    configuration: "r3",
    title: "Ship it",
    intent: "ship the thing",
    links: ["https://example.test/one"],
    checks: ["npm test"],
    branchName: "topic/one",
    targetBranchName: "main",
    repository,
    landingMode: "PullRequest",
  });
  const commanding = [creationOffer(undefined, { commandedCheckStage: 1 })];
  const again = creationBodyFrom(commanding, form, [
    creationBinding(repository),
  ]);
  expect(again.assembled === "Body" && again.body.brief).toStrictEqual(
    released.brief,
  );
});

/** A draft kept from before briefs were stored has none: the form is empty
 * where a person would write, and lands as a form naming no repository does. */
test("a draft with no brief prefills nothing a person writes", () => {
  const form = editFormFrom(
    unbriefed,
    [creationBinding(repository, "PullRequestMerge")],
    "r3",
  );
  expect(form.intent).toBe("");
  expect(form.branchName).toBe("");
  expect(form.landingMode).toBe("Push");
});

test("the revision is written against the draft version it was read at", () => {
  const assembled = editRevisionFrom(
    released,
    creationOffers,
    editFormFrom(released, [creationBinding(repository)], "r3"),
    [creationBinding(repository)],
  );
  expect(assembled.assembled === "Body" && assembled.body).toMatchObject({
    expectedVersion: 5,
    configurationRevision: creationInitialization.configuration.revision,
  });
});

/** The screen draws no dependency picker, and the revision does not trust that
 * it did not: a form holding other dependencies still sends the draft's. */
test("the revision carries the draft's own dependencies whatever the form holds", () => {
  const form = {
    ...editFormFrom(released, [creationBinding(repository)], "r3"),
    dependencies: [8],
  };
  const assembled = editRevisionFrom(released, creationOffers, form, [
    creationBinding(repository),
  ]);
  expect(
    assembled.assembled === "Body" && assembled.body.authoring.dependencies,
  ).toStrictEqual([7]);
});

test("a form fault stops the revision, named as creation names it", () => {
  const form = {
    ...editFormFrom(released, [creationBinding(repository)], "r3"),
    intent: "",
  };
  const assembled = editRevisionFrom(released, creationOffers, form, [
    creationBinding(repository),
  ]);
  expect(
    assembled.assembled === "Faults" &&
      assembled.faults.map((fault) => fault.field),
  ).toStrictEqual(["intent"]);
});

/** What the repository's newest commit declares, in name order, the first a
 * draft's own name and the second the one a first-ready rule would take. */
const development = creationOffer(
  creationDeclared("n-development", repository, "development"),
);
const sonnet = creationOffer(
  creationDeclared("n-sonnet", repository, "development-sonnet"),
);
const declared = [development, sonnet];

/** A draft pinned at an older commit's revision of one declared name. */
function pinned(name: string, revision: string): DraftResponse {
  return {
    ...released,
    configurationRevision: revision,
    configurationVersion: { name, number: 3 },
  };
}

function revisionPinned(
  draft: DraftResponse,
  edit: ReturnType<typeof editOffersFrom>,
): string | undefined {
  const bound = [creationBinding(repository)];
  const assembled = editRevisionFrom(
    draft,
    edit.offers,
    { ...editFormFrom(draft, bound, edit.configuration), title: "Renamed" },
    bound,
  );
  return assembled.assembled === "Body"
    ? assembled.body.configurationRevision
    : undefined;
}

/**
 * The edit of a title is the case that moved tickets: the form took the first
 * ready revision listed, which is another name's wherever a repository
 * declares more than one.
 */
test("an edit starts on the name its draft holds, at that name's newest revision", () => {
  const draft = pinned("development", "o-development");
  expect(editOfferListed(draft, declared)).toBe(true);
  const edit = editOffersFrom(draft, declared, undefined);
  expect(edit).toStrictEqual({
    offers: declared,
    configuration: "development",
  });
  expect(revisionPinned(draft, edit)).toBe("n-development");
});

test("a draft at a revision still offered starts on it", () => {
  const draft = pinned("development-sonnet", "n-sonnet");
  expect(editOffersFrom(draft, declared, undefined).configuration).toBe(
    "development-sonnet",
  );
});

test("a draft whose name is no longer offered is offered its own revision, and keeps it", () => {
  const draft = pinned("development-opus", "o-opus");
  expect(editOfferListed(draft, declared)).toBe(false);
  const own = creationOffer(creationSummary("o-opus", "Ready")).initialization;
  const edit = editOffersFrom(draft, declared, own);
  expect(edit.configuration).toBe("development-opus");
  expect(edit.offers).toStrictEqual([
    { name: "development-opus", listed: undefined, initialization: own },
    ...declared,
  ]);
  expect(revisionPinned(draft, edit)).toBe("o-opus");
});

test("a draft whose own revision could not be read starts on no configuration", () => {
  const draft = pinned("development-opus", "o-opus");
  const edit = editOffersFrom(draft, declared, undefined);
  expect(edit).toStrictEqual({ offers: declared, configuration: "" });
  expect(revisionPinned(draft, edit)).toBe(undefined);
});

/** An initialization read for the revision a draft held before somebody else
 * revised it would pin the ticket back to that one. */
test("an initialization of another revision than the draft holds keeps nothing", () => {
  const draft = pinned("development-opus", "o-opus");
  const other = creationOffer(
    creationSummary("o-older", "Ready"),
  ).initialization;
  expect(editOffersFrom(draft, declared, other)).toStrictEqual({
    offers: declared,
    configuration: "",
  });
});

/** An authored revision has no name but itself, so a newer authored one is
 * another configuration and not a later revision of this draft's. */
test("an authored draft keeps its revision where the project offers another", () => {
  const offers = [creationOffer(creationSummary("r5", "Ready"))];
  expect(editOfferListed(creationDraft, offers)).toBe(false);
  expect(editOfferListed(creationDraft, creationOffers)).toBe(true);
});

test("a name two repositories declare does not say which of them a draft came from", () => {
  const elsewhere = "https://forge.test/gdoteof/scratch";
  const shared = [
    development,
    creationOffer(creationDeclared("s-development", elsewhere, "development")),
  ];
  expect(editOfferListed(pinned("development", "o-development"), shared)).toBe(
    false,
  );
  expect(editOfferListed(pinned("development", "s-development"), shared)).toBe(
    true,
  );
});

/**
 * A form holds the name an offer is chosen by, and that is not the draft's
 * where two repositories declare one name and each is told apart by its own.
 */
test("an edit of a draft at an offered revision starts on the name that offer is chosen by", () => {
  const elsewhere = "https://forge.test/gdoteof/scratch";
  const offered = creationConfigurationsOffered(
    [
      creationDeclared("s-development", elsewhere, "development"),
      creationDeclared("n-development", repository, "development"),
    ],
    [creationBinding(repository), creationBinding(elsewhere)],
  );
  const shared = offered.map((one) => ({
    ...creationOffer(one.listed),
    name: one.name,
  }));
  const draft = pinned("development", "s-development");
  const edit = editOffersFrom(draft, shared, undefined);
  expect(edit.configuration).toBe("development · gdoteof/scratch");
  expect(revisionPinned(draft, edit)).toBe("s-development");
});

test("the update names the revision the ticket was read at and the draft revised", () => {
  expect(
    ticketUpdateMutation(
      {
        ticket: 12,
        phase: "Pending",
        sequence: 9,
        ...ticketInstants,
        revision: 3,
      },
      { ...released, authoringVersion: 6 },
    ),
  ).toStrictEqual({
    mutation: "UpdateTicket",
    ticket: 12,
    expectedRevision: 3,
    authoringVersion: 6,
    configurationRevision: released.configurationRevision,
  });
});

test("a draft at the version its ticket was released from holds nothing unreleased", () => {
  const release = draftReleaseOf(released);
  expect(release).toStrictEqual({ release: "Current", released: 5 });
});

test("a draft revised past its release says it holds unreleased changes", () => {
  const release = draftReleaseOf({ ...released, authoringVersion: 7 });
  expect(release).toStrictEqual({ release: "Ahead", released: 5, current: 7 });
});

test("a draft naming no released version is not read as current", () => {
  const release = draftReleaseOf(unbriefed);
  expect(release).toStrictEqual({ release: "Unrecorded" });
});

test("the short label counts what the sentence spells out", () => {
  expect(draftUnreleasedLabel(draftReleaseOf(released))).toBe(
    "Nothing unreleased",
  );
  expect(
    draftUnreleasedLabel(draftReleaseOf({ ...released, authoringVersion: 7 })),
  ).toBe("2 unreleased");
  expect(draftUnreleasedLabel(draftReleaseOf(unbriefed))).toBe("Not recorded");
});
