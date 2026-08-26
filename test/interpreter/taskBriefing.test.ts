/**
 * Briefing composition: what the two templates render, what they refuse, and
 * the two structural claims the module rests on.
 *
 * THE ORDER CLAIM IS CHECKED OVER EVERY COMBINATION, not over a few. A section
 * is either present or absent, so the presence space is small enough to
 * enumerate for both roles, and each case asserts the rendered identities are
 * the fixed order with members removed rather than merely the right set.
 *
 * THE AUTHORITY CLAIM IS `./taskAuthority.test.ts`'s. What is checked here is
 * the one thing composition adds to it: the template's own narrowing leads the
 * fold, so no grant and no authored block leaves a briefed worker able to
 * complete a task itself.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  allTaskPurposes,
  briefingSectionOrder,
  briefingTemplateSections,
  briefingTemplateVersion,
  type BriefingSectionId,
  type TaskPurpose,
} from "../../src/interpreter/briefingTemplate.ts";
import {
  allBriefingFaults,
  allPracticeIds,
  blessedPracticeCatalog,
  briefingLineCharsMax,
  briefingLinesMax,
  authoredTaskConfigurationReadiness,
  composeTaskInvocation,
  renderBriefing,
  resolvePractices,
  runtimeChangedFilesMax,
  runtimeHandoffLinesMax,
  type BlessedPractice,
  type BriefingFault,
  type BriefingSection,
  type BriefingView,
  type EvaluationBlock,
  type PurposeBlock,
  type RenderedBriefing,
  type RuntimeFacts,
  type TaskInvocation,
  type TicketBrief,
  type WorkerConfiguration,
} from "../../src/interpreter/taskBriefing.ts";
import {
  taskAuthorityGrant,
  type AuthorityRequest,
  type PolicyAuthorityGrant,
} from "../../src/interpreter/taskAuthority.ts";
import type { ConfigurationPin } from "../../src/interpreter/projectDecision.ts";
import { asCanonicalConfiguration } from "../../src/interpreter/authoring.ts";

const pin: ConfigurationPin = {
  configurationRevision: "revision-7",
  configurationDigest: "digest-7",
};

const grant: PolicyAuthorityGrant = {
  tools: ["editor", "shell"],
  credentials: ["workspace"],
  network: false,
  filesystem: "WriteWorkspace",
  mayCompleteTask: true,
};

const brief: TicketBrief = {
  motivation: ["The importer drops rows and reports a success."],
  acceptanceCriteria: ["A dropped row is reported as a failure."],
  constraints: ["The importer keeps the signature its callers use."],
};

const noFacts: RuntimeFacts = { changedFiles: [], handoff: [] };

const authoredConfiguration = {
  brief,
  practices: ["AcceptanceCriteria"],
  work: { instructions: ["Change the importer."] },
  review: { instructions: ["Walk the call paths."] },
};

test("an authored document parses the complete task briefing contract", () => {
  assert.deepEqual(authoredTaskConfigurationReadiness(authoredConfiguration), {
    readiness: "Ready",
    configuration: authoredConfiguration,
  });
});

test("worker setup is parsed and carried into the composed invocation", () => {
  const worker: WorkerConfiguration = {
    arguments: ["--allowedTools", "Read,Edit"],
    setup: ["just hooks"],
    files: [{ path: ".claude/settings.json", content: '{"env":{}}' }],
  };
  assert.deepEqual(
    authoredTaskConfigurationReadiness({ ...authoredConfiguration, worker }),
    {
      readiness: "Ready",
      configuration: { ...authoredConfiguration, worker },
    },
  );
  assert.deepEqual(composed(viewOf({ worker })).worker, worker);
});

test("an unreadable worker setup is refused at release parsing", () => {
  assert.deepEqual(
    authoredTaskConfigurationReadiness({
      ...authoredConfiguration,
      worker: { arguments: [], setup: [], files: [{ path: 1, content: "x" }] },
    }),
    { readiness: "Incomplete", fault: "WorkerInvalid" },
  );
});

test("an authored document without the briefing shape is refused by name", () => {
  assert.deepEqual(authoredTaskConfigurationReadiness({}), {
    readiness: "Incomplete",
    fault: "BriefingShapeMissing",
  });
});

test("authored briefing bounds are enforced while the document is parsed", () => {
  assert.deepEqual(
    authoredTaskConfigurationReadiness({
      ...authoredConfiguration,
      work: { instructions: ["x".repeat(briefingLineCharsMax + 1)] },
    }),
    { readiness: "Incomplete", fault: "TextTooLong" },
  );
  assert.deepEqual(
    authoredTaskConfigurationReadiness({
      ...authoredConfiguration,
      review: {
        instructions: Array.from(
          { length: briefingLinesMax + 1 },
          () => "review",
        ),
      },
    }),
    { readiness: "Incomplete", fault: "TooManyLines" },
  );
});

test("every authored line list is bounded while it is parsed", () => {
  const tooMany = Array.from({ length: briefingLinesMax + 1 }, () => "line");
  const variants = [
    { ...authoredConfiguration, brief: { ...brief, motivation: tooMany } },
    {
      ...authoredConfiguration,
      brief: { ...brief, acceptanceCriteria: tooMany },
    },
    { ...authoredConfiguration, brief: { ...brief, constraints: tooMany } },
    { ...authoredConfiguration, work: { instructions: tooMany } },
    { ...authoredConfiguration, review: { instructions: tooMany } },
  ];
  for (const variant of variants) {
    assert.deepEqual(authoredTaskConfigurationReadiness(variant), {
      readiness: "Incomplete",
      fault: "TooManyLines",
    });
  }
});

test("missing or mistyped authored fields are refused at their field", () => {
  const variants: readonly [unknown, string][] = [
    [
      { ...authoredConfiguration, brief: { ...brief, motivation: undefined } },
      "MotivationInvalid",
    ],
    [
      {
        ...authoredConfiguration,
        brief: { ...brief, acceptanceCriteria: [1] },
      },
      "AcceptanceCriteriaInvalid",
    ],
    [
      { ...authoredConfiguration, brief: { ...brief, constraints: undefined } },
      "ConstraintsInvalid",
    ],
    [{ ...authoredConfiguration, practices: undefined }, "PracticesInvalid"],
    [{ ...authoredConfiguration, work: {} }, "WorkInvalid"],
    [{ ...authoredConfiguration, review: undefined }, "ReviewInvalid"],
  ];
  for (const [variant, fault] of variants) {
    assert.deepEqual(authoredTaskConfigurationReadiness(variant), {
      readiness: "Incomplete",
      fault,
    });
  }
});

test("empty briefs and unblessed or duplicate practices are refused at release parsing", () => {
  assert.deepEqual(
    authoredTaskConfigurationReadiness({
      ...authoredConfiguration,
      brief: { motivation: [], acceptanceCriteria: [], constraints: [] },
    }),
    { readiness: "Incomplete", fault: "EmptyBrief" },
  );
  for (const practices of [
    ["Nonsense"],
    ["AcceptanceCriteria", "AcceptanceCriteria"],
  ]) {
    assert.notEqual(
      authoredTaskConfigurationReadiness({
        ...authoredConfiguration,
        practices,
      }).readiness,
      "Ready",
    );
  }
});

test("authority requests are structured and their name collections are bounded", () => {
  assert.equal(
    authoredTaskConfigurationReadiness({
      ...authoredConfiguration,
      authority: {
        tools: ["editor"],
        credentials: ["workspace"],
        network: false,
        filesystem: "ReadWorkspace",
        mayCompleteTask: false,
      },
    }).readiness,
    "Ready",
  );
  for (const authority of [
    "everything",
    { filesystem: "RootShell" },
    { network: "yes" },
    { tools: Array.from({ length: briefingLinesMax + 1 }, () => "tool") },
    { credentials: [1] },
  ]) {
    assert.deepEqual(
      authoredTaskConfigurationReadiness({
        ...authoredConfiguration,
        authority,
      }),
      { readiness: "Incomplete", fault: "AuthorityInvalid" },
    );
  }
  assert.deepEqual(
    authoredTaskConfigurationReadiness({
      ...authoredConfiguration,
      work: { instructions: [], authority: { filesystem: "RootShell" } },
    }),
    { readiness: "Incomplete", fault: "WorkInvalid" },
  );
  assert.deepEqual(
    authoredTaskConfigurationReadiness({
      ...authoredConfiguration,
      review: { instructions: [], authority: { network: "yes" } },
    }),
    { readiness: "Incomplete", fault: "ReviewInvalid" },
  );
});

test("the largest accepted authored collections fit the canonical storage bound", () => {
  const lines = Array.from({ length: briefingLinesMax }, () =>
    "x".repeat(briefingLineCharsMax),
  );
  const canonical = JSON.stringify({
    authority: {
      credentials: lines,
      filesystem: "None",
      mayCompleteTask: false,
      network: false,
      tools: lines,
    },
    brief: {
      acceptanceCriteria: lines,
      constraints: lines,
      motivation: lines,
    },
    image: "worker:v1",
    practices: [...allPracticeIds],
    review: { instructions: lines },
    version: 1,
    work: { instructions: lines },
  });
  assert.doesNotThrow(() => asCanonicalConfiguration(canonical));
});

/** One view, with the parts a case is about replacing the ordinary ones. */
function viewOf(parts: {
  readonly purpose?: TaskPurpose;
  readonly stage?: number;
  readonly pin?: ConfigurationPin;
  readonly revision?: string;
  readonly digest?: string;
  readonly brief?: TicketBrief;
  readonly practices?: readonly string[];
  readonly block?: PurposeBlock;
  readonly blockReview?: PurposeBlock;
  readonly evaluations?: readonly EvaluationBlock[];
  readonly authority?: AuthorityRequest;
  readonly worker?: WorkerConfiguration;
  readonly runtime?: RuntimeFacts;
  readonly priorWorkReports?: readonly string[];
  readonly grant?: PolicyAuthorityGrant;
}): BriefingView {
  const block = parts.block ?? { instructions: [] };
  return {
    purpose: parts.purpose ?? "Work",
    ...(parts.stage === undefined ? {} : { stage: parts.stage }),
    pin: parts.pin ?? pin,
    configuration: {
      configurationRevision: parts.revision ?? pin.configurationRevision,
      configurationDigest: parts.digest ?? pin.configurationDigest,
      brief: parts.brief ?? brief,
      practices: parts.practices ?? [],
      work: block,
      review: parts.blockReview ?? block,
      ...(parts.evaluations === undefined
        ? {}
        : { evaluations: parts.evaluations }),
      ...(parts.authority === undefined ? {} : { authority: parts.authority }),
      ...(parts.worker === undefined ? {} : { worker: parts.worker }),
    },
    runtime: parts.runtime ?? noFacts,
    priorWorkReports: { reports: parts.priorWorkReports ?? [] },
    grant: parts.grant ?? grant,
  };
}

/** The invocation a view composes to, failing the case rather than the run when it does not. */
function composed(view: BriefingView): TaskInvocation {
  const outcome = composeTaskInvocation(blessedPracticeCatalog, view);
  if (outcome.composed !== "Composed") {
    assert.fail(`composition was blocked: ${outcome.fault}`);
  }
  return outcome.invocation;
}

/** The fault a view is refused with, failing the case when it is not refused. */
function blockedFault(view: BriefingView): BriefingFault {
  const outcome = composeTaskInvocation(blessedPracticeCatalog, view);
  if (outcome.composed !== "Blocked")
    assert.fail("composition was not blocked");
  return outcome.fault;
}

/** Whether the compiler will let the first type stand where the second is wanted. */
type Assignable<A, B> = [A] extends [B] ? true : false;

test("a sequence of blocks is not a briefing until this module seals one", () => {
  const unsealedIsNotBriefing: Assignable<
    Omit<RenderedBriefing, "seal">,
    RenderedBriefing
  > = false;
  const renderedIsBriefing: Assignable<
    ReturnType<typeof renderBriefing>,
    RenderedBriefing
  > = true;
  assert.equal(unsealedIsNotBriefing, false);
  assert.equal(renderedIsBriefing, true);
});

/** Every subset of these section identities, which is the whole presence space. */
function subsetsOf(
  sections: readonly BriefingSectionId[],
): readonly (readonly BriefingSectionId[])[] {
  return sections.reduce<readonly (readonly BriefingSectionId[])[]>(
    (found, section) => [...found, ...found.map((each) => [...each, section])],
    [[]],
  );
}

const optionalSections: readonly BriefingSectionId[] = [
  "WhyItMatters",
  "AcceptanceAndConstraints",
  "PurposeInstructions",
  "Practices",
  "RuntimeContext",
];

const shared: BlessedPractice = {
  practice: "AcceptanceCriteria",
  scope: "Both",
  instruction: "Take the acceptance criteria one at a time.",
};

/** A view whose optional bodies are non-empty for exactly the named sections. */
function viewPresenting(
  purpose: TaskPurpose,
  present: ReadonlySet<BriefingSectionId>,
): BriefingView {
  return viewOf({
    purpose,
    brief: {
      motivation: present.has("WhyItMatters") ? brief.motivation : [],
      acceptanceCriteria: present.has("AcceptanceAndConstraints")
        ? brief.acceptanceCriteria
        : [],
      constraints: [],
    },
    block: {
      instructions: present.has("PurposeInstructions")
        ? ["Change the importer and nothing beside it."]
        : [],
    },
    runtime: present.has("RuntimeContext")
      ? { workspace: "/work/importer", changedFiles: [], handoff: [] }
      : noFacts,
    priorWorkReports: present.has("PriorWorkReports")
      ? ["The worker changed the importer and ran the focused gate."]
      : [],
  });
}

test("an absent optional section never reorders its neighbours", () => {
  for (const purpose of allTaskPurposes) {
    for (const chosen of subsetsOf(optionalSections)) {
      const present = new Set(chosen);
      const rendered = renderBriefing(
        viewPresenting(purpose, present),
        present.has("Practices") ? [shared] : [],
      );
      assert.deepEqual(
        rendered.sections.map((section) => section.section),
        briefingSectionOrder.filter(
          (section) =>
            present.has(section) || briefingTemplateSections.includes(section),
        ),
      );
    }
  }
});

test("the sections a template owns are rendered even when the ticket says nothing else", () => {
  const rendered = renderBriefing(viewPresenting("Work", new Set()), []);
  assert.deepEqual(
    rendered.sections.map((section) => section.section),
    briefingTemplateSections,
  );
  assert.equal(rendered.templateVersion, briefingTemplateVersion);
});

test("the rendered text is its sections in the order they were rendered", () => {
  const rendered = composed(
    viewOf({ practices: [...allPracticeIds] }),
  ).briefing;
  let read = -1;
  for (const section of rendered.sections) {
    const at = rendered.text.indexOf(`## ${section.heading}`);
    assert.ok(at > read);
    read = at;
    for (const line of section.lines) assert.ok(rendered.text.includes(line));
  }
});

test("both roles are briefed with the same ticket brief", () => {
  const work = composed(viewOf({ purpose: "Work" })).briefing;
  const review = composed(viewOf({ purpose: "Review" })).briefing;
  for (const section of ["WhyItMatters", "AcceptanceAndConstraints"] as const) {
    assert.deepEqual(
      work.sections.find((each) => each.section === section)?.lines,
      review.sections.find((each) => each.section === section)?.lines,
    );
  }
});

/** The purpose-specific lines one composed briefing carries, or nothing when it has none. */
function purposeLines(view: BriefingView): readonly string[] | undefined {
  return composed(view).briefing.sections.find(
    (section) => section.section === "PurposeInstructions",
  )?.lines;
}

test("each role is briefed from its own block and never the other's", () => {
  const view = viewOf({
    block: {
      instructions: ["Change the importer and nothing beside it."],
      authority: { tools: ["editor"] },
    },
    blockReview: {
      instructions: ["Say which acceptance criterion each hunk meets."],
      authority: { tools: ["shell"] },
    },
  });
  assert.deepEqual(purposeLines({ ...view, purpose: "Work" }), [
    "Change the importer and nothing beside it.",
  ]);
  assert.deepEqual(purposeLines({ ...view, purpose: "Review" }), [
    "Say which acceptance criterion each hunk meets.",
  ]);
  assert.deepEqual(
    taskAuthorityGrant(composed({ ...view, purpose: "Work" }).authority).tools,
    ["editor"],
  );
  assert.deepEqual(
    taskAuthorityGrant(composed({ ...view, purpose: "Review" }).authority)
      .tools,
    ["shell"],
  );
});

test("each evaluation stage selects its own block, practices, and authority", () => {
  const evaluations = [
    {
      purpose: "Review" as const,
      instructions: ["Review the change."],
      practices: ["ChangedCallPaths"],
      authority: { tools: ["editor"] },
    },
    {
      purpose: "Check" as const,
      instructions: ["Run the command suite."],
      practices: ["AcceptanceCriteria"],
      authority: { tools: ["shell"] },
    },
  ];
  const first = composed(viewOf({ purpose: "Review", stage: 0, evaluations }));
  const second = composed(viewOf({ purpose: "Review", stage: 1, evaluations }));
  assert.deepEqual(
    first.briefing.sections.find(
      (section) => section.section === "PurposeInstructions",
    )?.lines,
    ["Review the change."],
  );
  assert.deepEqual(first.provenance.practices, ["ChangedCallPaths"]);
  assert.deepEqual(second.provenance.practices, ["AcceptanceCriteria"]);
  assert.deepEqual(taskAuthorityGrant(first.authority).tools, ["editor"]);
  assert.deepEqual(taskAuthorityGrant(second.authority).tools, ["shell"]);
});

test("a fault in one role's block does not refuse the other role's briefing", () => {
  const view = viewOf({
    block: { instructions: ["Change the importer and nothing beside it."] },
    blockReview: { instructions: [""] },
  });
  assert.equal(blockedFault({ ...view, purpose: "Review" }), "EmptyLine");
  assert.deepEqual(purposeLines({ ...view, purpose: "Work" }), [
    "Change the importer and nothing beside it.",
  ]);
});

test("a practice reaches only the roles its scope names", () => {
  const resolved = (purpose: TaskPurpose): readonly string[] => {
    const found = resolvePractices(blessedPracticeCatalog, purpose, [
      ...allPracticeIds,
    ]);
    if (found.resolved !== "Practices")
      assert.fail("the catalog refused itself");
    return found.practices.map((practice) => practice.practice);
  };
  assert.deepEqual(resolved("Work"), [
    "RegressionCoverage",
    "AcceptanceCriteria",
  ]);
  assert.deepEqual(resolved("Review"), [
    "ChangedCallPaths",
    "AcceptanceCriteria",
  ]);
});

test("the order the practices were configured in does not change the briefing", () => {
  const forward = composed(viewOf({ practices: [...allPracticeIds] }));
  const backward = composed(
    viewOf({ practices: [...allPracticeIds].reverse() }),
  );
  assert.equal(forward.briefing.text, backward.briefing.text);
  assert.deepEqual(forward.provenance, backward.provenance);
});

test("the same view renders the same briefing however often it is composed", () => {
  const view = viewOf({ practices: [...allPracticeIds] });
  assert.equal(composed(view).briefing.text, composed(view).briefing.text);
});

test("a configuration that is not the pinned revision is refused rather than rendered", () => {
  assert.equal(
    blockedFault(viewOf({ revision: "revision-8" })),
    "RevisionMismatch",
  );
  assert.equal(blockedFault(viewOf({ digest: "digest-8" })), "DigestMismatch");
});

test("composition takes completion authority away whatever policy granted", () => {
  const invocation = composed(
    viewOf({
      authority: { mayCompleteTask: true },
      block: { instructions: [], authority: { mayCompleteTask: true } },
    }),
  );
  const resolved = taskAuthorityGrant(invocation.authority);
  assert.equal(grant.mayCompleteTask, true);
  assert.equal(resolved.mayCompleteTask, false);
  assert.deepEqual(resolved.tools, ["editor", "shell"]);
});

test("an authored block narrows the granted authority and never raises it", () => {
  const invocation = composed(
    viewOf({ authority: { tools: ["editor"], filesystem: "ReadWorkspace" } }),
  );
  const resolved = taskAuthorityGrant(invocation.authority);
  assert.deepEqual(resolved.tools, ["editor"]);
  assert.equal(resolved.filesystem, "ReadWorkspace");
});

test("the retained provenance carries no line of the briefing it describes", () => {
  const invocation = composed(viewOf({ practices: [...allPracticeIds] }));
  const retained = JSON.stringify(invocation.provenance);
  for (const section of invocation.briefing.sections) {
    for (const line of section.lines) {
      assert.equal(retained.includes(line), false);
    }
  }
  assert.deepEqual(Object.keys(invocation.provenance).sort(), [
    "configurationDigest",
    "configurationRevision",
    "practices",
    "purpose",
    "sections",
    "templateVersion",
  ]);
  for (const section of invocation.provenance.sections) {
    assert.deepEqual(Object.keys(section).sort(), ["chars", "section"]);
  }
});

test("the provenance names the pinned revision, the template and every resolved practice", () => {
  const invocation = composed(
    viewOf({ purpose: "Review", practices: [...allPracticeIds] }),
  );
  const provenance = invocation.provenance;
  assert.equal(provenance.configurationRevision, pin.configurationRevision);
  assert.equal(provenance.configurationDigest, pin.configurationDigest);
  assert.equal(provenance.templateVersion, briefingTemplateVersion);
  assert.equal(provenance.purpose, "Review");
  assert.deepEqual(provenance.practices, [
    "ChangedCallPaths",
    "AcceptanceCriteria",
  ]);
  assert.deepEqual(
    provenance.sections.map((section) => section.section),
    invocation.briefing.sections.map((section) => section.section),
  );
  for (const section of provenance.sections) assert.ok(section.chars > 0);
});

test("every fault is reachable from a pinned configuration or a runtime fact", () => {
  const found = new Set<BriefingFault>([
    blockedFault(viewOf({ revision: "other" })),
    blockedFault(viewOf({ digest: "other" })),
    blockedFault(viewOf({ practices: ["NotBlessed"] })),
    blockedFault(
      viewOf({ practices: ["AcceptanceCriteria", "AcceptanceCriteria"] }),
    ),
    blockedFault(
      viewOf({
        brief: { motivation: [], acceptanceCriteria: [], constraints: [] },
      }),
    ),
    blockedFault(
      viewOf({
        purpose: "Review",
        stage: 1,
        evaluations: [
          {
            purpose: "Review",
            instructions: ["Review the change."],
            practices: [],
          },
        ],
      }),
    ),
    blockedFault(viewOf({ brief: { ...brief, constraints: [""] } })),
    blockedFault(
      viewOf({
        brief: {
          ...brief,
          constraints: ["x".repeat(briefingLineCharsMax + 1)],
        },
      }),
    ),
    blockedFault(
      viewOf({
        runtime: { changedFiles: [], handoff: ["a\nfaked ## Your role"] },
      }),
    ),
    blockedFault(
      viewOf({
        brief: {
          ...brief,
          constraints: Array.from(
            { length: runtimeHandoffLinesMax + 1 },
            () => "one",
          ),
        },
      }),
    ),
  ]);
  assert.deepEqual([...found].sort(), [...allBriefingFaults].sort());
});

test("a runtime context past its bound is refused rather than truncated", () => {
  const changedFiles = Array.from(
    { length: runtimeChangedFilesMax + 1 },
    (_unused, at) => `src/file-${String(at)}.ts`,
  );
  assert.equal(
    blockedFault(viewOf({ runtime: { changedFiles, handoff: [] } })),
    "TooManyLines",
  );
});

test("runtime facts move the runtime section and no other", () => {
  const withFacts = composed(
    viewOf({
      practices: [...allPracticeIds],
      runtime: {
        workspace: "/work/importer",
        changedFiles: ["importer/rows.ts"],
        handoff: ["The parser was left alone."],
      },
    }),
  ).briefing;
  const without = composed(viewOf({ practices: [...allPracticeIds] })).briefing;
  const pinnedHalf = (rendered: typeof without): readonly BriefingSection[] =>
    rendered.sections.filter((section) => section.section !== "RuntimeContext");
  assert.deepEqual(pinnedHalf(withFacts), pinnedHalf(without));
  assert.ok(
    withFacts.sections.some((section) => section.section === "RuntimeContext"),
  );
});
