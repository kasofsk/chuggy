/**
 * One thread's page with every door a stop touches under a case's hand: the
 * store a batch at a time, the live stream a frame at a time, and each message
 * and each stop held until the case answers it. And the column as a reader is
 * shown it, read back as words.
 *
 * The store's lines are written as the runtime writes them — a member's
 * message as a string, the note of an interruption as one text block — since
 * what a stop leaves in a store is told apart by exactly that.
 */

import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { expect, vi } from "vitest";

import type {
  ThreadResponse,
  ThreadTranscriptResponse,
  ThreadTurnResponse,
} from "../../../src/contract/responses.ts";
import { moving } from "./conversationMoving.ts";
import {
  interruptionNote,
  interruptionSentence,
} from "./interruptionFixture.ts";
import { answer, settled } from "./screenHarness.tsx";
import { sessionPlacementBody } from "./sessionPlacementFixture.ts";
import { frame, streamServer } from "./streamDouble.ts";
import type { StreamOpening, StreamServer } from "./streamDouble.ts";
import { threadConversationMounted } from "./threadConversationMount.tsx";
import type { ThreadConversationMounted } from "./threadConversationMount.tsx";
import { threadStorePage } from "./threadFixture.ts";

export type StageEntry = ThreadTranscriptResponse["entries"][number];

/** One line of the store, under the uuid a case names it by. */
export function stageLine(
  uuid: string,
  type: "user" | "assistant",
  message: unknown,
): StageEntry {
  return { uuid, type, timestamp: "2026-09-02T10:00:00Z", message };
}

/** A member's message as the store holds one. */
export function stageAsked(uuid: string, text: string): StageEntry {
  return stageLine(uuid, "user", { role: "user", content: text });
}

/** One block of the assistant's message `id`. */
export function stageBlock(
  uuid: string,
  id: string,
  block: unknown,
): StageEntry {
  return stageLine(uuid, "assistant", { id, content: [block] });
}

/** Text of the assistant's message `id`. */
export function stageWrote(uuid: string, id: string, text: string): StageEntry {
  return stageBlock(uuid, id, { type: "text", text });
}

/** The note the runtime leaves where a turn was interrupted. */
export function stageInterrupted(
  uuid: string,
  sentence: string = interruptionSentence,
): StageEntry {
  return stageLine(uuid, "user", interruptionNote(sentence));
}

/** One mailbox turn as a read lists it: out, or ended as a case says. */
export function stageTurn(
  ordinal: number,
  turn: string,
  input: string,
  ended:
    | "Queued"
    | "Claimed"
    | "Stopped"
    | { readonly answer: string }
    | { readonly failure: NonNullable<ThreadTurnResponse["failure"]> },
): ThreadTurnResponse {
  const listed = { turn, ordinal, inputKind: "UserMessage", input, tools: [] };
  if (ended === "Queued" || ended === "Claimed")
    return { ...listed, inputKind: "UserMessage", state: ended };
  if (ended === "Stopped")
    return {
      ...listed,
      inputKind: "UserMessage",
      state: "Abandoned",
      failure: "TurnStopped",
    };
  if ("failure" in ended)
    return {
      ...listed,
      inputKind: "UserMessage",
      state: "Failed",
      failure: ended.failure,
    };
  return {
    ...listed,
    inputKind: "UserMessage",
    state: "Answered",
    result: ended.answer,
  };
}

/** One post held until the case answers it. */
export interface StagePost {
  readonly session: string;
  readonly turn: string;
  /** What a message said, which a stop does not carry. */
  readonly message: string | undefined;
  /** The body as it was posted. */
  readonly body: unknown;
  readonly answered: (response: Response) => void;
}

/** The doors of one stage, each as a case reads and moves it. */
export interface StageDoors {
  /** The store's batches, which a case adds to as the session flushes. */
  readonly batches: (readonly StageEntry[])[];
  readonly sends: StagePost[];
  readonly stops: StagePost[];
}

const stagePosted = /\/threads\/([^/]+)\/(?:messages|turns\/([^/]+)\/stop)$/u;

/** The reads every page under a stage makes, answered alike for all of them. */
function stageRead(url: URL, doors: StageDoors): Response | undefined {
  if (url.pathname.endsWith("/hosted-runs")) return answer({ granted: true });
  if (url.pathname.endsWith("/session-placement"))
    return answer(sessionPlacementBody({ thread: "InCluster" }));
  if (!url.pathname.endsWith("/transcript")) return undefined;
  const after = Number(url.searchParams.get("after"));
  return answer(threadStorePage(doors.batches, after));
}

/**
 * The door a stage's page asks. A message and a stop are each held until the
 * case answers; `reads` answers what a case's own page asks beside them, and
 * anything nothing answers is a resource that is not there.
 */
export function stageDoor(
  doors: StageDoors,
  reads: (
    url: URL,
    method: string,
  ) => Response | Promise<Response> | undefined = () => undefined,
): (address: string, init?: RequestInit) => Promise<Response> {
  return (address, init) => {
    const url = new URL(address, "http://console");
    const method = init?.method ?? "GET";
    const posted = method === "POST" ? stagePosted.exec(url.pathname) : null;
    if (posted === null)
      return Promise.resolve(
        reads(url, method) ??
          stageRead(url, doors) ??
          answer({ error: { code: "NotFound" } }, 404),
      );
    const body = JSON.parse(
      typeof init?.body === "string" ? init.body : "{}",
    ) as { readonly turn?: string; readonly message?: string };
    const [, session = "", stopped] = posted;
    return new Promise<Response>((answered) => {
      (stopped === undefined ? doors.sends : doors.stops).push({
        session,
        turn: stopped ?? body.turn ?? "",
        message: body.message,
        body,
        answered,
      });
    });
  };
}

/** A project stream that is open and holds. */
export const stageProjectOpening: StreamOpening = {
  status: 200,
  chunks: [frame("ready", undefined, { version: 1 })],
  hold: true,
};

/** A thread's live stream opening on a session with `held` in flight. */
export function stageLiveOpening(
  held: Record<string, unknown> = { blocks: [] },
): StreamOpening {
  return {
    status: 200,
    chunks: [frame("snapshot", undefined, { version: 1, held })],
    hold: true,
  };
}

export interface Stage extends StageDoors, ThreadConversationMounted {
  readonly server: StreamServer;
}

/** One thread's page over a store holding `store`'s batches, its live stream
 * answered by each of `liveOpenings` in turn. */
export function stageMounted(
  thread: ThreadResponse,
  store: readonly (readonly StageEntry[])[],
  liveOpenings: readonly StreamOpening[] = [stageLiveOpening()],
): Stage {
  const doors: StageDoors = { batches: [...store], sends: [], stops: [] };
  vi.stubGlobal("fetch", stageDoor(doors));
  const server = streamServer([stageProjectOpening], "token", liveOpenings);
  return { ...doors, server, ...threadConversationMounted(thread, server) };
}

/** One event of `turn` down the live stream that is open. */
export function stageHeard(stage: Stage, turn: string, event: unknown): void {
  stage.server.pushLive(frame("live", undefined, { version: 1, turn, event }));
}

/** A block of `turn`'s message beginning, and the text heard of it. */
export function stageHeardBlock(
  stage: Stage,
  turn: string,
  block: {
    readonly message: string;
    readonly index: number;
    readonly kind: string;
    readonly name?: string;
    readonly text?: string;
  },
): void {
  const { text, ...began } = block;
  stageHeard(stage, turn, { live: "Block", ...began });
  if (text === undefined) return;
  const { message, index } = block;
  stageHeard(stage, turn, { live: "Text", message, index, offset: 0, text });
}

export function stageBox(): HTMLTextAreaElement {
  return screen.getByRole<HTMLTextAreaElement>("textbox", { name: "Message" });
}

/** The composer's one button, by the word it says. */
export function stageButton(): string {
  const found = ["Stop", "Send"].filter(
    (name) => screen.queryByRole("button", { name }) !== null,
  );
  return found.join("+");
}

/** `text` typed and Enter pressed, with nothing waited on but the press. */
export async function stageSent(text: string): Promise<void> {
  fireEvent.change(stageBox(), { target: { value: text } });
  await waitFor(() => {
    expect(stageBox().value).toBe(text);
  });
  await act(async () => {
    fireEvent.keyDown(stageBox(), { key: "Enter" });
    await Promise.resolve();
  });
}

/** One press of Stop, and what the press itself queued. */
export async function stageStopped(): Promise<void> {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Stop" }));
    await Promise.resolve();
  });
}

/** A held post answered, and the page left to settle on it. */
export async function stageAnswered(
  post: StagePost | undefined,
  body: unknown,
  status = 200,
): Promise<void> {
  if (post === undefined) throw new Error("no such post was made");
  await act(async () => {
    post.answered(answer(body, status));
    await Promise.resolve();
  });
  await settled();
}

/** One answer as a reader sees it: its texts and the lines of its work in
 * order, the lines between brackets, and the word under it between
 * parentheses where one is shown. */
function stageAnswerDrawn(answered: Element): string {
  const parts = Array.from(
    answered.querySelectorAll(".run-report-bare, .conversation-work-line"),
    (part) =>
      part.classList.contains("conversation-work-line")
        ? `[${part.textContent}]`
        : part.textContent,
  );
  const word = answered.querySelector(
    '.conversation-meta p [role="status"]:not(.visually-hidden)',
  )?.textContent;
  return [...parts, ...(word ? [`(${word})`] : [])].join(" ");
}

/** The column from the top: each message a member sent after `>`, and each
 * answer as `stageAnswerDrawn` reads it. */
export function stageColumn(container: HTMLElement): readonly string[] {
  return Array.from(container.querySelectorAll("[data-message-id]"), (drawn) =>
    drawn.classList.contains("conversation-answer")
      ? stageAnswerDrawn(drawn)
      : `> ${drawn.textContent}`,
  );
}

/** What a stop must leave none of: anything moving, the ink of a failure
 * anywhere on the column, and a failure's notice on an answer. */
export function stageAlarms(container: HTMLElement): readonly string[] {
  const named = (selector: string, name: string): readonly string[] =>
    Array.from(container.querySelectorAll(selector), () => name);
  return [
    ...moving(container),
    ...named(".conversation-answer .text-tone-fail", "error ink"),
    ...named(".conversation-answer .notice", "notice"),
    ...named(".conversation-work-line .num", "seconds"),
  ];
}

/** Waits until the column reads as `expected`. */
export async function stageColumnIs(
  container: HTMLElement,
  expected: readonly string[],
): Promise<void> {
  await waitFor(() => {
    expect(stageColumn(container)).toStrictEqual(expected);
  });
}
