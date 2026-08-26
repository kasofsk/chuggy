/**
 * The decisions creating a ticket makes, checked where a browser cannot see
 * them going wrong: which configuration is used, and what one form becomes.
 *
 * The body assertions round-trip through `draftCreationSchema` itself, so what
 * is checked is that the API would accept the body rather than that this suite
 * and the assembler agree on its shape.
 */

import { expect, test } from "vitest";

import {
  briefIntentCharsMax,
  briefIntentLinesMax,
  briefLinksMax,
} from "../../../src/contract/brief.ts";
import { draftCreationSchema } from "../../../src/contract/requests.ts";
import {
  creationBodyFrom,
  creationBranchRef,
  creationIntentLines,
  creationOffered,
  latestReadyConfiguration,
  creationReleaseMutation,
} from "../app/core/ticketCreation.ts";
import type { TicketCreationForm } from "../app/core/ticketCreation.ts";
import {
  creationDigest,
  creationDraft,
  creationForm,
  creationInitialization,
  creationSummary,
} from "./ticketCreationFixture.ts";

function faultFields(form: TicketCreationForm): readonly string[] {
  const assembled = creationBodyFrom(creationInitialization, form);
  return assembled.assembled === "Faults"
    ? assembled.faults.map((fault) => fault.field)
    : [];
}

test("the configuration is the newest ready revision, and none is drawable", () => {
  const listed = [
    creationSummary("r4", "Incomplete"),
    creationSummary("r3", "Ready"),
    creationSummary("r2", "Ready"),
  ];
  expect(latestReadyConfiguration(listed)?.revision).toBe("r3");
  expect(latestReadyConfiguration([creationSummary("r4", "Incomplete")])).toBe(
    undefined,
  );
  expect(latestReadyConfiguration([])).toBe(undefined);
});

test("a filled form becomes a body the wire's own parser accepts", () => {
  const assembled = creationBodyFrom(
    creationInitialization,
    creationForm({
      links: ["https://example.test/a"],
      branchName: "topic/one",
    }),
  );
  expect(assembled.assembled).toBe("Body");
  if (assembled.assembled !== "Body") return;
  expect(draftCreationSchema.parse(assembled.body)).toStrictEqual(
    assembled.body,
  );
  expect(assembled.body.brief).toStrictEqual({
    intent: "ship it",
    links: ["https://example.test/a"],
    branch: "refs/heads/topic/one",
  });
});

test("the fence the initialization stated is what the body carries", () => {
  const assembled = creationBodyFrom(creationInitialization, creationForm());
  expect(assembled.assembled).toBe("Body");
  if (assembled.assembled !== "Body") return;
  expect(assembled.body.expectedProjectSequence).toBe(41);
  expect(assembled.body.configurationDigest).toBe(creationDigest);
  expect(assembled.body.configurationRevision).toBe("r3");
});

test("a branch is a name here and a full reference on the wire", () => {
  expect(creationBranchRef("topic/one")).toBe("refs/heads/topic/one");
  expect(creationBranchRef("  ")).toBe(undefined);
  const assembled = creationBodyFrom(creationInitialization, creationForm());
  expect(
    assembled.assembled === "Body" && "branch" in assembled.body.brief,
  ).toBe(false);
});

test("a branch name the wire's reference bound refuses is a fault, not a body", () => {
  expect(
    faultFields(creationForm({ branchName: "b".repeat(300) })),
  ).toStrictEqual(["branch"]);
});

test("the links a brief carries are bounded and read over one scheme", () => {
  const many = Array.from(
    { length: briefLinksMax + 1 },
    () => "https://a.test",
  );
  expect(faultFields(creationForm({ links: many }))).toStrictEqual(["links"]);
  expect(faultFields(creationForm({ links: ["http://a.test"] }))).toStrictEqual(
    ["links"],
  );
  const assembled = creationBodyFrom(
    creationInitialization,
    creationForm({ links: ["  ", "https://a.test"] }),
  );
  expect(
    assembled.assembled === "Body" && assembled.body.brief.links,
  ).toStrictEqual(["https://a.test"]);
});

test("an intent is required, and bounded in characters and in printed lines", () => {
  expect(faultFields(creationForm({ intent: "   " }))).toStrictEqual([
    "intent",
  ]);
  expect(
    faultFields(creationForm({ intent: "x".repeat(briefIntentCharsMax + 1) })),
  ).toStrictEqual(["intent"]);
  const tooManyLines = Array.from(
    { length: briefIntentLinesMax + 1 },
    (_, at) => `line ${String(at)}`,
  ).join("\n");
  expect(faultFields(creationForm({ intent: tooManyLines }))).toStrictEqual([
    "intent",
  ]);
});

test("a line with nothing on it prints nothing, so it counts for nothing", () => {
  expect(creationIntentLines("a\r\n\r\n b \n")).toStrictEqual(["a", " b "]);
  const blankHeavy = Array.from(
    { length: briefIntentLinesMax },
    (_, at) => `line ${String(at)}`,
  ).join("\n\n");
  expect(faultFields(creationForm({ intent: blankHeavy }))).toStrictEqual([]);
});

test("a value the offered set does not hold is still offered as the one chosen", () => {
  const label = (value: number): string => String(value);
  expect(creationOffered([1, 2], 2, label)).toStrictEqual([1, 2]);
  expect(creationOffered([1, 2], 5, label)).toStrictEqual([5, 1, 2]);
});

test("the release names the draft it was answered with, and its authoring version", () => {
  expect(creationReleaseMutation(creationDraft)).toStrictEqual({
    mutation: "ReleaseDraft",
    ticket: 12,
    authoringVersion: 3,
    configurationRevision: "r3",
  });
});
