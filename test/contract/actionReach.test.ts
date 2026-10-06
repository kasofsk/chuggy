import assert from "node:assert/strict";
import test from "node:test";

import {
  allActionReaches,
  allActionReachesShown,
  allActionReachesUnshown,
  ticketActionReachResponseSchema,
} from "../../src/contract/actionReach.ts";
import { actionReportDetailCharsMax } from "../../src/contract/actionReport.ts";

const repository = "https://forge.example/acme/atlas.git";
const commit = "c".repeat(40);

const least = {
  outcome: "Succeeded",
  commit: "a".repeat(40),
  receivedAt: "2026-10-05T22:45:51.000000Z",
};

const whole = {
  ...least,
  observedAt: "2026-10-05T22:45:50.250000Z",
  detail: "run chuggy-release-x7k2p",
  link: "https://grafana.example.test/d/release?var-run=x7k2p",
};

/** One declared action at a mark, showing what it is given. */
function standing(reach: string, observation: unknown): unknown {
  return { action: "build", name: "Build it", reach, observation };
}

function admitted(value: unknown): boolean {
  return ticketActionReachResponseSchema.safeParse(value).success;
}

/** Whether a landed ticket whose one action is `action` is a response. */
function admittedAction(action: unknown): boolean {
  return admitted({ repository, commit, actions: [action] });
}

test("the marks are the five, those read from a report first", () => {
  assert.deepEqual(allActionReaches, [
    "Reached",
    "Failed",
    "RolledBack",
    "NotYet",
    "Unknown",
  ]);
  assert.deepEqual(
    [...allActionReachesShown, ...allActionReachesUnshown],
    allActionReaches,
  );
});

test("a landed ticket answers its repository, its commit and each action at a mark, read back whole", () => {
  const answered = {
    repository,
    commit: "d".repeat(64),
    actions: [
      ...allActionReachesShown.flatMap((reach) => [
        standing(reach, least),
        standing(reach, whole),
      ]),
      ...allActionReachesUnshown.map((reach) => standing(reach, null)),
    ],
  };
  assert.deepEqual(ticketActionReachResponseSchema.parse(answered), answered);
  const none = { repository, commit, actions: [] };
  assert.deepEqual(ticketActionReachResponseSchema.parse(none), none);
});

test("a mark read from a report shows it, and a mark read from none shows null", () => {
  for (const reach of allActionReachesShown) {
    assert.equal(admittedAction(standing(reach, null)), false, reach);
    assert.equal(
      admittedAction({
        ...(standing(reach, least) as object),
        observation: undefined,
      }),
      false,
      reach,
    );
  }
  for (const reach of allActionReachesUnshown) {
    assert.equal(admittedAction(standing(reach, least)), false, reach);
    assert.equal(
      admittedAction({ action: "build", name: "Build it", reach }),
      false,
      reach,
    );
  }
  assert.equal(admittedAction(standing("Pending", null)), false);
  assert.equal(admittedAction(standing("Pending", least)), false);
});

test("a ticket that landed nowhere answers no repository, no commit and no actions, and nothing between", () => {
  const nowhere = { repository: null, commit: null, actions: [] };
  assert.deepEqual(ticketActionReachResponseSchema.parse(nowhere), nowhere);
  for (const [what, value] of [
    ["a repository with no commit", { ...nowhere, repository }],
    ["a commit with no repository", { ...nowhere, commit }],
    [
      "actions with no commit",
      { ...nowhere, actions: [standing("NotYet", null)] },
    ],
    [
      "actions and a repository with no commit",
      { repository, commit: null, actions: [standing("NotYet", null)] },
    ],
    ["no actions at all", { repository, commit }],
    ["an empty repository", { repository: "", commit, actions: [] }],
  ] as const)
    assert.equal(admitted(value), false, what);
});

test("a field the response has no place for is refused rather than dropped", () => {
  const landed = { repository, commit, actions: [standing("Reached", whole)] };
  assert.equal(admitted(landed), true);
  assert.equal(admitted({ ...landed, ticket: 7 }), false);
  assert.equal(
    admittedAction({ ...(standing("Reached", whole) as object), ordinal: 4 }),
    false,
  );
  assert.equal(
    admittedAction({ ...(standing("NotYet", null) as object), ordinal: 4 }),
    false,
  );
  for (const extra of [{ ordinal: 4 }, { reporter: "rig-build" }])
    assert.equal(
      admittedAction(standing("Reached", { ...whole, ...extra })),
      false,
      JSON.stringify(extra),
    );
});

test("a commit is a git object's id, an outcome one a report may say, and a link one a report may carry", () => {
  for (const [what, value] of [
    ["a short commit", { repository, commit: "abc123", actions: [] }],
    ["a ref", { repository, commit: "refs/heads/main", actions: [] }],
  ] as const)
    assert.equal(admitted(value), false, what);
  for (const [what, shown] of [
    ["a short commit", { ...whole, commit: "abc123" }],
    ["an outcome nobody reports", { ...whole, outcome: "Running" }],
    ["no outcome", { commit: least.commit, receivedAt: least.receivedAt }],
    ["no receipt", { commit: least.commit, outcome: least.outcome }],
    ["an empty receipt", { ...whole, receivedAt: "" }],
    ["a link that is not https", { ...whole, link: "http://example.test/" }],
    ["a script for a link", { ...whole, link: "javascript:alert(1)" }],
    ["an empty detail", { ...whole, detail: "" }],
    ["a detail holding a NUL", { ...whole, detail: "a\u0000b" }],
  ] as const)
    assert.equal(admittedAction(standing("Reached", shown)), false, what);
});

test("a detail is as long as a row holds one, measured in characters as the row measures it", () => {
  const widest = "\u{1F680}".repeat(actionReportDetailCharsMax);
  assert.equal(
    admittedAction(standing("Failed", { ...least, detail: widest })),
    true,
  );
  assert.equal(
    admittedAction(standing("Failed", { ...least, detail: `${widest}x` })),
    false,
  );
});
