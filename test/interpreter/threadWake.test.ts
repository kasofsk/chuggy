/**
 * The bounded wake pass, over a store that answers the way the definers do.
 *
 * THE STORE IS A REFERENCE MAILBOX, not a set of canned answers. It holds a
 * turn list per member, refuses a turn identity it already holds with
 * `AlreadyWoken`, and refuses past its backlog — because the properties this
 * suite is about are properties of the pass ACROSS passes, and a stub that
 * forgot what it was told could not refute either the replay or the drop.
 *
 * A MAILBOX SKIP IS A RACE AND AN UNADMITTED PRINCIPAL IS NOT. `NoThread` and
 * `Closed` can only be a mailbox that changed between the read and the wake, so
 * the reference store draws them per offer; whether the project still admits a
 * principal is the authority's answer and is drawn by the reference authority
 * beside it, before any offer is made.
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  sessionIdentityCharsMax,
  threadBacklogMax,
  threadWakesPerPassMax,
} from "../../src/contract/http.ts";
import {
  asSessionId,
  type SessionId,
  type SessionTurnId,
} from "../../src/interpreter/agentSession.ts";
import {
  asPrincipal,
  type Principal,
} from "../../src/interpreter/principal.ts";
import {
  memberAuthority,
  ProjectAccessUnavailable,
  type ProjectAccess,
} from "../../src/interpreter/projectAccess.ts";
import type { Partition } from "../../src/interpreter/projectStore.ts";
import {
  allThreadWakeReasons,
  parseThreadWake,
  type ThreadWakeReason,
} from "../../src/interpreter/thread.ts";
import { threadStandingRulesDefault } from "../../src/contract/threadSeeding.ts";
import {
  threadWakeAdvanced,
  threadWakePass,
  threadWakeTurn,
  threadWakeTurnPrefix,
  type ThreadWakeCandidate,
  type ThreadWakeOffered,
  type ThreadWakeReport,
  type ThreadWakeService,
  type ThreadWakeStore,
} from "../../src/interpreter/threadWake.ts";
import { randomOf, type Random } from "../random/random.ts";

const partition = { tenant: "acme", project: "atlas" } as unknown as Partition;
const instant = "2026-09-02T12:00:00.000Z";
const clock = { nowIso: () => instant };

function member(label: string): { principal: Principal; session: SessionId } {
  return {
    principal: asPrincipal(`oidc:${label}`),
    session: asSessionId(`session-${label}`),
  };
}

function candidateAt(
  sequence: number,
  label: string,
  reason: ThreadWakeReason = "TicketRefused",
): ThreadWakeCandidate {
  const { principal, session } = member(label);
  return {
    sequence,
    partition,
    reason,
    resource: String(sequence * 10),
    principal,
    session,
  };
}

/** What one offer did to the mailbox, so a case can read the whole exchange back. */
interface WakeOffer {
  readonly session: SessionId;
  readonly turn: SessionTurnId;
  readonly input: string;
  readonly offered: ThreadWakeOffered["woken"];
}

/** How a mailbox stands when a wake reaches it, which the read cannot have known. */
type MailboxStanding = "Open" | "Closed" | "NoThread";

interface ReferenceStoreOptions {
  readonly log: readonly ThreadWakeCandidate[];
  readonly cursor?: number;
  /** How each member's mailbox stands at the moment of the offer. */
  readonly standing?: (session: SessionId) => MailboxStanding;
  readonly backlogMax?: number;
  /** Raises out of the nth offer, counted from one, so a case can crash a pass. */
  readonly raiseAtOffer?: number;
  /** Answers a page the caller did not ask for, which the pass must refuse. */
  readonly page?: (
    page: readonly ThreadWakeCandidate[],
  ) => readonly ThreadWakeCandidate[];
  /** Answers a cursor other than the one it was moved to. */
  readonly held?: (sequence: number) => number;
}

interface ReferenceStore extends ThreadWakeStore {
  readonly offers: readonly WakeOffer[];
  readonly advances: readonly number[];
  mailbox(session: SessionId): readonly SessionTurnId[];
}

/**
 * A mailbox and a change log, answering the way the definers do: the candidate
 * read is exclusive of the cursor, ordered by sequence, and capped at the limit
 * it was given; the wake door is idempotent on the turn identity.
 */
function referenceStore(options: ReferenceStoreOptions): ReferenceStore {
  const mailboxes = new Map<SessionId, SessionTurnId[]>();
  const offers: WakeOffer[] = [];
  const advances: number[] = [];
  const backlogMax = options.backlogMax ?? threadBacklogMax;
  const standing = options.standing ?? (() => "Open" as const);
  let cursor = options.cursor ?? 0;
  let raised = false;
  const store: ThreadWakeStore = {
    cursor: () => Promise.resolve(cursor),
    candidates: (after, limit) => {
      const page = options.log
        .filter((candidate) => candidate.sequence > after)
        .slice(0, limit);
      return Promise.resolve(
        options.page === undefined ? page : options.page(page),
      );
    },
    wake: (input) => {
      if (!raised && offers.length + 1 === options.raiseAtOffer) {
        raised = true;
        return Promise.reject(
          new Error("reference store: the door was unreachable"),
        );
      }
      const session =
        options.log.find((candidate) => candidate.principal === input.principal)
          ?.session ?? asSessionId("session-unknown");
      const held = standing(session);
      const answer = ((): ThreadWakeOffered => {
        if (held !== "Open") return { woken: held };
        const mailbox = mailboxes.get(session) ?? [];
        const already = mailbox.indexOf(input.turn);
        if (already >= 0)
          return { woken: "AlreadyWoken", ordinal: already + 1 };
        if (mailbox.length >= backlogMax) return { woken: "Backlogged" };
        mailboxes.set(session, [...mailbox, input.turn]);
        return { woken: "Woken", ordinal: mailbox.length + 1 };
      })();
      offers.push({
        session,
        turn: input.turn,
        input: input.input,
        offered: answer.woken,
      });
      return Promise.resolve(answer);
    },
    advance: (sequence) => {
      advances.push(sequence);
      cursor = Math.max(cursor, sequence);
      return Promise.resolve(
        options.held === undefined ? cursor : options.held(cursor),
      );
    },
  };
  return {
    ...store,
    offers,
    advances,
    mailbox: (session) => mailboxes.get(session) ?? [],
  };
}

/**
 * The project authority the pass asks, admitting every principal a case has not
 * named. It counts its refusals, because a candidate the authority turned away
 * reaches no store and a case has nowhere else to read that from.
 */
function referenceAccess(
  options: {
    readonly unadmitted?: ReadonlySet<Principal>;
    readonly undecided?: ReadonlySet<Principal>;
  } = {},
): ProjectAccess & { readonly refused: readonly Principal[] } {
  const refused: Principal[] = [];
  return {
    refused,
    authorize: (principal) => {
      if (options.undecided?.has(principal) === true)
        return Promise.reject(
          new ProjectAccessUnavailable("the authority did not answer"),
        );
      if (options.unadmitted?.has(principal) === true) {
        refused.push(principal);
        return Promise.resolve(undefined);
      }
      return Promise.resolve(memberAuthority(principal));
    },
  };
}

function serviceOf(
  store: ThreadWakeStore,
  wakesPerPassMax = threadWakesPerPassMax,
  access: ProjectAccess = referenceAccess(),
): ThreadWakeService {
  return { store, access, clock, wakesPerPassMax };
}

test("an empty page costs one bounded read, writes nothing and moves nothing", async () => {
  const store = referenceStore({ log: [], cursor: 7 });
  const report = await threadWakePass(serviceOf(store));

  assert.deepEqual(report, { read: 0, woken: 0, skipped: 0, cursor: 7 });
  assert.deepEqual(store.offers, []);
  assert.deepEqual(store.advances, []);
});

test("every reason the roster names becomes a turn whose document says so", async () => {
  const log = allThreadWakeReasons.map((reason, index) =>
    candidateAt(index + 1, `member-${reason}`, reason),
  );
  const store = referenceStore({ log });
  const report = await threadWakePass(serviceOf(store));

  assert.equal(report.read, allThreadWakeReasons.length);
  assert.equal(report.woken, allThreadWakeReasons.length);
  assert.equal(report.skipped, 0);
  assert.equal(report.cursor, allThreadWakeReasons.length);
  assert.deepEqual(
    store.offers.map((offer) => parseThreadWake(offer.input).wake),
    [...allThreadWakeReasons],
  );
  for (const [index, offer] of store.offers.entries()) {
    const document = parseThreadWake(offer.input);
    const candidate = log[index];
    assert.ok(candidate !== undefined);
    assert.equal(document.resource, candidate.resource);
    assert.equal(document.at, instant);
    assert.equal(document.standing, threadStandingRulesDefault);
  }
});

/**
 * The standing a wake restates is the project's own, and it rides on the
 * candidate rather than being read inside the pass — a read there would be an
 * await in the middle of a pure pass, which house rule 8 is about.
 */
test("a candidate carrying its project's standing is what the wake restates", async () => {
  const standingRules = "- You draft, and nothing else.";
  const store = referenceStore({
    log: [{ ...candidateAt(1, "solo"), standingRules }],
  });

  await threadWakePass(serviceOf(store));

  const offer = store.offers[0];
  assert.ok(offer !== undefined);
  assert.equal(parseThreadWake(offer.input).standing, standingRules);
});

test("the wake carries the reason and the resource and never a body", async () => {
  const store = referenceStore({ log: [candidateAt(1, "solo")] });
  await threadWakePass(serviceOf(store));

  const offer = store.offers[0];
  assert.ok(offer !== undefined);
  assert.deepEqual(Object.keys(JSON.parse(offer.input) as object).sort(), [
    "at",
    "resource",
    "standing",
    "version",
    "wake",
  ]);
});

test("the turn identity is a pure function of the sequence and the session", () => {
  const first = candidateAt(41, "one");
  assert.equal(threadWakeTurn(first), threadWakeTurn({ ...first }));
  assert.notEqual(
    threadWakeTurn(first),
    threadWakeTurn(candidateAt(42, "one")),
  );
  assert.notEqual(
    threadWakeTurn(first),
    threadWakeTurn(candidateAt(41, "two")),
  );
  assert.ok(threadWakeTurn(first).startsWith(`${threadWakeTurnPrefix}-41-`));
  assert.equal(
    threadWakeTurn({ ...first, reason: "TicketCompleted", resource: "9" }),
    threadWakeTurn(first),
    "the identity is the change row and the mailbox, not what the notice says",
  );
});

test("a session as wide as the column still derives a turn the column takes", () => {
  const widest = asSessionId("s".repeat(sessionIdentityCharsMax));
  const derived = threadWakeTurn({
    ...candidateAt(Number.MAX_SAFE_INTEGER, "wide"),
    session: widest,
  });
  assert.ok(derived.length <= sessionIdentityCharsMax);
});

test("a pass that crashed before advancing re-offers the same turn, once", async () => {
  const log = [candidateAt(1, "a"), candidateAt(2, "b"), candidateAt(3, "c")];
  const crashing = referenceStore({ log, raiseAtOffer: 3 });
  await assert.rejects(() => threadWakePass(serviceOf(crashing)));
  assert.deepEqual(crashing.advances, [], "a crashed pass moved the cursor");

  const report = await threadWakePass(serviceOf(crashing));
  assert.deepEqual(report, { read: 3, woken: 3, skipped: 0, cursor: 3 });
  assert.deepEqual(
    crashing.offers.filter((offer) => offer.offered === "AlreadyWoken").length,
    2,
    "the two turns the crashed pass had enqueued are the two it is told it holds",
  );
  for (const candidate of log)
    assert.deepEqual(crashing.mailbox(candidate.session), [
      threadWakeTurn(candidate),
    ]);
});

test("a pass that already advanced reads nothing and enqueues nothing", async () => {
  const log = [candidateAt(1, "a"), candidateAt(2, "b")];
  const store = referenceStore({ log });
  const first = await threadWakePass(serviceOf(store));
  const second = await threadWakePass(serviceOf(store));

  assert.equal(first.woken, 2);
  assert.deepEqual(second, { read: 0, woken: 0, skipped: 0, cursor: 2 });
  assert.equal(store.offers.length, 2, "an advanced cursor re-offered a wake");
});

test("each mailbox a wake cannot reach is skipped, and the pass carries on", async () => {
  for (const held of ["NoThread", "Closed"] as const) {
    const log = [candidateAt(1, "gone"), candidateAt(2, "here")];
    const store = referenceStore({
      log,
      standing: (session) =>
        session === member("gone").session ? held : "Open",
    });
    const report = await threadWakePass(serviceOf(store));

    assert.deepEqual(
      report,
      { read: 2, woken: 1, skipped: 1, cursor: 2 },
      held,
    );
    assert.deepEqual(
      store.offers.map((offer) => offer.offered),
      [held, "Woken"],
      held,
    );
    assert.deepEqual(store.mailbox(member("gone").session), [], held);
  }
});

/**
 * A thread the project no longer admits its principal to is the derivation of
 * `Orphaned`, and it is answered before the mailbox rather than by it.
 */
test("a thread whose principal is no longer admitted is skipped unoffered", async () => {
  const log = [candidateAt(1, "gone"), candidateAt(2, "here")];
  const store = referenceStore({ log });
  const access = referenceAccess({
    unadmitted: new Set([member("gone").principal]),
  });
  const report = await threadWakePass(serviceOf(store, undefined, access));

  assert.deepEqual(report, { read: 2, woken: 1, skipped: 1, cursor: 2 });
  assert.deepEqual(
    store.offers.map((offer) => offer.session),
    [member("here").session],
  );
  assert.deepEqual(access.refused, [member("gone").principal]);
});

/**
 * An authority that could not answer is neither a wake nor an orphaned thread,
 * so the cursor stops below the sequence it could not decide and the next pass
 * reads it again.
 */
test("an authority that could not answer holds the cursor below that sequence", async () => {
  const log = [candidateAt(1, "first"), candidateAt(2, "silent")];
  const store = referenceStore({ log });
  const access = referenceAccess({
    undecided: new Set([member("silent").principal]),
  });
  const report = await threadWakePass(serviceOf(store, undefined, access));

  assert.deepEqual(report, { read: 2, woken: 1, skipped: 1, cursor: 1 });
  assert.deepEqual(store.advances, [1]);
});

test("an authority that could not answer the first candidate moves nothing", async () => {
  const log = [candidateAt(1, "silent"), candidateAt(2, "second")];
  const store = referenceStore({ log });
  const access = referenceAccess({
    undecided: new Set([member("silent").principal]),
  });
  const report = await threadWakePass(serviceOf(store, undefined, access));

  assert.deepEqual(report, { read: 2, woken: 1, skipped: 1, cursor: 0 });
  assert.deepEqual(store.advances, []);
});

test("a full mailbox is skipped and the cursor still moves past the notice", async () => {
  const log = Array.from({ length: threadBacklogMax + 2 }, (_, index) =>
    candidateAt(index + 1, "loud"),
  );
  const store = referenceStore({ log });
  const report = await threadWakePass(serviceOf(store));

  assert.deepEqual(report, {
    read: log.length,
    woken: threadBacklogMax,
    skipped: log.length - threadBacklogMax,
    cursor: log.length,
  });
  assert.equal(store.mailbox(member("loud").session).length, threadBacklogMax);
  assert.deepEqual(
    store.offers.slice(threadBacklogMax).map((offer) => offer.offered),
    ["Backlogged", "Backlogged"],
  );
  const again = await threadWakePass(serviceOf(store));
  assert.deepEqual(again, {
    read: 0,
    woken: 0,
    skipped: 0,
    cursor: log.length,
  });
});

test("the cursor moves once, to the highest sequence the page read whole", async () => {
  const log = [candidateAt(4, "a"), candidateAt(9, "b"), candidateAt(11, "c")];
  const store = referenceStore({ log });
  const report = await threadWakePass(serviceOf(store));

  assert.deepEqual(store.advances, [11]);
  assert.equal(report.cursor, 11);
});

test("a page that filled its bound leaves its last sequence for the next pass", async () => {
  const log = [
    candidateAt(4, "a"),
    candidateAt(9, "b"),
    candidateAt(9, "c"),
    candidateAt(9, "d"),
  ];
  const store = referenceStore({ log });
  const first = await threadWakePass(serviceOf(store, 3));

  assert.deepEqual(
    store.advances,
    [4],
    "the cursor passed a sequence it had not read whole",
  );
  assert.deepEqual(first, { read: 3, woken: 3, skipped: 0, cursor: 4 });

  const second = await threadWakePass(serviceOf(store, 3));
  assert.equal(second.cursor, 9);
  assert.deepEqual(
    store.mailbox(member("d").session),
    [threadWakeTurn(candidateAt(9, "d"))],
    "the member the first page could not hold is woken by the next pass, and a cursor that had jumped to the page's last sequence would never have offered them one",
  );
  for (const candidate of log)
    assert.deepEqual(store.mailbox(candidate.session), [
      threadWakeTurn(candidate),
    ]);
});

test("a full page of one sequence moves past it and says which one", async () => {
  const log = [candidateAt(9, "a"), candidateAt(9, "b"), candidateAt(9, "c")];
  const store = referenceStore({ log });
  const report = await threadWakePass(serviceOf(store, 2));

  assert.deepEqual(report, {
    read: 2,
    woken: 2,
    skipped: 0,
    cursor: 9,
    truncatedAt: 9,
  });
  assert.deepEqual(
    store.mailbox(member("c").session),
    [],
    "a fan-out wider than the bound is what the report names, not what it hides",
  );
  const again = await threadWakePass(serviceOf(store, 2));
  assert.deepEqual(again, { read: 0, woken: 0, skipped: 0, cursor: 9 });
});

test("a page whose last candidate raises leaves the cursor where it was", async () => {
  const log = [candidateAt(1, "a"), candidateAt(2, "b")];
  const store = referenceStore({ log, cursor: 0, raiseAtOffer: 2 });
  await assert.rejects(() => threadWakePass(serviceOf(store)));

  assert.deepEqual(store.advances, []);
  assert.equal(await store.cursor(), 0);
});

test("the pass reads its own bound and refuses a page wider than it", async () => {
  const log = Array.from({ length: 5 }, (_, index) =>
    candidateAt(index + 1, `member-${String(index)}`),
  );
  const asked: number[] = [];
  const store = referenceStore({ log });
  await threadWakePass(
    serviceOf(
      {
        ...store,
        candidates: (after, limit) => {
          asked.push(limit);
          return store.candidates(after, limit);
        },
      },
      2,
    ),
  );
  assert.deepEqual(asked, [2]);

  const over = referenceStore({ log, page: (page) => [...page, ...page] });
  await assert.rejects(
    () => threadWakePass(serviceOf(over, 2)),
    /a page of 4 answers a bound of 2/u,
  );
  assert.deepEqual(over.offers, [], "an unbounded page was acted on");
});

test("a bound above the ceiling the read caps itself at is refused, not clamped", async () => {
  const store = referenceStore({ log: [candidateAt(1, "a")] });
  await assert.rejects(
    () => threadWakePass(serviceOf(store, threadWakesPerPassMax + 1)),
    /is above the .* the candidate read caps itself at/u,
  );
  assert.deepEqual(store.offers, []);
  assert.deepEqual(store.advances, []);

  const held = referenceStore({ log: [candidateAt(1, "a")] });
  const report = await threadWakePass(serviceOf(held, threadWakesPerPassMax));
  assert.equal(report.woken, 1, "the ceiling itself is a bound a pass holds");
});

test("a bound no pass can hold is refused before anything is read", async () => {
  for (const bound of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    const store = referenceStore({ log: [candidateAt(1, "a")] });
    await assert.rejects(
      () => threadWakePass(serviceOf(store, bound)),
      /is not a bound a pass can hold/u,
      String(bound),
    );
    assert.deepEqual(store.offers, [], String(bound));
  }
});

test("a page out of sequence order is refused rather than advanced from", async () => {
  const log = [candidateAt(1, "a"), candidateAt(2, "b")];
  const store = referenceStore({
    log,
    page: (page) => [...page].reverse(),
  });
  await assert.rejects(
    () => threadWakePass(serviceOf(store)),
    /a page out of sequence order/u,
  );
  assert.deepEqual(store.advances, []);
});

test("a cursor that did not take the advance is a failure, not a report", async () => {
  const store = referenceStore({
    log: [candidateAt(5, "a")],
    held: () => 1,
  });
  await assert.rejects(
    () => threadWakePass(serviceOf(store)),
    /the cursor holds 1 after being moved to 5/u,
  );
});

test("a cursor another writer moved further ahead is the cursor the report names", async () => {
  const store = referenceStore({ log: [candidateAt(5, "a")], held: () => 9 });
  const report = await threadWakePass(serviceOf(store));
  assert.equal(report.cursor, 9);
});

test("what a page read whole is derived from the page and its bound alone", () => {
  const page = [candidateAt(2, "a"), candidateAt(5, "b"), candidateAt(5, "c")];
  assert.equal(threadWakeAdvanced([], 4), undefined);
  assert.deepEqual(threadWakeAdvanced(page, 4), { sequence: 5 });
  assert.deepEqual(threadWakeAdvanced(page, 3), { sequence: 2 });
  assert.deepEqual(threadWakeAdvanced(page.slice(1), 2), {
    sequence: 5,
    truncatedAt: 5,
  });
});

/**
 * The generative walk: random logs, random fan-out, random mailbox standings
 * and random crashes, driven pass after pass against the reference mailbox
 * above. What it refutes is the pair of properties no single case can — that
 * one candidate is never two turns, and that a cursor never passes a candidate
 * the mailbox would have taken.
 */
function walkLog(
  random: Random,
  sessions: readonly string[],
): ThreadWakeCandidate[] {
  const log: ThreadWakeCandidate[] = [];
  let sequence = 0;
  const rows = random.below(12) + 1;
  for (let row = 0; row < rows; row += 1) {
    sequence += random.below(3) + 1;
    const fanOut = random.below(3) + 1;
    const woken = new Set<string>();
    for (let one = 0; one < fanOut; one += 1) {
      const label = sessions[random.below(sessions.length)];
      if (label === undefined || woken.has(label)) continue;
      woken.add(label);
      log.push(
        candidateAt(
          sequence,
          label,
          allThreadWakeReasons[random.below(allThreadWakeReasons.length)] ??
            "TicketRefused",
        ),
      );
    }
  }
  return log.sort((left, right) => left.sequence - right.sequence);
}

/**
 * What the walk actually reached. A generative suite whose generator never
 * produced the shape it is about is green over nothing, so the walk counts what
 * it drew and the case refuses a tally with an empty class in it.
 */
interface WalkTally {
  crashed: number;
  truncated: number;
  backlogged: number;
  closed: number;
  orphaned: number;
  noThread: number;
  replayed: number;
  fullPages: number;
}

/** One pass of the walk, with a crash drawn inside it, and every per-pass invariant. */
async function walkPass(input: {
  readonly store: ReferenceStore;
  readonly access: ProjectAccess;
  readonly random: Random;
  readonly limit: number;
  readonly cursor: number;
  readonly seed: number;
  readonly tally: WalkTally;
}): Promise<ThreadWakeReport | undefined> {
  const { store, access, random, limit, cursor, seed, tally } = input;
  const crashAt = random.coin() ? random.below(limit) + 1 : undefined;
  let offered = 0;
  const running: ThreadWakeService = {
    store: {
      ...store,
      wake: (offer) => {
        offered += 1;
        if (offered === crashAt)
          return Promise.reject(new Error("walk: the door was unreachable"));
        return store.wake(offer);
      },
    },
    access,
    clock,
    wakesPerPassMax: limit,
  };
  let report: ThreadWakeReport;
  try {
    report = await threadWakePass(running);
  } catch {
    tally.crashed += 1;
    assert.equal(
      await store.cursor(),
      cursor,
      `seed ${String(seed)}: a crashed pass moved the cursor`,
    );
    return undefined;
  }
  if (report.truncatedAt !== undefined) tally.truncated += 1;
  if (report.read === limit) tally.fullPages += 1;
  assert.ok(
    report.read <= limit,
    `seed ${String(seed)}: the bound was exceeded`,
  );
  assert.equal(
    report.woken + report.skipped,
    report.read,
    `seed ${String(seed)}: a candidate was neither woken nor skipped`,
  );
  assert.ok(
    report.cursor >= cursor,
    `seed ${String(seed)}: the cursor went backwards`,
  );
  return report;
}

/** What must hold of the mailboxes once a walk has run out of passes. */
function walkSettled(input: {
  readonly store: ReferenceStore;
  readonly log: readonly ThreadWakeCandidate[];
  readonly sessions: readonly string[];
  readonly reports: readonly ThreadWakeReport[];
  readonly cursor: number;
  readonly seed: number;
  readonly unadmitted: ReadonlySet<Principal>;
}): void {
  const { store, log, sessions, reports, cursor, seed, unadmitted } = input;
  const truncated = new Set(
    reports.flatMap((report) =>
      report.truncatedAt === undefined ? [] : [report.truncatedAt],
    ),
  );
  for (const label of sessions) {
    const mailbox = store.mailbox(member(label).session);
    assert.equal(
      new Set(mailbox).size,
      mailbox.length,
      `seed ${String(seed)}: one candidate became two turns`,
    );
    for (const turn of mailbox)
      assert.ok(
        log.some((candidate) => threadWakeTurn(candidate) === turn),
        `seed ${String(seed)}: a turn no candidate derives`,
      );
  }
  for (const candidate of log) {
    if (candidate.sequence > cursor) continue;
    if (truncated.has(candidate.sequence)) continue;
    if (unadmitted.has(candidate.principal)) continue;
    const turn = threadWakeTurn(candidate);
    assert.ok(
      store.offers.some((offer) => offer.turn === turn),
      `seed ${String(seed)}: sequence ${String(candidate.sequence)} was passed unoffered`,
    );
  }
  assert.ok(
    cursor <= (log.at(-1)?.sequence ?? 0),
    `seed ${String(seed)}: the cursor passed the end of the log`,
  );
}

const walkSeeds = 200;
const walkPasses = 12;
const walkSessions = ["one", "two", "three", "four"];
/**
 * Every standing a mailbox can be in when a wake reaches it, `Open` drawn twice
 * so a walk that only ever closed threads could not be mistaken for one that
 * woke them. Whether the project admits a principal is settled for the whole
 * walk instead, because the pass holds no state about it.
 */
const walkStandings: readonly MailboxStanding[] = [
  "Open",
  "Open",
  "Closed",
  "NoThread",
];

/** What one seed's offers add to the walk's tally, so every arm is reached somewhere. */
function walkOffersTallied(
  offers: readonly { readonly offered: ThreadWakeOffered["woken"] }[],
  tally: WalkTally,
): void {
  for (const offer of offers) {
    if (offer.offered === "Backlogged") tally.backlogged += 1;
    if (offer.offered === "Closed") tally.closed += 1;
    if (offer.offered === "NoThread") tally.noThread += 1;
    if (offer.offered === "AlreadyWoken") tally.replayed += 1;
  }
}

test("a walk of passes wakes each candidate at most once and skips none silently", async () => {
  const tally: WalkTally = {
    crashed: 0,
    truncated: 0,
    backlogged: 0,
    closed: 0,
    orphaned: 0,
    noThread: 0,
    replayed: 0,
    fullPages: 0,
  };
  for (let seed = 0; seed < walkSeeds; seed += 1) {
    const random = randomOf(seed);
    const log = walkLog(random, walkSessions);
    const standings = new Map<SessionId, MailboxStanding>(
      walkSessions.map((label) => [member(label).session, "Open" as const]),
    );
    const limit = random.below(4) + 1;
    const store = referenceStore({
      log,
      backlogMax: random.below(threadBacklogMax) + 1,
      standing: (session) => standings.get(session) ?? "NoThread",
    });
    const unadmitted = new Set(
      walkSessions
        .filter(() => random.below(4) === 0)
        .map((label) => member(label).principal),
    );
    const access = referenceAccess({ unadmitted });
    const reports: ThreadWakeReport[] = [];
    let cursor = 0;
    for (let pass = 0; pass < walkPasses; pass += 1) {
      if (random.coin()) {
        const label = walkSessions[random.below(walkSessions.length)];
        const held = walkStandings[random.below(walkStandings.length)];
        if (label !== undefined && held !== undefined)
          standings.set(member(label).session, held);
      }
      const report = await walkPass({
        store,
        access,
        random,
        limit,
        cursor,
        seed,
        tally,
      });
      if (report === undefined) continue;
      reports.push(report);
      cursor = report.cursor;
    }
    walkSettled({
      store,
      log,
      sessions: walkSessions,
      reports,
      cursor,
      seed,
      unadmitted,
    });
    tally.orphaned += access.refused.length;
    walkOffersTallied(store.offers, tally);
  }
  for (const [what, count] of Object.entries(tally))
    assert.ok(count > 0, `the walk never reached ${what}`);
});
