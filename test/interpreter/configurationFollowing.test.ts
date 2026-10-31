/**
 * Whether a ticket following its newest configuration revision moves to the
 * one its repository's head declares, judged in order: the held revision, the
 * trim, the head's readiness under its default program, then what it runs.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import type { ConfigurationSelection } from "../../src/contract/configurationSelection.ts";
import {
  canonicalConfigurationOf,
  type CanonicalConfiguration,
} from "../../src/interpreter/authoring.ts";
import {
  configurationFollowingRead,
  configurationFollowingVerdict,
  type ConfigurationFollowingTicket,
} from "../../src/interpreter/configurationFollowing.ts";
import { asRepositoryId } from "../../src/interpreter/finalizer.ts";
import { asDraftBrief } from "../../src/interpreter/ticketBrief.ts";

const repository = asRepositoryId("https://example.test/following.git");

const agent = (text: string) => ({
  runner: "Agent",
  prompt: { text },
  worker: {
    mode: { type: "SingleAgent", agent: "Claude", arguments: [] },
    setup: [],
    files: [],
  },
});

/** A catalog whose default plan reviews and whose other plan runs the tests, changed by `change`. */
function catalog(
  change: (value: Record<string, unknown>) => void = () => undefined,
): CanonicalConfiguration {
  const value: Record<string, unknown> = {
    version: 2,
    image: "worker:v2",
    workloads: {
      build: agent("Build it."),
      review: agent("Review it."),
      tests: { runner: "Commands", commands: ["npm test"] },
    },
    plans: {
      standard: [{ name: "review", evaluators: ["review"] }],
      tested: [{ name: "tests", evaluators: ["tests"] }],
    },
    finalizers: { merged: { approvalRequired: false } },
    defaults: {
      work: "build",
      evaluation: "standard",
      finalization: "merged",
      configuration: "Latest",
    },
  };
  change(value);
  return canonicalConfigurationOf(value);
}

/** The value one catalog fixture field is, to change in place. */
function field(value: Record<string, unknown>, name: string) {
  return value[name] as Record<string, unknown>;
}

const brief = asDraftBrief({
  intent: "Follow the newest revision.",
  links: [],
  repository,
  finalization: { mode: "Push" },
});

const oneStage = [{ key: 1, evaluators: [{ key: 1 }] }];

function ticket(
  head: CanonicalConfiguration,
  overrides: Partial<ConfigurationFollowingTicket> = {},
): ConfigurationFollowingTicket {
  return {
    held: catalog(),
    head,
    brief,
    overrides: undefined,
    selection: undefined,
    program: oneStage,
    dependencies: new Set(),
    repository,
    ...overrides,
  };
}

test("a head declaring the same catalog leaves the ticket current", () => {
  assert.deepEqual(configurationFollowingVerdict(ticket(catalog())), {
    verdict: "Current",
  });
});

test("a head changing only a workload the ticket does not run leaves it current", () => {
  const head = catalog((value) => {
    field(value, "workloads")["tests"] = {
      runner: "Commands",
      commands: ["npm run test:all"],
    };
  });
  assert.deepEqual(configurationFollowingVerdict(ticket(head)), {
    verdict: "Current",
  });
});

test("a head changing a workload the ticket runs moves it onto the default program", () => {
  const head = catalog((value) => {
    field(value, "workloads")["review"] = agent("Review it harder.");
  });
  assert.deepEqual(configurationFollowingVerdict(ticket(head)), {
    verdict: "Moves",
    program: oneStage,
  });
});

test("a head changing the evaluator its selection names moves it", () => {
  const selection: ConfigurationSelection = {
    evaluation: "tested",
    configuration: "Latest",
  };
  const head = catalog((value) => {
    field(value, "workloads")["tests"] = {
      runner: "Commands",
      commands: ["npm run test:all"],
    };
  });
  assert.deepEqual(configurationFollowingVerdict(ticket(head, { selection })), {
    verdict: "Moves",
    program: oneStage,
  });
});

test("a head changing only the selected finalizer moves the ticket", () => {
  const head = catalog((value) => {
    field(value, "finalizers")["merged"] = { approvalRequired: true };
  });
  assert.deepEqual(
    configurationFollowingVerdict(ticket(head)).verdict,
    "Moves",
  );
});

test("a head renaming a stage or changing its outputs moves the ticket", () => {
  const renamed = catalog((value) => {
    field(value, "plans")["standard"] = [
      { name: "inspection", evaluators: ["review"] },
    ];
  });
  const outputs = catalog((value) => {
    value["outputs"] = [
      {
        name: "Report",
        path: "report.md",
        mediaType: "text/markdown",
        renderer: "Markdown",
      },
    ];
  });
  for (const head of [renamed, outputs])
    assert.equal(configurationFollowingVerdict(ticket(head)).verdict, "Moves");
});

test("a plan gaining a stage moves the ticket onto a program running it", () => {
  const head = catalog((value) => {
    field(value, "plans")["standard"] = [
      { name: "review", evaluators: ["review"] },
      { name: "tests", evaluators: ["tests"] },
    ];
  });
  assert.deepEqual(configurationFollowingVerdict(ticket(head)), {
    verdict: "Moves",
    program: [
      { key: 1, evaluators: [{ key: 1 }] },
      { key: 2, evaluators: [{ key: 1 }] },
    ],
  });
});

test("a head dropping a workload the selection names holds the ticket with the fault", () => {
  const selection: ConfigurationSelection = { evaluation: "tested" };
  const head = catalog((value) => {
    delete field(value, "plans")["tested"];
  });
  assert.deepEqual(configurationFollowingVerdict(ticket(head, { selection })), {
    verdict: "Held",
    fault: "SelectionUnknown",
  });
});

test("a trimmed ticket is answered before its head is read", () => {
  const held = catalog((value) => {
    field(value, "plans")["standard"] = [
      { name: "review", evaluators: ["review"] },
      { name: "tests", evaluators: ["tests"] },
    ];
  });
  assert.deepEqual(
    configurationFollowingVerdict(
      ticket(canonicalConfigurationOf({ version: 1 }), { held }),
    ),
    { verdict: "Trimmed" },
  );
});

test("a head holding no catalog holds the ticket", () => {
  assert.deepEqual(
    configurationFollowingVerdict(
      ticket(canonicalConfigurationOf({ version: 1 })),
    ),
    { verdict: "Held", fault: "SelectionUnsupported" },
  );
});

test("a held revision not ready for the ticket holds it", () => {
  assert.deepEqual(
    configurationFollowingVerdict(
      ticket(catalog(), { selection: { work: "absent" } }),
    ),
    { verdict: "Held", fault: "SelectionUnknown" },
  );
});

test("a head that would leave the brief's checks unrun holds the ticket", () => {
  const withChecks = asDraftBrief({
    intent: brief.intent,
    links: [],
    checks: ["npm run lint"],
    repository,
    finalization: { mode: "Push" },
  });
  const selection: ConfigurationSelection = { evaluation: "tested" };
  const head = catalog((value) => {
    field(value, "plans")["tested"] = [
      { name: "tests", evaluators: ["review"] },
    ];
  });
  assert.deepEqual(
    configurationFollowingVerdict(
      ticket(head, { selection, brief: withChecks }),
    ),
    { verdict: "Held", fault: "BriefChecksUncommanded" },
  );
});

test("a ticket's own read answers the verdict without the program, and a held one under the code a release is refused with", () => {
  const changed = catalog((value) => {
    field(value, "workloads")["review"] = agent("Review it harder.");
  });
  const trimmedHeld = catalog((value) => {
    field(value, "plans")["standard"] = [
      { name: "review", evaluators: ["review"] },
      { name: "tests", evaluators: ["tests"] },
    ];
  });
  const shapeless = catalog((value) => {
    field(value, "workloads")["review"] = { runner: "Agent" };
  });
  assert.deepEqual(configurationFollowingRead(ticket(catalog()), false), {
    verdict: "Current",
  });
  assert.deepEqual(configurationFollowingRead(ticket(changed), false), {
    verdict: "Moves",
  });
  assert.deepEqual(
    configurationFollowingRead(ticket(changed, { held: trimmedHeld }), false),
    { verdict: "Trimmed" },
  );
  assert.deepEqual(
    configurationFollowingRead(
      ticket(canonicalConfigurationOf({ version: 1 })),
      false,
    ),
    { verdict: "Held", code: "SelectionUnsupported" },
  );
  assert.deepEqual(configurationFollowingRead(ticket(shapeless), false), {
    verdict: "Held",
    code: "ConfigurationInvalid",
  });
});

test("a ticket's own read answers Current where it holds the head's own revision, which the importer never judges", () => {
  const trimmed = catalog((value) => {
    field(value, "plans")["standard"] = [
      { name: "review", evaluators: ["review"] },
      { name: "tests", evaluators: ["tests"] },
    ];
  });
  assert.deepEqual(
    configurationFollowingRead(ticket(trimmed, { held: trimmed }), true),
    { verdict: "Current" },
  );
  assert.equal(
    configurationFollowingRead(
      ticket(trimmed, {
        held: trimmed,
        selection: { configuration: "Pinned" },
      }),
      true,
    ),
    undefined,
  );
});

test("a ticket's own read answers nothing where its choice, or else its held catalog's default, pins it", () => {
  const changed = catalog((value) => {
    field(value, "workloads")["review"] = agent("Review it harder.");
  });
  const unchosen = catalog((value) => {
    delete field(value, "defaults")["configuration"];
  });
  assert.equal(
    configurationFollowingRead(
      ticket(changed, { selection: { configuration: "Pinned" } }),
      false,
    ),
    undefined,
  );
  assert.equal(
    configurationFollowingRead(ticket(changed, { held: unchosen }), false),
    undefined,
  );
  assert.deepEqual(
    configurationFollowingRead(
      ticket(changed, {
        held: unchosen,
        selection: { configuration: "Latest" },
      }),
      false,
    ),
    { verdict: "Moves" },
  );
});
