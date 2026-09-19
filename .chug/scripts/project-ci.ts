#!/usr/bin/env node
/**
 * The project's own gate sequencer, reported as a ci-result-v2 document on
 * stdout. `.chug/tasks/ci.sh` already decides what passed: it exits 0 clean, 1
 * on a finding and 2 when a gate could not run, and it prints one `--- <label>`
 * section per gate with a `ci: FAILED — <label>` or `ci: LINTER ERROR ...`
 * line beneath the section that earned it. This reads that transcript back and
 * names the failing sections, so a verdict here never disagrees with the gate
 * run that produced it.
 */
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { stripVTControlCharacters } from "node:util";

export const findingLimit = 32;
export const descriptionLimit = 4000;
export const summaryLimit = 12000;
export const sectionHeadLines = 40;

export interface Finding {
  readonly id: string;
  readonly description: string;
}

export interface Result {
  verdict: "passed" | "failed";
  summary: string;
  findings?: readonly Finding[];
}

export type Run = (
  command: readonly string[],
  root: string,
) => readonly [string, number];

/** A gate run is one command whose whole transcript is kept. */
function runCommand(
  command: readonly string[],
  root: string,
): readonly [string, number] {
  const [head, ...rest] = command;
  if (head === undefined) return ["no command was given", 2];
  const finished = spawnSync(head, rest, {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, CHUG_CI_FULL: "1", LC_ALL: "C" },
    maxBuffer: 64 * 1024 * 1024,
  });
  const output = stripVTControlCharacters(
    `${finished.stdout ?? ""}${finished.stderr ?? ""}`,
  );
  if (finished.error !== undefined)
    return [`${output}\n${finished.error.message}`, 2];
  return [output, finished.status ?? 2];
}

/** Sections are delimited by the `--- <label>` lines the sequencer prints. */
export function sections(
  output: string,
): ReadonlyMap<string, readonly string[]> {
  const found = new Map<string, string[]>();
  let current: string[] | undefined;
  for (const line of output.split("\n")) {
    const opened = /^--- (?<label>.+)$/u.exec(line);
    if (opened?.groups !== undefined) {
      current = [];
      found.set(opened.groups["label"] ?? line, current);
      continue;
    }
    current?.push(line);
  }
  return found;
}

/**
 * A gate is named by the sequencer's own verdict line. Both spellings are read
 * because a gate that could not run is not a pass either.
 */
export function failedLabels(output: string): readonly string[] {
  const labels: string[] = [];
  for (const line of output.split("\n")) {
    const named =
      /^ci: FAILED — (?<label>.+?)(?: \(rc=\d+\); rerun with: .*)?$/u.exec(
        line,
      ) ??
      /^ci: LINTER ERROR(?: \(\d+\))? — (?<label>.+?)(?: could not run.*)?$/u.exec(
        line,
      );
    const label = named?.groups?.["label"];
    if (label !== undefined && !labels.includes(label)) labels.push(label);
  }
  return labels;
}

function head(lines: readonly string[]): string {
  return lines
    .slice(0, sectionHeadLines)
    .join("\n")
    .trim()
    .slice(0, descriptionLimit);
}

/**
 * A label the sequencer failed may not head its own section, because a suite
 * failure is reported inside the `shell suites` section.
 */
function describe(
  label: string,
  parts: ReadonlyMap<string, readonly string[]>,
  output: string,
): string {
  const own = parts.get(label);
  if (own !== undefined && own.join("").trim() !== "") return head(own);
  const mentions = output.split("\n").filter((line) => line.includes(label));
  return head(mentions.length > 0 ? mentions : [label]);
}

export function runCi(run: Run = runCommand, root = process.cwd()): Result {
  const transcripts: string[] = [];
  const [installed, installCode] = run(
    ["npm", "ci", "--include=dev"],
    root,
  );
  transcripts.push(`--- dependencies\n${installed}`);
  if (installCode !== 0)
    return {
      verdict: "failed",
      summary: transcripts.join("\n\n").slice(-summaryLimit),
      findings: [
        {
          id: "gate:dependencies",
          description: head(installed.split("\n").slice(-sectionHeadLines)),
        },
      ],
    };
  const [gated, gateCode] = run(["sh", "./.chug/tasks/ci.sh"], root);
  transcripts.push(gated);
  const summary = transcripts.join("\n\n").slice(-summaryLimit);
  if (gateCode === 0) return { verdict: "passed", summary };
  const parts = sections(gated);
  const labels = failedLabels(gated);
  const findings =
    labels.length > 0
      ? labels.map((label) => ({
          id: `gate:${label}`,
          description: describe(label, parts, gated),
        }))
      : [
          {
            id: "gate:ci",
            description: `the gate run exited ${gateCode} without naming a gate\n\n${head(gated.split("\n").slice(-sectionHeadLines))}`,
          },
        ];
  return {
    verdict: "failed",
    summary,
    findings: findings.slice(0, findingLimit),
  };
}

export function main(): number {
  console.log(JSON.stringify(runCi()));
  return 0;
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
  process.exitCode = main();
