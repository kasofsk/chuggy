/**
 * What the thread pages draw, derived: where a thread stands, which are the
 * reader's own, what a turn is waiting for, what a wake is about, and what one
 * press of `Send` ended as.
 *
 * `mine` IS THE SERVER'S ANSWER AND NEVER THIS BROWSER'S. Nothing under
 * `ui/chuggy-ui/` names a principal, a subject or a user — the session module
 * holds two opaque tokens and decodes neither — so "my thread" is a question
 * only the API can be asked, and every derivation here reads the field it
 * answered rather than working it out.
 *
 * `Orphaned` IS A WORD THE WIRE CARRIES AND NOT ONE DERIVED HERE. `state` is
 * `threadStandings`, so an open session the project no longer admits its owner
 * to — still acting, as a person who may no longer read it — is answered as
 * itself.
 * A console that folded `state` and `owner` again would be a second account of
 * a standing the server already decided, and the two would disagree the first
 * time either moved.
 *
 * A WAKE DOCUMENT IS READ FOR ITS POINTER AND NOTHING ELSE. Its `standing` is
 * an instruction to the agent, not copy for a reader, and its raw JSON is not
 * the turn a member typed; so what is taken from it is the reason and the
 * resource, and a document those cannot be found in draws as a bare `Wake`
 * rather than as its own text. Nothing here checks the reason against a roster:
 * the roster lives in the interpreter, a reason is already a noun, and a
 * console that refused an unfamiliar one would answer a wake it could plainly
 * name with silence.
 *
 * A DOOR THAT WILL TAKE NO MORE MESSAGES ENDS THE COMPOSER WHICHEVER REFUSAL
 * IT IS, and the envelope's code is what says which. A console holding its own
 * roster of the door's refusals would answer the next one the door grows by
 * drawing nothing — so each code the wire has gets the word it belongs to and
 * anything else is drawn as the code the server sent.
 *
 * EVERY CODE THIS CONSOLE NAMES IS THE DOOR'S OWN ROSTER MEMBER.
 * `threadMessageRefusalCodes` is every code the message door emits, and both
 * things this module does with one go through it: the refusals drawn in their
 * own word are narrowed rather than compared with a literal, and the words are
 * a switch total over the roster. So a door that renamed a code stops this
 * module compiling instead of drawing it under a word it no longer means. A
 * code the roster does not carry is drawn as itself, which is what the
 * fallback is for.
 *
 * AN OPEN IS IDEMPOTENT ON A KEY THE CONSOLE MINTS, so a press sent again
 * reaches the thread the first one opened rather than a second; and a member
 * at their limit on open threads is told so in a word of its own.
 *
 * A WAIT IS NOT A REFUSAL AND A `Retryable` IS NOT ALWAYS A BACKLOG. `classify`
 * answers `Retryable` for 429 AND 503, so an outage would draw as a mailbox
 * that is full; the code is carried and drawn for the same reason it is on a
 * conflict.
 *
 * A TURN IDENTITY BELONGS TO THE TEXT AND THE IMAGES IT WAS MINTED FOR.
 * Enqueuing is idempotent on the turn, so re-pressing after a mailbox said
 * `Backlogged` must reuse the identity or risk a second copy of one message;
 * and posting EDITED text, or another set of images, under a retained identity
 * would answer the ordinal the first message already has, so the reader would
 * be told their correction landed when the mailbox still holds what they
 * corrected.
 *
 * AN IMAGE IS A REASON A SEND IS REFUSED, AND SAID AS ONE. An upload the
 * artifact route refused, an image the message door says is not the
 * project's, and a store neither could ask are each drawn in the words of the
 * image, so a reader is not left to guess which of the message's parts it was.
 */

import { z } from "zod";

import {
  identitySchema,
  threadBacklogMax,
} from "../../../../src/contract/http.ts";
import type {
  ThreadEntryResponse,
  ThreadMessageAccepted,
  ThreadResponse,
  ThreadTurnResponse,
  ThreadTurnStopResponse,
} from "../../../../src/contract/responses.ts";
import {
  artifactUnavailableCode,
  hostedRunsNotGrantedCode,
  projectArtifactUploadRefusalCodes,
  threadLimitReachedCode,
  threadMessageRefusalCodes,
} from "../../../../src/contract/rosters.ts";
import type {
  PlacementRoute,
  ProjectArtifactUploadRefusalCode,
  SessionRunnerStanding,
  SessionTurnInputKind,
  ThreadMessageRefusalCode,
  ThreadStanding,
} from "../../../../src/contract/rosters.ts";
import type { ApiFailure, ApiResult } from "./apiRequest.ts";
import { base64urlFromBytes } from "./base64url.ts";
import { conversationAttachmentsSame } from "./conversationAttachments.ts";
import type { ConversationAttachment } from "./conversationAttachments.ts";
import { threadHomeNamed } from "./threadHome.ts";
import type { ThreadHome } from "./threadHome.ts";
import {
  sessionRefusedNoRunner,
  sessionRunnerShort,
} from "./sessionRunners.ts";
import type { SessionRunnerShort } from "./sessionRunners.ts";

/** Whether a thread still takes messages, which is the one standing that does. */
export function threadTakesMessages(
  thread: Pick<ThreadEntryResponse, "state">,
): boolean {
  return thread.state === "Open";
}

/** Whether a thread door refused because the tenant has not granted this
 * reader hosted runs, which no retry answers. */
export function threadUnhosted(result: ApiResult<unknown>): boolean {
  return (
    result.outcome === "Rejected" && result.code === hostedRunsNotGrantedCode
  );
}

/**
 * What the reader's own thread door asks of them, as far as the reads have
 * said: where its turns run, whether the tenant grants hosted runs, and the
 * reader's own runners. Each is absent until its read answers.
 */
export interface ThreadDoor {
  readonly route: PlacementRoute | undefined;
  readonly granted: boolean | undefined;
  readonly runner: SessionRunnerStanding | undefined;
  /** How many times the placement has answered, which a failed read does not
   * move. */
  readonly reads: number;
}

/** Whether the door would refuse for the hosted grant: the grant read as not
 * given, where the route is not read as one that needs none. */
export function threadDoorUnhosted(door: ThreadDoor): boolean {
  return door.route !== "Pool" && door.granted === false;
}

/** Why the reader's runner cannot take their turn now, where the route is
 * runners' and the reader's runner has been read. */
export function threadDoorRunnerShort(
  door: ThreadDoor,
): SessionRunnerShort | undefined {
  return door.route === undefined || door.runner === undefined
    ? undefined
    : sessionRunnerShort(door.route, door.runner);
}

/** Whether a thread can still be closed, which every standing but `Closed` can:
 * an orphaned thread still acts, and is the one most worth ending. */
export function threadClosable(
  thread: Pick<ThreadEntryResponse, "state">,
): boolean {
  return thread.state !== "Closed";
}

/** A thread's own label, wherever one is drawn: its title, or `New thread`
 * before it has one. */
export function threadLabel(
  thread: Pick<ThreadEntryResponse, "title">,
): string {
  return thread.title ?? "New thread";
}

export const threadActionNames = ["Rename", "Close"] as const;
export type ThreadAction = (typeof threadActionNames)[number];

/** The actions offered on the thread the pane holds: Rename is the owner's
 * alone, Close is anyone's while the thread still stands. Empty on a
 * stranger's closed thread, which offers neither. */
export function threadActions(
  thread: Pick<ThreadEntryResponse, "mine" | "state">,
): readonly ThreadAction[] {
  return [
    ...(thread.mine ? (["Rename"] as const) : []),
    ...(threadClosable(thread) ? (["Close"] as const) : []),
  ];
}

/**
 * The word one turn's kind is drawn as, total over the wire's roster so a kind
 * it grows stops compiling here. `UserMessage` is what the mailbox calls a
 * member's own turn and `Message` is what a member calls it; the two the thread
 * door cannot produce are named rather than defaulted, because a default is how
 * a kind nobody drew reaches a reader as the wrong noun.
 */
export function threadTurnKindWord(kind: SessionTurnInputKind): string {
  switch (kind) {
    case "UserMessage":
      return "Message";
    case "Wake":
      return "Wake";
    case "Observation":
      return "Observation";
    case "Inquiry":
      return "Inquiry";
  }
}

/** Where each standing sorts: a thread that still takes messages before one
 * that no longer does. */
const threadStandingRanks: Readonly<Record<ThreadStanding, number>> = {
  Open: 0,
  Orphaned: 1,
  Closed: 2,
};

/** An instant that does not read sorts as the oldest there is. */
function threadMovedMs(thread: Pick<ThreadEntryResponse, "lastActivityAt">) {
  const at = Date.parse(thread.lastActivityAt);
  return Number.isFinite(at) ? at : Number.NEGATIVE_INFINITY;
}

/** Open threads first, then orphaned, then closed, each the most recently
 * moved first; ties keep the order the listing gave them. */
export function threadsByStanding(
  threads: readonly ThreadEntryResponse[],
): readonly ThreadEntryResponse[] {
  return threads.toSorted(
    (a, b) =>
      threadStandingRanks[a.state] - threadStandingRanks[b.state] ||
      threadMovedMs(b) - threadMovedMs(a),
  );
}

/** Whether the thread's newest turn is one the mailbox has not settled, which
 * is the only time its session is writing anything a reader could hear. */
export function threadWriting(thread: Pick<ThreadResponse, "turns">): boolean {
  const newest = thread.turns.reduce<ThreadTurnResponse | undefined>(
    (latest, turn) =>
      latest === undefined || turn.ordinal > latest.ordinal ? turn : latest,
    undefined,
  );
  return newest?.state === "Queued" || newest?.state === "Claimed";
}

/** Whether the thread has a turn the mailbox settled, which is when a store it
 * does not name is one that is missing rather than one not written yet. A turn
 * a member stopped, held or still waiting, may have stored nothing, so it is
 * no sign of one. */
export function threadStoreDue(thread: Pick<ThreadResponse, "turns">): boolean {
  return thread.turns.some(
    (turn) =>
      turn.state !== "Queued" &&
      turn.state !== "Claimed" &&
      turn.failure !== "TurnStopped" &&
      turn.failure !== "TurnStoppedQueued",
  );
}

/**
 * The two fields a wake document is drawn from. Unknown keys are dropped rather
 * than refused, so a document carrying more than this reads as the notice it is.
 */
const threadWakeDrawnSchema = z.object({
  wake: identitySchema,
  resource: identitySchema,
});

/** What one wake is about, and nothing where the input is not one. */
export interface ThreadWakeDrawn {
  readonly wake: string;
  readonly resource: string;
}

export function threadWakeDrawn(input: string): ThreadWakeDrawn | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(input);
  } catch {
    return undefined;
  }
  const read = threadWakeDrawnSchema.safeParse(parsed);
  return read.success ? read.data : undefined;
}

/** How much entropy a thread turn identity is drawn with, which is what the
 * mailbox dedupes on and so what a retried post is safe by. */
export const threadTurnIdBytesCount = 16;

/** One minted turn identity, prefixed so a mailbox row says what door it came
 * through without anything having to join to find out. */
export function threadTurnMinted(bytes: Uint8Array): string {
  return `thread-turn-${base64urlFromBytes(bytes)}`;
}

/** How much entropy a thread's open key is drawn with, which is what a
 * retried open is answered the same thread by. */
export const threadOpenKeyBytesCount = 16;

/** One minted open key, prefixed as a turn identity is and spelled in the
 * characters the door takes a key in. */
export function threadOpenKeyMinted(bytes: Uint8Array): string {
  return `thread-open-${base64urlFromBytes(bytes)}`;
}

/** Whether an open was refused because the reader holds as many open threads
 * in the project as their limit allows. */
export function threadOpenAtLimit(result: ApiResult<unknown>): boolean {
  return (
    result.outcome === "Conflict" && result.code === threadLimitReachedCode
  );
}

/** The word an open refused at the reader's limit is drawn as. */
export const threadLimitWord = "Thread limit reached";

/** What a press sent: the text, and the images attached to it. */
export interface ThreadPressed {
  readonly text: string;
  readonly attached: readonly ConversationAttachment[];
}

/** The turn a press posts under: the one the last press minted where the text
 * and the images are unchanged, and nothing — so the caller mints — where
 * either is not. */
export function threadTurnRetained(
  held: (ThreadPressed & { readonly turn: string }) | undefined,
  pressed: ThreadPressed,
): string | undefined {
  return held !== undefined &&
    held.text === pressed.text &&
    conversationAttachmentsSame(held.attached, pressed.attached)
    ? held.turn
    : undefined;
}

/** A message this page sent, under the turn identity it minted for it, held
 * for as long as the mailbox read does not list that turn. */
export interface ThreadSending {
  readonly turn: string;
  readonly text: string;
}

/** A message a thread's door handed back while no box of it was drawn: its
 * text, and the turns whose images go back with it. */
export interface ThreadKept {
  readonly text: string;
  readonly turns: readonly string[];
}

/** What is kept with one more message handed back: under one kept already, a
 * blank line between, as a text no one turn sent. */
export function threadKeptWith(
  before: ThreadKept | undefined,
  kept: ThreadKept,
): ThreadKept {
  return before === undefined
    ? kept
    : {
        text: `${before.text}\n\n${kept.text}`,
        turns: [...before.turns, ...kept.turns],
      };
}

/** Whether what is kept for a thread goes because its box is read-only: the
 * thread takes nothing more. */
export function threadKeptClosed(
  record: Pick<ThreadSendRecord, "kept">,
  takes: boolean,
): boolean {
  return !takes && record.kept !== undefined;
}

/**
 * What a tab holds of one composer's presses, wherever it is drawn: a thread's
 * by its session, and a first box's, which has no session, by its home alone.
 * Images and the presses on their way are not in it; each is named by its turn.
 */
export interface ThreadSendRecord {
  readonly send: ThreadSend;
  /** The last press the door did not take, which the next press of the same
   * text and images posts under again. */
  readonly held: ThreadSending | undefined;
  readonly sending: readonly ThreadSending[];
  /** The turns a press of Stop named, less each press taken back. */
  readonly stopping: readonly string[];
  /** How many presses of Stop the door's answer took back. */
  readonly takenBack: number;
  readonly kept: ThreadKept | undefined;
  /** How many presses have not ended. */
  readonly pressesOut: number;
  /** A first box's open key, held from its first open until its message is
   * taken. */
  readonly openKey: string | undefined;
  /** The thread a first box's open answered, until its message is taken. */
  readonly opened: string | undefined;
}

export type ThreadSendRecords = Readonly<Record<string, ThreadSendRecord>>;

export const threadSendRecordEmpty: ThreadSendRecord = {
  send: { send: "Idle" },
  held: undefined,
  sending: [],
  stopping: [],
  takenBack: 0,
  kept: undefined,
  pressesOut: 0,
  openKey: undefined,
  opened: undefined,
};

/** What one composer's record is filed under: its home as `threadHomeNamed`
 * names it, and its session, which a first box has none of. */
export function threadSendRecordName(
  home: ThreadHome,
  session: string | undefined,
): string {
  return JSON.stringify([threadHomeNamed(home), session ?? null]);
}

export function threadSendRecordOf(
  records: ThreadSendRecords,
  name: string,
): ThreadSendRecord {
  return records[name] ?? threadSendRecordEmpty;
}

/** The records with one written. */
export function threadSendRecordWith(
  records: ThreadSendRecords,
  name: string,
  next: (record: ThreadSendRecord) => ThreadSendRecord,
): ThreadSendRecords {
  return { ...records, [name]: next(threadSendRecordOf(records, name)) };
}

/** A press began: drawn from now under its turn, and out until it ends. */
export function threadSendBegan(
  record: ThreadSendRecord,
  sent: ThreadSending,
): ThreadSendRecord {
  return {
    ...record,
    send: { send: "Sending" },
    sending: threadSendingWith(record.sending, sent),
    pressesOut: record.pressesOut + 1,
  };
}

/** A first box's open answered with its thread. */
export function threadSendOpened(
  record: ThreadSendRecord,
  session: string,
): ThreadSendRecord {
  return { ...record, opened: session };
}

/**
 * A press ended as the door answered it. One the door took is held no longer,
 * and spends a first box's key and thread; one it did not take is held for the
 * next press and drawn no longer, since its text goes back, and where no box
 * that pressed is drawn the text is kept for the next box of the thread, under
 * any kept before it.
 */
export function threadSendEnded(
  record: ThreadSendRecord,
  ended: {
    readonly sent: ThreadSending;
    readonly send: ThreadSend;
    readonly away: boolean;
  },
): ThreadSendRecord {
  const { sent, send } = ended;
  const out = { ...record, send, pressesOut: record.pressesOut - 1 };
  if (send.send === "Sent")
    return { ...out, held: undefined, openKey: undefined, opened: undefined };
  const unsent = {
    ...out,
    held: sent,
    sending: threadSendingWithout(record.sending, [sent.turn]),
  };
  if (!ended.away) return unsent;
  const kept = threadKeptWith(record.kept, {
    text: sent.text,
    turns: [sent.turn],
  });
  return {
    ...unsent,
    kept,
    held: record.kept === undefined ? sent : undefined,
  };
}

/** What a first box leaves when it goes: nothing, unless a press is still out
 * or a message is kept, so the next first box starts clean. */
export function threadSendFirstLeft(
  record: ThreadSendRecord,
): ThreadSendRecord {
  return record.pressesOut > 0 || record.kept !== undefined
    ? record
    : threadSendRecordEmpty;
}

/** The reader moved past what the note said: an edit, or a press of Stop. */
export function threadSendIdled(record: ThreadSendRecord): ThreadSendRecord {
  return { ...record, send: { send: "Idle" } };
}

/** The messages drawn less those the mailbox read lists. */
export function threadSendListed(
  record: ThreadSendRecord,
  listed: readonly string[],
): ThreadSendRecord {
  return { ...record, sending: threadSendingWithout(record.sending, listed) };
}

/** A box holds what was kept. */
export function threadSendTaken(record: ThreadSendRecord): ThreadSendRecord {
  return { ...record, kept: undefined };
}

/** What was kept goes with what it was refused as, where `threadKeptClosed`
 * says the box would hold it read-only. */
export function threadSendClosed(record: ThreadSendRecord): ThreadSendRecord {
  return { ...record, kept: undefined, send: { send: "Idle" } };
}

/** A press of Stop: its turn reads stopped from the press. */
export function threadStopPressedOn(
  record: ThreadSendRecord,
  turn: string,
): ThreadSendRecord {
  return { ...record, stopping: threadStoppingWith(record.stopping, turn) };
}

/**
 * A press of Stop taken back: at once and uncounted where the door handed its
 * message back, and counted where the door's answer stopped nothing, a refusal
 * said as the note.
 */
export function threadStopTakenBack(
  record: ThreadSendRecord,
  turn: string,
  stop: ThreadStop | undefined,
): ThreadSendRecord {
  const stopping = threadStoppingWithout(record.stopping, turn);
  if (stop === undefined) return { ...record, stopping };
  const counted = { ...record, stopping, takenBack: record.takenBack + 1 };
  if (stop.stop !== "Refused") return counted;
  const cause = stop.cause === undefined ? {} : { cause: stop.cause };
  return {
    ...counted,
    send: { send: "Refused", what: "Stop", turn, ...cause },
  };
}

/** Every turn the records name, whose images are held for them. */
export function threadSendTurnsNamed(
  records: ThreadSendRecords,
): ReadonlySet<string> {
  return new Set(
    Object.values(records).flatMap((record) => [
      ...(record.held === undefined ? [] : [record.held.turn]),
      ...(record.kept?.turns ?? []),
    ]),
  );
}

/** The send drawn: a stop's refusal goes once the read lists its turn ended,
 * since nothing is left to stop. */
export function threadSendShown(
  send: ThreadSend,
  ended: readonly string[],
): ThreadSend {
  return send.send === "Refused" &&
    send.what === "Stop" &&
    ended.includes(send.turn)
    ? { send: "Idle" }
    : send;
}

/** The messages sent with one more, last. A page holds no more of them than
 * the mailbox takes turns, and a press past that is drawn when the mailbox
 * lists it. */
export function threadSendingWith(
  sending: readonly ThreadSending[],
  sent: ThreadSending,
): readonly ThreadSending[] {
  const others = sending.filter((held) => held.turn !== sent.turn);
  return others.length >= threadBacklogMax ? sending : [...others, sent];
}

/** The messages sent less those of the turns named, and the same list where
 * it holds none of them. */
export function threadSendingWithout(
  sending: readonly ThreadSending[],
  turns: readonly string[],
): readonly ThreadSending[] {
  const left = sending.filter((held) => !turns.includes(held.turn));
  return left.length === sending.length ? sending : left;
}

/** The turns a press of Stop named, with one more. A page holds no more of
 * them than the mailbox takes turns, the oldest leaving past that. */
export function threadStoppingWith(
  stopping: readonly string[],
  turn: string,
): readonly string[] {
  if (stopping.includes(turn)) return stopping;
  return [...stopping, turn].slice(-threadBacklogMax);
}

/** The turns a press of Stop named less `turn`, and the same list where it
 * does not hold that one. */
export function threadStoppingWithout(
  stopping: readonly string[],
  turn: string,
): readonly string[] {
  return stopping.includes(turn)
    ? stopping.filter((held) => held !== turn)
    : stopping;
}

/** The turns the mailbox read lists as ended, however each ended. */
export function threadTurnsEnded(
  thread: Pick<ThreadResponse, "turns">,
): readonly string[] {
  return thread.turns.flatMap((turn) =>
    turn.state === "Queued" || turn.state === "Claimed" ? [] : [turn.turn],
  );
}

/** The word for what a member can do something about in a failed request,
 * which no code the API answers with is. */
export function threadRefusalCause(failure: ApiFailure): string | undefined {
  if (failure.outcome === "Unauthenticated") return "Signed out";
  return failure.outcome === "Unreachable" ? "Unreachable" : undefined;
}

/** A press a door refused: the send, or the stop of one turn, with the word
 * for its cause where a member can act on one. */
export type ThreadRefused =
  | { readonly what: "Send"; readonly cause?: string }
  | { readonly what: "Stop"; readonly turn: string; readonly cause?: string };

/** The one line a refusal is said in: what was not done, and its cause where
 * a member can act on it. */
export function threadRefusalLine(refused: ThreadRefused): string {
  const said = refused.what === "Send" ? "Not sent" : "Not stopped";
  return refused.cause === undefined ? said : `${said} · ${refused.cause}`;
}

/** What one press of Stop came to: this press ended the turn, the turn had
 * ended by itself, or it is still out. */
export type ThreadStop =
  | { readonly stop: "Ended" }
  | { readonly stop: "AlreadyEnded" }
  | { readonly stop: "Refused"; readonly cause?: string };

/**
 * One stop, classified. The turn is ended where this press ended it and where
 * its thread was closed under it, which ends every turn of it; a turn that had
 * ended was stopped by nothing; anything else leaves it out and is one refusal.
 */
export function threadStopFrom(
  result: ApiResult<ThreadTurnStopResponse>,
): ThreadStop {
  if (result.outcome === "Ok")
    return {
      stop: result.value.stopped === "Stopped" ? "Ended" : "AlreadyEnded",
    };
  const closed =
    result.outcome === "Conflict" &&
    threadRefusalCode(result.code) === "ThreadClosed";
  if (closed) return { stop: "Ended" };
  const cause = threadRefusalCause(result);
  return { stop: "Refused", ...(cause === undefined ? {} : { cause }) };
}

/** Where one press of `Send` got to, or before one, what its door would answer. */
export type ThreadSend =
  | { readonly send: "Idle" }
  | { readonly send: "Sending" }
  | { readonly send: "Sent"; readonly ordinal: number }
  | { readonly send: "Waiting"; readonly why: string }
  | { readonly send: "Ended"; readonly why: string }
  /** The tenant does not grant the reader hosted runs, so this thread takes
   * nothing from them; a refusal counts the placement reads before it. */
  | { readonly send: "Unhosted"; readonly readsAt?: number }
  /** The thread's turns go to runners and the reader has registered none. */
  | { readonly send: "NoRunner" }
  /** The reader's runner has not polled lately, so a turn waits for it. */
  | { readonly send: "RunnerOffline" }
  | ({ readonly send: "Refused" } & ThreadRefused);

/**
 * What a composer reports: a press's own answer where it has one to say, and
 * otherwise what its door would answer, so a member is told before they type
 * rather than after they send — `Unhosted` before any press, on a thread that
 * takes messages where the door asks a grant the read says is not given, and
 * the reader's runner where the turns go to runners and it cannot take one now.
 * A press's `Unhosted` gives way to a placement read after it that says
 * runners, which ask no grant, and never to the read it was refused over.
 */
export function threadSendStanding(
  send: ThreadSend,
  takes: boolean,
  door: ThreadDoor,
): ThreadSend {
  if (!takes) return send;
  const pressed: ThreadSend =
    send.send === "Unhosted" &&
    door.route === "Pool" &&
    (send.readsAt === undefined || door.reads > send.readsAt)
      ? { send: "Idle" }
      : send;
  if (pressed.send === "Idle" && threadDoorUnhosted(door))
    return { send: "Unhosted" };
  const short = threadDoorRunnerShort(door);
  return short !== undefined &&
    (pressed.send === "Idle" || pressed.send === "Sent")
    ? { send: short }
    : pressed;
}

/** Whether a queued turn of the reader's own thread waits on a runner that
 * cannot take it now, rather than on its turn to run. */
export function threadTurnsWait(door: ThreadDoor): boolean {
  return threadDoorRunnerShort(door) !== undefined;
}

/**
 * The refusal the door's own roster carries, and nothing where a code came back
 * that it does not — a code this console reports rather than acts on or names.
 */
export function threadRefusalCode(
  code: string,
): ThreadMessageRefusalCode | undefined {
  return threadMessageRefusalCodes.find((known) => known === code);
}

/** The word one code the roster carries is drawn as, total over it so a code
 * the roster renames or grows stops compiling here. */
function threadRosterWord(code: ThreadMessageRefusalCode): string {
  switch (code) {
    case "NotYourThread":
      return "Elsewhere";
    case "ThreadClosed":
      return "Closed";
    case "ThreadBacklogged":
      return "Backlogged";
    case "ThreadTurnTooLarge":
      return "Oversize";
    case "ThreadImageUnknown":
      return "Image missing";
  }
}

/** The word a refusal is drawn as: the roster's own, or the code the server sent
 * where the roster does not carry it. */
export function threadRefusalWord(code: string): string {
  const known = threadRefusalCode(code);
  return known === undefined ? code : threadRosterWord(known);
}

/** Whether a rejected send is drawn in its code's word: another member's
 * thread, and an image the project does not hold. */
function threadRefusalSaid(code: string): boolean {
  const known = threadRefusalCode(code);
  return known === "NotYourThread" || known === "ThreadImageUnknown";
}

/** A send a door refused, with the word for its cause where there is one. */
export function threadSendRefused(
  cause?: string,
): ThreadSend & { readonly send: "Refused" } {
  return {
    send: "Refused",
    what: "Send",
    ...(cause === undefined ? {} : { cause }),
  };
}

/** The word for a store that could not say whether an image is the
 * project's, or take one. */
const threadImagesUnavailable = "Images unavailable";

/** The word one refusal of the upload's own is drawn as, total over its
 * roster. */
function threadUploadRosterWord(
  code: ProjectArtifactUploadRefusalCode,
): string {
  switch (code) {
    case "ArtifactTooLarge":
      return "Image too large";
    case "UnsupportedMediaType":
      return "Image type refused";
  }
}

/**
 * An upload that failed, as the send it leaves unsent: the upload's own
 * refusal in its word, a store that could not take it as unavailable, a cause
 * a member can act on as that, and anything else as an image not uploaded.
 */
export function threadUploadRefused(
  failure: ApiFailure,
): ThreadSend & { readonly send: "Refused" } {
  const known =
    failure.outcome === "Rejected"
      ? projectArtifactUploadRefusalCodes.find((code) => code === failure.code)
      : undefined;
  if (known !== undefined)
    return threadSendRefused(threadUploadRosterWord(known));
  if (
    failure.outcome === "Retryable" &&
    failure.code === artifactUnavailableCode
  )
    return threadSendRefused(threadImagesUnavailable);
  return threadSendRefused(threadRefusalCause(failure) ?? "Image not uploaded");
}

/**
 * One post, classified. A wait and an ended thread are each drawn as the word
 * the door's own code names, and neither is a fault the reader can press
 * through; everything else is one refusal.
 */
export function threadSendFrom(
  result: ApiResult<ThreadMessageAccepted>,
): ThreadSend {
  switch (result.outcome) {
    case "Ok":
      return { send: "Sent", ordinal: result.value.ordinal };
    case "Retryable":
      return {
        send: "Waiting",
        why:
          result.code === artifactUnavailableCode
            ? threadImagesUnavailable
            : threadRefusalWord(result.code),
      };
    case "Conflict":
      return { send: "Ended", why: threadRefusalWord(result.code) };
    case "Rejected":
      if (threadUnhosted(result)) return { send: "Unhosted" };
      if (sessionRefusedNoRunner(result)) return { send: "NoRunner" };
      return threadRefusalSaid(result.code)
        ? threadSendRefused(threadRefusalWord(result.code))
        : threadSendRefused(threadRefusalCause(result));
    case "Absent":
    case "Unauthenticated":
    case "Fault":
    case "Unreachable":
    case "Unreadable":
      return threadSendRefused(threadRefusalCause(result));
  }
}
