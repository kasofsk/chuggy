/**
 * The authority lattice, proved over its whole small space rather than sampled.
 *
 * WHAT THIS TIER CAN DECIDE is every claim the module makes, because the space
 * is finite: the grants below are every combination of two tool names, one
 * credential, both flags and each reach, and the requests are the same space
 * with every field free to be absent. So "no request widens" and "order does
 * not matter" are checked exhaustively rather than argued.
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

/** Every request, including ones naming a tool no grant carries and ones with no opinion. */
function everyRequest(): readonly AuthorityRequest[] {
  const found: AuthorityRequest[] = [];
  const flags: readonly (boolean | undefined)[] = [undefined, false, true];
  const reaches: readonly (FilesystemAccess | undefined)[] = [
    undefined,
    ...filesystemAccessOrder,
  ];
  for (const tools of [undefined, ...subsets(["editor", "shell", "git"])]) {
    for (const network of flags) {
      for (const filesystem of reaches) {
        for (const mayCompleteTask of flags) {
          found.push({
            ...(tools === undefined ? {} : { tools }),
            ...(network === undefined ? {} : { network }),
            ...(filesystem === undefined ? {} : { filesystem }),
            ...(mayCompleteTask === undefined ? {} : { mayCompleteTask }),
          });
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
