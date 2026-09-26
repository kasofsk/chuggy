#!/usr/bin/env node

/**
 * Publishes the worker contract: packs it and releases the tarball on GitHub
 * under the tag `worker-contract-v<release>`, made at the commit it was packed
 * from. A consumer installs the release's asset by its URL, and its lockfile
 * pins the tarball's integrity.
 *
 * IT REFUSES BEFORE IT PACKS. A working tree with changes is not the commit the
 * tag would name; a history that does not name this release as the wire this
 * tree holds is a release that was never moved; and a release already made or
 * already tagged is one GitHub or git would refuse halfway through.
 *
 * AND IT REFUSES BEFORE IT RELEASES a pack whose files are not the ones the
 * history records for this release, naming the pack's: that record is what an
 * installed copy of the asset is held to once a later release is served.
 * `--dry-run` does everything but the release and the tag.
 */

import { spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { workerContractRelease } from "../src/contract/workerContract.ts";
import {
  packWorkerContract,
  workspaceManifest,
  type PackedWorkerContract,
} from "./pack-worker-contract.ts";
import {
  workerContractHistory,
  workerContractHistoryRefusal,
  workerContractWire,
  type WorkerContractHistory,
} from "./worker-contract-wire.ts";

/** Everything a publish reads or changes outside this module, so a test can stand in for git and GitHub. */
export interface WorkerContractPublishPorts {
  readonly clean: () => boolean;
  readonly commit: () => string;
  readonly tagged: (tag: string) => boolean;
  readonly released: (tag: string) => boolean;
  readonly history: () => WorkerContractHistory;
  readonly wire: () => Promise<string>;
  readonly pack: (outDirectory: string) => PackedWorkerContract;
  readonly release: (
    tag: string,
    commit: string,
    tarball: string,
    title: string,
    notes: string,
  ) => void;
  readonly tag: (tag: string, commit: string) => void;
}

export type WorkerContractPublished =
  | { readonly published: "Refused"; readonly why: string }
  | {
      readonly published: "Packed" | "Released";
      readonly packed: PackedWorkerContract;
      readonly commit: string;
      readonly tag: string;
    };

/** The tag a release is published under. */
export function workerContractTag(release: string): string {
  return `worker-contract-v${release}`;
}

/** Packs `release` into `outDirectory` unless a refusal holds, then releases and tags it unless `dryRun`. */
export async function publishWorkerContract(
  ports: WorkerContractPublishPorts,
  name: string,
  release: string,
  outDirectory: string,
  dryRun: boolean,
): Promise<WorkerContractPublished> {
  const tag = workerContractTag(release);
  if (!ports.clean())
    return {
      published: "Refused",
      why: "the working tree has changes the tag would not name",
    };
  const history = ports.history();
  const unheld = workerContractHistoryRefusal(
    history,
    release,
    await ports.wire(),
  );
  if (unheld !== undefined) return { published: "Refused", why: unheld };
  if (ports.tagged(tag))
    return { published: "Refused", why: `${tag} is already a tag` };
  if (ports.released(tag))
    return { published: "Refused", why: `${tag} is already released` };
  const commit = ports.commit();
  const packed = ports.pack(outDirectory);
  const recorded = history.at(-1)?.files;
  if (packed.files !== recorded)
    return {
      published: "Refused",
      why: `the history records ${String(recorded)} as ${release}'s files, and the pack's are ${packed.files}: record the pack's`,
    };
  if (dryRun) return { published: "Packed", packed, commit, tag };
  ports.release(
    tag,
    commit,
    packed.tarball,
    `${name} ${release}`,
    `Packed at ${commit} (sha256 ${packed.sha256}).`,
  );
  ports.tag(tag, commit);
  return { published: "Released", packed, commit, tag };
}

/** One command's output, raised where it exits other than `allowed` says. */
function publishWorkerContractCommand(
  command: string,
  args: readonly string[],
  allowed: readonly number[] = [0],
): {
  readonly status: number;
  readonly stdout: string;
  readonly stderr: string;
} {
  const run = spawnSync(command, args, { encoding: "utf8" });
  if (run.error !== undefined) throw run.error;
  const status = run.status ?? -1;
  if (!allowed.includes(status))
    throw new Error(
      `${command} ${args.join(" ")} exited ${String(status)}\n${run.stderr}`,
    );
  return { status, stdout: run.stdout, stderr: run.stderr };
}

/**
 * Whether `gh release view <tag>` said the release exists. A release GitHub
 * has not found is an answer, and every other failure is not.
 */
export function publishWorkerContractReleased(viewed: {
  readonly status: number;
  readonly stdout: string;
  readonly stderr: string;
}): boolean {
  if (viewed.status === 0) return true;
  if (/^release not found$/mu.test(viewed.stderr)) return false;
  throw new Error("gh could not say whether the release exists");
}

/** Releases the tarball, which makes the tag at `commit` on the remote. */
function publishWorkerContractRelease(
  tag: string,
  commit: string,
  tarball: string,
  title: string,
  notes: string,
): void {
  publishWorkerContractCommand("gh", [
    "release",
    "create",
    tag,
    tarball,
    "--target",
    commit,
    "--title",
    title,
    "--notes",
    notes,
  ]);
}

const publishWorkerContractGit: Pick<
  WorkerContractPublishPorts,
  "clean" | "commit" | "tagged" | "tag"
> = {
  clean: () =>
    publishWorkerContractCommand("git", ["status", "--porcelain"]).stdout ===
    "",
  commit: () =>
    publishWorkerContractCommand("git", ["rev-parse", "HEAD"]).stdout.trim(),
  tagged: (tag) =>
    publishWorkerContractCommand(
      "git",
      ["rev-parse", "--quiet", "--verify", `refs/tags/${tag}`],
      [0, 1],
    ).status === 0,
  tag: (tag, commit) => {
    publishWorkerContractCommand("git", ["tag", tag, commit]);
  },
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({
    options: { "dry-run": { type: "boolean" }, out: { type: "string" } },
  });
  const published = await publishWorkerContract(
    {
      ...publishWorkerContractGit,
      released: (tag) =>
        publishWorkerContractReleased(
          publishWorkerContractCommand("gh", ["release", "view", tag], [0, 1]),
        ),
      history: workerContractHistory,
      wire: workerContractWire,
      pack: packWorkerContract,
      release: publishWorkerContractRelease,
    },
    workspaceManifest().name,
    workerContractRelease,
    values.out === undefined
      ? mkdtempSync(join(tmpdir(), "worker-contract-publish-"))
      : resolve(values.out),
    values["dry-run"] === true,
  );
  if (published.published === "Refused") {
    process.stderr.write(`publish-worker-contract: ${published.why}\n`);
    process.exitCode = 1;
  } else
    process.stdout.write(
      `${published.published} ${published.packed.sha256}  ${published.packed.tarball}\n` +
        `${published.published === "Released" ? "released and tagged" : "would release and tag"} ${published.tag} at ${published.commit}\n`,
    );
}
