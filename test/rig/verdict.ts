/**
 * The suite's verdict, read back from the run's own report.
 *
 * A DRILL THAT DID NOT RUN IS A COULD-NOT-RUN. Playwright exits zero on a run
 * whose drills all skipped, and its list reporter prints neither the reason nor
 * anything an operator would read as a warning — so a run that exercised none of
 * #325's criteria would report success and be believed. This reads the report
 * the run wrote and exits 2 for a skip, which is the verdict this tree gives
 * every other gate that could not reach one.
 *
 * IT ALSO CATCHES THE RIG THAT COULD NOT BE ASKED. `onRig` marks a failed
 * command with `rigCouldNotRunPrefix`, which is defined here and imported there,
 * so a wrong ssh destination or a denied role is a could-not-run as well rather
 * than an ordinary failure. The match is against the error the run recorded,
 * not against any source text.
 *
 * It is a program and a module: the recipe runs it over the report, and
 * `rig.ts` imports the prefix so the mark has one definition.
 */

import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

/** What an error carries when the cluster could not be asked, rather than answered. */
export const rigCouldNotRunPrefix = "the rig could not be asked";

/** One drill that did not reach a verdict, and what the report said about it. */
export interface UnreachedDrill {
  readonly title: string;
  readonly reason: string;
}

/** Both ways a run fails to establish anything, kept apart because they read differently. */
export interface RunVerdict {
  readonly skipped: readonly UnreachedDrill[];
  readonly unaskable: readonly UnreachedDrill[];
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function asArray(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : [];
}

function asText(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

/** The reason a skip states, or the fact that it stated none. */
function skipReason(test: Record<string, unknown>): string {
  for (const held of asArray(test["annotations"])) {
    const annotation = asRecord(held);
    if (annotation === undefined) continue;
    if (asText(annotation["type"]) !== "skip") continue;
    const said = asText(annotation["description"]);
    if (said !== undefined) return said;
  }
  return "no reason was recorded";
}

/** The first recorded error naming an unaskable rig, if this drill hit one. */
function unaskableReason(test: Record<string, unknown>): string | undefined {
  for (const held of asArray(test["results"])) {
    const message = asText(asRecord(asRecord(held)?.["error"])?.["message"]);
    if (message !== undefined && message.includes(rigCouldNotRunPrefix))
      return message.split("\n")[0] ?? message;
  }
  return undefined;
}

function readSpec(
  spec: Record<string, unknown>,
  into: { skipped: UnreachedDrill[]; unaskable: UnreachedDrill[] },
): void {
  const title = asText(spec["title"]) ?? "an unnamed drill";
  for (const held of asArray(spec["tests"])) {
    const test = asRecord(held);
    if (test === undefined) continue;
    const unaskable = unaskableReason(test);
    if (unaskable !== undefined)
      into.unaskable.push({ title, reason: unaskable });
    else if (asText(test["status"]) === "skipped")
      into.skipped.push({ title, reason: skipReason(test) });
  }
}

function readSuite(
  suite: Record<string, unknown>,
  into: { skipped: UnreachedDrill[]; unaskable: UnreachedDrill[] },
): void {
  for (const held of asArray(suite["specs"])) {
    const spec = asRecord(held);
    if (spec !== undefined) readSpec(spec, into);
  }
  for (const held of asArray(suite["suites"])) {
    const nested = asRecord(held);
    if (nested !== undefined) readSuite(nested, into);
  }
}

/** Every drill in the report that did not reach a verdict, and why. */
export function runVerdict(report: unknown): RunVerdict {
  const into = {
    skipped: [] as UnreachedDrill[],
    unaskable: [] as UnreachedDrill[],
  };
  const root = asRecord(report);
  if (root !== undefined) readSuite(root, into);
  return into;
}

function report(path: string): void {
  const verdict = runVerdict(JSON.parse(readFileSync(path, "utf8")));
  for (const drill of verdict.unaskable)
    process.stderr.write(
      `acceptance: LINTER ERROR — ${drill.title} could not ask the rig: ${drill.reason}\n`,
    );
  for (const drill of verdict.skipped)
    process.stderr.write(
      `acceptance: LINTER ERROR — ${drill.title} did not run: ${drill.reason}\n`,
    );
  if (verdict.unaskable.length + verdict.skipped.length === 0) return;
  process.stderr.write(
    "acceptance: a drill that did not run establishes nothing; two is not a pass.\n",
  );
  process.exitCode = 2;
}

function main(): void {
  const path = process.argv[2];
  if (path === undefined) {
    process.stderr.write("usage: verdict.ts <playwright json report>\n");
    process.exitCode = 2;
    return;
  }
  try {
    report(path);
  } catch (failure: unknown) {
    const said = failure instanceof Error ? failure.message : "unknown failure";
    process.stderr.write(
      `acceptance: LINTER ERROR — no report to read: ${said}\n`,
    );
    process.exitCode = 2;
  }
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href
)
  main();
