/**
 * The capacity mirror's contract against the specification it mirrors:
 * `src/interpreter/executionScheduler.ts` restates `model/capacity.qnt` in
 * TypeScript, and this reads the model at run time to check that the
 * restatement still says the same thing.
 *
 * A HAND-MAINTAINED COPY OF A PROVED DEFINITION GOES STALE SILENTLY, which is
 * the failure this exists to prevent. The status roster and the legal-move and
 * slot-ownership tables are read out of the model's own source, so a
 * constructor or an arm added there becomes a failure here rather than a
 * divergence nobody notices; the arithmetic is checked by the safety property
 * the model states over it.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import {
  allExecutionStatuses,
  executionAccountActiveCount,
  executionActiveCount,
  executionCapacitySafe,
  executionIdentityUnique,
  executionLegalMove,
  executionMayAdmit,
  executionOwnsSlot,
  executionPreferredOver,
  executionProvenanceWellFormed,
  executionReservationDeficit,
  type CapacityExecution,
  type Entitlement,
  type ExecutionStatus,
} from "../../src/interpreter/executionScheduler.ts";

const modelRoot = join(import.meta.dirname, "..", "..");

/** The capacity model as text, which is the authority every roster below is read from. */
function capacitySource(): string {
  return readFileSync(join(modelRoot, "model", "capacity.qnt"), "utf8");
}

/** The body a `match` opens, matched brace to brace so a nested one reads the same. */
function matchBody(source: string, opener: string): string {
  const start = source.indexOf(opener);
  assert.ok(start >= 0, `model/capacity.qnt has no ${opener}`);
  let depth = 0;
  for (let at = start + opener.length - 1; at < source.length; at++) {
    if (source[at] === "{") depth++;
    else if (source[at] === "}") {
      depth--;
      if (depth === 0) return source.slice(start + opener.length, at);
    }
  }
  throw new Error(`model/capacity.qnt: ${opener} is unterminated`);
}

/** Every `| Constructor => body` arm of a match body, in the order the model writes them. */
function matchArms(body: string): readonly { subject: string; body: string }[] {
  return body
    .split("|")
    .map((piece) => piece.trim())
    .filter((piece) => piece.length > 0)
    .map((piece) => {
      const at = piece.indexOf("=>");
      assert.ok(at > 0, `model/capacity.qnt: ${piece} is not a match arm`);
      return {
        subject: piece.slice(0, at).trim(),
        body: piece.slice(at + 2).trim(),
      };
    });
}

test("the status roster is the one model/capacity.qnt declares", () => {
  const declaration = /type ExecutionStatus = ([^\n]+)/.exec(capacitySource());
  assert.ok(declaration?.[1], "model/capacity.qnt declares no ExecutionStatus");
  assert.deepEqual(
    declaration[1].split("|").map((name) => name.trim()),
    [...allExecutionStatuses],
  );
});

test("slot ownership is the table model/capacity.qnt writes", () => {
  const arms = matchArms(
    matchBody(
      capacitySource(),
      "ownsSlot(status: ExecutionStatus): bool = match status {",
    ),
  );
  assert.equal(arms.length, allExecutionStatuses.length);
  for (const arm of arms) {
    assert.equal(
      executionOwnsSlot(arm.subject as ExecutionStatus),
      arm.body === "true",
      `ownsSlot disagrees with the model at ${arm.subject}`,
    );
  }
});

test("the legal moves are the table model/capacity.qnt writes", () => {
  const arms = matchArms(
    matchBody(
      capacitySource(),
      "legalStatusMove(before: ExecutionStatus, after: ExecutionStatus): bool =\n    match before {",
    ),
  );
  assert.equal(arms.length, allExecutionStatuses.length);
  for (const arm of arms) {
    const permitted = new Set(
      [...arm.body.matchAll(/after == ([A-Za-z]+)/g)].map((found) => found[1]),
    );
    assert.ok(permitted.size > 0, `no move is readable at ${arm.subject}`);
    for (const after of allExecutionStatuses) {
      assert.equal(
        executionLegalMove(arm.subject as ExecutionStatus, after),
        permitted.has(after),
        `legalStatusMove disagrees with the model at ${arm.subject} -> ${after}`,
      );
    }
  }
});

/** One registration, with only the fields the capacity arithmetic reads. */
function registration(
  task: number,
  account: string,
  status: ExecutionStatus,
): CapacityExecution {
  return {
    project: "project-one",
    ticket: 1,
    task,
    account,
    sourceSeq: 1,
    sourceEffect: 0,
    status,
  };
}

const entitlements: ReadonlyMap<string, Entitlement> = new Map([
  ["reserving", { reserved: 2, maximum: 3 }],
  ["borrowing", { reserved: 0, maximum: 3 }],
]);

test("a queued registration owns no slot and an active one owns exactly one", () => {
  const ledger = allExecutionStatuses.map((status, index) =>
    registration(index + 1, "borrowing", status),
  );
  assert.equal(executionActiveCount(ledger), 3);
  assert.equal(executionAccountActiveCount(ledger, "borrowing"), 3);
  assert.equal(executionAccountActiveCount(ledger, "reserving"), 0);
});

test("admission stops at cluster headroom and at the account maximum", () => {
  const running = [1, 2].map((task) =>
    registration(task, "borrowing", "Running"),
  );
  const candidate = registration(3, "borrowing", "Queued");
  assert.equal(
    executionMayAdmit(3, entitlements, [...running, candidate], candidate),
    true,
  );
  assert.equal(
    executionMayAdmit(2, entitlements, [...running, candidate], candidate),
    false,
  );
  const atMaximum = [1, 2, 3].map((task) =>
    registration(task, "borrowing", "Running"),
  );
  const fourth = registration(4, "borrowing", "Queued");
  assert.equal(
    executionMayAdmit(9, entitlements, [...atMaximum, fourth], fourth),
    false,
  );
});

test("an admitted registration is never admissible a second time", () => {
  const admitted = registration(1, "borrowing", "Admitted");
  assert.equal(executionMayAdmit(9, entitlements, [admitted], admitted), false);
});

test("a reservation deficit dominates a borrower with none", () => {
  const ledger = [registration(1, "borrowing", "Running")];
  const deficient = registration(2, "reserving", "Queued");
  const borrower = registration(3, "borrowing", "Queued");
  assert.equal(
    executionReservationDeficit(entitlements, ledger, "reserving"),
    2,
  );
  assert.equal(
    executionReservationDeficit(entitlements, ledger, "borrowing"),
    0,
  );
  assert.equal(
    executionPreferredOver(entitlements, ledger, deficient, borrower),
    true,
  );
  assert.equal(
    executionPreferredOver(entitlements, ledger, borrower, deficient),
    false,
  );
});

test("one logical task names at most one registration, per project", () => {
  const here = registration(1, "borrowing", "Queued");
  assert.equal(executionIdentityUnique([here, here]), false);
  assert.equal(
    executionIdentityUnique([here, { ...here, project: "project-two" }]),
    true,
  );
  assert.equal(
    executionIdentityUnique([here, registration(2, "borrowing", "Queued")]),
    true,
  );
});

test("provenance names a journaled effect position", () => {
  const here = registration(1, "borrowing", "Queued");
  assert.equal(executionProvenanceWellFormed([here]), true);
  assert.equal(
    executionProvenanceWellFormed([{ ...here, sourceSeq: 0 }]),
    false,
  );
  assert.equal(
    executionProvenanceWellFormed([{ ...here, sourceEffect: -1 }]),
    false,
  );
  assert.equal(
    executionProvenanceWellFormed([{ ...here, project: "" }]),
    false,
  );
});

test("every admission the model permits leaves the ledger safe", () => {
  const ledger: CapacityExecution[] = [
    registration(1, "reserving", "Queued"),
    registration(2, "reserving", "Queued"),
    registration(3, "borrowing", "Queued"),
    registration(4, "borrowing", "Queued"),
  ];
  const clusterSlotsMax = 3;
  assert.equal(
    executionCapacitySafe(clusterSlotsMax, entitlements, ledger),
    true,
  );
  for (let index = 0; index < ledger.length; index++) {
    const candidate = ledger[index];
    assert.ok(candidate);
    if (!executionMayAdmit(clusterSlotsMax, entitlements, ledger, candidate))
      continue;
    ledger[index] = { ...candidate, status: "Admitted" };
    assert.equal(
      executionCapacitySafe(clusterSlotsMax, entitlements, ledger),
      true,
      "an admission the model permits left the ledger unsafe",
    );
  }
  assert.equal(executionActiveCount(ledger), clusterSlotsMax);
});

test("an unsafe ledger is reported unsafe", () => {
  const over = [1, 2, 3, 4].map((task) =>
    registration(task, "borrowing", "Running"),
  );
  assert.equal(executionCapacitySafe(9, entitlements, over), false);
  assert.equal(executionCapacitySafe(3, entitlements, over.slice(0, 3)), true);
  assert.equal(executionCapacitySafe(2, entitlements, over.slice(0, 3)), false);
});
