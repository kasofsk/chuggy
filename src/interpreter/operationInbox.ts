/**
 * The durable submission side of one project partition: what the API needs of
 * PostgreSQL to make an authorized mutation durable, and to take it back.
 *
 * WHY A SECOND PORT AND NOT MORE OF `ProjectStore`. Acceptance is the API's
 * transaction and the append is the project ticket writer's, and
 * `docs/design/006-durable-project-dispatch.md` says runtime services do not
 * share an omnipotent credential. A port whose methods two roles answer is a
 * port no set of grants can describe, and the grant is where that boundary is
 * actually enforced — so the split here is by authority, and each side is
 * given only the calls its role is granted. `./projectDiscovery.ts` is the
 * writer's side of the same relations, and the adapter for each takes its
 * own pool because in deployment those pools carry different credentials.
 *
 * WHY ACCEPTANCE IS ONE CALL. It writes the operation, the inbox ordinal, the
 * decision input and the readiness generation in one transaction, and a port that
 * offered those separately would invite an implementation that allocated an
 * ordinal in one call and enqueued in the next — the acceptance that returns
 * an operation identity and then loses it.
 *
 * A PLAINTEXT KEY CROSSES THIS BOUNDARY AND NEVER RETURNS. `asIdempotencyKey`
 * normalizes and bounds it here; the adapter stores only a versioned keyed
 * digest of it, and no outcome below carries it back. That is why the key is
 * an argument to `accept` rather than a value any caller can read off an
 * operation.
 *
 * EVERY REFUSAL IS A VALUE, as in `./projectStore.ts`. A conflicting
 * idempotency key, a lifecycle that admits no such class and an operation
 * already terminal are all outcomes a caller must handle. A conflict deliberately carries no operation
 * identity: authorization is the caller's and 006 forbids disclosing an
 * existing operation to a retry whose access has not been verified, so the
 * port hands out nothing there is to leak.
 *
 * IT ACCEPTS AND IT DOES NOT DECIDE. Nothing here consumes a decision input,
 * appends a journal entry, terminalizes an operation from a decision or
 * updates a projection: that is `./projectDecision.ts`, and it is the
 * writer's. Cancellation is the one path that terminalizes, because 006 makes
 * it an infrastructure transaction that must remain available without a
 * healthy project writer.
 */

import type { Lifecycle, Partition } from "./projectStore.ts";
import type { TicketCommand } from "./ticketCommand.ts";
export {
  asOperationDecisionEvent,
  type NativeActionResolution,
  type OperationDecisionEvent,
  type TicketCommand,
} from "./ticketCommand.ts";

declare const operationIdBrand: unique symbol;
declare const authorityKindBrand: unique symbol;
declare const authoritySubjectBrand: unique symbol;
declare const idempotencyKeyBrand: unique symbol;
declare const operationCommandBrand: unique symbol;

/** An operation's identity: globally unique, opaque, minted by its submitter and never reused. */
export type OperationId = string & { readonly [operationIdBrand]: true };

/** The class of authority a submission was made under, which is what idempotency is scoped by. */
export type AuthorityKind = string & { readonly [authorityKindBrand]: true };

/** The non-reassignable internal subject a submission is audited to, never a credential or a profile. */
export type AuthoritySubject = string & {
  readonly [authoritySubjectBrand]: true;
};

/** A client's idempotency key, normalized and bounded here and stored nowhere. */
export type IdempotencyKey = string & { readonly [idempotencyKeyBrand]: true };

/** The canonical encoding of the parsed command an operation carries. */
export type OperationCommand = string & {
  readonly [operationCommandBrand]: true;
};

/** The longest opaque operation identity a stored row carries. */
export const operationIdentityCharsMax = 256;

/** The longest normalized idempotency key this tree keys a digest from. */
export const idempotencyKeyCharsMax = 256;

/** The longest authority kind or subject a stored operation records. */
export const authorityCharsMax = 256;

/** The longest command an accepted operation carries into the inbox. */
export const operationCommandCharsMax = 65_536;

/**
 * Refuses text a bounded column cannot hold, and text that is not text: an
 * opaque client string with no cap is an unbounded row, and one carrying an
 * unpaired surrogate is a value every UTF-8 encoding of it folds to the
 * replacement character, so two such strings share one digest and one stored
 * row. House rule 9 forbids the first and no later slice can retrofit either
 * onto rows already written.
 */
function asBoundedText(value: string, what: string, charsMax: number): string {
  if (value.length === 0) throw new RangeError(`${what}: a value is empty`);
  if (!value.isWellFormed()) {
    throw new RangeError(
      `${what}: an unpaired surrogate is not a value a digest can separate`,
    );
  }
  if (value.length > charsMax) {
    throw new RangeError(
      `${what}: ${String(value.length)} characters is past the ${String(charsMax)} a stored row holds`,
    );
  }
  return value;
}

/** Brands an opaque operation identity. */
export function asOperationId(value: string): OperationId {
  return asBoundedText(
    value,
    "operation id",
    operationIdentityCharsMax,
  ) as OperationId;
}

/** Brands a bounded authority kind. */
export function asAuthorityKind(value: string): AuthorityKind {
  return asBoundedText(
    value,
    "authority kind",
    authorityCharsMax,
  ) as AuthorityKind;
}

/** Brands a bounded authority subject. */
export function asAuthoritySubject(value: string): AuthoritySubject {
  return asBoundedText(
    value,
    "authority subject",
    authorityCharsMax,
  ) as AuthoritySubject;
}

/**
 * Normalizes a client idempotency key to NFC and bounds it. Nothing else is
 * folded: trimming or case-folding would merge two keys a client meant to keep
 * apart, and merging them returns one client's operation to another's retry.
 */
export function asIdempotencyKey(value: string): IdempotencyKey {
  return asBoundedText(
    value.normalize("NFC"),
    "idempotency key",
    idempotencyKeyCharsMax,
  ) as IdempotencyKey;
}

/** Brands the canonical command encoding an operation carries. */
export function asOperationCommand(value: string): OperationCommand {
  return asBoundedText(
    value,
    "operation command",
    operationCommandCharsMax,
  ) as OperationCommand;
}

/** Who a submission is made by: the kind idempotency is scoped to, and the subject it is audited to. */
export interface Authority {
  readonly kind: AuthorityKind;
  readonly subject: AuthoritySubject;
}

/**
 * What an operation is allowed to enter a project during. Ordinary work is
 * everything a user submits to a healthy project; the reducing class is 006's
 * explicitly listed correctness-reducing paths, which a suspended or
 * integrity-blocked project still admits.
 */
export type AdmissionClass = "Ordinary" | "CorrectnessReducing";

/** Every admission class, in the order this file declares them, so a suite can iterate rather than restate. */
export const allAdmissionClasses: readonly AdmissionClass[] = [
  "Ordinary",
  "CorrectnessReducing",
];

/**
 * The admission matrix acceptance checks under the locked lifecycle row.
 * `Retention` appears in neither row because 006 admits no writer to it at
 * all.
 */
export const admissionLifecycles: Readonly<
  Record<AdmissionClass, readonly Lifecycle[]>
> = {
  Ordinary: ["Active"],
  CorrectnessReducing: ["Active", "Suspended", "IntegrityBlocked", "Deleting"],
};

/** An operation begins pending and ends succeeded, refused or cancelled; nothing else is public. */
export type OperationState = "Pending" | "Succeeded" | "Refused" | "Cancelled";

/** Every operation state, in the order this file declares them, so a suite can iterate rather than restate. */
export const allOperationStates: readonly OperationState[] = [
  "Pending",
  "Succeeded",
  "Refused",
  "Cancelled",
];

/** One authorized mutation, offered for durable acceptance into a project's inbox. */
export interface Submission {
  readonly partition: Partition;
  readonly operation: OperationId;
  readonly authority: Authority;
  readonly key: IdempotencyKey;
  readonly command: TicketCommand;
}

/** The immutable scheduling class trusted ingress derives from a typed command. */
export type PriorityClass =
  "Safety" | "Completion" | "Continuation" | "Ordinary";

export const allPriorityClasses: readonly PriorityClass[] = [
  "Safety",
  "Completion",
  "Continuation",
  "Ordinary",
];

/** Trusted ingress policy. Callers never provide either classification. */
export function classifyCommand(command: TicketCommand): {
  readonly admission: AdmissionClass;
  readonly priority: Exclude<PriorityClass, "Continuation">;
} {
  if (
    command.command === "ReleaseDraft" ||
    command.command === "ManualDispatch" ||
    command.command === "ProposeDispatch"
  )
    return { admission: "Ordinary", priority: "Ordinary" };
  if (command.command === "ResolveNativeAction") {
    return {
      admission:
        command.resolution === "Revoke" ? "CorrectnessReducing" : "Ordinary",
      priority: command.resolution === "Revoke" ? "Safety" : "Ordinary",
    };
  }
  switch (command.event.type) {
    case "Revoke":
      return { admission: "CorrectnessReducing", priority: "Safety" };
    case "TaskDone":
    case "ExecutionBlocked":
    case "FinalizationResult":
      return { admission: "CorrectnessReducing", priority: "Completion" };
    case "Dispatch":
    case "ResumeTicket":
      return { admission: "Ordinary", priority: "Ordinary" };
  }
}

/** One authorized cancellation of a pending operation, audited to the authority that asked for it. */
export interface Cancellation {
  readonly partition: Partition;
  readonly operation: OperationId;
  readonly authority: Authority;
}

/**
 * What an accepted operation says about itself. The lifecycle generation is
 * the one it was accepted under, which is the guard a reactivated project
 * reconsiders it against.
 */
export interface OperationStanding {
  readonly partition: Partition;
  readonly operation: OperationId;
  readonly ordinal: number;
  readonly state: OperationState;
  readonly authorityKind: AuthorityKind;
  readonly admission: AdmissionClass;
  readonly lifecycleGeneration: number;
}

/**
 * What an acceptance found. `Original` is an idempotent retry, which allocates
 * no second ordinal, and `IdempotencyConflict` is the same key offered with a
 * different command.
 */
export type Accepted =
  | { readonly accepted: "Accepted"; readonly operation: OperationStanding }
  | { readonly accepted: "Original"; readonly operation: OperationStanding }
  | { readonly accepted: "IdempotencyConflict" }
  | { readonly accepted: "InvalidCommand" }
  | { readonly accepted: "Backpressure"; readonly retryAfterSeconds: number }
  | { readonly accepted: "Unavailable"; readonly retryAfterSeconds: number }
  | { readonly accepted: "NotAdmitted"; readonly lifecycle: Lifecycle };

/** What a cancellation found, distinguishing a repeat of itself from an operation a writer already decided. */
export type Cancelled =
  | { readonly cancelled: "Cancelled"; readonly operation: OperationStanding }
  | {
      readonly cancelled: "AlreadyCancelled";
      readonly operation: OperationStanding;
    }
  | { readonly cancelled: "NotPending"; readonly state: OperationState }
  | { readonly cancelled: "Unknown" };

/**
 * The durable inbox for project partitions, from the submitting side. Every
 * call names its partition, and none of them reads across two.
 */
export interface OperationInbox {
  /**
   * Accepts one submission, allocating its ordinal and writing its operation,
   * decision input and readiness generation in one transaction under the locked
   * lifecycle row.
   */
  accept(submission: Submission): Promise<Accepted>;

  /**
   * Cancels a still-pending operation under the same decision-input row lock a
   * deciding writer takes.
   */
  cancel(cancellation: Cancellation): Promise<Cancelled>;

  /** What an accepted operation says about itself, or undefined when this partition has no such operation. */
  operation(
    partition: Partition,
    operation: OperationId,
  ): Promise<OperationStanding | undefined>;
}
