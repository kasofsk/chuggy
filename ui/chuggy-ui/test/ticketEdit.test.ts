/**
 * What editing a Pending ticket decides: the form its draft reads back as, the
 * revision that form becomes, the update that releases it, and what the
 * provenance says about the draft beside the live revision.
 *
 * The revision is round-tripped through `draftRevisionSchema` by the assembler
 * itself, so what is checked here is its content: the version it is written
 * against and the dependencies it carries whatever the form holds.
 */

import { expect, test } from "vitest";

import type { DraftResponse } from "../../../src/contract/responses.ts";
import { creationBodyFrom } from "../app/core/ticketCreation.ts";
import {
  draftReleaseLine,
  draftReleaseOf,
  editFormFrom,
  editRevisionFrom,
  ticketRevisionLine,
  ticketUpdateMutation,
} from "../app/core/ticketEdit.ts";
import {
  creationBinding,
  creationDraft,
  creationInitialization,
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
  const form = editFormFrom(released, [creationBinding(repository)]);
  expect(form).toStrictEqual({
    dependencies: [7],
    program: released.authoring.program,
    title: "Ship it",
    intent: "ship the thing",
    links: ["https://example.test/one"],
    checks: ["npm test"],
    branchName: "topic/one",
    targetBranchName: "main",
    repository,
    landingMode: "PullRequest",
  });
  const again = creationBodyFrom(creationInitialization, form, [
    creationBinding(repository),
  ]);
  expect(again.assembled === "Body" && again.body.brief).toStrictEqual(
    released.brief,
  );
});

/** A draft kept from before briefs were stored has none: the form is empty
 * where a person would write, and lands as a form naming no repository does. */
test("a draft with no brief prefills nothing a person writes", () => {
  const form = editFormFrom(unbriefed, [
    creationBinding(repository, "PullRequestMerge"),
  ]);
  expect(form.intent).toBe("");
  expect(form.branchName).toBe("");
  expect(form.landingMode).toBe("Push");
});

test("the revision is written against the draft version it was read at", () => {
  const assembled = editRevisionFrom(
    released,
    creationInitialization,
    editFormFrom(released, [creationBinding(repository)]),
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
    ...editFormFrom(released, [creationBinding(repository)]),
    dependencies: [8],
  };
  const assembled = editRevisionFrom(released, creationInitialization, form, [
    creationBinding(repository),
  ]);
  expect(
    assembled.assembled === "Body" && assembled.body.authoring.dependencies,
  ).toStrictEqual([7]);
});

test("a form fault stops the revision, named as creation names it", () => {
  const form = {
    ...editFormFrom(released, [creationBinding(repository)]),
    intent: "",
  };
  const assembled = editRevisionFrom(released, creationInitialization, form, [
    creationBinding(repository),
  ]);
  expect(
    assembled.assembled === "Faults" &&
      assembled.faults.map((fault) => fault.field),
  ).toStrictEqual(["intent"]);
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
  expect(ticketRevisionLine(2, release)).toBe(
    "revision 2, from draft version 5",
  );
  expect(draftReleaseLine(release)).toBe("nothing unreleased");
});

test("a draft revised past its release says it holds unreleased changes", () => {
  const release = draftReleaseOf({ ...released, authoringVersion: 7 });
  expect(release).toStrictEqual({ release: "Ahead", released: 5, current: 7 });
  expect(ticketRevisionLine(2, release)).toBe(
    "revision 2, from draft version 5",
  );
  expect(draftReleaseLine(release)).toBe("version 7 holds unreleased changes");
});

test("a draft naming no released version is not read as current", () => {
  const release = draftReleaseOf(unbriefed);
  expect(release).toStrictEqual({ release: "Unrecorded" });
  expect(ticketRevisionLine(2, release)).toBe("revision 2");
  expect(draftReleaseLine(release)).not.toBe("nothing unreleased");
});
