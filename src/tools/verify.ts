/**
 * REPLAY THE COMMITTED CORPUS: the one walk both the gate and the emitter make,
 * so that what the emitter accepts and what the gate enforces cannot drift.
 *
 * IT NEVER REGENERATES. Everything here reads the manifest and the committed
 * fixture files; nothing runs quint. That is what insulates the verdict from
 * `--mbt`'s experimental status and from a quint upgrade — either would break
 * regeneration visibly, under the pin `check-model.sh` holds, and never the
 * gate.
 *
 * THE TWO OUTCOMES ARE KEPT APART ALL THE WAY OUT. A finding is a disagreement
 * about the machine: a step whose record came back different, a state whose
 * fleet moved elsewhere, an invariant false after a step, an obligation no
 * fixture covers, a file the manifest does not name. An error is the check
 * being unable to run at all: an absent corpus, a fixture that is not JSON, a
 * trace this tree cannot decode. They exit 1 and 2, and 2 is not a pass.
 */

import { readdirSync } from "node:fs";

import type { Config } from "../domain/domain.ts";
import {
  CoverageBuilder,
  coverageGaps,
  pinsMissed,
  type Coverage,
} from "../spine/coverage.ts";
import { decodeSteps } from "../spine/decode.ts";
import { DecodeError, decodeTrace } from "../spine/itf.ts";
import { replayTrace } from "../spine/replay.ts";
import {
  CorpusError,
  constsDisagree,
  fixturePath,
  loadManifest,
  mcSource,
  messageOf,
  readJson,
  readModuleConsts,
  tier1Dir,
  tier2Dir,
  witnessSource,
  type Manifest,
} from "./corpus.ts";

export type Verification = {
  readonly findings: readonly string[];
  readonly errors: readonly string[];
  readonly coverage: Coverage;
  readonly replayed: readonly string[];
};

/**
 * Walk the whole corpus. A could-not-run stops the walk — there is nothing to
 * say about a corpus that cannot be read — while findings accumulate, because a
 * reader fixing a mismatch wants every fixture's verdict, not the first.
 */
export function verifyCorpus(): Verification {
  const findings: string[] = [];
  const coverage = new CoverageBuilder();
  const replayed: string[] = [];
  let manifest: Manifest;
  try {
    manifest = loadManifest();
  } catch (error) {
    return errorOnly(error, coverage);
  }

  try {
    findings.push(...orphanFixtures(manifest));
    findings.push(...staleConsts(manifest));
    for (const fixture of manifest.tier1) {
      coverage.observeInstance(fixture.instance);
      findings.push(
        ...replayFixture(fixture, fixturePath(fixture, 1), coverage),
      );
      replayed.push(fixture.name);
    }
    for (const fixture of manifest.tier2) {
      findings.push(
        ...replayFixture(fixture, fixturePath(fixture, 2), coverage),
      );
      replayed.push(fixture.name);
    }
  } catch (error) {
    return { ...errorOnly(error, coverage), findings, replayed };
  }

  const taken = coverage.taken();
  findings.push(
    ...coverageGaps(taken).map(
      (gap) => `coverage: ${gap.obligation} ${gap.missing}`,
    ),
  );
  return { findings, errors: [], coverage: taken, replayed };
}

function errorOnly(error: unknown, coverage: CoverageBuilder): Verification {
  if (error instanceof CorpusError || error instanceof DecodeError) {
    return {
      findings: [],
      errors: [messageOf(error)],
      coverage: coverage.taken(),
      replayed: [],
    };
  }
  throw error;
}

/**
 * Replay one fixture at its own consts, then check the two claims it makes:
 * that it replays, and that it reaches what the manifest says it is in the
 * corpus for.
 *
 * ITS COVERAGE IS TAKEN ON ITS OWN FIRST and folded into the corpus's after,
 * which is the whole of what makes a pin checkable: against a corpus-wide
 * accumulator every pin would be satisfied as long as SOME fixture reached the
 * entry, which is exactly the claim a pin is not making.
 */
function replayFixture(
  fixture: {
    readonly name: string;
    readonly consts: Config;
    readonly pins: readonly string[];
  },
  path: string,
  corpus: CoverageBuilder,
): readonly string[] {
  const trace = decodeTrace(readJson(path), fixture.name);
  const plans = decodeSteps(trace, fixture.name);
  const own = new CoverageBuilder();
  const report = replayTrace(fixture.consts, trace, plans, own, fixture.name);
  const taken = own.taken();
  corpus.absorb(taken);
  return [
    ...report.findings.map(
      (finding) =>
        `${fixture.name}: state ${String(finding.state)}: ${finding.detail}`,
    ),
    ...pinsMissed(fixture.pins, taken).map(
      (pin) =>
        `${fixture.name}: the manifest pins ${pin} to this fixture, and it reaches no such step`,
    ),
  ];
}

/**
 * Every committed fixture file is named by the manifest, and every manifest
 * entry has a file. A file nothing names is a trace nothing replays — the
 * shape a dropped manifest entry leaves behind — and the missing direction is
 * raised as could-not-run by the read itself.
 */
function orphanFixtures(manifest: Manifest): readonly string[] {
  const named = new Set([
    ...manifest.tier1.map((f) => fixturePath(f, 1)),
    ...manifest.tier2.map((f) => fixturePath(f, 2)),
  ]);
  const findings: string[] = [];
  for (const [dir, tier] of [
    [tier1Dir, 1],
    [tier2Dir, 2],
  ] as const) {
    let entries;
    try {
      entries = readdirSync(dir);
    } catch (error) {
      throw new CorpusError(`${dir} cannot be listed: ${messageOf(error)}`);
    }
    for (const entry of entries) {
      const path = `${dir}/${entry}`;
      if (!named.has(path)) {
        findings.push(
          `corpus: ${path} is committed and the manifest names no fixture for it (tier ${String(tier)})`,
        );
      }
    }
  }
  return findings;
}

/**
 * The manifest's consts against the model's own const blocks. A trace speaks
 * about the machine it was emitted from; if the model has moved since, the
 * fixture is stale and its green verdict means nothing.
 */
function staleConsts(manifest: Manifest): readonly string[] {
  const findings: string[] = [];
  for (const fixture of manifest.tier1) {
    const module = `mc_chuggy_${fixture.instance}`;
    const difference = constsDisagree(
      fixture.consts,
      readModuleConsts(mcSource, module),
      `${fixture.name} (${module})`,
    );
    if (difference !== undefined) {
      findings.push(`corpus: ${difference}`);
    }
  }
  for (const fixture of manifest.tier2) {
    const difference = constsDisagree(
      fixture.consts,
      readModuleConsts(witnessSource, fixture.module),
      `${fixture.name} (${fixture.module})`,
    );
    if (difference !== undefined) {
      findings.push(`corpus: ${difference}`);
    }
  }
  return findings;
}
