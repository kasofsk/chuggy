#!/usr/bin/env node

/**
 * Publishes the worker contract up to a maintainer's approval: packs it,
 * stages the tarball on npm for them to approve under their own second factor,
 * and tags the commit it was packed from as `worker-contract-v<release>`. npm
 * stages only a package it already holds, so a first version is published by
 * hand.
 *
 * IT REFUSES BEFORE IT PACKS. A working tree with changes is not the commit the
 * tag would name; a history that does not name this release as the wire this
 * tree holds is a release that was never moved; and a release already on the
 * registry or already tagged is one npm or git would refuse halfway through.
 * `--dry-run` does everything but the stage and the tag.
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

/** Everything a publish reads or changes outside this module, so a test can stand in for git and the registry. */
export interface WorkerContractPublishPorts {
  readonly clean: () => boolean;
  readonly commit: () => string;
  readonly tagged: (tag: string) => boolean;
  readonly published: (name: string, version: string) => boolean;
  readonly history: () => WorkerContractHistory;
  readonly wire: () => Promise<string>;
  readonly pack: (outDirectory: string) => PackedWorkerContract;
  readonly stage: (tarball: string) => void;
  readonly tag: (tag: string, commit: string) => void;
}

export type WorkerContractPublished =
  | { readonly published: "Refused"; readonly why: string }
  | {
      readonly published: "Packed" | "Staged";
      readonly packed: PackedWorkerContract;
      readonly commit: string;
      readonly tag: string;
    };

/** The tag a release is published under. */
export function workerContractTag(release: string): string {
  return `worker-contract-v${release}`;
}

/** Packs `release` into `outDirectory` unless a refusal holds, then stages and tags it unless `dryRun`. */
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
  const unheld = workerContractHistoryRefusal(
    ports.history(),
    release,
    await ports.wire(),
  );
  if (unheld !== undefined) return { published: "Refused", why: unheld };
  if (ports.tagged(tag))
    return { published: "Refused", why: `${tag} is already a tag` };
  if (ports.published(name, release))
    return {
      published: "Refused",
      why: `${name}@${release} is already on the registry`,
    };
  const commit = ports.commit();
  const packed = ports.pack(outDirectory);
  if (dryRun) return { published: "Packed", packed, commit, tag };
  ports.stage(packed.tarball);
  ports.tag(tag, commit);
  return { published: "Staged", packed, commit, tag };
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
 * Whether `npm view <name>@<version> version --json` said the registry holds
 * the version. A package or version it has never seen is an answer, and every
 * other failure is not.
 */
export function publishWorkerContractRegistered(viewed: {
  readonly status: number;
  readonly stdout: string;
  readonly stderr: string;
}): boolean {
  if (viewed.status === 0) return viewed.stdout.trim() !== "";
  if (/\bE404\b/u.test(`${viewed.stdout}${viewed.stderr}`)) return false;
  throw new Error("npm could not say whether the release is on the registry");
}

/** An npm that has `npm stage`, which the toolchain's npm may not. */
const publishWorkerContractStagingNpm = "npm@11.20.0";

/** Stages the tarball on this terminal, so its operator sees the stage npm names. */
function publishWorkerContractTarball(tarball: string): void {
  const run = spawnSync(
    "npx",
    ["--yes", publishWorkerContractStagingNpm, "stage", "publish", tarball],
    { stdio: "inherit" },
  );
  if (run.error !== undefined) throw run.error;
  if (run.status !== 0)
    throw new Error(
      `npm stage publish ${tarball} exited ${String(run.status)}`,
    );
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
      published: (name, version) =>
        publishWorkerContractRegistered(
          publishWorkerContractCommand(
            "npm",
            ["view", `${name}@${version}`, "version", "--json"],
            [0, 1],
          ),
        ),
      history: workerContractHistory,
      wire: workerContractWire,
      pack: packWorkerContract,
      stage: publishWorkerContractTarball,
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
        `${published.published === "Staged" ? "tagged" : "would tag"} ${published.tag} at ${published.commit}\n` +
        (published.published === "Staged"
          ? `approve it: npx ${publishWorkerContractStagingNpm} stage approve <id>\n`
          : ""),
    );
}
