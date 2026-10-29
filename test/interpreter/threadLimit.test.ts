import assert from "node:assert/strict";
import { test } from "node:test";

import { threadsOpenDefault, threadsOpenMax } from "../../src/contract/http.ts";
import type { Authority } from "../../src/interpreter/operationInbox.ts";
import {
  asPrincipal,
  oidcPrincipal,
  type Principal,
} from "../../src/interpreter/principal.ts";
import {
  memberAuthority,
  type ProjectAccess,
  type ProjectAccessKind,
} from "../../src/interpreter/projectAccess.ts";
import {
  asProjectId,
  asTenantId,
  type Partition,
} from "../../src/interpreter/projectStore.ts";
import {
  threadLimitAdministration,
  type ThreadLimitStore,
} from "../../src/interpreter/threadLimit.ts";
import { projectAccessSiteRefused } from "./projectAccessFixture.ts";

const partition: Partition = {
  tenant: asTenantId("tenant"),
  project: asProjectId("project"),
};
const caller = asPrincipal("member-one");
const issuer = "https://auth.example/";

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

/** Each member's row in memory, answering the default where none was written. */
function stored(): {
  readonly store: ThreadLimitStore;
  readonly writes: [Principal, number, Authority][];
} {
  const rows = new Map<Principal, number>();
  const writes: [Principal, number, Authority][] = [];
  return {
    writes,
    store: {
      limit: (_partition, member) =>
        Promise.resolve(rows.get(member) ?? threadsOpenDefault),
      write: (_partition, member, threadsMax, authority) => {
        writes.push([member, threadsMax, authority]);
        if (rows.get(member) === threadsMax)
          return Promise.resolve("Unchanged");
        rows.set(member, threadsMax);
        return Promise.resolve("Written");
      },
    },
  };
}

test("a member nobody set a limit for reads as the default, and a reader is told they cannot change it", async () => {
  const { store } = stored();
  const limits = threadLimitAdministration(granting(["Read"]), store, issuer);

  assert.deepEqual(await limits.read(caller, partition, "dana"), {
    result: "Found",
    view: { threadsMax: threadsOpenDefault, administers: false },
  });
});

test("an administrator sets the limit of the member the subject names, as themselves", async () => {
  const { store, writes } = stored();
  const limits = threadLimitAdministration(
    granting(["Read", "Administer"]),
    store,
    issuer,
  );

  assert.deepEqual(await limits.write(caller, partition, "dana", 3), {
    result: "Written",
    view: { threadsMax: 3, administers: true },
  });
  assert.deepEqual(await limits.write(caller, partition, "dana", 3), {
    result: "Unchanged",
    view: { threadsMax: 3, administers: true },
  });
  assert.deepEqual(
    writes.map(([member]) => member),
    [oidcPrincipal(issuer, "dana"), oidcPrincipal(issuer, "dana")],
  );
  assert.deepEqual(writes[0]?.[2], memberAuthority(caller));
  assert.deepEqual(await limits.read(caller, partition, "dana"), {
    result: "Found",
    view: { threadsMax: 3, administers: true },
  });
});

test("a member who does not administer the project writes nothing, and one who cannot read it reads nothing", async () => {
  const { store, writes } = stored();
  const reader = threadLimitAdministration(
    granting(["Read", "Mutate"]),
    store,
    issuer,
  );
  const stranger = threadLimitAdministration(granting([]), store, issuer);

  assert.deepEqual(await reader.write(caller, partition, "dana", 3), {
    result: "NotFound",
  });
  assert.deepEqual(await stranger.read(caller, partition, "dana"), {
    result: "NotFound",
  });
  assert.deepEqual(writes, []);
});

test("a limit outside its bound is refused before anything is written", async () => {
  const { store, writes } = stored();
  const limits = threadLimitAdministration(
    granting(["Read", "Administer"]),
    store,
    issuer,
  );

  for (const threadsMax of [0, threadsOpenMax + 1, 1.5])
    await assert.rejects(
      limits.write(caller, partition, "dana", threadsMax),
      RangeError,
    );
  assert.deepEqual(writes, []);
});
