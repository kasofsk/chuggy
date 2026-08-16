/**
 * The gate's driver: replay the committed corpus and report, three-valued.
 *
 * `.chug/tasks/check-conformance.sh` is what runs this, and the shell there is
 * the part that belongs in a gate — locating the checkout, refusing a missing
 * toolchain, translating an exit code. Everything this file does needs the
 * TypeScript program, so it lives where the typechecker and the type-aware
 * lint reach it.
 *
 * IT PRINTS THE ROSTERS IT COVERED, not counts of them. A number is a claim a
 * reader has to trust; the roster is the evidence, and it is what a reviewer
 * checks the corpus against.
 */

import { shippedDeciders } from "../spine/cmd.ts";
import { exemptionArms, mcInstances } from "../spine/coverage.ts";
import { reachableStepLabels } from "../spine/decode.ts";
import { nondetBinders } from "../spine/itf.ts";
import { verifyCorpus } from "./verify.ts";

const boundBinderNames: readonly string[] = nondetBinders.map(
  ([bound]) => bound,
);

function main(): number {
  const verification = verifyCorpus();
  for (const name of verification.replayed) {
    console.log(`  replayed ${name}`);
  }
  report("decider", shippedDeciders, verification.coverage.deciders);
  report("step label", reachableStepLabels, verification.coverage.labels);
  report("exemption arm", exemptionArms, verification.coverage.arms);
  report("mc instance", mcInstances, verification.coverage.instances);
  report("nondet binder", boundBinderNames, verification.coverage.binders);

  for (const finding of verification.findings) {
    console.log(`ERROR ${finding}`);
  }
  // THE VERDICT LINE, which the gate requires before believing the exit code:
  // a tool that printed nothing measured nothing, whatever it exited with.
  if (verification.errors.length > 0) {
    for (const error of verification.errors) {
      console.log(`check-conformance: LINTER ERROR — ${error}`);
    }
    return 2;
  }
  if (verification.findings.length > 0) {
    console.log(
      `check-conformance: ${String(verification.findings.length)} finding(s) across ${String(verification.replayed.length)} fixture(s)`,
    );
    return 1;
  }
  console.log(
    `check-conformance: clean (${String(verification.replayed.length)} fixture(s))`,
  );
  return 0;
}

/** One obligation's roster, marked where the corpus reached it. */
function report(
  obligation: string,
  roster: readonly string[],
  reached: ReadonlySet<string>,
): void {
  // JOINED ON A SEPARATOR NO ENTRY CONTAINS. Two exemption arms hold a comma
  // and a space in their own names, so a comma-joined line cannot be read back
  // into the roster it prints.
  const marked = roster.map(
    (entry) => `${reached.has(entry) ? "+" : "-"} ${entry}`,
  );
  console.log(`  ${obligation}: ${marked.join(" · ")}`);
}

process.exitCode = main();
