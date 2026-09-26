#!/usr/bin/env node

/**
 * Packs the worker contract for publishing: the workspace's entries emitted as
 * JavaScript and declarations, under a manifest derived from the workspace's
 * own, printed as the tarball's sha256 and path.
 */

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { z } from "zod";

import { workerContractRelease } from "../src/contract/workerContract.ts";

const root = fileURLToPath(new URL("..", import.meta.url));
const workspace = join(root, "src/contract");
const tsc = fileURLToPath(import.meta.resolve("typescript/bin/tsc"));

const workspaceManifestSchema = z.strictObject({
  name: z.string().min(1),
  private: z.literal(true),
  license: z.string().min(1),
  type: z.literal("module"),
  exports: z.record(z.string(), z.string().regex(/^\.\/\w+\.ts$/)),
  peerDependencies: z.record(z.string(), z.string()),
});

export type WorkspaceManifest = z.infer<typeof workspaceManifestSchema>;

export interface PublishedManifest {
  readonly name: string;
  readonly version: string;
  readonly license: string;
  readonly type: "module";
  readonly exports: Readonly<
    Record<string, { readonly types: string; readonly default: string }>
  >;
  readonly peerDependencies: Readonly<Record<string, string>>;
}

export interface PackedWorkerContract {
  readonly tarball: string;
  readonly sha256: string;
}

/** A workspace manifest, refused unless every field it carries has a rule in `publishedManifest`. */
export function workspaceManifestOf(value: unknown): WorkspaceManifest {
  return workspaceManifestSchema.parse(value);
}

/** The workspace manifest as this tree holds it. */
export function workspaceManifest(): WorkspaceManifest {
  return workspaceManifestOf(
    JSON.parse(readFileSync(join(workspace, "package.json"), "utf8")),
  );
}

/** The manifest the tarball carries: each entry pointed at its emitted JavaScript and declarations, and versioned by the release. */
export function publishedManifest(
  manifest: WorkspaceManifest,
  release: string,
): PublishedManifest {
  return {
    name: manifest.name,
    version: release,
    license: manifest.license,
    type: manifest.type,
    exports: Object.fromEntries(
      Object.entries(manifest.exports).map(([entry, source]) => {
        const stem = source.slice(0, -".ts".length);
        return [entry, { types: `${stem}.d.ts`, default: `${stem}.js` }];
      }),
    ),
    peerDependencies: manifest.peerDependencies,
  };
}

/** Emits the workspace's entries and what they import, then packs them with the workspace's licence under the published manifest into `outDirectory`. */
export function packWorkerContract(outDirectory: string): PackedWorkerContract {
  const manifest = workspaceManifest();
  const work = mkdtempSync(join(tmpdir(), "worker-contract-"));
  try {
    const staged = join(work, "package");
    const project = join(work, "tsconfig.json");
    writeFileSync(
      project,
      JSON.stringify({
        extends: join(root, "tsconfig.contract-pack.json"),
        compilerOptions: { outDir: staged },
        files: Object.values(manifest.exports).map((source) =>
          join(workspace, source),
        ),
      }),
    );
    packWorkerContractCommand(process.execPath, [tsc, "-p", project]);
    copyFileSync(join(workspace, "LICENSE"), join(staged, "LICENSE"));
    writeFileSync(
      join(staged, "package.json"),
      `${JSON.stringify(publishedManifest(manifest, workerContractRelease), null, 2)}\n`,
    );
    mkdirSync(outDirectory, { recursive: true });
    const packed = z
      .tuple([z.object({ filename: z.string().min(1) })])
      .parse(
        JSON.parse(
          packWorkerContractCommand("npm", [
            "pack",
            staged,
            "--pack-destination",
            outDirectory,
            "--ignore-scripts",
            "--json",
          ]),
        ),
      );
    const tarball = join(outDirectory, packed[0].filename);
    const sha256 = createHash("sha256")
      .update(readFileSync(tarball))
      .digest("hex");
    return { tarball, sha256 };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

function packWorkerContractCommand(
  command: string,
  args: readonly string[],
): string {
  const run = spawnSync(command, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  });
  if (run.error !== undefined) throw run.error;
  if (run.status !== 0)
    throw new Error(
      `${command} ${args.join(" ")} exited ${String(run.status)}\n${run.stdout}`,
    );
  return run.stdout;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({ options: { out: { type: "string" } } });
  if (values.out === undefined)
    throw new Error(
      "usage: node scripts/pack-worker-contract.ts --out <directory>",
    );
  const { tarball, sha256 } = packWorkerContract(resolve(values.out));
  process.stdout.write(`${sha256}  ${tarball}\n`);
}
