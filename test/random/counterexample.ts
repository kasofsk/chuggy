/**
 * A found counterexample written in the corpus format, and the failure report
 * that points at it.
 *
 * THE FILE IS A GOLDEN IN EVERY RESPECT THE REPLAYER CONSUMES: an ITF states
 * array carrying `mbt::actionTaken` and `mbt::nondetPicks` beside the instance's
 * `tickets` and `lastStep` variables, with a manifest row naming it, so
 * `test/conformance/` replays it exactly as it replays a committed row —
 * pointed at the directory with `CHUG_GOLDEN_DIR`, or committed as a new row if
 * the divergence it reproduces is real. The states are what this tree's own
 * deciders produced, which is the point: the fixture pins the divergence, and
 * once the defect is fixed the replay of it goes red at the divergent step.
 *
 * WHAT CANNOT BE WRITTEN IS SAID INSTEAD. A counterexample whose last step
 * threw has no post-state to record, so the report carries the seed and the
 * instance — which reproduce the run exactly — and no file.
 */

import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Config } from "../../src/domain/config.ts";
import { initRecord } from "../../src/domain/core.ts";
import {
  encodeCore,
  encodeOption,
  encodeStepRecord,
} from "../itf/vocabulary.ts";
import { encodeValue, type ItfValue } from "../itf/decode.ts";
import { drawnWire, type Drawn } from "./draws.ts";
import { shrinkSteps } from "./shrink.ts";
import {
  walkInit,
  walkRecord,
  walkReplay,
  type Decide,
  type StepFailure,
  type WalkOutcome,
  type WalkStep,
} from "./walk.ts";

/** A seed as the manifest spells one. `Number()` reads the same spelling back. */
export function seedLabel(seed: number): string {
  return `0x${seed.toString(16)}`;
}

/** A whole `mbt::nondetPicks` record, every pick present, absent draws as `None`. */
function nondetPicksOf(drawn: Drawn): unknown {
  return Object.fromEntries(
    Object.entries(drawnWire(drawn)).map(([name, wire]) => [
      name,
      encodeOption(wire as ItfValue | undefined),
    ]),
  );
}

/**
 * The ITF document for a failing trace: the initial state, then one state per
 * step holding the action, its picks, and what the deciders produced.
 */
export function counterexampleDocument(
  config: Config,
  instance: string,
  steps: readonly WalkStep[],
  decide: Decide,
): unknown {
  const ticketsVar = `${instance}::chuggy_domain::tickets`;
  const lastStepVar = `${instance}::chuggy_domain::lastStep`;
  const states: unknown[] = [
    {
      "#meta": { index: 0 },
      "mbt::actionTaken": "init",
      "mbt::nondetPicks": nondetPicksOf({}),
      [lastStepVar]: encodeValue(encodeStepRecord(initRecord)),
      [ticketsVar]: encodeValue(encodeCore(walkInit(config))),
    },
  ];
  for (const { step, decision } of walkRecord(config, steps, decide)) {
    states.push({
      "#meta": { index: states.length },
      "mbt::actionTaken": step.action,
      "mbt::nondetPicks": nondetPicksOf(step.drawn),
      [lastStepVar]: encodeValue(encodeStepRecord(decision.rec)),
      [ticketsVar]: encodeValue(encodeCore(decision.post)),
    });
  }
  return {
    "#meta": {
      format: "ITF",
      "format-description":
        "https://apalache-mc.org/docs/adr/015adr-trace.html",
      source: "test/random/walk.ts",
      status: "violation",
    },
    vars: ["mbt::actionTaken", "mbt::nondetPicks", lastStepVar, ticketsVar],
    states,
  };
}

/** Where a written counterexample landed. */
export interface WrittenCounterexample {
  readonly file: string;
  readonly directory: string;
}

/**
 * Writes the trace and a manifest row naming it, so the directory is a corpus
 * the conformance replay consumes as it stands.
 */
export function writeCounterexample(
  directory: string,
  config: Config,
  instance: string,
  seed: number,
  steps: readonly WalkStep[],
  decide: Decide,
  purpose: string,
): WrittenCounterexample {
  const name = `walk-${instance}-${seedLabel(seed)}`;
  const document = counterexampleDocument(config, instance, steps, decide);
  mkdirSync(directory, { recursive: true });
  const file = join(directory, `${name}.itf.json`);
  writeFileSync(file, `${JSON.stringify(document, null, 2)}\n`);
  const manifest = {
    goldens: [
      {
        name,
        instance,
        seed: seedLabel(seed),
        source: "test/random/walk.ts",
        steps: steps.length,
        purpose,
      },
    ],
  };
  writeFileSync(
    join(directory, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  return { file, directory };
}

/** A failure's parts, in the order a reader acts on them. */
function failureLines(failure: StepFailure): string {
  const parts: string[] = [];
  if (failure.failed.length > 0) {
    parts.push(
      `these invariants came back false: ${failure.failed.join(", ")}`,
    );
  }
  if (failure.refused.length > 0) {
    parts.push(`these could not be asked: ${failure.refused.join(", ")}`);
  }
  if (failure.emissions.length > 0) {
    parts.push(`completion emissions: ${failure.emissions.join("; ")}`);
  }
  if (failure.broke !== undefined) parts.push(failure.broke);
  return parts.join("; ");
}

/**
 * The whole failure report: what failed and where, the shrunk trace written as
 * a corpus the replayer consumes, and the pair that reproduces the run.
 */
export function counterexampleReport(
  config: Config,
  instance: string,
  seed: number,
  outcome: WalkOutcome,
  decide: Decide,
  directory: string | undefined,
): string {
  const finding = outcome.finding;
  if (finding === undefined) {
    throw new Error("counterexample: the outcome carries no finding to report");
  }
  const lines = [
    `${instance} seed ${seedLabel(seed)}: step ${String(finding.step)} (${finding.action}): ${failureLines(finding.failure)}`,
  ];
  lines.push(
    ...counterexampleReportFixture(
      config,
      instance,
      seed,
      outcome,
      decide,
      directory,
    ),
  );
  lines.push(
    `rerun with: CHUG_WALK_SEED=${seedLabel(seed)} CHUG_WALK_INSTANCE=${instance} node --test test/random/walk.test.ts`,
  );
  return lines.join("\n");
}

/** The fixture half of the report, or why there is none. */
function counterexampleReportFixture(
  config: Config,
  instance: string,
  seed: number,
  outcome: WalkOutcome,
  decide: Decide,
  directory: string | undefined,
): readonly string[] {
  if (outcome.finding?.failure.broke !== undefined) {
    return ["no fixture: the failing step produced no decision to record"];
  }
  const shrunk = shrinkSteps(config, outcome.steps, decide);
  const replayed = walkReplay(config, shrunk, decide);
  if (
    replayed.kind !== "finding" ||
    replayed.finding.failure.broke !== undefined
  ) {
    return [
      "no fixture: the shrunk trace's failing step produced no decision to record",
    ];
  }
  const where = directory ?? mkdtempSync(join(tmpdir(), "chuggy-walk-"));
  const written = writeCounterexample(
    where,
    config,
    instance,
    seed,
    shrunk,
    decide,
    `the walk's counterexample: ${failureLines(replayed.finding.failure)}`,
  );
  return [
    `shrunk to ${String(shrunk.length)} step(s) and written as a corpus: ${written.file}`,
    `replay it with: CHUG_GOLDEN_DIR=${written.directory} node --test test/conformance/replay.test.ts`,
  ];
}
