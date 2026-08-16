/**
 * THE EMITTER: regenerate every committed fixture from the manifest, then
 * replay what it wrote and refuse to leave a corpus that misses an obligation.
 *
 * IT IS NOT A GATE AND IT IS NOT IN `ci.sh`. It runs quint, which is the one
 * thing `check-conformance.sh` must never do: a gate that regenerates would
 * take its verdict from whatever the model says today, which is the opposite of
 * replaying a committed trace. This is the developer's tool for when the model
 * moves, and its output is a diff to read.
 *
 *   node src/tools/emit-corpus.ts
 *
 * WHAT IT WRITES, and the two ways a committed fixture differs from raw quint
 * output — both deliberate, both deterministic, so that regenerating an
 * unchanged model produces byte-identical files and a real diff is visible in
 * the noise of none:
 *
 *   1. `#meta.timestamp` AND `#meta.description` ARE DROPPED. Both embed the
 *      generation time, so keeping them would make every regeneration a diff.
 *      Nothing reads them — the decoder ignores `#meta` wholesale — and what
 *      they would have told a reader (which command, which seed, which module)
 *      is in the manifest, checkable. The rest of the block is kept: `format`,
 *      `source` and `status` are facts about the document rather than about
 *      when it was written.
 *   2. A TRAILING RUN OF `settled` STATES IS TRUNCATED TO ONE. `settle` is the
 *      dead-end stutter and it dominates a walk that reaches a quiet fleet
 *      early, so a search budget spent there would commit hundreds of
 *      identical states. One is kept, always: the corpus owes the `settled`
 *      label and its exemption arm a step, and truncating to none would drop
 *      an obligation to save bytes. Only a TRAILING run is truncated, and only
 *      as a suffix, so every state's `#meta.index` still equals its position.
 *
 * THE SIGSEGV RETRY. Quint 0.32.0 intermittently dies on the rust backend with
 * signal 11 and no output (ledger #12). A run that dies that way has produced
 * no verdict, so it is retried rather than recorded — and a run that dies
 * repeatedly is reported as could-not-run. Nothing here ever turns an absent
 * verdict into a fixture.
 */

import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { decodeTrace } from "../spine/itf.ts";
import {
  CorpusError,
  fixturePath,
  loadManifest,
  messageOf,
  readJson,
  tier1Dir,
  tier2Dir,
  witnessSource,
  type Tier1Fixture,
  type Tier2Fixture,
} from "./corpus.ts";
import { verifyCorpus } from "./verify.ts";

const QUINT = "./node_modules/.bin/quint";
const MC = "model/mc/mc_chuggy.qnt";

/** How many times a run that produced no verdict at all is given again. */
const segfaultRetries = 4;

/** The signal-11 exit code a shell reports, which is the flake's whole signature. */
const segfaultStatus = 139;

type Run = {
  readonly status: number;
  readonly stdout: string;
  readonly stderr: string;
};

function runQuint(args: readonly string[]): Run {
  for (let attempt = 0; attempt <= segfaultRetries; attempt += 1) {
    const result = spawnSync(QUINT, [...args], { encoding: "utf8" });
    const status = result.status ?? segfaultStatus;
    const stdout = result.stdout || "";
    const stderr = result.stderr || "";
    if (status !== segfaultStatus || stdout !== "" || stderr !== "") {
      return { status, stdout, stderr };
    }
    console.log(`  quint died with no verdict; retrying (ledger #12)`);
  }
  throw new CorpusError(
    `quint produced no verdict after every retry: ${args.join(" ")}`,
  );
}

// === Post-processing =======================================================

/**
 * The committed form of a raw ITF document: volatile metadata dropped, a
 * trailing settled run truncated, serialized one way.
 *
 * ONE LINE PER STATE, which is a diff decision rather than a size one. A trace
 * is read by the state, the replayer reports its findings by the state, and a
 * regenerated corpus is reviewed by asking which states moved — so a state is
 * the unit a line should hold. Fully indented, the same corpus is many times
 * the bytes and a one-field change spreads over a dozen diff hunks; on one line
 * per state it is one changed line, at the index the finding names.
 */
function commitForm(raw: unknown, where: string): string {
  const doc = { ...(raw as Record<string, unknown>) };
  const meta = doc["#meta"];
  if (typeof meta === "object" && meta !== null) {
    const kept = { ...(meta as Record<string, unknown>) };
    delete kept["timestamp"];
    delete kept["description"];
    doc["#meta"] = kept;
  }
  const states = truncateTrailingSettled(doc, where);
  const head = Object.entries(doc)
    .filter(([key]) => key !== "states")
    .map(
      ([key, value]) => `  ${JSON.stringify(key)}: ${JSON.stringify(value)}`,
    );
  const body = states.map((state) => `    ${JSON.stringify(state)}`);
  return `{\n${head.join(",\n")},\n  "states": [\n${body.join(",\n")}\n  ]\n}\n`;
}

function truncateTrailingSettled(
  doc: Record<string, unknown>,
  where: string,
): readonly unknown[] {
  const trace = decodeTrace(doc, where);
  const states = doc["states"];
  if (!Array.isArray(states)) {
    throw new CorpusError(`${where}: states is not an array`);
  }
  let keep = trace.states.length;
  while (keep > 1) {
    const last = trace.states[keep - 1];
    const previous = trace.states[keep - 2];
    if (
      last === undefined ||
      previous === undefined ||
      last.lastStep.label !== "settled" ||
      previous.lastStep.label !== "settled"
    ) {
      break;
    }
    keep -= 1;
  }
  return (states as readonly unknown[]).slice(0, keep);
}

function write(path: string, text: string): void {
  writeFileSync(path, text, "utf8");
  console.log(`  wrote ${path}`);
}

// === Tier 1: the seeded searches ===========================================

function emitTier1(fixture: Tier1Fixture, scratch: string): void {
  const out = join(scratch, `${fixture.name}.itf.json`);
  const run = runQuint([
    "run",
    MC,
    `--main=mc_chuggy_${fixture.instance}`,
    `--seed=${fixture.seed}`,
    `--max-samples=${String(fixture.maxSamples)}`,
    `--max-steps=${String(fixture.maxSteps)}`,
    `--invariant=${fixture.invariant}`,
    "--mbt",
    `--out-itf=${out}`,
    "--verbosity=0",
  ]);
  const wanted = fixture.expect === "violation" ? 1 : 0;
  if (run.status !== wanted) {
    throw new CorpusError(
      `${fixture.name}: the search was to report ${fixture.expect} (exit ${String(wanted)}) and exited ${String(run.status)}: ${run.stdout}${run.stderr}`,
    );
  }
  write(fixturePath(fixture, 1), commitForm(readJson(out), fixture.name));
}

// === Tier 2: the deterministic witness exports =============================

/**
 * One `quint test` per witness module writes one trace per run in it, named by
 * the run. The module is exported once and every fixture naming it takes its
 * own run's file, so a module with several witnesses costs one invocation.
 */
function emitTier2(
  module: string,
  fixtures: readonly Tier2Fixture[],
  scratch: string,
): void {
  const dir = join(scratch, module);
  mkdirSync(dir, { recursive: true });
  const run = runQuint([
    "test",
    `--main=${module}`,
    `--out-itf=${join(dir, "{test}_{seq}.itf.json")}`,
    witnessSource,
  ]);
  if (run.status !== 0) {
    throw new CorpusError(
      `${module}: the witness suite did not pass: ${run.stdout}${run.stderr}`,
    );
  }
  const written = readdirSync(dir);
  for (const fixture of fixtures) {
    const file = written.find((f) => f.startsWith(`${fixture.run}_`));
    if (file === undefined) {
      throw new CorpusError(
        `${fixture.name}: ${module} exported no trace for run ${fixture.run}; it wrote [${written.join(", ")}]`,
      );
    }
    write(
      fixturePath(fixture, 2),
      commitForm(readJson(join(dir, file)), fixture.name),
    );
  }
}

// === The run ===============================================================

function main(): number {
  const scratch = mkdtempSync(join(tmpdir(), "chuggy-corpus-"));
  try {
    const manifest = loadManifest();
    mkdirSync(tier1Dir, { recursive: true });
    mkdirSync(tier2Dir, { recursive: true });
    for (const fixture of manifest.tier1) {
      emitTier1(fixture, scratch);
    }
    const modules = [...new Set(manifest.tier2.map((f) => f.module))];
    for (const module of modules) {
      emitTier2(
        module,
        manifest.tier2.filter((f) => f.module === module),
        scratch,
      );
    }
  } catch (error) {
    console.log(`emit-corpus: LINTER ERROR — ${messageOf(error)}`);
    return 2;
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }

  const verification = verifyCorpus();
  for (const error of verification.errors) {
    console.log(`emit-corpus: LINTER ERROR — ${error}`);
  }
  for (const finding of verification.findings) {
    console.log(`ERROR ${finding}`);
  }
  if (verification.errors.length > 0) {
    return 2;
  }
  if (verification.findings.length > 0) {
    console.log(
      "emit-corpus: the regenerated corpus does not satisfy its obligations",
    );
    return 1;
  }
  console.log(
    "emit-corpus: regenerated, replayed, and every obligation covered",
  );
  return 0;
}

process.exitCode = main();
