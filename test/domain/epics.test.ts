/**
 * The epic write rule and the figures derived from members' phases.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  applyEpic,
  decideEpic,
  epicDraftDeleted,
  epicContentBytesMax,
  epicProgress,
  epicStatus,
  epicSummaryCharsMax,
  epicTicketsMax,
  epicTitleCharsMax,
  type EpicCommand,
  type EpicContent,
  type EpicMemberState,
  type EpicState,
} from "../../src/domain/epics.ts";
import type { Phase } from "../../src/domain/phase.ts";

const everyTicket = (): boolean => true;
const noTicket = (): boolean => false;

function content(patch: Partial<EpicContent> = {}): EpicContent {
  return {
    title: "Epic",
    description: "About",
    visibility: "Active",
    tickets: [1, 2],
    ...patch,
  };
}

function save(state: EpicState, command: EpicCommand): EpicState {
  const outcome = decideEpic(state, command, everyTicket);
  assert.equal(outcome.kind, "Saved");
  return applyEpic(state, command, outcome);
}

const empty: EpicState = new Map();

test("epics are numbered from 1 without a gap, refused writes taking no number", () => {
  const refused = decideEpic(
    empty,
    { kind: "Create", content: content({ title: " " }) },
    everyTicket,
  );
  assert.equal(refused.kind, "Refused");
  let state = save(empty, { kind: "Create", content: content() });
  state = save(state, { kind: "Create", content: content() });
  assert.deepEqual([...state.keys()], [1, 2]);
  assert.deepEqual(
    decideEpic(state, { kind: "Create", content: content() }, everyTicket),
    { kind: "Saved", epic: 3, revision: 1 },
  );
});

test("a revise of a missing epic is refused MissingEpic", () => {
  assert.deepEqual(
    decideEpic(
      empty,
      { kind: "Revise", epic: 1, expected: 1, content: content() },
      everyTicket,
    ),
    { kind: "Refused", reason: "MissingEpic" },
  );
});

test("a revise against a stale revision names the current one", () => {
  const state = save(empty, { kind: "Create", content: content() });
  assert.deepEqual(
    decideEpic(
      state,
      { kind: "Revise", epic: 1, expected: 5, content: content() },
      everyTicket,
    ),
    { kind: "Refused", reason: "StaleRevision", current: 1 },
  );
});

test("a revise at the current revision saves the next one", () => {
  const state = save(empty, { kind: "Create", content: content() });
  assert.deepEqual(
    decideEpic(
      state,
      { kind: "Revise", epic: 1, expected: 1, content: content() },
      everyTicket,
    ),
    { kind: "Saved", epic: 1, revision: 2 },
  );
});

test("an Archived epic that stays Archived cannot change its members, and the revise that reactivates it can", () => {
  const archived = save(empty, {
    kind: "Create",
    content: content({ visibility: "Archived" }),
  });
  const revise = (patch: Partial<EpicContent>): EpicCommand => ({
    kind: "Revise",
    epic: 1,
    expected: 1,
    content: content({ visibility: "Archived", ...patch }),
  });
  assert.deepEqual(
    decideEpic(archived, revise({ tickets: [1] }), everyTicket),
    {
      kind: "Refused",
      reason: "ArchivedEpic",
    },
  );
  assert.deepEqual(
    decideEpic(archived, revise({ tickets: [1, 2, 3] }), everyTicket),
    { kind: "Refused", reason: "ArchivedEpic" },
  );
  assert.equal(
    decideEpic(archived, revise({ title: "Renamed" }), everyTicket).kind,
    "Saved",
  );
  assert.equal(
    decideEpic(
      archived,
      revise({ visibility: "Active", tickets: [9] }),
      everyTicket,
    ).kind,
    "Saved",
  );
});

test("content is refused at each bound and accepted on it", () => {
  const create = (patch: Partial<EpicContent>) =>
    decideEpic(empty, { kind: "Create", content: content(patch) }, everyTicket);
  assert.equal(create({ title: "x".repeat(epicTitleCharsMax) }).kind, "Saved");
  assert.deepEqual(create({ title: "" }), {
    kind: "Refused",
    reason: "EmptyTitle",
  });
  assert.deepEqual(create({ title: "x".repeat(epicTitleCharsMax + 1) }), {
    kind: "Refused",
    reason: "LongTitle",
  });
  assert.equal(
    create({ title: "\u{1F600}".repeat(epicTitleCharsMax) }).kind,
    "Saved",
  );
  assert.equal(
    create({ summary: "x".repeat(epicSummaryCharsMax) }).kind,
    "Saved",
  );
  assert.deepEqual(create({ summary: "x".repeat(epicSummaryCharsMax + 1) }), {
    kind: "Refused",
    reason: "LongSummary",
  });
  assert.deepEqual(create({ description: "x".repeat(epicContentBytesMax) }), {
    kind: "Refused",
    reason: "LargeContent",
  });
  const members = (count: number) =>
    Array.from({ length: count }, (_, index) => index + 1);
  assert.equal(create({ tickets: members(epicTicketsMax) }).kind, "Saved");
  assert.deepEqual(create({ tickets: members(epicTicketsMax + 1) }), {
    kind: "Refused",
    reason: "ManyTickets",
  });
});

test("a title of whitespace alone is empty, whichever whitespace it is", () => {
  for (const blank of ["\t", "\n", "\u00a0", "\u3000", "\ufeff"])
    assert.deepEqual(
      decideEpic(
        empty,
        { kind: "Create", content: content({ title: blank }) },
        everyTicket,
      ),
      { kind: "Refused", reason: "EmptyTitle" },
    );
});

test("content the wire would never hand over is a fault, not a refusal", () => {
  const decide =
    (patch: Partial<EpicContent>, state: EpicState = empty) =>
    () =>
      decideEpic(
        state,
        { kind: "Create", content: content(patch) },
        everyTicket,
      );
  assert.throws(decide({ tickets: [2, 1] }), /ascending/u);
  assert.throws(decide({ tickets: [1, 1] }), /ascending/u);
  assert.throws(decide({ tickets: [0] }), /not a ticket number/u);
  assert.throws(decide({ summary: " " }), /blank summary/u);
  const gapped: EpicState = new Map([[2, { revision: 1, content: content() }]]);
  assert.throws(decide({}, gapped), /epic 1 is missing/u);
});

test("the byte bound weighs canonical JSON in UTF-8, not characters", () => {
  const overhead = JSON.stringify({
    description: "",
    tickets: [],
    title: "Epic",
    visibility: "Active",
  }).length;
  const fit = (characters: number, text: string) =>
    decideEpic(
      empty,
      {
        kind: "Create",
        content: content({
          tickets: [],
          description: text.repeat(characters),
        }),
      },
      everyTicket,
    ).kind;
  assert.equal(fit(epicContentBytesMax - overhead, "x"), "Saved");
  assert.equal(fit(epicContentBytesMax - overhead + 1, "x"), "Refused");
  assert.equal(
    fit(Math.floor((epicContentBytesMax - overhead) / 2), "é"),
    "Saved",
  );
  assert.equal(
    fit(Math.floor((epicContentBytesMax - overhead) / 2) + 1, "é"),
    "Refused",
  );
});

test("members the project does not hold are named", () => {
  assert.deepEqual(
    decideEpic(
      empty,
      { kind: "Create", content: content({ tickets: [1, 2, 3] }) },
      (ticket) => ticket === 2,
    ),
    { kind: "Refused", reason: "UnknownTickets", tickets: [1, 3] },
  );
  assert.equal(
    decideEpic(
      empty,
      { kind: "Create", content: content({ tickets: [] }) },
      noTicket,
    ).kind,
    "Saved",
  );
});

test("a refused write leaves the state as it was", () => {
  const state = save(empty, { kind: "Create", content: content() });
  const command: EpicCommand = {
    kind: "Revise",
    epic: 1,
    expected: 9,
    content: content({ title: "Other" }),
  };
  assert.equal(
    applyEpic(state, command, decideEpic(state, command, everyTicket)),
    state,
  );
});

test("a deleted draft leaves every epic holding it, an Archived one included, each at its next revision", () => {
  let state = save(empty, { kind: "Create", content: content() });
  state = save(state, {
    kind: "Create",
    content: content({ visibility: "Archived", tickets: [2, 3] }),
  });
  state = save(state, { kind: "Create", content: content({ tickets: [3] }) });
  const after = epicDraftDeleted(state, 2);
  assert.deepEqual(after.get(1), {
    revision: 2,
    content: content({ tickets: [1] }),
  });
  assert.deepEqual(after.get(2), {
    revision: 2,
    content: content({ visibility: "Archived", tickets: [3] }),
  });
  assert.equal(after.get(3), state.get(3));
});

function phases(
  counts: Partial<Record<EpicMemberState, number>>,
): EpicMemberState[] {
  return Object.entries(counts).flatMap(([phase, count]) =>
    Array.from({ length: count }, () => phase as EpicMemberState),
  );
}

test("progress counts members by phase and leaves Revoked out of the total", () => {
  const progress = epicProgress(
    phases({ Pending: 2, Work: 1, Done: 3, Revoked: 4 }),
  );
  assert.equal(progress.done, 3);
  assert.equal(progress.drafts, 0);
  assert.equal(progress.total, 6);
  assert.deepEqual(progress.byPhase, {
    Pending: 2,
    Work: 1,
    Evaluation: 0,
    Finalization: 0,
    Done: 3,
    Escalated: 0,
    Revoked: 4,
  });
});

test("a draft member counts in the total as one not yet started", () => {
  const progress = epicProgress(phases({ Draft: 2, Pending: 1, Done: 1 }));
  assert.equal(progress.drafts, 2);
  assert.equal(progress.total, 4);
  assert.equal(progress.byPhase.Pending, 1);
  const status = (counts: Partial<Record<EpicMemberState, number>>) =>
    epicStatus(epicProgress(phases(counts)));
  assert.equal(status({ Draft: 3 }), "not_started");
  assert.equal(status({ Draft: 1, Pending: 1, Revoked: 1 }), "not_started");
  assert.equal(status({ Draft: 1, Done: 1 }), "in_progress");
  assert.equal(status({ Draft: 1, Escalated: 1 }), "attention");
});

test("status is the first that holds, in order", () => {
  const status = (counts: Partial<Record<Phase, number>>) =>
    epicStatus(epicProgress(phases(counts)));
  assert.equal(status({}), "empty");
  assert.equal(status({ Revoked: 2 }), "empty");
  assert.equal(status({ Done: 1, Revoked: 1 }), "done");
  assert.equal(status({ Done: 1, Escalated: 1 }), "attention");
  assert.equal(status({ Pending: 1, Escalated: 1, Work: 1 }), "attention");
  assert.equal(status({ Pending: 2, Revoked: 1 }), "not_started");
  assert.equal(status({ Pending: 1, Done: 1 }), "in_progress");
  assert.equal(status({ Work: 1 }), "in_progress");
  assert.equal(status({ Evaluation: 1, Pending: 1 }), "in_progress");
});
