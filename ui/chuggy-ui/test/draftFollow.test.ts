/**
 * What an editor following a server draft decides over each revision it
 * observes: whether its form is drawn again, left standing behind, moved onto
 * its own write, or told the draft closed, and what a creation following it
 * goes back to.
 *
 * The form here is the title alone, because what is decided turns on whether
 * two forms agree and on nothing a ticket's form holds beyond that.
 */

import { expect, test } from "vitest";

import type { DraftResponse } from "../../../src/contract/responses.ts";
import {
  draftFollowBehindChoice,
  draftFollowBehindSentence,
  draftFollowClosedOf,
  draftFollowClosedSentence,
  draftFollowCreationHeld,
  draftFollowed,
  draftFollowKept,
  draftFollowOpened,
  draftFollowStandingOf,
  draftFollowTaken,
  draftFollowTouched,
  draftFollowEdited,
  draftFollowNewest,
  draftFollowSaveable,
} from "../app/core/draftFollow.ts";
import type { DraftFollowHeld } from "../app/core/draftFollow.ts";
import type { CreationDraftHeld } from "../app/core/ticketCreationRun.ts";
import { creationBody, creationDraft } from "./ticketCreationFixture.ts";

interface Form {
  readonly title: string;
}

function draftAt(
  version: number,
  title: string,
  state: DraftResponse["state"] = "Draft",
): DraftResponse {
  return {
    ...creationDraft,
    authoringVersion: version,
    state,
    brief: { title, intent: "ship it", links: [] },
  };
}

function formOf(draft: DraftResponse): Form {
  return { title: draft.brief?.title ?? "" };
}

const three = draftAt(3, "Ship it");
const four = draftAt(4, "Shipped by the agent");

function opened(): DraftFollowHeld<Form> {
  return draftFollowOpened<Form>(three, undefined);
}

function typed(title: string): DraftFollowHeld<Form> {
  return { ...opened(), edited: { title } };
}

function observing(
  current: DraftResponse,
  over: { readonly own?: DraftResponse; readonly busy?: boolean } = {},
) {
  return { current, own: over.own, busy: over.busy ?? false };
}

test("an editor opens on the draft as it is, holding nothing of its own", () => {
  expect(opened()).toStrictEqual({
    base: three,
    version: 3,
    edited: undefined,
    authored: false,
    seeding: 0,
  });
});

test("a YAML copy this browser kept stands on the version kept beside it", () => {
  const held = draftFollowOpened<Form>(four, { version: 3 });
  expect(held.version).toBe(3);
  expect(held.authored).toBe(true);
  expect(draftFollowStandingOf(held, observing(four), formOf)).toStrictEqual({
    standing: "Behind",
    current: four,
  });
});

test.each([
  ["no version beside it", undefined],
  ["a version past the draft's", 9],
])("a kept copy with %s stands on the draft as it is", (_said, version) => {
  const held = draftFollowOpened<Form>(four, { version });
  expect(held.version).toBe(4);
  expect(draftFollowStandingOf(held, observing(four), formOf)).toStrictEqual({
    standing: "Current",
  });
});

test("a form is touched by typing that differs from its base, or by YAML of its author's", () => {
  expect(draftFollowTouched(opened(), formOf)).toBe(false);
  expect(draftFollowTouched(typed("Ship it"), formOf)).toBe(false);
  expect(draftFollowTouched(typed("Mine"), formOf)).toBe(true);
  expect(draftFollowTouched({ ...opened(), authored: true }, formOf)).toBe(
    true,
  );
});

test("an untouched form is drawn again from a newer revision", () => {
  expect(
    draftFollowed(typed("Ship it"), observing(four), formOf),
  ).toStrictEqual({
    base: four,
    version: 4,
    edited: undefined,
    authored: false,
    seeding: 1,
  });
});

test("a touched form is left as it is under a newer revision, and stands behind it", () => {
  const held = typed("Mine");
  expect(draftFollowed(held, observing(four), formOf)).toBe(held);
  expect(draftFollowStandingOf(held, observing(four), formOf)).toStrictEqual({
    standing: "Behind",
    current: four,
  });
});

test("YAML of the author's is never redrawn under them, even saying what its base says", () => {
  const held = { ...opened(), authored: true };
  expect(draftFollowed(held, observing(four), formOf)).toBe(held);
  expect(draftFollowStandingOf(held, observing(four), formOf).standing).toBe(
    "Behind",
  );
});

test("a revision no newer than the one stood on moves nothing", () => {
  const held = typed("Mine");
  expect(draftFollowed(held, observing(three), formOf)).toBe(held);
  expect(draftFollowStandingOf(held, observing(three), formOf)).toStrictEqual({
    standing: "Current",
  });
});

test("nothing is judged while the editor's own submit runs", () => {
  const held = typed("Mine");
  const running = observing(four, { busy: true });
  expect(draftFollowed(opened(), running, formOf)).toStrictEqual(opened());
  expect(draftFollowStandingOf(held, running, formOf)).toStrictEqual({
    standing: "Current",
  });
});

test("the editor's own write moves what it stands on and keeps what is typed", () => {
  const own = draftAt(4, "Mine");
  const held = typed("Mine");
  const moved = draftFollowed(held, observing(three, { own }), formOf);
  expect(moved).toStrictEqual({ ...held, base: own, version: 4 });
  expect(draftFollowed(moved, observing(own, { own }), formOf)).toBe(moved);
  expect(
    draftFollowStandingOf(moved, observing(own, { own }), formOf),
  ).toStrictEqual({ standing: "Current" });
});

test("a revision past the editor's own write still leaves a touched form behind it", () => {
  const own = draftAt(4, "Mine");
  const five = draftAt(5, "The agent again");
  const held = typed("Mine");
  expect(draftFollowed(held, observing(five, { own }), formOf)).toBe(held);
  expect(
    draftFollowStandingOf(held, observing(five, { own }), formOf).standing,
  ).toBe("Behind");
});

test("taking theirs draws the form afresh from the draft and drops what was typed", () => {
  expect(
    draftFollowTaken({ ...typed("Mine"), authored: true }, four),
  ).toStrictEqual({
    base: four,
    version: 4,
    edited: undefined,
    authored: false,
    seeding: 1,
  });
});

test("keeping one's own stands what is typed on the draft as it is now", () => {
  const kept = draftFollowKept({ ...typed("Mine"), authored: true }, four);
  expect(kept).toStrictEqual({
    base: four,
    version: 4,
    edited: { title: "Mine" },
    authored: true,
    seeding: 0,
  });
  expect(draftFollowStandingOf(kept, observing(four), formOf)).toStrictEqual({
    standing: "Current",
  });
});

test("a draft deleted under the editor is said, and moves nothing", () => {
  const deleted = draftAt(4, "Ship it", "Deleted");
  expect(draftFollowed(opened(), observing(deleted), formOf)).toStrictEqual(
    opened(),
  );
  expect(
    draftFollowStandingOf(opened(), observing(deleted), formOf),
  ).toStrictEqual({ standing: "Deleted", ticket: 12 });
});

test("a draft released under an editor that opened it unreleased is said", () => {
  const released = draftAt(4, "Ship it", "Released");
  expect(
    draftFollowStandingOf(typed("Mine"), observing(released), formOf),
  ).toStrictEqual({ standing: "Released", ticket: 12 });
  expect(draftFollowed(opened(), observing(released), formOf)).toStrictEqual(
    opened(),
  );
});

test("a released ticket's own draft, revised, is followed like any other", () => {
  const base = draftAt(3, "Ship it", "Released");
  const revised = draftAt(4, "Shipped by the agent", "Released");
  const held = draftFollowOpened<Form>(base, undefined);
  expect(draftFollowed(held, observing(revised), formOf).base).toBe(revised);
  expect(
    draftFollowStandingOf(
      { ...held, edited: { title: "Mine" } },
      observing(revised),
      formOf,
    ).standing,
  ).toBe("Behind");
});

test.each([
  ["Draft", undefined],
  ["Released", { standing: "Released", ticket: 12 }],
  ["Deleted", { standing: "Deleted", ticket: 12 }],
] as const)("a draft opened %s is closed as %o", (state, closed) => {
  expect(draftFollowClosedOf(draftAt(3, "Ship it", state))).toStrictEqual(
    closed,
  );
});

const written: CreationDraftHeld = {
  draft: draftAt(4, "Mine"),
  origin: "Followed",
  body: creationBody,
  operation: "op-1",
  unsettled: false,
};

test("a creation following a draft no submit has written goes back to its base, knowing nothing of what wrote it", () => {
  expect(
    draftFollowCreationHeld(undefined, { base: three, version: 3 }, "op-2"),
  ).toStrictEqual({
    draft: three,
    origin: "Followed",
    body: undefined,
    operation: "op-2",
    unsettled: false,
  });
});

test("a creation goes back to what its last submit wrote, and forgets what wrote it once it stands past it", () => {
  expect(
    draftFollowCreationHeld(written, { base: four, version: 4 }, "op-2"),
  ).toBe(written);
  expect(
    draftFollowCreationHeld(written, { base: four, version: 5 }, "op-2"),
  ).toStrictEqual({ ...written, body: undefined });
});

test("each standing is said in a sentence of its own", () => {
  expect(draftFollowBehindSentence(12)).toBe(
    "Draft 12 changed while you were editing; your edits are kept.",
  );
  expect(draftFollowBehindChoice).toBe(
    "Take theirs to drop your edits, or keep yours to replace its new revision with the whole ticket as it is here.",
  );
  expect(draftFollowClosedSentence({ standing: "Released", ticket: 12 })).toBe(
    "Draft 12 was released as ticket 12, so there is nothing left here to release.",
  );
  expect(draftFollowClosedSentence({ standing: "Deleted", ticket: 12 })).toBe(
    "Draft 12 was deleted, so there is nothing left here to release.",
  );
});

test("a form is edited where it says anything its base does not, whatever it was typed through", () => {
  const base = { title: "Ship it", links: [] };
  expect(draftFollowEdited(base, { ...base })).toBe(false);
  expect(draftFollowEdited({ ...base, title: "Mine" }, base)).toBe(true);
});

test("the newer of an editor's own writes is the one it stands on, and either may be absent", () => {
  const older = creationDraft;
  const newer = { ...creationDraft, authoringVersion: 4 };
  expect(draftFollowNewest(older, newer)).toBe(newer);
  expect(draftFollowNewest(newer, older)).toBe(newer);
  expect(draftFollowNewest(undefined, older)).toBe(older);
  expect(draftFollowNewest(older, undefined)).toBe(older);
  expect(draftFollowNewest(undefined, undefined)).toBeUndefined();
});

test("an editor saves only to a draft that has not closed under it", () => {
  expect(draftFollowSaveable({ standing: "Current" })).toBe(true);
  expect(
    draftFollowSaveable({ standing: "Behind", current: creationDraft }),
  ).toBe(true);
  expect(draftFollowSaveable({ standing: "Released", ticket: 12 })).toBe(false);
  expect(draftFollowSaveable({ standing: "Deleted", ticket: 12 })).toBe(false);
});
