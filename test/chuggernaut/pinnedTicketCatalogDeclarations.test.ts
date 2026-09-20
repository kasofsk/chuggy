import assert from "node:assert/strict";
import { test } from "node:test";
import { pinnedTicketCatalogs } from "../../src/adapters/catalog/pinnedTicketCatalog.ts";
import { ticketCatalogRoot } from "../../src/interpreter/ticketCatalog.ts";
import type {
  TicketCatalogEntry,
  TicketCatalogFragments,
} from "../../src/interpreter/ticketCatalog.ts";
import { asTenantId, asProjectId } from "../../src/interpreter/projectStore.ts";
import {
  asGitObjectId,
  asRepositoryId,
} from "../../src/interpreter/finalizer.ts";

const partition = {
  tenant: asTenantId("tenant"),
  project: asProjectId("project"),
};
const commit = asGitObjectId("b".repeat(40));
const repository = "github.com/acme/atlas";

const project =
  "version: 2\nname: atlas\nrepository: ignored\n" +
  "rework_limit: 5\ncloud_project: owner/platform\n" +
  "execution_profiles:\n" +
  "  small:\n    required_capabilities: [linux]\n" +
  "  large:\n    required_capabilities: [linux]\n";

/** The committed tree, listed newest-name-last so a sorted answer is not the input order. */
const committed = new Map([
  ["project.yaml", project],
  ["finalizers/pull-request.yaml", "kind: finalizer\n"],
  ["finalizers/git-merge.yaml", "kind: finalizer\n"],
  ["workloads/work.yaml", "kind: workload\n"],
]);

function fragmentsDouble(held: Map<string, string>): TicketCatalogFragments {
  return {
    paths: () => Promise.resolve([...held.keys()]),
    read: (_partition, reference) => Promise.resolve(held.get(reference)),
    write: () => Promise.resolve(),
    remove: () => Promise.resolve(false),
  };
}

function catalogs(runtime: Map<string, string> = new Map()) {
  const files = new Map([...committed, ...runtime]);
  return pinnedTicketCatalogs(
    {
      snapshot: () =>
        Promise.resolve({
          repository,
          entries: (): Promise<readonly TicketCatalogEntry[]> =>
            Promise.resolve(
              [...committed.keys()].map((path) => ({
                path,
                origin: "Git" as const,
              })),
            ),
          snapshot: {
            read: (path: string) => {
              const held = files.get(path.slice(ticketCatalogRoot.length));
              return held === undefined
                ? Promise.reject(new TypeError(`unavailable: ${path}`))
                : Promise.resolve(held);
            },
          },
        }),
      tip: () =>
        Promise.resolve({ repository: asRepositoryId(repository), commit }),
    },
    () => ({
      put: () => Promise.reject(new Error("unused")),
      read: () => Promise.reject(new Error("unused")),
    }),
    fragmentsDouble(runtime),
  );
}

test("declarations are the project document's own, with the rosters sorted", async () => {
  const declared = await catalogs().declarations({ partition, commit });
  assert.deepEqual(declared, {
    repository,
    reworkLimit: 5,
    cloudProject: "owner/platform",
    executionProfiles: ["large", "small"],
    finalizers: ["git-merge.yaml", "pull-request.yaml"],
  });
});

/**
 * A finalizer the project holds durably is one a ticket here may name exactly
 * as a committed one is, so a roster taken from the committed tree alone would
 * leave a reader unable to find the reference their ticket resolves against.
 */
test("a runtime finalizer fragment is declared beside the committed ones", async () => {
  const declared = await catalogs(
    new Map([["finalizers/nightly.yaml", "kind: finalizer\n"]]),
  ).declarations({ partition, commit });
  assert.deepEqual(declared?.finalizers, [
    "git-merge.yaml",
    "nightly.yaml",
    "pull-request.yaml",
  ]);
});
