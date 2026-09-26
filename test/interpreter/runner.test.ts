/**
 * The worker pool's assignment guard against the specification it refines:
 * `src/interpreter/workerPoolAssignment.ts` restates `model/runner.qnt`'s
 * `canAssign` and `placementOutcome` for a pool, and this reads the model at
 * run time to check that the restatement still says the same thing.
 *
 * A HAND-MAINTAINED COPY OF A PROVED DEFINITION GOES STALE SILENTLY, which is
 * the failure this exists to prevent. The runner machine emits no golden, so
 * nothing replays against it; instead its rosters, the terms its guard
 * conjoins and the runs of `model/tests/runner_test.qnt` that exercise the
 * guard are read out of the model's own source, and a constructor, a term or
 * a run added there becomes a failure here until the refinement answers it.
 *
 * WHAT IT DOES NOT PROVE. It holds the decider to the model over the rows of
 * `test/interpreter/runnerCases.ts`, and says nothing of the claim a pool
 * makes against PostgreSQL, which states the guard a second time.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { workerPoolCapabilitySchema } from "../../src/contract/workerPool.ts";
import {
  allArchitectures,
  allExecutionCapabilities,
  allOperatingSystems,
  type ExecutionCapability,
} from "../../src/interpreter/executionRequirement.ts";
import {
  allExecutionRoutes,
  allWorkerPoolClasses,
  allWorkerPoolPlacementOutcomes,
  allWorkerPoolPlacementPhases,
  workerPoolCanAssign,
  workerPoolDemandRouted,
  workerPoolPlacementOutcome,
  workerPoolPlatformToken,
  workerPoolPolicyRegistered,
  workerPoolSessionHasSlot,
  type ExecutionRoute,
  type WorkerPoolDemand,
  type WorkerPoolPolicy,
} from "../../src/interpreter/workerPoolAssignment.ts";
import { asProjectId } from "../../src/interpreter/projectStore.ts";
import { populated } from "./roster.ts";
import {
  runnerCaseAssignment,
  runnerCases,
  runnerTerm,
} from "./runnerCases.ts";

const modelRoot = join(import.meta.dirname, "..", "..");

/** The runner model as text, which is the authority every roster and term below is read from. */
function runnerSource(): string {
  return readFileSync(join(modelRoot, "model", "runner.qnt"), "utf8");
}

/** The runner model's own runs, which the case table restates. */
function runnerTestSource(): string {
  return readFileSync(
    join(modelRoot, "model", "tests", "runner_test.qnt"),
    "utf8",
  );
}

/** The constructors a one-line sum type declares, in the order the model writes them. */
function runnerRoster(name: string): readonly string[] {
  const found = new RegExp(`\\n  type ${name} = ([^{\\n]+)\\n`).exec(
    runnerSource(),
  );
  assert.ok(found?.[1], `model/runner.qnt declares no sum type ${name}`);
  return found[1].split("|").map((constructor) => constructor.trim());
}

/** Quint written on one line, so a term reads the same however the model wraps it. */
function runnerFlattened(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** What an opening bracket at `at` encloses, found by depth over both kinds of bracket the model nests. */
function runnerBracketed(text: string, at: number): string {
  assert.ok(
    text[at] === "(" || text[at] === "{",
    `model/runner.qnt: no bracket opens at ${String(at)}`,
  );
  let depth = 0;
  for (let index = at; index < text.length; index++) {
    const character = text[index];
    if (character === "(" || character === "{") depth++;
    if (character === ")" || character === "}") depth--;
    if (depth === 0) return text.slice(at + 1, index);
  }
  throw new Error(
    `model/runner.qnt: the bracket at ${String(at)} never closes`,
  );
}

/** The pieces a separator divides where no bracket is open. */
function runnerTopLevel(text: string, separator: string): readonly string[] {
  const pieces: string[] = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < text.length; index++) {
    const character = text[index];
    if (character === "(" || character === "{") depth++;
    if (character === ")" || character === "}") depth--;
    if (depth === 0 && text.startsWith(separator, index)) {
      pieces.push(text.slice(start, index));
      start = index + separator.length;
    }
  }
  pieces.push(text.slice(start));
  return pieces.map((piece) => piece.trim()).filter((piece) => piece !== "");
}

/** The body of one pure definition, flattened: what follows its signature up to the next member of the module. */
function runnerDefinition(name: string): string {
  const source = runnerSource();
  const start = source.indexOf(`\n  pure def ${name}(`);
  assert.ok(start >= 0, `model/runner.qnt defines no ${name}`);
  const rest = source.slice(start + 1);
  const end = rest.search(/\n {2}[^\s}]/);
  const text = runnerFlattened(end < 0 ? rest : rest.slice(0, end));
  const signature = text.indexOf("): bool =");
  assert.ok(signature > 0, `model/runner.qnt: ${name} is not a predicate`);
  return text.slice(signature + "): bool =".length).trim();
}

/** The terms a predicate conjoins: an `and { }` block's members, or an infix chain's. */
function runnerConjuncts(body: string): readonly string[] {
  return body.startsWith("and {")
    ? runnerTopLevel(runnerBracketed(body, body.indexOf("{")), ",")
    : runnerTopLevel(body, " and ");
}

/** A term, or the terms of the predicate it calls, each arm's qualified by the constructor it matches. */
function runnerExpanded(term: string): readonly string[] {
  const call = /^([a-z]\w*)\(/.exec(term)?.[1];
  if (call === undefined || !runnerSource().includes(`pure def ${call}(`))
    return [term];
  const body = runnerDefinition(call);
  if (!body.startsWith("match ")) return runnerConjuncts(body);
  return runnerTopLevel(runnerBracketed(body, body.indexOf("{")), "|").flatMap(
    (arm) => {
      const at = arm.indexOf("=>");
      const constructor = arm.slice(0, arm.indexOf("(")).trim();
      return runnerConjuncts(arm.slice(at + 2).trim()).map(
        (conjunct) => `${constructor}: ${conjunct}`,
      );
    },
  );
}

/** Every term `canAssign` conjoins, the session it is guarded on first and each predicate it calls opened one level. */
function runnerCanAssignTerms(): readonly string[] {
  const body = runnerDefinition("canAssign");
  assert.ok(
    body.startsWith("if ("),
    "model/runner.qnt: canAssign is unguarded",
  );
  const guard = runnerBracketed(body, body.indexOf("("));
  const conjoined = runnerConjuncts(body.slice(body.indexOf("and {")));
  return [guard, ...conjoined.flatMap(runnerExpanded)];
}

const runnerGuards = [
  "canAssign",
  "placementOutcome",
  "inventoryMatches",
  "policyAllows",
];

/** The runs of `model/tests/runner_test.qnt` that call one of the guards this restates. */
function runnerGuardRuns(): readonly string[] {
  const runs = runnerTestSource().split("\n  run ").slice(1);
  return runs
    .filter((run) =>
      runnerGuards.some((guard) => new RegExp(`\\b${guard}\\(`).test(run)),
    )
    .map((run) => run.slice(0, run.indexOf(" ")));
}

test("the class roster is the one model/runner.qnt declares", () => {
  assert.deepEqual(runnerRoster("RunnerClass"), [...allWorkerPoolClasses]);
});

test("the outcome roster is the one model/runner.qnt declares", () => {
  assert.deepEqual(runnerRoster("PlacementOutcome"), [
    ...allWorkerPoolPlacementOutcomes,
  ]);
});

test("the phase roster is the one model/runner.qnt declares", () => {
  assert.deepEqual(runnerRoster("PlacementPhase"), [
    ...allWorkerPoolPlacementPhases,
  ]);
});

test("each execution capability is the model's, spelled as this tree spells it", () => {
  const spelling: Readonly<Record<string, ExecutionCapability>> = {
    AgentClaude: "Agent:Claude",
    AgentCodex: "Agent:Codex",
  };
  assert.deepEqual(Object.keys(spelling), runnerRoster("ExecutionCapability"));
  assert.deepEqual(Object.values(spelling), [...allExecutionCapabilities]);
});

test("each route is the model's, named as execution.placement stores it", () => {
  const stored: Readonly<Record<string, ExecutionRoute>> = {
    Kubernetes: "InCluster",
    RegisteredRunner: "Pool",
  };
  assert.deepEqual(Object.keys(stored), runnerRoster("ExecutionRoute"));
  assert.deepEqual(Object.values(stored), [...allExecutionRoutes]);
});

test("a platform is the model's record, and every one is a token a pool can declare", () => {
  const record = /\n {2}type Platform = \{([^}]*)\}/.exec(runnerSource());
  assert.ok(record?.[1], "model/runner.qnt declares no Platform record");
  assert.deepEqual(
    record[1].split(",").map((field) => runnerFlattened(field)),
    ["operatingSystem: OperatingSystem", "architecture: Architecture"],
  );
  assert.deepEqual(runnerRoster("OperatingSystem"), [...allOperatingSystems]);
  assert.deepEqual(runnerRoster("Architecture"), [...allArchitectures]);
  const tokens = allOperatingSystems.flatMap((operatingSystem) =>
    allArchitectures.map((architecture) =>
      workerPoolPlatformToken({ operatingSystem, architecture }),
    ),
  );
  assert.equal(new Set(tokens).size, tokens.length);
  for (const token of tokens)
    assert.ok(
      workerPoolCapabilitySchema.safeParse(token).success,
      `${token} is not a capability token a pool can be registered with`,
    );
});

test("every term canAssign conjoins is made false by some case, and no case names another", () => {
  const terms = runnerCanAssignTerms();
  assert.deepEqual(
    [...terms, runnerTerm.image].sort(),
    Object.values(runnerTerm).sort(),
    "the terms this table names are not the ones model/runner.qnt conjoins",
  );
  const named: ReadonlySet<string> = new Set(Object.values(runnerTerm));
  const falsified = new Set(runnerCases.flatMap((each) => each.falsifies));
  for (const term of named)
    assert.ok(falsified.has(term), `no case makes ${term} false`);
  for (const term of falsified)
    assert.ok(named.has(term), `${term} is not a term of canAssign`);
});

test("every run of model/tests/runner_test.qnt that exercises a guard is restated, and no case names another", () => {
  const restated = new Set(
    runnerCases.flatMap((each) =>
      each.model === undefined ? [] : [each.model],
    ),
  );
  assert.deepEqual([...restated].sort(), [...runnerGuardRuns()].sort());
});

test("every field of the registered policy and the routed demand is varied by some case", () => {
  const policy = Object.keys(
    workerPoolPolicyRegistered,
  ) as readonly (keyof WorkerPoolPolicy)[];
  for (const field of populated(policy, "the registered policy"))
    assert.ok(
      runnerCases.some(
        (each) => each.pool[field] !== workerPoolPolicyRegistered[field],
      ),
      `no case varies the registered ${field}`,
    );
  const demand = Object.keys(
    workerPoolDemandRouted,
  ) as readonly (keyof WorkerPoolDemand)[];
  for (const field of populated(demand, "the routed demand"))
    assert.ok(
      runnerCases.some(
        (each) =>
          each.placement.demand[field] !== workerPoolDemandRouted[field],
      ),
      `no case varies the routed ${field}`,
    );
});

test("every case is named once, and falsifies a term exactly when it is refused", () => {
  const names = runnerCases.map((each) => each.name);
  assert.equal(new Set(names).size, names.length);
  for (const each of runnerCases)
    assert.equal(each.falsifies.length === 0, each.canAssign, each.name);
});

for (const each of populated(runnerCases, "the runner cases")) {
  test(each.name, () => {
    const enrolment = { pool: each.pool, session: each.session };
    assert.equal(
      workerPoolCanAssign(
        each.placement,
        enrolment,
        runnerCaseAssignment,
        new Set(each.assignmentsBound),
      ),
      each.canAssign,
      "canAssign",
    );
    assert.equal(
      workerPoolPlacementOutcome(each.placement, [enrolment]),
      each.placementOutcome,
      "placementOutcome",
    );
  });
}

test("an execution is placeable while any configured pool can take it, and unavailable while one could", () => {
  const ordinary = runnerCases[0];
  assert.ok(ordinary?.canAssign === true && ordinary.session !== undefined);
  const { placement } = ordinary;
  const current = { pool: ordinary.pool, session: ordinary.session };
  const absent = {
    pool: { ...ordinary.pool, pool: "pool-two" },
    session: undefined,
  };
  const foreign = {
    pool: {
      ...ordinary.pool,
      partition: {
        ...placement.partition,
        project: asProjectId("project-two"),
      },
    },
    session: ordinary.session,
  };
  assert.equal(
    workerPoolPlacementOutcome(placement, []),
    "DefinitiveIncompatibility",
  );
  assert.equal(
    workerPoolPlacementOutcome(placement, [foreign]),
    "DefinitiveIncompatibility",
  );
  assert.equal(
    workerPoolPlacementOutcome(placement, [foreign, absent]),
    "Unavailable",
  );
  assert.equal(
    workerPoolPlacementOutcome(placement, [foreign, absent, current]),
    "Placeable",
  );
  assert.equal(
    workerPoolPlacementOutcome({ ...placement, route: "InCluster" }, [current]),
    "NotApplicable",
  );
});

test("a poll's slots are refused unless they are a count under a positive bound", () => {
  const session = runnerCases[0]?.session;
  assert.ok(session);
  for (const held of [-1, 0.5, Number.NaN])
    assert.throws(
      () => workerPoolSessionHasSlot({ ...session, held }),
      RangeError,
    );
  for (const heldMax of [0, -1, 1.5])
    assert.throws(
      () => workerPoolSessionHasSlot({ ...session, heldMax }),
      RangeError,
    );
});
