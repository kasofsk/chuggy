/**
 * The importer's sweep over the tickets following a head: only a move writes,
 * a ticket's failure is that ticket's alone, and the run stops at its bounds
 * and its deadline and says so.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { asTicketId } from "../../src/domain/ids.ts";
import {
  asConfigurationRevisionId,
  canonicalConfigurationOf,
  type CanonicalConfiguration,
  type ConfigurationRevisionId,
} from "../../src/interpreter/authoring.ts";
import {
  configurationFollowingMovesMax,
  configurationFollowingPageTicketsMax,
  configurationFollowingReport,
  configurationFollowingTicketsReadMax,
  followConfigurations,
  type ConfigurationFollowingBinding,
  type ConfigurationFollowingCandidate,
  type ConfigurationFollowingMove,
  type ConfigurationFollowingMoved,
  type ConfigurationFollowingPort,
} from "../../src/interpreter/configurationFollowingSweep.ts";
import {
  asGitObjectId,
  asRepositoryId,
} from "../../src/interpreter/finalizer.ts";
import { asOperationId } from "../../src/interpreter/operationInbox.ts";
import { asProjectId, asTenantId } from "../../src/interpreter/projectStore.ts";
import { asDraftBrief } from "../../src/interpreter/ticketBrief.ts";

const repository = asRepositoryId("https://example.test/sweep.git");

const binding: ConfigurationFollowingBinding = {
  partition: { tenant: asTenantId("tenant"), project: asProjectId("project") },
  repository,
  commit: asGitObjectId("b".repeat(40)),
};

function catalog(prompt: string): CanonicalConfiguration {
  return canonicalConfigurationOf({
    version: 2,
    image: "worker:v2",
    workloads: {
      build: {
        runner: "Agent",
        prompt: { text: prompt },
        worker: {
          mode: { type: "SingleAgent", agent: "Claude", arguments: [] },
          setup: [],
          files: [],
        },
      },
    },
    plans: { standard: [{ name: "review", evaluators: ["build"] }] },
    defaults: { work: "build", evaluation: "standard" },
  });
}

const held = asConfigurationRevisionId(`repository:${"a".repeat(40)}:work`);
const moved = asConfigurationRevisionId(`repository:${"b".repeat(40)}:work`);
const same = asConfigurationRevisionId(`repository:${"b".repeat(40)}:same`);
const sameHeld = asConfigurationRevisionId(`repository:${"a".repeat(40)}:same`);

const canonicals = new Map<ConfigurationRevisionId, CanonicalConfiguration>([
  [held, catalog("Build it.")],
  [moved, catalog("Build it better.")],
  [sameHeld, catalog("Build it.")],
  [same, catalog("Build it.")],
]);

function candidate(
  ticket: number,
  head: ConfigurationRevisionId = moved,
): ConfigurationFollowingCandidate {
  return {
    ticket: asTicketId(ticket),
    revision: 1,
    held: head === same ? sameHeld : held,
    head,
    brief: asDraftBrief({
      intent: "Follow.",
      links: [],
      repository,
      finalization: { mode: "Push" },
    }),
    overrides: undefined,
    selection: undefined,
    authoring: {
      deps: new Set(),
      prog: [{ key: 1, evaluators: [{ key: 1 }] }],
    },
  };
}

/** A port answering `pages` in turn, every canonical on the first page alone, and each move by `answer`. */
function port(
  pages: readonly (readonly ConfigurationFollowingCandidate[])[],
  answer: (move: ConfigurationFollowingMove) => ConfigurationFollowingMoved,
): ConfigurationFollowingPort & {
  readonly moves: ConfigurationFollowingMove[];
  readonly reads: number[];
} {
  const moves: ConfigurationFollowingMove[] = [];
  const reads: number[] = [];
  return {
    moves,
    reads,
    candidates: ({ after }) => {
      reads.push(after);
      const page = pages[reads.length - 1] ?? [];
      return Promise.resolve({
        candidates: page,
        canonicals: reads.length === 1 ? canonicals : new Map(),
      });
    },
    move: (move) => {
      moves.push(move);
      return Promise.resolve(answer(move));
    },
  };
}

const accepted = (): ConfigurationFollowingMoved => ({
  moved: "Accepted",
  operation: asOperationId("follow-operation"),
});

test("only a ticket whose head changes what it runs is moved, and onto the head's revision", async () => {
  const ports = port([[candidate(1), candidate(2, same)]], accepted);
  const run = await followConfigurations({
    bindings: [binding],
    port: ports,
    now: () => 0,
    deadlineAtMs: 1,
  });
  assert.deepEqual(
    ports.moves.map((move) => [move.ticket, move.configuration]),
    [[1, moved]],
  );
  assert.deepEqual(
    configurationFollowingReport(run).map((reported) => reported.line),
    [
      `tenant/project ${repository} ticket 1 following ${moved} moved as operation follow-operation`,
    ],
  );
});

test("a move whose door raised fails that ticket alone, and a refused one is reported", async () => {
  const ports = port([[candidate(1), candidate(2), candidate(3)]], (move) => {
    if (move.ticket === 1) throw new Error("door raised");
    return move.ticket === 2
      ? { moved: "Refused", answer: "Backpressure" }
      : accepted();
  });
  const report = configurationFollowingReport(
    await followConfigurations({
      bindings: [binding],
      port: ports,
      now: () => 0,
      deadlineAtMs: 1,
    }),
  );
  assert.deepEqual(
    report.map(({ line, failed }) => [
      line.split(" ").slice(-2).join(" "),
      failed,
    ]),
    [
      [`${moved} failed`, true],
      ["refused: Backpressure", false],
      ["operation follow-operation", false],
    ],
  );
});

test("a full page is followed by the next, after its last ticket, with the revisions already read", async () => {
  const first = Array.from(
    { length: configurationFollowingPageTicketsMax },
    (_, index) => candidate(index + 1, same),
  );
  const ports = port(
    [first, [candidate(configurationFollowingPageTicketsMax + 1)]],
    accepted,
  );
  await followConfigurations({
    bindings: [binding],
    port: ports,
    now: () => 0,
    deadlineAtMs: 1,
  });
  assert.deepEqual(ports.reads, [0, configurationFollowingPageTicketsMax]);
  assert.deepEqual(
    ports.moves.map((move) => move.ticket),
    [configurationFollowingPageTicketsMax + 1],
  );
});

test("a binding whose candidates could not be read is reported, and the next is still swept", async () => {
  let reads = 0;
  const ports: ConfigurationFollowingPort = {
    candidates: () => {
      reads += 1;
      return reads === 1
        ? Promise.reject(new Error("read raised"))
        : Promise.resolve({ candidates: [candidate(1)], canonicals });
    },
    move: () => Promise.resolve(accepted()),
  };
  const report = configurationFollowingReport(
    await followConfigurations({
      bindings: [binding, binding],
      port: ports,
      now: () => 0,
      deadlineAtMs: 1,
    }),
  );
  assert.deepEqual(
    report.map((reported) => reported.failed),
    [true, false],
  );
  assert.equal(
    report[0]?.line,
    `tenant/project ${repository} following failed`,
  );
});

test("a run past its deadline calls no door and says it stopped short", async () => {
  let now = 0;
  const ports = port([[candidate(1), candidate(2)]], () => {
    now = 1;
    return accepted();
  });
  const run = await followConfigurations({
    bindings: [binding, binding],
    port: ports,
    now: () => now,
    deadlineAtMs: 1,
  });
  assert.equal(ports.moves.length, 1);
  assert.deepEqual(ports.reads, [0]);
  assert.equal(run.stopped, "Deadline");
  assert.equal(
    configurationFollowingReport(run).at(-1)?.line,
    "configuration following stopped short: Deadline",
  );
});

test("a run offers no more moves than its bound", async () => {
  const many = Array.from(
    { length: configurationFollowingMovesMax + 1 },
    (_, index) => candidate(index + 1),
  );
  const pages = Array.from(
    { length: Math.ceil(many.length / configurationFollowingPageTicketsMax) },
    (_, index) =>
      many.slice(
        index * configurationFollowingPageTicketsMax,
        (index + 1) * configurationFollowingPageTicketsMax,
      ),
  );
  const ports = port(pages, accepted);
  const run = await followConfigurations({
    bindings: [binding],
    port: ports,
    now: () => 0,
    deadlineAtMs: 1,
  });
  assert.equal(ports.moves.length, configurationFollowingMovesMax);
  assert.equal(run.stopped, "Moves");
});

test("a run whose read bound falls inside a page of its last binding says it stopped short", async () => {
  const short = configurationFollowingPageTicketsMax / 2;
  const other: ConfigurationFollowingBinding = {
    ...binding,
    partition: { ...binding.partition, project: asProjectId("other") },
  };
  const sizes = new Map([
    [binding, short],
    [other, configurationFollowingTicketsReadMax],
  ]);
  const asked: number[] = [];
  const ports: ConfigurationFollowingPort = {
    candidates: ({ binding: swept, after, max }) => {
      asked.push(max);
      const size = sizes.get(swept) ?? 0;
      return Promise.resolve({
        candidates: Array.from(
          { length: Math.max(0, Math.min(max, size - after)) },
          (_, index) => candidate(after + index + 1, same),
        ),
        canonicals,
      });
    },
    move: () => Promise.resolve(accepted()),
  };
  const run = await followConfigurations({
    bindings: [binding, other],
    port: ports,
    now: () => 0,
    deadlineAtMs: 1,
  });
  assert.equal(asked.at(-1), short);
  assert.equal(run.stopped, "TicketsRead");
  assert.equal(
    configurationFollowingReport(run).at(-1)?.line,
    "configuration following stopped short: TicketsRead",
  );
});
