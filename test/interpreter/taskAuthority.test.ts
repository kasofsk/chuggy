/**
 * The authority lattice, proved over its whole small space rather than sampled.
 *
 * WHAT THIS TIER CAN DECIDE is every claim the module makes, because the space
 * is finite: the grants below are every combination of two tool names, one
 * credential, both flags and each reach, and the requests are the same space
 * with every field free to be absent. So "no request widens" and "order does
 * not matter" are checked exhaustively rather than argued.
 *
 * THE SPACE INCLUDES A REACH THE ORDER DOES NOT NAME, because the untyped
 * boundary this module exists to survive is a policy adapter whose answer drifts
 * from the union. A value outside the vocabulary is what the exhaustive cases
 * cannot generate from the vocabulary itself, so it is written in below and cast
 * exactly where a drifted adapter would have produced one.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  filesystemAccessOrder,
  grantTaskAuthority,
  narrowTaskAuthority,
  resolveTaskAuthority,
  taskAuthorityGrant,
  taskAuthorityIncludes,
  type AuthorityRequest,
  type FilesystemAccess,
  type PolicyAuthorityGrant,
  type TaskAuthority,
} from "../../src/interpreter/taskAuthority.ts";

/** Every subset of these names, which is what makes the grant space finite and complete. */
function subsets(names: readonly string[]): readonly (readonly string[])[] {
  return names.reduce<readonly (readonly string[])[]>(
    (found, name) => [...found, ...found.map((each) => [...each, name])],
    [[]],
  );
}

/** Every grant over the small vocabulary above. */
function everyGrant(): readonly PolicyAuthorityGrant[] {
  const found: PolicyAuthorityGrant[] = [];
  for (const tools of subsets(["editor", "shell"])) {
    for (const credentials of subsets(["ci"])) {
      for (const network of [false, true]) {
        for (const filesystem of filesystemAccessOrder) {
          for (const mayCompleteTask of [false, true]) {
            found.push({
              tools,
              credentials,
              network,
              filesystem,
              mayCompleteTask,
            });
          }
        }
      }
    }
  }
  return found;
}

/** The reach a drifted policy adapter answers with, which no order here names. */
const driftedReach = "RootReadWrite" as FilesystemAccess;

/** Every request, including ones naming what no grant carries and ones with no opinion. */
function everyRequest(): readonly AuthorityRequest[] {
  const found: AuthorityRequest[] = [];
  const flags: readonly (boolean | undefined)[] = [undefined, false, true];
  const reaches: readonly (FilesystemAccess | undefined)[] = [
    undefined,
    ...filesystemAccessOrder,
    driftedReach,
  ];
  for (const tools of [undefined, ...subsets(["editor", "shell", "git"])]) {
    for (const credentials of [undefined, ...subsets(["ci"])]) {
      for (const network of flags) {
        for (const filesystem of reaches) {
          for (const mayCompleteTask of flags) {
            found.push({
              ...(tools === undefined ? {} : { tools }),
              ...(credentials === undefined ? {} : { credentials }),
              ...(network === undefined ? {} : { network }),
              ...(filesystem === undefined ? {} : { filesystem }),
              ...(mayCompleteTask === undefined ? {} : { mayCompleteTask }),
            });
          }
        }
      }
    }
  }
  return found;
}

/** Every ordering of these requests, which is what order-independence is checked over. */
function permutations(
  requests: readonly AuthorityRequest[],
): readonly (readonly AuthorityRequest[])[] {
  if (requests.length <= 1) return [requests];
  return requests.flatMap((request, index) =>
    permutations([
      ...requests.slice(0, index),
      ...requests.slice(index + 1),
    ]).map((rest) => [request, ...rest]),
  );
}

const grants = everyGrant();
const requests = everyRequest();

test("no request widens the authority it is met with", () => {
  for (const grant of grants) {
    const held = grantTaskAuthority(grant);
    for (const request of requests) {
      const after = taskAuthorityGrant(narrowTaskAuthority(held, request));
      if (!taskAuthorityIncludes(grant, after)) {
        assert.fail(
          `${JSON.stringify(request)} widened ${JSON.stringify(grant)}`,
        );
      }
    }
  }
});

test("appending a block to a fold can only lower what the fold resolved", () => {
  const blocks: readonly AuthorityRequest[] = [
    { tools: ["editor", "git"] },
    { filesystem: "ReadWorkspace" },
  ];
  for (const grant of grants) {
    const before = taskAuthorityGrant(resolveTaskAuthority(grant, blocks));
    for (const request of requests) {
      const after = taskAuthorityGrant(
        resolveTaskAuthority(grant, [...blocks, request]),
      );
      if (!taskAuthorityIncludes(before, after)) {
        assert.fail(
          `${JSON.stringify(request)} widened ${JSON.stringify(before)}`,
        );
      }
    }
  }
});

/** Four blocks that disagree with each other, which is what makes the ordering test bite. */
const disagreeing: readonly AuthorityRequest[] = [
  { tools: ["editor", "shell"], mayCompleteTask: true },
  { network: false, filesystem: "ReadWorkspace" },
  { tools: ["shell", "git"], credentials: [] },
  { mayCompleteTask: false, filesystem: "WriteWorkspace" },
];

test("the order of the blocks does not change the authority they resolve to", () => {
  const orders = permutations(disagreeing);
  assert.equal(orders.length, 24);
  for (const grant of grants) {
    const resolved = taskAuthorityGrant(
      resolveTaskAuthority(grant, disagreeing),
    );
    for (const order of orders) {
      assert.deepEqual(
        taskAuthorityGrant(resolveTaskAuthority(grant, order)),
        resolved,
      );
    }
  }
});

test("a later block cannot restore completion authority an earlier one removed", () => {
  const grant: PolicyAuthorityGrant = {
    tools: ["shell"],
    credentials: [],
    network: true,
    filesystem: "WriteWorkspace",
    mayCompleteTask: true,
  };
  const resolved = taskAuthorityGrant(
    resolveTaskAuthority(grant, [
      { mayCompleteTask: false },
      { mayCompleteTask: true, network: true, filesystem: "WriteWorkspace" },
    ]),
  );
  assert.equal(resolved.mayCompleteTask, false);
  assert.equal(resolved.network, true);
});

test("a request cannot add a tool or a credential the grant never carried", () => {
  const grant: PolicyAuthorityGrant = {
    tools: ["editor"],
    credentials: [],
    network: false,
    filesystem: "None",
    mayCompleteTask: false,
  };
  const resolved = taskAuthorityGrant(
    resolveTaskAuthority(grant, [
      { tools: ["editor", "shell", "git"], credentials: ["deploy"] },
    ]),
  );
  assert.deepEqual(resolved.tools, ["editor"]);
  assert.deepEqual(resolved.credentials, []);
});

test("a block with no opinion leaves every field where the block before it left it", () => {
  const grant: PolicyAuthorityGrant = {
    tools: ["editor", "shell"],
    credentials: ["ci"],
    network: true,
    filesystem: "WriteWorkspace",
    mayCompleteTask: true,
  };
  const narrowed = resolveTaskAuthority(grant, [{ filesystem: "None" }]);
  assert.deepEqual(
    taskAuthorityGrant(
      resolveTaskAuthority(grant, [{ filesystem: "None" }, {}]),
    ),
    taskAuthorityGrant(narrowed),
  );
});

test("a minted grant is sorted and duplicate-free, so two of them compare by value", () => {
  const resolved = taskAuthorityGrant(
    grantTaskAuthority({
      tools: ["shell", "editor", "shell"],
      credentials: ["ci", "ci"],
      network: false,
      filesystem: "None",
      mayCompleteTask: false,
    }),
  );
  assert.deepEqual(resolved.tools, ["editor", "shell"]);
  assert.deepEqual(resolved.credentials, ["ci"]);
});

test("a request naming a reach no order names narrows nothing", () => {
  const grant: PolicyAuthorityGrant = {
    tools: [],
    credentials: [],
    network: false,
    filesystem: "None",
    mayCompleteTask: false,
  };
  const resolved = taskAuthorityGrant(
    resolveTaskAuthority(grant, [{ filesystem: driftedReach }]),
  );
  assert.equal(resolved.filesystem, "None");
});

test("a policy grant naming a reach no order names is refused at the mint", () => {
  assert.throws(
    () =>
      grantTaskAuthority({
        tools: [],
        credentials: [],
        network: false,
        filesystem: driftedReach,
        mayCompleteTask: false,
      }),
    (error: unknown) => {
      assert.ok(error instanceof RangeError);
      assert.match(error.message, /filesystem reach this order does not/u);
      return true;
    },
  );
});

test("inclusion refuses a reach no order names on either side of it", () => {
  const grant: PolicyAuthorityGrant = {
    tools: [],
    credentials: [],
    network: false,
    filesystem: "None",
    mayCompleteTask: false,
  };
  const drifted: PolicyAuthorityGrant = {
    ...grant,
    filesystem: driftedReach,
  };
  assert.equal(taskAuthorityIncludes(grant, drifted), false);
  assert.equal(taskAuthorityIncludes(drifted, grant), false);
  assert.equal(taskAuthorityIncludes(drifted, drifted), false);
});

test("a grant handed back cannot be grown by the reader holding it", () => {
  const authority = grantTaskAuthority({
    tools: ["editor"],
    credentials: ["ci"],
    network: false,
    filesystem: "None",
    mayCompleteTask: false,
  });
  const held = taskAuthorityGrant(authority);
  assert.throws(() => (held.tools as string[]).push("shell"), TypeError);
  assert.throws(() => (held.credentials as string[]).push("deploy"), TypeError);
  assert.throws(() => {
    (held as { network: boolean }).network = true;
  }, TypeError);
  assert.deepEqual(taskAuthorityGrant(authority).tools, ["editor"]);
  assert.equal(taskAuthorityGrant(authority).network, false);
});

test("the grant an authority holds cannot be replaced through the key reflection names", () => {
  const least: PolicyAuthorityGrant = {
    tools: ["editor"],
    credentials: [],
    network: false,
    filesystem: "None",
    mayCompleteTask: false,
  };
  const widest: PolicyAuthorityGrant = {
    tools: ["editor", "shell", "root"],
    credentials: ["deploy"],
    network: true,
    filesystem: "WriteWorkspace",
    mayCompleteTask: true,
  };
  const authorities: readonly (readonly [string, TaskAuthority])[] = [
    ["minted", grantTaskAuthority(least)],
    ["narrowed", narrowTaskAuthority(grantTaskAuthority(least), {})],
    ["resolved", resolveTaskAuthority(least, [{}])],
  ];
  for (const [how, authority] of authorities) {
    const keys = Object.getOwnPropertySymbols(authority);
    assert.equal(keys.length, 1, `the ${how} authority holds no single key`);
    const key = keys[0] as symbol;
    const named = authority as unknown as Record<symbol, PolicyAuthorityGrant>;
    assert.throws(() => {
      named[key] = widest;
    }, TypeError);
    assert.equal(Reflect.deleteProperty(authority, key), false, how);
    assert.deepEqual(taskAuthorityGrant(authority), least, how);
  }
});

test("a narrowed grant is frozen exactly as the minted one is", () => {
  const narrowed = taskAuthorityGrant(
    narrowTaskAuthority(
      grantTaskAuthority({
        tools: ["editor", "shell"],
        credentials: [],
        network: true,
        filesystem: "WriteWorkspace",
        mayCompleteTask: true,
      }),
      { tools: ["editor"] },
    ),
  );
  assert.throws(() => (narrowed.tools as string[]).push("shell"), TypeError);
  assert.deepEqual(narrowed.tools, ["editor"]);
});

test("inclusion is reflexive and rejects each single widening", () => {
  const grant: PolicyAuthorityGrant = {
    tools: ["editor"],
    credentials: ["ci"],
    network: false,
    filesystem: "ReadWorkspace",
    mayCompleteTask: false,
  };
  assert.ok(taskAuthorityIncludes(grant, grant));
  const widenings: readonly PolicyAuthorityGrant[] = [
    { ...grant, tools: ["editor", "shell"] },
    { ...grant, credentials: ["ci", "deploy"] },
    { ...grant, network: true },
    { ...grant, filesystem: "WriteWorkspace" },
    { ...grant, mayCompleteTask: true },
  ];
  for (const wider of widenings) {
    assert.equal(taskAuthorityIncludes(grant, wider), false);
    assert.ok(taskAuthorityIncludes(wider, grant));
  }
});
