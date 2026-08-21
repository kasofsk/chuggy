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
  composeTaskInvocation,
  renderBriefing,
  resolvePractices,
  runtimeChangedFilesMax,
  type BlessedPractice,
  type BriefingFault,
  type BriefingView,
  type PurposeBlock,
  type RuntimeFacts,
  type TaskInvocation,
  type TicketBrief,
} from "../../src/interpreter/taskBriefing.ts";
import {
  taskAuthorityGrant,
  type AuthorityRequest,
  type PolicyAuthorityGrant,
} from "../../src/interpreter/taskAuthority.ts";
import type { ConfigurationPin } from "../../src/interpreter/projectDecision.ts";

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

/** One view, with the parts a case is about replacing the ordinary ones. */
function viewOf(parts: {
  readonly purpose?: TaskPurpose;
  readonly pin?: ConfigurationPin;
  readonly revision?: string;
  readonly digest?: string;
  readonly brief?: TicketBrief;
  readonly practices?: readonly string[];
  readonly block?: PurposeBlock;
  readonly authority?: AuthorityRequest;
  readonly runtime?: RuntimeFacts;
  readonly grant?: PolicyAuthorityGrant;
}): BriefingView {
  const block = parts.block ?? { instructions: [] };
  return {
    purpose: parts.purpose ?? "Work",
    pin: parts.pin ?? pin,
    configuration: {
      configurationRevision: parts.revision ?? pin.configurationRevision,
      configurationDigest: parts.digest ?? pin.configurationDigest,
      brief: parts.brief ?? brief,
      practices: parts.practices ?? [],
      work: block,
      review: block,
      ...(parts.authority === undefined ? {} : { authority: parts.authority }),
    },
    runtime: parts.runtime ?? noFacts,
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
            { length: briefingLinesMax + 1 },
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
