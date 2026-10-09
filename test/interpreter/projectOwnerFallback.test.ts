import assert from "node:assert/strict";
import { test } from "node:test";

import type { Authority } from "../../src/interpreter/operationInbox.ts";
import { asPrincipal } from "../../src/interpreter/principal.ts";
import {
  memberAuthority,
  type ProjectAccess,
  type ProjectAccessKind,
} from "../../src/interpreter/projectAccess.ts";
import {
  asWorkerPoolOwnerFallback,
  projectOwnerFallbackAdministration,
  type ProjectOwnerFallbackStore,
  type WorkerPoolOwnerFallback,
} from "../../src/interpreter/projectOwnerFallback.ts";
import {
  asProjectId,
  asTenantId,
  type Partition,
} from "../../src/interpreter/projectStore.ts";
import { projectAccessSiteRefused } from "./projectAccessFixture.ts";

const partition: Partition = {
  tenant: asTenantId("tenant"),
  project: asProjectId("project"),
};
const caller = asPrincipal("member-one");

/** An authority granting `caller` the kinds a case names, and nothing else. */
function granting(kinds: readonly ProjectAccessKind[]): ProjectAccess {
  return {
    authorize: (principal, _partition, kind) =>
      Promise.resolve(
        kinds.includes(kind) ? memberAuthority(principal) : undefined,
      ),
    authorizeTenant: () => Promise.resolve(undefined),
    authorizeSite: projectAccessSiteRefused,
  };
}

/** One project's row in memory, recording each write and who made it. */
function stored(): {
  readonly store: ProjectOwnerFallbackStore;
  readonly writes: [WorkerPoolOwnerFallback | undefined, Authority][];
} {
  let current: WorkerPoolOwnerFallback | undefined;
  const writes: [WorkerPoolOwnerFallback | undefined, Authority][] = [];
  return {
    writes,
    store: {
      fallback: () => Promise.resolve(current),
      write: (_partition, fallback, authority) => {
        writes.push([fallback, authority]);
        if (fallback === current) return Promise.resolve("Unchanged");
        current = fallback;
        return Promise.resolve("Written");
      },
    },
  };
}

test("an administrator names the fallback, and absent is a write of its own", async () => {
  const { store, writes } = stored();
  const administration = projectOwnerFallbackAdministration(
    granting(["Read", "Administer"]),
    store,
  );
  assert.deepEqual(await administration.write(caller, partition, "Strict"), {
    result: "Written",
    view: { fallback: "Strict", administers: true },
  });
  assert.deepEqual(await administration.write(caller, partition, "Strict"), {
    result: "Unchanged",
    view: { fallback: "Strict", administers: true },
  });
  assert.deepEqual(await administration.write(caller, partition, undefined), {
    result: "Written",
    view: { fallback: undefined, administers: true },
  });
  assert.deepEqual(
    writes.map(([fallback, authority]) => [fallback, authority.subject]),
    [
      ["Strict", caller],
      ["Strict", caller],
      [undefined, caller],
    ],
  );
});

test("a member who does not administer the project reads the fallback and writes nothing", async () => {
  const { store, writes } = stored();
  const administration = projectOwnerFallbackAdministration(
    granting(["Read", "Execute"]),
    store,
  );
  assert.deepEqual(await administration.write(caller, partition, "Strict"), {
    result: "NotFound",
  });
  assert.deepEqual(writes, []);
  assert.deepEqual(await administration.read(caller, partition), {
    result: "Found",
    view: { fallback: undefined, administers: false },
  });
});

test("a caller who may not read the project is told it is not there", async () => {
  const { store } = stored();
  assert.deepEqual(
    await projectOwnerFallbackAdministration(granting([]), store).read(
      caller,
      partition,
    ),
    { result: "NotFound" },
  );
});

test("a fallback the model does not name is refused rather than read as one it does", () => {
  assert.equal(asWorkerPoolOwnerFallback("Preferred"), "Preferred");
  assert.throws(() => asWorkerPoolOwnerFallback("Lenient"), RangeError);
});
