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
  briefBranchCharsMax,
  briefBranchPrefix,
  briefChecksMax,
  briefIntentCharsMax,
  briefIntentLinesMax,
  briefLineCharsMax,
  briefLinkScheme,
  briefLinksMax,
} from "../../../src/contract/brief.ts";
import { draftCreationSchema } from "../../../src/contract/requests.ts";
import {
  creationBodyFrom,
  creationBranchOf,
  creationBranchPrefixedSentence,
  creationConfigurationSentence,
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

/** An intent that prints exactly the given number of lines. */
function intentOf(lines: number): string {
  return Array.from({ length: lines }, (_, at) => `line ${String(at)}`).join(
    "\n",
  );
}

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

test("the sentence names the configuration and keeps its revision on hover", () => {
  expect(
    creationConfigurationSentence({
      ...creationSummary("repository:cfaca0a:chuggy", "Ready"),
      provenance: {
        source: "Repository",
        repository: "kasofsk/chuggy",
        commit: "cfaca0a0f14ec03845a4e01458ac6c3a56d52a23",
        path: "configurations/chuggy.json",
        name: "chuggy",
      },
      version: { name: "chuggy", number: 12 },
    }),
  ).toEqual({
    text: "shaped by configuration chuggy #12 · cfaca0a, the latest revision this project has ready",
    title: "repository:cfaca0a:chuggy",
  });
});

test("a configuration with no version and no commit is named by its revision alone", () => {
  expect(creationConfigurationSentence(creationSummary("r3", "Ready"))).toEqual(
    {
      text: "shaped by configuration r3, the latest revision this project has ready",
      title: "r3",
    },
  );
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
  expect(creationBranchOf("topic/one")).toStrictEqual({
    named: "Ref",
    ref: "refs/heads/topic/one",
  });
  expect(creationBranchOf("  ")).toStrictEqual({ named: "None" });
  const assembled = creationBodyFrom(creationInitialization, creationForm());
  expect(assembled.assembled).toBe("Body");
  if (assembled.assembled !== "Body") return;
  expect("branch" in assembled.body.brief).toBe(false);
});

/**
 * A reader who has seen the wire pastes the reference. Prefixing that a second
 * time names a branch nobody has, and every layer below accepts it: the doubled
 * value is a well-formed reference name.
 */
test("a reference pasted where a name was asked for is refused, not prefixed twice", () => {
  expect(creationBranchOf("refs/heads/main")).toStrictEqual({
    named: "Prefixed",
  });
  const assembled = creationBodyFrom(
    creationInitialization,
    creationForm({ branchName: "refs/heads/main" }),
  );
  expect(assembled.assembled).toBe("Faults");
  expect(assembled.assembled === "Faults" && assembled.faults).toStrictEqual([
    { field: "branch", reason: creationBranchPrefixedSentence },
  ]);
});

/**
 * Naming a target is the whole of what asking for a finalization is, so the
 * field is absent from a brief that names none rather than repeating the
 * branch the work started from.
 */
test("a named target is a finalization on the wire, and no target is no field", () => {
  const landing = creationBodyFrom(
    creationInitialization,
    creationForm({ branchName: "topic/one", targetBranchName: "release/next" }),
  );
  expect(landing.assembled).toBe("Body");
  if (landing.assembled !== "Body") return;
  expect(landing.body.brief).toStrictEqual({
    intent: "ship it",
    links: [],
    branch: "refs/heads/topic/one",
    finalization: { mode: "Push", target: "refs/heads/release/next" },
  });
  const worked = creationBodyFrom(
    creationInitialization,
    creationForm({ branchName: "topic/one" }),
  );
  expect(worked.assembled).toBe("Body");
  if (worked.assembled !== "Body") return;
  expect("finalization" in worked.body.brief).toBe(false);
});

test("a target names where work lands whether or not a branch says where it starts", () => {
  const assembled = creationBodyFrom(
    creationInitialization,
    creationForm({ targetBranchName: "release/next" }),
  );
  expect(assembled.assembled).toBe("Body");
  if (assembled.assembled !== "Body") return;
  expect(assembled.body.brief).toStrictEqual({
    intent: "ship it",
    links: [],
    finalization: { mode: "Push", target: "refs/heads/release/next" },
  });
});

test("a target is refused the way a branch is, and says the same edit fixes it", () => {
  const assembled = creationBodyFrom(
    creationInitialization,
    creationForm({ targetBranchName: "refs/heads/main" }),
  );
  expect(assembled.assembled === "Faults" && assembled.faults).toStrictEqual([
    { field: "target", reason: creationBranchPrefixedSentence },
  ]);
  expect(
    faultFields(
      creationForm({ targetBranchName: "b".repeat(briefBranchCharsMax + 1) }),
    ),
  ).toStrictEqual(["target"]);
});

test("a branch name the wire's reference bound refuses is a fault, not a body", () => {
  expect(
    faultFields(
      creationForm({ branchName: "b".repeat(briefBranchCharsMax + 1) }),
    ),
  ).toStrictEqual(["branch"]);
});

/**
 * The form states no bound of its own: the wire's parser is what it runs, so
 * its verdict turns exactly where the contract's constants say it does. A bound
 * that moves in `src/contract/brief.ts` moves this case with it.
 */
test("each bound the contract states is where the form's verdict turns", () => {
  const linkAt = `${briefLinkScheme}${"a".repeat(briefLineCharsMax - briefLinkScheme.length)}`;
  const branchAt = "b".repeat(briefBranchCharsMax - briefBranchPrefix.length);
  const atBound: readonly Partial<TicketCreationForm>[] = [
    { intent: "x".repeat(briefIntentCharsMax) },
    { intent: intentOf(briefIntentLinesMax) },
    { links: Array.from({ length: briefLinksMax }, () => "https://a.test") },
    { links: [linkAt] },
    { branchName: branchAt },
    { targetBranchName: branchAt },
  ];
  const overBound: readonly Partial<TicketCreationForm>[] = [
    { intent: "x".repeat(briefIntentCharsMax + 1) },
    { intent: intentOf(briefIntentLinesMax + 1) },
    {
      links: Array.from({ length: briefLinksMax + 1 }, () => "https://a.test"),
    },
    { links: [`${linkAt}a`] },
    { branchName: `${branchAt}b` },
    { targetBranchName: `${branchAt}b` },
  ];
  for (const over of atBound)
    expect([over, faultFields(creationForm(over))]).toStrictEqual([over, []]);
  for (const over of overBound)
    expect([over, faultFields(creationForm(over))]).not.toStrictEqual([
      over,
      [],
    ]);
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

test("the check lines a brief appends are bounded, trimmed and omitted when empty", () => {
  const many = Array.from({ length: briefChecksMax + 1 }, () => "npm test");
  expect(faultFields(creationForm({ checks: many }))).toStrictEqual(["checks"]);
  expect(
    faultFields(creationForm({ checks: ["x".repeat(briefLineCharsMax + 1)] })),
  ).toStrictEqual(["checks"]);
  const appended = creationBodyFrom(
    creationInitialization,
    creationForm({ checks: ["  ", " npm test "] }),
  );
  expect(
    appended.assembled === "Body" && appended.body.brief.checks,
  ).toStrictEqual(["npm test"]);
  const none = creationBodyFrom(
    creationInitialization,
    creationForm({ checks: ["   "] }),
  );
  expect(none.assembled === "Body" && none.body.brief.checks).toBe(undefined);
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
