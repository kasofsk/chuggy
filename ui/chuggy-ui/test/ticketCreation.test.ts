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
  briefTitleCharsMax,
} from "../../../src/contract/brief.ts";
import { draftCreationSchema } from "../../../src/contract/requests.ts";
import type { ProjectRepositoryResponse } from "../../../src/contract/responses.ts";
import {
  creationBodyFrom,
  creationBranchOf,
  creationFormFrom,
  creationLandingDefault,
  creationLandingTargetSentence,
  creationLandingWholeSentence,
  creationRepositoryChosen,
  creationRepositoryDefault,
  creationRepositoryRequired,
  creationBranchPrefixedSentence,
  creationConfigurationSentence,
  creationIntentLines,
  creationOffered,
  latestReadyConfiguration,
  creationReleaseMutation,
} from "../app/core/ticketCreation.ts";
import type { TicketCreationForm } from "../app/core/ticketCreation.ts";
import {
  creationBinding,
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

/**
 * The longest intent of the given character count, its newlines included: every
 * line but the last at the line bound, so the character bound is what the whole
 * turns on rather than either of the other two.
 */
function intentOfChars(chars: number): string {
  const filled = briefIntentLinesMax - 1;
  const last = chars - filled * briefLineCharsMax - filled;
  return [
    ...Array.from({ length: filled }, () => "a".repeat(briefLineCharsMax)),
    "a".repeat(last),
  ].join("\n");
}

/** A project binding nothing, which is what every case but the repository
 * rule's own is about. */
const noBindings: readonly ProjectRepositoryResponse[] = [];

function faultFields(form: TicketCreationForm): readonly string[] {
  const assembled = creationBodyFrom(creationInitialization, form, noBindings);
  return assembled.assembled === "Faults"
    ? assembled.faults.map((fault) => fault.field)
    : [];
}

function faultReasons(form: TicketCreationForm): readonly string[] {
  const assembled = creationBodyFrom(creationInitialization, form, noBindings);
  return assembled.assembled === "Faults"
    ? assembled.faults.map((fault) => fault.reason)
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
    noBindings,
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
    finalization: { mode: "Push" },
  });
});

test("a title is sent where one is typed, and omitted where the field is blank", () => {
  const titled = creationBodyFrom(
    creationInitialization,
    creationForm({ title: "  Ship it  " }),
    noBindings,
  );
  expect(titled.assembled).toBe("Body");
  if (titled.assembled !== "Body") return;
  expect(titled.body.brief.title).toBe("Ship it");

  const untitled = creationBodyFrom(
    creationInitialization,
    creationForm(),
    noBindings,
  );
  expect(untitled.assembled).toBe("Body");
  if (untitled.assembled !== "Body") return;
  expect("title" in untitled.body.brief).toBe(false);
});

test("a title the wire will not take names the field a reader has to revisit", () => {
  expect(
    faultFields(creationForm({ title: "t".repeat(briefTitleCharsMax + 1) })),
  ).toStrictEqual(["title"]);
});

test("the fence the initialization stated is what the body carries", () => {
  const assembled = creationBodyFrom(
    creationInitialization,
    creationForm(),
    noBindings,
  );
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
  const assembled = creationBodyFrom(
    creationInitialization,
    creationForm(),
    noBindings,
  );
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
    noBindings,
  );
  expect(assembled.assembled).toBe("Faults");
  expect(assembled.assembled === "Faults" && assembled.faults).toStrictEqual([
    { field: "branch", reason: creationBranchPrefixedSentence },
  ]);
});

/**
 * A managed finalizer is given the landing it runs, so the finalization is on
 * every such brief; the target is what a brief naming none leaves off, and the
 * work then lands on the branch it was done on.
 */
test("a landing is on the wire under a managed finalizer, with a target only where one is named", () => {
  const landing = creationBodyFrom(
    creationInitialization,
    creationForm({ branchName: "topic/one", targetBranchName: "release/next" }),
    noBindings,
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
    noBindings,
  );
  expect(worked.assembled).toBe("Body");
  if (worked.assembled !== "Body") return;
  expect(worked.body.brief.finalization).toStrictEqual({ mode: "Push" });
});

test("a target names where work lands whether or not a branch says where it starts", () => {
  const assembled = creationBodyFrom(
    creationInitialization,
    creationForm({ targetBranchName: "release/next" }),
    noBindings,
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
    noBindings,
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
    { intent: "x".repeat(briefLineCharsMax) },
    { intent: intentOf(briefIntentLinesMax) },
    { intent: intentOfChars(briefIntentCharsMax) },
    { links: Array.from({ length: briefLinksMax }, () => "https://a.test") },
    { links: [linkAt] },
    { branchName: branchAt },
    { targetBranchName: branchAt },
  ];
  const overBound: readonly Partial<TicketCreationForm>[] = [
    { intent: "x".repeat(briefLineCharsMax + 1) },
    { intent: intentOfChars(briefIntentCharsMax + 1) },
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
    noBindings,
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
    noBindings,
  );
  expect(
    appended.assembled === "Body" && appended.body.brief.checks,
  ).toStrictEqual(["npm test"]);
  const none = creationBodyFrom(
    creationInitialization,
    creationForm({ checks: ["   "] }),
    noBindings,
  );
  expect(none.assembled === "Body" && none.body.brief.checks).toBe(undefined);
});

test("an intent is required, and bounded in characters and in printed lines", () => {
  expect(faultFields(creationForm({ intent: "   " }))).toStrictEqual([
    "intent",
  ]);
  expect(
    faultFields(creationForm({ intent: intentOfChars(briefIntentCharsMax) })),
  ).toStrictEqual([]);
  expect(
    faultFields(
      creationForm({ intent: intentOfChars(briefIntentCharsMax + 1) }),
    ),
  ).toStrictEqual(["intent"]);
  const tooManyLines = Array.from(
    { length: briefIntentLinesMax + 1 },
    (_, at) => `line ${String(at)}`,
  ).join("\n");
  expect(faultFields(creationForm({ intent: tooManyLines }))).toStrictEqual([
    "intent",
  ]);
});

test("an intent refused for one long line is told to break lines, not to shorten", () => {
  const pasted = creationForm({ intent: "x".repeat(briefLineCharsMax + 88) });
  expect(faultFields(pasted)).toStrictEqual(["intent"]);
  expect(faultReasons(pasted)[0]).toContain(String(briefLineCharsMax));
  expect(faultReasons(pasted)[0]).toContain(
    "break the sentence across lines rather than shorten it",
  );
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

const soleRepository = "https://forge.test/kasofsk/chuggy";
const oneBinding = [creationBinding(soleRepository)];
const twoBindings = [
  creationBinding(soleRepository),
  creationBinding("https://forge.test/kasofsk/chuggy-fabric", "PullRequest"),
];

/**
 * The server refuses a release naming no repository once the project binds one,
 * so the form says so before the submit rather than after it.
 */
test("a repository is required exactly where the project binds one", () => {
  expect(creationRepositoryRequired([])).toBe(false);
  expect(creationRepositoryRequired(oneBinding)).toBe(true);
  expect(creationRepositoryRequired(twoBindings)).toBe(true);
});

test("the sole binding is the default, and two bindings default to neither", () => {
  expect(creationRepositoryDefault([])).toBe("");
  expect(creationRepositoryDefault(oneBinding)).toBe(soleRepository);
  expect(creationRepositoryDefault(twoBindings)).toBe("");
  expect(creationFormFrom(creationInitialization, oneBinding).repository).toBe(
    soleRepository,
  );
});

test("a form naming no repository is refused where the project binds one", () => {
  const assembled = creationBodyFrom(
    creationInitialization,
    creationForm({ repository: "" }),
    twoBindings,
  );
  expect(assembled.assembled).toBe("Faults");
  if (assembled.assembled !== "Faults") return;
  expect(assembled.faults.map((fault) => fault.field)).toStrictEqual([
    "repository",
  ]);
});

test("a chosen repository is on the brief, and a project binding none sends no field", () => {
  const named = creationBodyFrom(
    creationInitialization,
    creationForm({ repository: soleRepository }),
    oneBinding,
  );
  expect(named.assembled).toBe("Body");
  if (named.assembled !== "Body") return;
  expect(named.body.brief.repository).toBe(soleRepository);
  expect(draftCreationSchema.parse(named.body)).toStrictEqual(named.body);

  const none = creationBodyFrom(
    creationInitialization,
    creationForm(),
    noBindings,
  );
  expect(none.assembled).toBe("Body");
  if (none.assembled !== "Body") return;
  expect("repository" in none.body.brief).toBe(false);
});

/**
 * The landing a form starts on is the repository's, so a person who changes
 * nothing releases the ticket the binding says it should be. A project binding
 * nothing, and a repository its listing no longer holds, land on the mode this
 * console defaults to rather than on nothing at all.
 */
test("a form's landing is the chosen repository's, and Push where none says", () => {
  expect(creationLandingDefault(twoBindings, soleRepository)).toBe("Push");
  expect(
    creationLandingDefault(
      twoBindings,
      "https://forge.test/kasofsk/chuggy-fabric",
    ),
  ).toBe("PullRequest");
  expect(creationLandingDefault(twoBindings, "")).toBe("Push");
  expect(creationLandingDefault(noBindings, soleRepository)).toBe("Push");
  expect(
    creationFormFrom(creationInitialization, [
      creationBinding(soleRepository, "PullRequest"),
    ]).landingMode,
  ).toBe("PullRequest");
});

/**
 * A LANDING THE READER CHOSE IS NOT RE-SEEDED. Changing repositories re-seeds
 * only where the choice on screen is still the one the old repository seeded;
 * a reader who moved it has said what they want and the second repository does
 * not overrule them.
 */
test("changing repositories re-seeds an untouched landing and leaves a touched one", () => {
  const fabric = "https://forge.test/kasofsk/chuggy-fabric";
  const docs = "https://forge.test/kasofsk/chuggy-docs";
  const bound = [...twoBindings, creationBinding(docs)];
  const seeded = creationFormFrom(creationInitialization, bound);
  const onPush = { ...seeded, repository: soleRepository };
  expect(creationRepositoryChosen(onPush, bound, fabric)).toStrictEqual({
    ...onPush,
    repository: fabric,
    landingMode: "PullRequest",
  });
  const touched = { ...onPush, landingMode: "PullRequest" as const };
  expect(creationRepositoryChosen(touched, bound, docs)).toStrictEqual({
    ...touched,
    repository: docs,
  });
});

/** A ticket authored to run no finalizer lands nothing, so no landing reaches
 * the wire and neither does the target box beside it. */
test("a form with no finalizer sends no finalization at all", () => {
  const assembled = creationBodyFrom(
    creationInitialization,
    creationForm({
      finalizer: "NoFinalizer",
      landingMode: "PullRequest",
      targetBranchName: "release/next",
    }),
    noBindings,
  );
  expect(assembled.assembled).toBe("Body");
  if (assembled.assembled !== "Body") return;
  expect("finalization" in assembled.body.brief).toBe(false);
});

test("a chosen landing is on the wire whatever the repository's default is", () => {
  const assembled = creationBodyFrom(
    creationInitialization,
    creationForm(
      {
        repository: soleRepository,
        landingMode: "PullRequest",
        branchName: "topic/one",
        targetBranchName: "release/next",
      },
      oneBinding,
    ),
    oneBinding,
  );
  expect(assembled.assembled).toBe("Body");
  if (assembled.assembled !== "Body") return;
  expect(assembled.body.brief.finalization).toStrictEqual({
    mode: "PullRequest",
    target: "refs/heads/release/next",
  });
  expect(draftCreationSchema.parse(assembled.body)).toStrictEqual(
    assembled.body,
  );
});

/**
 * A pull request is opened from one reference into another, so both boxes are
 * the reader's to fill: the empty one and the one repeating the branch are
 * refused before the wire sees either.
 */
test("a pull request names a target, and one that is not the branch", () => {
  expect(
    faultReasons(
      creationForm({ landingMode: "PullRequest", branchName: "topic/one" }),
    ),
  ).toStrictEqual([creationLandingTargetSentence]);
  expect(
    faultReasons(
      creationForm({
        landingMode: "PullRequest",
        branchName: "topic/one",
        targetBranchName: "topic/one",
      }),
    ),
  ).toStrictEqual([creationLandingWholeSentence]);
  expect(
    faultFields(
      creationForm({ landingMode: "PullRequest", branchName: "topic/one" }),
    ),
  ).toStrictEqual(["target"]);
});

/** A push lands on the branch the work was done on, so it names no target and
 * is not refused for naming none. */
test("a push with no target is accepted, and so is a pull request with one", () => {
  expect(faultFields(creationForm({ branchName: "topic/one" }))).toStrictEqual(
    [],
  );
  expect(
    faultFields(
      creationForm({
        landingMode: "PullRequest",
        branchName: "topic/one",
        targetBranchName: "release/next",
      }),
    ),
  ).toStrictEqual([]);
});
