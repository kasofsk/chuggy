/**
 * The epic wire: content normalization, the two writes, the query grammar, and
 * the limits held equal to the ones the domain decides by.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  epicContentSchema,
  epicHistoryQueryParse,
  epicListQueryParse,
  epicPageLimitDefault,
  epicPageLimitMax,
  epicWriteRequestParse,
  epicContentBytesMax,
  epicSummaryCharsMax,
  epicTicketsMax,
  epicTitleCharsMax,
  epicVisibilitySchema,
} from "../../src/contract/epics.ts";
import { ticketSearchCharsMax } from "../../src/contract/http.ts";
import { epicStatusRoster } from "../../src/contract/responses.ts";
import * as domain from "../../src/domain/epics.ts";

test("the wire's limits are the ones the domain decides by", () => {
  assert.equal(epicTitleCharsMax, domain.epicTitleCharsMax);
  assert.equal(epicSummaryCharsMax, domain.epicSummaryCharsMax);
  assert.equal(epicTicketsMax, domain.epicTicketsMax);
  assert.equal(epicContentBytesMax, domain.epicContentBytesMax);
});

test("the wire's statuses and visibilities are the domain's, in its order", () => {
  assert.deepEqual([...epicStatusRoster], [...domain.epicStatuses]);
  assert.deepEqual(epicVisibilitySchema.options, [...domain.epicVisibilities]);
});

test("content sorts and dedupes its tickets and reads a blank summary as none", () => {
  const parsed = epicContentSchema.parse({
    title: "T",
    summary: "  \n",
    description: "D",
    visibility: "Active",
    tickets: [3, 1, 3, 2],
  });
  assert.deepEqual(parsed, {
    title: "T",
    description: "D",
    visibility: "Active",
    tickets: [1, 2, 3],
  });
  assert.equal("summary" in parsed, false);
});

test("content keeps a summary that says something", () => {
  const parsed = epicContentSchema.parse({
    title: "T",
    summary: "Short",
    description: "",
    visibility: "Archived",
    tickets: [],
  });
  assert.equal(parsed.summary, "Short");
});

test("content refuses an unknown field, a bad visibility and a bad ticket", () => {
  const base = {
    title: "T",
    description: "D",
    visibility: "Active",
    tickets: [1],
  };
  assert.throws(() => epicContentSchema.parse({ ...base, extra: 1 }));
  assert.throws(() => epicContentSchema.parse({ ...base, visibility: "All" }));
  for (const ticket of [0, -1, 1.5, "1", Number.MAX_SAFE_INTEGER + 2]) {
    assert.throws(() =>
      epicContentSchema.parse({ ...base, tickets: [ticket] }),
    );
  }
  assert.throws(() => epicContentSchema.parse({ ...base, title: undefined }));
});

const content = {
  title: "T",
  description: "D",
  visibility: "Active",
  tickets: [],
};

test("a Create carries content only", () => {
  assert.deepEqual(epicWriteRequestParse({ kind: "Create", content }), {
    kind: "Create",
    content,
  });
  assert.throws(() =>
    epicWriteRequestParse({ kind: "Create", epic: 1, content }),
  );
});

test("a Revise names an epic and the revision it read", () => {
  assert.deepEqual(
    epicWriteRequestParse({ kind: "Revise", epic: 2, expected: 3, content }),
    { kind: "Revise", epic: 2, expected: 3, content },
  );
  assert.throws(() => epicWriteRequestParse({ kind: "Revise", content }));
  assert.throws(() =>
    epicWriteRequestParse({ kind: "Revise", epic: 0, expected: 1, content }),
  );
  assert.throws(() => epicWriteRequestParse({ kind: "Retire" }));
});

test("a list query defaults its limit and reads every filter, a search bounded in characters as a ticket search is", () => {
  assert.deepEqual(epicListQueryParse({}), { limit: epicPageLimitDefault });
  assert.equal(
    epicListQueryParse({ search: "x".repeat(ticketSearchCharsMax) }).search
      ?.length,
    ticketSearchCharsMax,
  );
  assert.equal(
    epicListQueryParse({ search: "🜁".repeat(ticketSearchCharsMax) }).search,
    "🜁".repeat(ticketSearchCharsMax),
  );
  assert.deepEqual(
    epicListQueryParse({
      search: "x",
      visibility: "All",
      ticket: "7",
      sort: "title",
      after: "4",
      limit: String(epicPageLimitMax),
    }),
    {
      search: "x",
      visibility: "All",
      ticket: 7,
      sort: "title",
      after: 4,
      limit: epicPageLimitMax,
    },
  );
});

test("a list query refuses what its grammar does not name", () => {
  for (const query of [
    { limit: "0" },
    { limit: String(epicPageLimitMax + 1) },
    { limit: "05" },
    { limit: "-1" },
    { ticket: "0" },
    { visibility: "active" },
    { sort: "random" },
    { after: "x" },
    { unknown: "1" },
    { search: "x".repeat(ticketSearchCharsMax + 1) },
    { search: "" },
    { search: "x\u0000" },
  ]) {
    assert.throws(() => epicListQueryParse(query), JSON.stringify(query));
  }
});

test("a history query takes a page and nothing else", () => {
  assert.deepEqual(epicHistoryQueryParse({ after: "2", limit: "5" }), {
    after: 2,
    limit: 5,
  });
  assert.deepEqual(epicHistoryQueryParse({}), { limit: epicPageLimitDefault });
  assert.throws(() => epicHistoryQueryParse({ search: "x" }));
});
