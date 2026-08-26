/**
 * Every coded answer the two mutation routes can give, held against the
 * sentences `ui/chuggy-ui/` has for them.
 *
 * The responses are BUILT by the boundary's own `submissionResponse` and
 * `cancellationResponse` over every arm of their result unions, then classified
 * by the contract's own `classify`, then handed to the console. Nothing here
 * reads the server's source for a code: a roster written twice is only held
 * equal by driving the thing that emits it, and a suite that grepped for the
 * literals would pass over a code the server had stopped sending.
 *
 * THE ARMS ARE KEYED BY THEIR OWN TAG AND NOT LISTED. An array literal over a
 * union is not required to cover it, so a list of arms is a list of the ones
 * somebody remembered; a record the compiler checks against `Record<Tag, Arm>`
 * is one an arm cannot be added to the boundary without joining. The forward
 * direction rests on that and on every fallback in `codeSentences.ts` naming
 * itself as one.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { classify } from "../../src/contract/outcomes.ts";
import type { ApiOutcome } from "../../src/contract/outcomes.ts";
import {
  cancellationResponse,
  submissionResponse,
} from "../../src/adapters/http/outcomes.ts";
import type { NativeHttpResponse } from "../../src/adapters/http/outcomes.ts";
import type {
  NativeCancellation,
  NativeSubmissionResult,
} from "../../src/interpreter/nativeWeb.ts";
import type {
  Accepted,
  Cancelled,
  OperationStanding,
} from "../../src/interpreter/operationInbox.ts";
import {
  mutationDeferralCodes,
  mutationRefusalCodes,
  operationFailureSentence,
} from "../../ui/chuggy-ui/app/core/codeSentences.ts";

const partition = { tenant: "acme", project: "atlas" } as Parameters<
  typeof submissionResponse
>[0];

const standing = {
  partition,
  operation: "op-1",
  ordinal: 1,
  state: "Pending",
  authorityKind: "Human",
  admission: "Ordinary",
  lifecycleGeneration: 1,
} as unknown as OperationStanding;

const acceptances = {
  Accepted: { accepted: "Accepted", operation: standing },
  Original: { accepted: "Original", operation: standing },
  IdempotencyConflict: { accepted: "IdempotencyConflict" },
  InvalidCommand: { accepted: "InvalidCommand" },
  Backpressure: { accepted: "Backpressure", retryAfterSeconds: 3 },
  Unavailable: { accepted: "Unavailable", retryAfterSeconds: 3 },
  NotAdmitted: { accepted: "NotAdmitted", lifecycle: "Suspended" },
} as const satisfies Record<Accepted["accepted"], Accepted>;

const cancelled = {
  Cancelled: { cancelled: "Cancelled", operation: standing },
  AlreadyCancelled: { cancelled: "AlreadyCancelled", operation: standing },
  NotPending: { cancelled: "NotPending", state: "Succeeded" },
  Unknown: { cancelled: "Unknown" },
} as const satisfies Record<Cancelled["cancelled"], Cancelled>;

const submitted = {
  NotFound: { result: "NotFound" },
  Backlogged: { result: "Backlogged", scope: "Project", retryAfterSeconds: 3 },
  Authorized: { result: "Authorized", acceptance: acceptances.Accepted },
} as const satisfies Record<
  NativeSubmissionResult["result"],
  NativeSubmissionResult
>;

const cancellationResults = {
  NotFound: { result: "NotFound" },
  Found: { result: "Found", cancellation: cancelled.Cancelled },
} as const satisfies Record<NativeCancellation["result"], NativeCancellation>;

/** Every submission arm, and every acceptance the authorized one can carry. */
const submissions: readonly NativeSubmissionResult[] = [
  ...Object.values(submitted),
  ...Object.values(acceptances).map(
    (acceptance) =>
      ({ result: "Authorized", acceptance }) satisfies NativeSubmissionResult,
  ),
];

const cancellations: readonly NativeCancellation[] = [
  ...Object.values(cancellationResults),
  ...Object.values(cancelled).map(
    (cancellation) =>
      ({ result: "Found", cancellation }) satisfies NativeCancellation,
  ),
];

function outcomeOf(built: NativeHttpResponse): ApiOutcome {
  return classify(built.status, (name) => built.headers[name], built.body);
}

/** The code the envelope carries, for the arms that carry one. */
function codeOf(built: NativeHttpResponse): string | undefined {
  const body = built.body;
  if (body === null || typeof body !== "object" || !("error" in body))
    return undefined;
  const error = (body as { readonly error: unknown }).error;
  if (error === null || typeof error !== "object" || !("code" in error))
    return undefined;
  const code = (error as { readonly code: unknown }).code;
  return typeof code === "string" ? code : undefined;
}

function saysSomethingFor(
  built: NativeHttpResponse,
  what: string,
): string | undefined {
  const outcome = outcomeOf(built);
  const code = codeOf(built);
  if (outcome.outcome === "Ok" || outcome.outcome === "Accepted") return code;
  if (code === undefined) return undefined;
  const said = operationFailureSentence(outcome);
  assert.ok(
    !said.includes(code),
    `${what} answers ${code} and the console read it back verbatim: ${said}`,
  );
  assert.ok(
    !said.includes("does not know"),
    `${what} answers ${code} and no roster in the console holds it: ${said}`,
  );
  return code;
}

/** Every coded answer either route builds, over every arm of its union. */
function codesAnswered(): ReadonlySet<string> {
  const seen = new Set<string>();
  for (const result of submissions) {
    const code = saysSomethingFor(
      submissionResponse(partition, result),
      `submission ${result.result}`,
    );
    if (code !== undefined) seen.add(code);
  }
  for (const result of cancellations) {
    const code = saysSomethingFor(
      cancellationResponse(result),
      `cancellation ${result.result}`,
    );
    if (code !== undefined) seen.add(code);
  }
  return seen;
}

test("every coded answer these two routes build reaches a reader as a sentence", () => {
  assert.ok(codesAnswered().size > 0, "no arm carried a coded answer at all");
});

test("the console holds a sentence for no code these routes never send", () => {
  const answered = codesAnswered();
  for (const code of [...mutationRefusalCodes, ...mutationDeferralCodes])
    assert.ok(
      answered.has(code),
      `the console explains ${code}, which neither route answers with`,
    );
});
