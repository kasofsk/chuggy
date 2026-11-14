/**
 * The bounded pass that turns a change-log row into a turn in a member's
 * mailbox, and the one wake a thread's own attempt offers it. It reads a cursor, reads one page of candidates,
 * offers each of them one wake, and moves the cursor once. It is pure —
 * nothing here reaches a store, a clock or a route except through
 * `ThreadWakeService` or `ThreadJobWakeService` — and it composes no body: the document names the reason
 * and the resource, and a thread that wants the ticket reads it with its own
 * tools.
 *
 * THE TURN IDENTITY IS DERIVED, NOT MINTED. `threadWakeTurn` is a pure
 * function of the change sequence and the session, so a pass that crashed
 * after enqueuing and before advancing re-offers THE SAME turn and is told
 * `AlreadyWoken`. That is the whole reason the cursor may be moved outside the
 * enqueues' transaction, and it is why the session is carried as a digest
 * rather than verbatim: a session identity may be as wide as the column that
 * holds it, so a turn id that spelled one out could not also fit.
 *
 * A WAKE THAT LANDS NOWHERE IS SKIPPED, NOT RETRIED, and the cursor still
 * moves past it. A member whose mailbox is full has more waiting than they
 * have read, and a wake retried until it fits would make their mailbox a
 * queue of notices nobody asked for; a thread that is closed or absent has
 * nobody to tell. The pass counts each of those and carries on, because one
 * member's mailbox is not the pass's business to stop for.
 *
 * A THREAD WHOSE PRINCIPAL MAY NOT CHANGE THE PROJECT IS ONE OF THOSE, because
 * a wake is a turn and a member who may only read starts none; so is one whose
 * principal the project no longer admits at all, and one routed in cluster
 * whose tenant no longer grants them the hosted run the turn would spend. THE
 * AUTHORITY IS ASKED HERE. `src/interpreter/projectAccess.ts`
 * answers it, not the mailbox door, because access is not a row this database
 * holds. An authority that could not answer at all is neither a wake nor an
 * ownerless thread: the candidate is passed over and its sequence holds the
 * cursor, which is the same rule the paragraph below states for a sequence
 * read in part. A raise instead would end the pacing loop, and an outage is
 * not a reason to stop selecting. One routed to runners where the member has no
 * chat host is skipped too, read off the page beside its route, because no
 * runner would take the turn.
 *
 * A CURSOR MAY ONLY MOVE PAST A SEQUENCE THE PASS DECIDED WHOLE. One change row
 * wakes at most the one thread its ticket's draft was filed from, but the pass
 * does not rest on that read's shape: a page that filled its bound may hold
 * only part of the last sequence's candidates — and a cursor moved past that
 * sequence would drop the rest of them permanently and silently. So a full
 * page advances to the highest sequence BELOW its last, which the ordering
 * makes complete, and its last sequence is read again next pass, where what
 * was already woken answers `AlreadyWoken`. The one case with no complete
 * sequence to move to is a page entirely of one sequence: there the pass moves
 * past it anyway and says so in `truncatedAt`, because the alternative is a
 * cursor that can never move again for any project and no bound a deployment
 * can set would free it.
 *
 * THE PASS TRUSTS THE PAGE'S ORDER AND CHECKS IT. The reasoning above holds
 * only where a page is a PREFIX of the window after the cursor, so a page that
 * is not in sequence order, or that is wider than the bound it was asked for,
 * raises rather than deriving a cursor from an order it does not have.
 *
 * A THREAD'S OWN ATTEMPT WAKES IT THROUGH THE SAME DOOR. `threadJobWake` is
 * one candidate offered by a thread's attempt on its member's chat host rather
 * than read off the log: a job that exited, a watch that matched, a timer that
 * fell due, or jobs a new attempt restored. Its turn is derived from the
 * session and the attempt's own identity for the event, its document names
 * the job, watch or timer and nothing the job printed, and it is admitted on
 * the checks above, or a member's own thread on those its messages pass. It holds no cursor, so the attempt is told what its wake
 * came to, and an authority that could not answer is the one refusal worth
 * offering again.
 *
 * A BOUND ABOVE `threadWakesPerPassMax` IS REFUSED, NOT CLAMPED. The candidate
 * read caps what it is asked for at that ceiling, so a service carrying a wider
 * bound would read a capped page, read it as short, and advance to a sequence
 * it had not read whole — the drop this module exists to prevent, produced by
 * the configuration rather than by the pagination. A clamp would run a bound
 * other than the one it was given and say nothing; a refusal is the one answer
 * that cannot be mistaken for the bound holding.
 */

import { createHash } from "node:crypto";

import { threadWakesPerPassMax } from "../contract/http.ts";
import type {
  SessionBearerSecret,
  SessionId,
  SessionTurnId,
} from "./agentSession.ts";
import { asSessionTurnId, memberScopeReserved } from "./agentSession.ts";
import { memberChatAccess } from "./memberChat.ts";
import type { Principal } from "./principal.ts";
import type {
  PlacementRoute,
  SessionRunnerStanding,
} from "../contract/rosters.ts";
import { placementRouteGranted } from "./placementRoute.ts";
import {
  ProjectAccessUnavailable,
  type ProjectAccess,
} from "./projectAccess.ts";
import type { Partition } from "./projectStore.ts";
import { sessionRunnerServes } from "./sessionPlacement.ts";
import {
  threadWakeDocument,
  threadWakeText,
  type ThreadJobWakeReason,
  type ThreadTicketWakeReason,
} from "./thread.ts";

/** One change row and the thread it wakes: the open thread its ticket's draft was filed from. */
export interface ThreadWakeCandidate {
  readonly sequence: number;
  readonly partition: Partition;
  readonly reason: ThreadTicketWakeReason;
  readonly resource: string;
  readonly principal: Principal;
  readonly session: SessionId;
  /** Where the thread's turns run as the page was read, which decides whether the wake needs the hosted grant. */
  readonly route: PlacementRoute;
  /** Whether the member has a chat host, which a wake on a runner route needs. */
  readonly runner: SessionRunnerStanding;
  /**
   * The project's own standing rules, absent where it takes the default. It
   * rides on the candidate because the pass composes a document that restates
   * them and a read inside the pass would be an await in the middle of it.
   */
  readonly standingRules?: string;
}

/**
 * What one wake offered a member's mailbox. Two arms are a turn — the second
 * being the replay the derived identity makes possible — and the rest are a
 * mailbox there was no turn to put in.
 */
export type ThreadWakeOffered =
  | { readonly woken: "Woken" | "AlreadyWoken"; readonly ordinal: number }
  | { readonly woken: "NoThread" | "Closed" | "Backlogged" };

/**
 * The durable side of one pass. `candidates` answers in sequence order and
 * within the limit it was given; `advance` answers the sequence the cursor
 * holds afterwards, which is what lets the pass assert it moved.
 */
export interface ThreadWakeStore {
  cursor(): Promise<number>;
  candidates(
    after: number,
    limit: number,
  ): Promise<readonly ThreadWakeCandidate[]>;
  wake(input: {
    readonly partition: Partition;
    readonly session: SessionId;
    readonly turn: SessionTurnId;
    readonly input: string;
    /** The route the wake was admitted on, which it keeps whatever the thread's route becomes. */
    readonly route: PlacementRoute;
  }): Promise<ThreadWakeOffered>;
  advance(sequence: number): Promise<number>;
}

export interface ThreadWakeService {
  readonly store: ThreadWakeStore;
  readonly access: ProjectAccess;
  readonly clock: { nowIso(): string };
  readonly wakesPerPassMax: number;
}

export interface ThreadWakeReport {
  readonly read: number;
  readonly woken: number;
  readonly skipped: number;
  readonly cursor: number;
  /**
   * The sequence whose candidates the bound could not hold, where a page held
   * one sequence and nothing else. The pass moved past it, so the members it
   * could not see were not woken for that change.
   */
  readonly truncatedAt?: number;
}

/** What every wake turn's identity opens with, so one is recognisable in a mailbox. */
export const threadWakeTurnPrefix = "thread-wake";

/**
 * The turn a candidate becomes, derived so a replayed candidate is the same
 * turn: the change sequence, which is unique in the log, and the session it
 * wakes, digested so the identity is one width whatever the session's is.
 */
export function threadWakeTurn(candidate: ThreadWakeCandidate): SessionTurnId {
  const session = createHash("sha256").update(candidate.session).digest("hex");
  return asSessionTurnId(
    `${threadWakeTurnPrefix}-${String(candidate.sequence)}-${session}`,
  );
}

/** Where a page's cursor may be moved to, or nothing where the page holds nobody. */
export function threadWakeAdvanced(
  page: readonly ThreadWakeCandidate[],
  limit: number,
): { readonly sequence: number; readonly truncatedAt?: number } | undefined {
  const sequences = page.map((candidate) => candidate.sequence);
  const highest = sequences.reduce(
    (left: number | undefined, right) =>
      left === undefined || right > left ? right : left,
    undefined,
  );
  if (highest === undefined) return undefined;
  if (page.length < limit) return { sequence: highest };
  const below = sequences
    .filter((sequence) => sequence < highest)
    .reduce((left: number | undefined, right) => {
      return left === undefined || right > left ? right : left;
    }, undefined);
  return below === undefined
    ? { sequence: highest, truncatedAt: highest }
    : { sequence: below };
}

/** Refuses a page no ordering makes a prefix of the window, which is what the cursor rests on. */
function orderedPage(
  page: readonly ThreadWakeCandidate[],
  limit: number,
): readonly ThreadWakeCandidate[] {
  if (page.length > limit)
    throw new RangeError(
      `thread wake: a page of ${String(page.length)} answers a bound of ${String(limit)}`,
    );
  for (let index = 1; index < page.length; index += 1) {
    const previous = page[index - 1];
    const current = page[index];
    if (
      previous !== undefined &&
      current !== undefined &&
      current.sequence < previous.sequence
    )
      throw new RangeError("thread wake: a page out of sequence order");
  }
  return page;
}

/** What deciding whether a thread may be woken reads of it. */
type ThreadWakeAdmission = Pick<
  ThreadWakeCandidate,
  "partition" | "principal" | "route" | "runner"
>;

/** Whether a thread's principal may still change the project and the thread's route still lets them spend a turn, or nothing where the authority could not say. */
async function threadWakeAdmitted(
  access: ProjectAccess,
  candidate: ThreadWakeAdmission,
): Promise<boolean | undefined> {
  try {
    return (
      (await access.authorize(
        candidate.principal,
        candidate.partition,
        "Mutate",
      )) !== undefined &&
      (await placementRouteGranted(
        access,
        candidate.principal,
        candidate.partition,
        candidate.route,
      )) &&
      sessionRunnerServes(candidate.route, candidate.runner)
    );
  } catch (failure) {
    if (failure instanceof ProjectAccessUnavailable) return undefined;
    throw failure;
  }
}

/** Every wake one page offers, and the first sequence the authority left undecided. */
async function threadWakesOffered(
  service: ThreadWakeService,
  page: readonly ThreadWakeCandidate[],
): Promise<{ readonly woken: number; readonly undecidedAt?: number }> {
  let woken = 0;
  let undecidedAt: number | undefined;
  for (const candidate of page) {
    const admitted = await threadWakeAdmitted(service.access, candidate);
    if (admitted === undefined) {
      undecidedAt ??= candidate.sequence;
      continue;
    }
    if (!admitted) continue;
    const offered = await service.store.wake({
      partition: candidate.partition,
      session: candidate.session,
      turn: threadWakeTurn(candidate),
      route: candidate.route,
      input: threadWakeText(
        threadWakeDocument({
          wake: candidate.reason,
          resource: candidate.resource,
          at: service.clock.nowIso(),
          ...(candidate.standingRules === undefined
            ? {}
            : { standingRules: candidate.standingRules }),
        }),
      ),
    });
    if (offered.woken === "Woken" || offered.woken === "AlreadyWoken")
      woken += 1;
  }
  return { woken, ...(undecidedAt === undefined ? {} : { undecidedAt }) };
}

/** The cursor after a move, refusing a store that answered a sequence behind the one it was given. */
async function threadWakeCursorMoved(
  service: ThreadWakeService,
  sequence: number,
): Promise<number> {
  const cursor = await service.store.advance(sequence);
  if (cursor < sequence)
    throw new Error(
      `thread wake: the cursor holds ${String(cursor)} after being moved to ${String(sequence)}`,
    );
  return cursor;
}

export async function threadWakePass(
  service: ThreadWakeService,
): Promise<ThreadWakeReport> {
  const limit = service.wakesPerPassMax;
  if (!Number.isSafeInteger(limit) || limit < 1)
    throw new RangeError(
      `thread wake: ${String(limit)} is not a bound a pass can hold`,
    );
  if (limit > threadWakesPerPassMax)
    throw new RangeError(
      `thread wake: a bound of ${String(limit)} is above the ${String(threadWakesPerPassMax)} the candidate read caps itself at`,
    );
  const started = await service.store.cursor();
  const page = orderedPage(
    await service.store.candidates(started, limit),
    limit,
  );
  if (page.length === 0)
    return { read: 0, woken: 0, skipped: 0, cursor: started };
  const { woken, undecidedAt } = await threadWakesOffered(service, page);
  const decided =
    undecidedAt === undefined
      ? page
      : page.filter((candidate) => candidate.sequence < undecidedAt);
  const advanced = threadWakeAdvanced(decided, limit);
  const cursor =
    advanced === undefined
      ? started
      : await threadWakeCursorMoved(service, advanced.sequence);
  return {
    read: page.length,
    woken,
    skipped: page.length - woken,
    cursor,
    ...(advanced?.truncatedAt === undefined
      ? {}
      : { truncatedAt: advanced.truncatedAt }),
  };
}

/**
 * A thread's live attempt on its member's chat host, as its bearer resolves
 * for a wake of its own thread: what the pass reads off a candidate, read off
 * the attempt instead.
 */
export type ThreadJobWakeView = ThreadWakeAdmission &
  Pick<ThreadWakeCandidate, "session" | "standingRules"> & {
    /** The runner standing a member's own scope is served on, which a member's own thread is judged by in place of `runner`. */
    readonly inquiryRunner: SessionRunnerStanding;
  };

/** Why a bearer offers no wake: no live attempt holds it, or the attempt is not a thread's on a chat host. */
export type ThreadJobWakeUnbound = "Fenced" | "NotChatHostThread";

/** The bearer one job wake is offered under, which the store fences on at each door. */
export interface ThreadJobWakeBearer {
  readonly secret: SessionBearerSecret;
  readonly generation: number;
}

/**
 * The durable side of a job wake. `wake` resolves the bearer again rather than
 * trusting the view, so an attempt fenced between the two is not a turn, and
 * puts the turn through the same mailbox door the pass's `wake` does.
 */
export interface ThreadJobWakeStore {
  wakeView(
    bearer: ThreadJobWakeBearer,
  ): Promise<ThreadJobWakeView | ThreadJobWakeUnbound>;
  wakeThread(
    bearer: ThreadJobWakeBearer & {
      readonly turn: SessionTurnId;
      readonly input: string;
      readonly route: PlacementRoute;
    },
  ): Promise<ThreadWakeOffered | ThreadJobWakeUnbound>;
}

export interface ThreadJobWakeService {
  readonly store: ThreadJobWakeStore;
  readonly access: ProjectAccess;
  readonly clock: { nowIso(): string };
}

/** One wake a thread's attempt offers: the reason, the job, watch or timer it is about, and the attempt's identity for the event. */
export interface ThreadJobWakeOffer {
  readonly wake: ThreadJobWakeReason;
  readonly resource: string;
  readonly event: string;
}

/**
 * What a job wake came to: what the mailbox made of it, why the bearer offers
 * none, a thread the pass would have skipped, or an authority that could not
 * say, which is the one answer worth offering again.
 */
export type ThreadJobWoken =
  | ThreadWakeOffered
  | { readonly refused: ThreadJobWakeUnbound | "NotAdmitted" }
  | { readonly refused: "AccessUnavailable" };

/** What every job wake turn's identity opens with, which no ticket wake's sequence can. */
export const threadJobWakeTurnPrefix = `${threadWakeTurnPrefix}-job`;

/**
 * The turn a job wake becomes, derived from the session and the attempt's own
 * identity for the event, so the same event offered again is the same turn.
 * Both are digested together, as a pair no separator can make ambiguous.
 */
export function threadJobWakeTurn(
  session: SessionId,
  event: string,
): SessionTurnId {
  if (event.length === 0)
    throw new RangeError("thread job wake: the event identity is empty");
  const digest = createHash("sha256")
    .update(JSON.stringify([session, event]))
    .digest("hex");
  return asSessionTurnId(`${threadJobWakeTurnPrefix}-${digest}`);
}

/**
 * The authority a job wake is asked of and what it is judged on. A member's own
 * thread is judged as a message of theirs is: on the owner's tenant grant
 * alone, on the pool, by the runner their own scope is served on.
 */
function threadJobWakeAdmission(
  access: ProjectAccess,
  view: ThreadJobWakeView,
): { readonly access: ProjectAccess; readonly admission: ThreadWakeAdmission } {
  return memberScopeReserved(view.partition)
    ? {
        access: memberChatAccess(access),
        admission: { ...view, route: "Pool", runner: view.inquiryRunner },
      }
    : { access, admission: view };
}

/**
 * Offers one wake a thread's attempt asks for its own thread, under the
 * checks the pass makes of a candidate and through the door the pass wakes
 * through: the attempt is the candidate, and its event the change.
 */
export async function threadJobWake(
  service: ThreadJobWakeService,
  bearer: ThreadJobWakeBearer,
  offer: ThreadJobWakeOffer,
): Promise<ThreadJobWoken> {
  const view = await service.store.wakeView(bearer);
  if (view === "Fenced" || view === "NotChatHostThread")
    return { refused: view };
  const { access, admission } = threadJobWakeAdmission(service.access, view);
  const admitted = await threadWakeAdmitted(access, admission);
  if (admitted === undefined) return { refused: "AccessUnavailable" };
  if (!admitted) return { refused: "NotAdmitted" };
  const woken = await service.store.wakeThread({
    ...bearer,
    turn: threadJobWakeTurn(view.session, offer.event),
    route: admission.route,
    input: threadWakeText(
      threadWakeDocument({
        wake: offer.wake,
        resource: offer.resource,
        at: service.clock.nowIso(),
        ...(view.standingRules === undefined
          ? {}
          : { standingRules: view.standingRules }),
      }),
    ),
  });
  return woken === "Fenced" || woken === "NotChatHostThread"
    ? { refused: woken }
    : woken;
}
