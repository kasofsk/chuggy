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
 *      is in the manifest, checkable. The rest of the block is kept as quint
 *      wrote it — `format`, `format-description`, `source` and `status` are
 *      facts about the document rather than about when it was written.
 *   2. A TRAILING RUN OF `settled` STATES IS TRUNCATED TO ONE. `settle` is the
 *      dead-end stutter and it dominates a walk that reaches a quiet fleet
 *      early, so a search budget spent there would commit hundreds of
 *      identical states. One is kept, always: the corpus owes the `settled`
 *      label and its exemption arm a step, and truncating to none would drop
 *      an obligation to save bytes. Only a TRAILING run is truncated, and only
 *      as a suffix, so every state's `#meta.index` still equals its position.
 *
 * AND IT WRITES ONE FIELD OF THE MANIFEST: each fixture's `states`, the length
 * pin `verify.ts` checks on every replay. The manifest is otherwise a
 * hand-authored document and stays one — the counts are set in place and
 * nothing else about it is re-authored — because it is where a human declares
 * what a fixture is FOR, and this tool has no opinion about that. What the pin
 * buys is the one corruption a trace cannot report about itself: a state
 * removed from the end leaves a dense, ascending, perfectly readable shorter
 * trace, and the index check that catches every other removal has nothing to
 * say about it.
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

import { messageOf } from "../domain/assert.ts";
import { decodeTrace } from "../spine/itf.ts";
import {
  CorpusError,
  fixturePath,
  loadManifest,
  manifestPath,
  readJson,
  runTraceFile,
  tier1Dir,
  tier2Dir,
  witnessSource,
  writeManifestStateCounts,
  type Tier1Fixture,
  type Tier2Fixture,
} from "./corpus.ts";
import { verifyCorpus } from "./verify.ts";

const QUINT = "./node_modules/.bin/quint";
const MC = "model/mc/mc_chuggy.qnt";

/**
 * The pinned release, read the way `.chug/tasks/check-model.sh` reads it and
 * for its reason: a different release can change what a trace looks like, and
 * a corpus emitted by an unpinned tool is a corpus nobody can regenerate to
 * the same bytes. `--mbt` is experimental, which makes the pin matter more
 * here than anywhere else in this tree.
 */
const QUINT_VERSION = "0.32.0";

/**
 * How many times a run is ATTEMPTED when it keeps producing no verdict at all.
 * Stated as attempts rather than as retries: the loop below reads this as its
 * bound, and "retries" would make the bound one more than the number, which is
 * the kind of arithmetic a reader has to redo every time.
 */
const segfaultAttempts = 5;

type Run = {
  readonly status: number;
  readonly stdout: string;
  readonly stderr: string;
};

/**
 * Run quint, retrying THE FLAKE AND ONLY THE FLAKE.
 *
 * Three outcomes are told apart here, and the reason to separate them is that
 * they read identically from a distance — all three are "no verdict":
 *
 *   - THE BINARY IS NOT THERE. `spawnSync` reports an error and no status at
 *     all. Retrying it would produce the same nothing four more times and then
 *     blame the flake for a missing install, which is a message that sends a
 *     reader to the wrong place.
 *   - THE PROCESS WAS KILLED BY SIGSEGV WITH NO OUTPUT. That is ledger #12,
 *     load-sensitive and intermittent, and the run produced no verdict — so it
 *     is given again rather than recorded.
 *   - ANY OTHER SIGNAL. Something killed quint; this tool does not get to
 *     decide it was harmless.
 */
function runQuint(args: readonly string[]): Run {
  for (let attempt = 1; attempt <= segfaultAttempts; attempt += 1) {
    const result = spawnSync(QUINT, [...args], { encoding: "utf8" });
    if (result.error !== undefined) {
      throw new CorpusError(
        `${QUINT} could not be run: ${messageOf(result.error)}. Install with: npm ci`,
      );
    }
    const stdout = result.stdout || "";
    const stderr = result.stderr || "";
    const status = result.status;
    if (status !== null) {
      return { status, stdout, stderr };
    }
    if (result.signal !== "SIGSEGV" || stdout !== "" || stderr !== "") {
      throw new CorpusError(
        `quint was killed by ${String(result.signal)}: ${args.join(" ")}`,
      );
    }
    // Announced only while another attempt follows: the last one retries
    // nothing, and the line after it is the refusal.
    if (attempt < segfaultAttempts) {
      console.log(
        `  quint died with no verdict on attempt ${String(attempt)} of ${String(segfaultAttempts)}; retrying (ledger #12)`,
      );
    }
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
function commitForm(
  raw: unknown,
  where: string,
): { readonly text: string; readonly states: number } {
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
  return {
    text: `{\n${head.join(",\n")},\n  "states": [\n${body.join(",\n")}\n  ]\n}\n`,
    // THE COUNT THE MANIFEST WILL CARRY, taken from what was actually written
    // rather than from what the search reported: the trailing-settled
    // truncation above happens between the two, and a pin that counted the raw
    // trace would red every settled fixture on the first replay.
    states: states.length,
  };
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

/**
 * What each fixture's committed trace turned out to hold, gathered as the
 * fixtures are written and handed to the manifest at the end.
 *
 * ONE WRITE AT THE END RATHER THAN ONE PER FIXTURE, so a run that dies halfway
 * leaves the manifest as it was: a half-updated manifest is a document whose
 * counts describe two different corpora, and the gate would then report the
 * fixtures that were rewritten as the corrupt ones.
 */
const emittedStates = new Map<string, number>();

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
  const committed = commitForm(readJson(out), fixture.name);
  write(fixturePath(fixture, 1), committed.text);
  emittedStates.set(fixture.name, committed.states);
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
    const file = runTraceFile(written, fixture.run);
    if (file === undefined) {
      throw new CorpusError(
        `${fixture.name}: ${module} exported no trace for run ${fixture.run}; it wrote [${written.join(", ")}]`,
      );
    }
    const committed = commitForm(readJson(join(dir, file)), fixture.name);
    write(fixturePath(fixture, 2), committed.text);
    emittedStates.set(fixture.name, committed.states);
  }
}

// === The run ===============================================================

/**
 * Refuse to emit with an unpinned quint, before anything is written.
 *
 * `check-model.sh` states the argument this borrows: a different release can
 * change what typechecks, and here it can change what a trace CONTAINS — every
 * committed fixture would then be a document emitted by a tool no other
 * checkout has. The version is asked of the binary rather than of
 * `package.json`, because what matters is the one that will run.
 */
function requirePinnedQuint(): void {
  const run = runQuint(["--version"]);
  const version = run.stdout.trim();
  if (run.status !== 0 || version !== QUINT_VERSION) {
    throw new CorpusError(
      `quint ${version || "(no version)"}, expected ${QUINT_VERSION}; a corpus emitted by an unpinned tool cannot be regenerated`,
    );
  }
}

function main(): number {
  const scratch = mkdtempSync(join(tmpdir(), "chuggy-corpus-"));
  try {
    requirePinnedQuint();
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
    // THE MANIFEST LAST, and only once every fixture is on disk: the counts it
    // takes are what was written, so the document and the corpus move together
    // or neither does.
    writeManifestStateCounts(emittedStates);
    console.log(`  wrote ${manifestPath}`);
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
