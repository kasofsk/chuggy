import assert from "node:assert/strict";
import { test } from "node:test";
import { mergedTicketCatalogSnapshot } from "../../src/adapters/catalog/mergedTicketCatalog.ts";
import { ticketCatalogRoot } from "../../src/interpreter/ticketCatalog.ts";
import type {
  TicketCatalogEntry,
  TicketCatalogFragments,
} from "../../src/interpreter/ticketCatalog.ts";
import { asTenantId, asProjectId } from "../../src/interpreter/projectStore.ts";

const partition = {
  tenant: asTenantId("tenant"),
  project: asProjectId("project"),
};

function fragmentsDouble(
  held: Map<string, string>,
  reads: string[],
): TicketCatalogFragments {
  return {
    paths: () => Promise.resolve([...held.keys()]),
    read: (_partition, reference) => {
      reads.push(reference);
      return Promise.resolve(held.get(reference));
    },
    write: () => Promise.resolve(),
    remove: () => Promise.resolve(false),
  };
}

function pinnedDouble(
  committed: Map<string, string>,
  listings: { count: number },
) {
  return {
    repository: "github.com/acme/atlas",
    entries: (): Promise<readonly TicketCatalogEntry[]> => {
      listings.count += 1;
      return Promise.resolve(
        [...committed.keys()].map((path) => ({
          path,
          origin: "Git" as const,
        })),
      );
    },
    snapshot: {
      read: (path: string) => {
        const held = committed.get(path.slice(ticketCatalogRoot.length));
        return held === undefined
          ? Promise.reject(
              new TypeError(`catalog file is unavailable: ${path}`),
            )
          : Promise.resolve(held);
      },
    },
  };
}

function merged(
  committed: Map<string, string>,
  held: Map<string, string>,
  listings = { count: 0 },
  reads: string[] = [],
) {
  return {
    view: mergedTicketCatalogSnapshot(
      pinnedDouble(committed, listings),
      fragmentsDouble(held, reads),
      partition,
    ),
    listings,
    reads,
  };
}

test("the merged listing names each side once and says which answered", async () => {
  const { view } = merged(
    new Map([["workloads/work.yaml", "prompt: committed\n"]]),
    new Map([["evaluators/ci.yaml", "prompt: runtime\n"]]),
  );
  assert.deepEqual(await view.entries(), [
    { path: "workloads/work.yaml", origin: "Git" },
    { path: "evaluators/ci.yaml", origin: "Runtime" },
  ]);
});

test("a runtime fragment resolves where the repository holds nothing", async () => {
  const { view } = merged(
    new Map(),
    new Map([["evaluators/ci.yaml", "prompt: runtime\n"]]),
  );
  assert.equal(
    await view.snapshot.read(`${ticketCatalogRoot}evaluators/ci.yaml`),
    "prompt: runtime\n",
  );
});

test("a reference the repository holds is the repository's, and the row goes inert", async () => {
  const shadowed = new Map([["workloads/work.yaml", "prompt: committed\n"]]);
  const { view, reads } = merged(
    shadowed,
    new Map([["workloads/work.yaml", "prompt: runtime\n"]]),
  );
  assert.equal(
    await view.snapshot.read(`${ticketCatalogRoot}workloads/work.yaml`),
    "prompt: committed\n",
  );
  assert.deepEqual(await view.entries(), [
    { path: "workloads/work.yaml", origin: "Git" },
  ]);
  assert.deepEqual(reads, []);
});

test("a reference neither side holds reports the repository's own absence", async () => {
  const { view } = merged(new Map(), new Map());
  await assert.rejects(
    () => view.snapshot.read(`${ticketCatalogRoot}workloads/work.yaml`),
    /catalog file is unavailable/u,
  );
});

test("the repository listing is read once however many references are dereferenced", async () => {
  const { view, listings } = merged(
    new Map([
      ["one.yaml", "prompt: one\n"],
      ["two.yaml", "prompt: two\n"],
    ]),
    new Map([["three.yaml", "prompt: three\n"]]),
  );
  await view.snapshot.read(`${ticketCatalogRoot}one.yaml`);
  await view.snapshot.read(`${ticketCatalogRoot}two.yaml`);
  await view.snapshot.read(`${ticketCatalogRoot}three.yaml`);
  await view.entries();
  assert.equal(listings.count, 1);
});
