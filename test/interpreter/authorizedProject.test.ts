import assert from "node:assert/strict";
import { test } from "node:test";
import {
  authorizedProjectRead,
  authorizedProjectValue,
  authorizedProjectMutation,
} from "../../src/interpreter/authorizedProject.ts";
import { asPrincipal } from "../../src/interpreter/principal.ts";
import {
  memberAuthority,
  ProjectAccessUnavailable,
  type ProjectAccess,
} from "../../src/interpreter/projectAccess.ts";
import { asProjectId, asTenantId } from "../../src/interpreter/projectStore.ts";

const principal = asPrincipal("caller");
const partition = {
  tenant: asTenantId("tenant"),
  project: asProjectId("project"),
};
const authority = memberAuthority(principal);

function authorizedProjectFixture() {
  const calls: unknown[] = [];
  let allowed = true;
  let outage = false;
  const access: ProjectAccess = {
    authorize: (who, where, kind) => {
      calls.push({ who, where, kind });
      if (outage) throw new ProjectAccessUnavailable("unreachable");
      return Promise.resolve(allowed ? authority : undefined);
    },
    authorizeTenant: () => Promise.resolve(undefined),
  };
  return {
    access,
    calls,
    deny: () => {
      allowed = false;
    },
    fail: () => {
      outage = true;
    },
  };
}

test("read wrappers reauthorize every call and defer all work until admitted", async () => {
  for (const wrap of [authorizedProjectRead, authorizedProjectValue]) {
    const fixture = authorizedProjectFixture();
    let reads = 0;
    const read = wrap(fixture.access, (where, key: string) => {
      assert.equal(where, partition);
      assert.equal(key, "resource");
      assert.equal(fixture.calls.length, 1);
      reads += 1;
      return Promise.resolve("found");
    });
    const found = await read(principal, partition, "resource");
    assert.deepEqual(
      found,
      wrap === authorizedProjectRead
        ? "found"
        : { result: "Authorized", value: "found" },
    );
    fixture.deny();
    const denied = await read(principal, partition, "resource");
    assert.deepEqual(
      denied,
      wrap === authorizedProjectRead ? undefined : { result: "NotFound" },
    );
    assert.equal(reads, 1);
    assert.deepEqual(
      fixture.calls,
      Array.from({ length: 2 }, () => ({
        who: principal,
        where: partition,
        kind: "Read",
      })),
    );
    fixture.fail();
    await assert.rejects(
      () => read(principal, partition, "resource"),
      ProjectAccessUnavailable,
    );
    assert.equal(reads, 1);
  }
});

test("mutations receive the granted authority and never run on denial or outage", async () => {
  const fixture = authorizedProjectFixture();
  let writes = 0;
  const write = () =>
    authorizedProjectMutation(
      fixture.access,
      principal,
      partition,
      (granted) => {
        assert.equal(granted, authority);
        writes += 1;
        return Promise.resolve(writes);
      },
    );
  assert.deepEqual(await write(), { result: "Authorized", value: 1 });
  assert.deepEqual(fixture.calls, [
    { who: principal, where: partition, kind: "Mutate" },
  ]);
  fixture.deny();
  assert.deepEqual(await write(), { result: "NotFound" });
  fixture.fail();
  await assert.rejects(write, ProjectAccessUnavailable);
  assert.equal(writes, 1);
});

test("an authorized empty read stays authorized and work failures propagate", async () => {
  const fixture = authorizedProjectFixture();
  const empty = authorizedProjectValue(fixture.access, () =>
    Promise.resolve(undefined),
  );
  assert.deepEqual(await empty(principal, partition), {
    result: "Authorized",
    value: undefined,
  });
  const fault = new Error("store failed");
  const read = authorizedProjectRead(fixture.access, () => {
    throw fault;
  });
  await assert.rejects(
    () => read(principal, partition),
    (failure) => failure === fault,
  );
  await assert.rejects(
    () =>
      authorizedProjectMutation(fixture.access, principal, partition, () => {
        throw fault;
      }),
    (failure) => failure === fault,
  );
});
