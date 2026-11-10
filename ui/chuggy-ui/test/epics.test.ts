/**
 * The epic console logic: the address's view, how progress is drawn, the
 * form's request and the sentences a refusal is drawn as.
 */

import { expect, test } from "vitest";

import { epicListQueryParse } from "../../../src/contract/epics.ts";
import { ticketSearchCharsMax } from "../../../src/contract/http.ts";
import {
  epicDraftRefusal,
  epicFormFaults,
  epicFormFrom,
  epicPickerOptions,
  epicProgressBar,
  epicProgressCounts,
  epicProgressLine,
  epicProgressMovingAny,
  epicStatusLook,
  epicTicketsParsed,
  epicWriteFrom,
  epicWriteRefusal,
  epicsAskOf,
  epicsQueryOf,
  epicsQueryWith,
} from "../app/core/epics.ts";
import { copyTextEn } from "../app/copy/catalog.ts";
import { saidEn } from "./saidEn.ts";
import type { EpicForm } from "../app/core/epics.ts";
import { epicStatusRoster } from "../../../src/contract/responses.ts";
import { phaseTone } from "../app/core/tones.ts";

const form: EpicForm = {
  title: "Billing",
  summary: "",
  description: "Everything about billing",
  visibility: "Active",
  tickets: "#9, 3 3 12",
};

test("an address names only the choices that differ from the defaults", () => {
  expect(epicsQueryOf({})).toStrictEqual({});
  expect(
    epicsQueryOf({ q: " bill ", visibility: "Active", sort: "newest" }),
  ).toStrictEqual({ q: "bill" });
  expect(
    epicsQueryOf({ q: 12, visibility: "Archived", sort: "title" }),
  ).toStrictEqual({ q: "12", visibility: "Archived", sort: "title" });
  expect(epicsQueryOf({ visibility: "Gone", sort: 3 })).toStrictEqual({});
});

test("a search past the server's bound is asked cut to it, as the list's query admits", () => {
  for (const unit of ["x", "🜁"]) {
    const asked = epicsAskOf(
      epicsQueryOf({ q: unit.repeat(ticketSearchCharsMax + 5) }),
    );
    expect(asked.search).toBe(unit.repeat(ticketSearchCharsMax));
    expect(epicListQueryParse({ search: asked.search }).search).toBe(
      asked.search,
    );
  }
});

test("a part of the address is replaced and the rest is kept", () => {
  const query = { q: "bill", sort: "title" } as const;
  expect(epicsQueryWith(query, { visibility: "All" })).toStrictEqual({
    q: "bill",
    sort: "title",
    visibility: "All",
  });
  expect(epicsQueryWith(query, { q: undefined })).toStrictEqual({
    sort: "title",
  });
});

test("the list asks for the defaults an address leaves out", () => {
  expect(epicsAskOf({})).toMatchObject({
    visibility: "Active",
    sort: "newest",
    search: undefined,
  });
  expect(epicsAskOf({ q: "x", visibility: "All" })).toMatchObject({
    search: "x",
    visibility: "All",
  });
});

test("every status the wire speaks has a word and a tone", () => {
  for (const status of epicStatusRoster)
    expect(copyTextEn(epicStatusLook(status).word)).not.toBe("");
});

test("an epic needing attention is drawn in the hue an Escalated ticket is", () => {
  expect(epicStatusLook("attention").tone).toBe(phaseTone("Escalated"));
});

test("progress is said as what is done of what there is", () => {
  const byPhase = {
    Pending: 0,
    Work: 0,
    Evaluation: 0,
    Finalization: 0,
    Done: 0,
    Escalated: 0,
    Revoked: 0,
  };
  expect(
    saidEn(epicProgressLine({ byPhase, drafts: 0, done: 0, total: 0 })),
  ).toBe("no tickets");
  expect(
    saidEn(epicProgressLine({ byPhase, drafts: 0, done: 2, total: 5 })),
  ).toBe("2 of 5 done");
});

const counted = {
  Pending: 0,
  Work: 0,
  Evaluation: 0,
  Finalization: 0,
  Done: 0,
  Escalated: 0,
  Revoked: 0,
};

test("a bar's fill is the rounded share done of the total, and an empty epic's is none", () => {
  expect(
    epicProgressBar({
      byPhase: { ...counted, Done: 1, Pending: 2 },
      drafts: 0,
      done: 1,
      total: 3,
    }),
  ).toStrictEqual({ sharePercent: 33, moving: "Still" });
  expect(
    epicProgressBar({ byPhase: counted, drafts: 0, done: 0, total: 0 })
      .sharePercent,
  ).toBe(0);
});

test("a bar shimmers while a member moves, and sweeps its empty track while nothing is done", () => {
  for (const phase of ["Work", "Evaluation", "Finalization"] as const) {
    const moving = { ...counted, [phase]: 1, Done: 1 };
    expect(
      epicProgressBar({ byPhase: moving, drafts: 0, done: 1, total: 2 }).moving,
      phase,
    ).toBe("Shimmer");
    expect(
      epicProgressMovingAny({ byPhase: moving, drafts: 0, done: 1, total: 2 }),
    ).toBe(true);
  }
  expect(
    epicProgressBar({
      byPhase: { ...counted, Work: 2 },
      drafts: 0,
      done: 0,
      total: 2,
    }).moving,
  ).toBe("Sweep");
  expect(
    epicProgressMovingAny({
      byPhase: { ...counted, Escalated: 1, Pending: 1 },
      drafts: 0,
      done: 0,
      total: 2,
    }),
  ).toBe(false);
});

test("the counts name each phase a member is in, in the phases' order, and none for an empty epic", () => {
  expect(
    epicProgressCounts({
      byPhase: { ...counted, Revoked: 1, Pending: 2, Done: 3 },
      drafts: 0,
      done: 3,
      total: 5,
    }),
  ).toStrictEqual([
    { phase: "Pending", count: 2 },
    { phase: "Done", count: 3 },
    { phase: "Revoked", count: 1 },
  ]);
  expect(
    epicProgressCounts({ byPhase: counted, drafts: 0, done: 0, total: 0 }),
  ).toStrictEqual([]);
});

test("tickets are read from numbers, commas, spaces and hashes", () => {
  expect(epicTicketsParsed("#9, 3 3 12")).toStrictEqual({
    parsed: "Tickets",
    tickets: [9, 3, 3, 12],
  });
  expect(epicTicketsParsed("4, x, 0")).toStrictEqual({
    parsed: "Refused",
    words: ["x", "0"],
  });
  expect(epicTicketsParsed("")).toStrictEqual({
    parsed: "Tickets",
    tickets: [],
  });
});

test("a creation is sent with its tickets once each in order, and a revision at the revision read", () => {
  expect(epicWriteFrom(form, undefined)).toStrictEqual({
    kind: "Create",
    content: {
      title: "Billing",
      description: "Everything about billing",
      visibility: "Active",
      tickets: [3, 9, 12],
    },
  });
  expect(epicWriteFrom(form, { epic: 7, revision: 4 })).toMatchObject({
    kind: "Revise",
    epic: 7,
    expected: 4,
  });
  expect(epicWriteFrom({ ...form, tickets: "x" }, undefined)).toBeUndefined();
});

test("a form reads back as the epic it was made from", () => {
  const read = epicFormFrom({
    number: 7,
    revision: 2,
    title: "Billing",
    summary: "All of it",
    description: "d",
    visibility: "Archived",
    progress: {
      byPhase: {
        Pending: 0,
        Work: 0,
        Evaluation: 0,
        Finalization: 0,
        Done: 0,
        Escalated: 0,
        Revoked: 0,
      },
      drafts: 0,
      done: 0,
      total: 0,
    },
    status: "empty",
    waitingOnOutside: [],
    tickets: [3, 9],
  });
  expect(read).toStrictEqual({
    title: "Billing",
    summary: "All of it",
    description: "d",
    visibility: "Archived",
    tickets: "3, 9",
  });
});

test("a form with no title or unreadable tickets is faulted before it is sent", () => {
  expect(saidEn(epicFormFaults(form))).toStrictEqual([]);
  expect(saidEn(epicFormFaults({ ...form, title: " " }))).toStrictEqual([
    "The title is empty.",
  ]);
  expect(saidEn(epicFormFaults({ ...form, tickets: "q" }))).toStrictEqual([
    "Not ticket numbers: q.",
  ]);
});

test("a stale revision is said to need a reload, and unknown tickets are named", () => {
  expect(
    saidEn(
      epicWriteRefusal({
        outcome: "Conflict",
        code: "StaleRevision",
        body: { current: 5 },
      }),
    ),
  ).toContain("Reload");
  expect(
    saidEn(
      epicWriteRefusal({
        outcome: "Conflict",
        code: "UnknownTickets",
        body: { tickets: [4, 8] },
      }),
    ),
  ).toBe("The project has no ticket #4, #8.");
  expect(saidEn(epicWriteRefusal({ outcome: "Absent" }))).toBe(
    "The epic no longer exists.",
  );
});

test("a draft refused for its epic is said so, and any other refusal is not the epic's", () => {
  expect(
    saidEn(
      epicDraftRefusal({ outcome: "Conflict", code: "ArchivedEpic", body: {} }),
    ),
  ).toContain("archived");
  expect(
    saidEn(
      epicDraftRefusal({ outcome: "Conflict", code: "LargeContent", body: {} }),
    ),
  ).toContain("full");
  expect(
    saidEn(
      epicDraftRefusal({ outcome: "Conflict", code: "MissingEpic", body: {} }),
    ),
  ).toContain("no longer exists");
  expect(
    saidEn(
      epicDraftRefusal({
        outcome: "Conflict",
        code: "DraftInitializationStale",
        body: {},
      }),
    ),
  ).toBeUndefined();
  expect(saidEn(epicDraftRefusal({ outcome: "Absent" }))).toBeUndefined();
});

test("the picker keeps the epic chosen on another page among its options, once", () => {
  const billing = { number: 7, title: "Billing" };
  const shipping = { number: 9, title: "Shipping" };
  expect(epicPickerOptions([billing], shipping)).toEqual([
    { value: "9", text: "Shipping" },
    { value: "7", text: "Billing" },
  ]);
  expect(epicPickerOptions([billing], billing)).toEqual([
    { value: "7", text: "Billing" },
  ]);
  expect(epicPickerOptions([billing], undefined)).toEqual([
    { value: "7", text: "Billing" },
  ]);
});
