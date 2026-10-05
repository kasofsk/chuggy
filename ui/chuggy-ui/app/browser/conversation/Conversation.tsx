/**
 * The console's one conversation surface: exchanges drawn as a thread, and a
 * composer where the page hands one in.
 *
 * IT REACHES NO API AND NO ROUTER. Everything it draws arrives as props and
 * everything it sends leaves through `onSend`, so it mounts in a suite with
 * `render()` and no provider, and the three pages that adopt it keep their own
 * reads.
 *
 * THE MAILBOX IS THE QUEUE. Without a queue adapter the library refuses a send
 * while a turn is pending; the mailbox already queues, so the adapter holds no
 * items of its own and both lanes post.
 *
 * NOTHING HERE STACKS WITH A GRID. Every stack is a column flex, whose
 * automatic minimum size falls on the block axis: a report holding a wide table
 * overflows its own box and the column keeps the width its container gave it. A
 * grid track sized `auto` does the opposite — it grows to its content's
 * min-content width — so one such track above the text pushes the whole thread
 * past the pane holding it.
 *
 * AN EXCHANGE THAT DID NOT CHANGE IS NOT DRAWN AGAIN. The library keeps what it
 * made of a message for as long as it is handed the same one, so each
 * exchange's two messages are made once and a page redrawing one exchange a
 * frame redraws that one.
 *
 * ONE THING MOVES WHILE A TURN IS OUT, and `conversationIndicator` says where:
 * in that turn's own exchange, and at the foot of the column for a send no
 * exchange stands for yet. A turn heard to end is out no longer, whatever the
 * mailbox still says of it, and nothing moves for it.
 *
 * THE TURN THAT MOVES IS THE ONE STOP ENDS. Where the page takes a stop the
 * composer's button is Stop for as long as a turn is the thing moving, and one
 * press hands the page that turn through the library's own cancel.
 *
 * ONE PRESS STOPS ONE TURN. The button stays under the pointer and can be Stop
 * again at once, aimed at the turn behind, so a press that follows one of Stop
 * within a beat is taken for the same press and does nothing, and so is a
 * second Stop until the page's door has answered the first. The button is
 * drawn as taking no press for exactly as long as it takes none.
 *
 * A CLICK THAT SENDS BEGINS THE SAME BEAT. The button it leaves under the
 * pointer is Stop for the message just sent, and the second click of a double
 * click would end it.
 *
 * A MESSAGE HANDED BACK IS PUT BACK. The words the page could not take go back
 * in the box ahead of anything typed since, a blank line between, so neither
 * is lost, and a second handed back goes under the first.
 *
 * NOTHING STANDS BETWEEN THE COLUMN AND THE COMPOSER BUT WHAT A READER NEEDS
 * THERE. The engine runs where the answer is about to be and not on a strip of
 * its own, so the column ends where the composer begins.
 *
 * A READER WHO HAS SCROLLED AWAY IS OFFERED THE WAY BACK, on a band of its own
 * under the column, which is there only while they are away from its foot and
 * so never stands over a line of text. The library keeps the column pinned to
 * its foot only while the reader is at it, and its own control returns them
 * there and pins it again.
 *
 * HOW WIDE THE COLUMN IS AND HOW LARGE ITS TEXT ARE THE MOUNT'S TO SAY, through
 * the custom properties `conversation.css` reads, so a pane that gives the
 * conversation the whole frame sets it as a column to read and this file knows
 * nothing of where it is mounted.
 */

import {
  AssistantRuntimeProvider,
  ThreadPrimitive,
  useExternalStoreRuntime,
  useThreadViewport,
} from "@assistant-ui/react";
import type {
  AppendMessage,
  AssistantRuntime,
  ExternalThreadQueueAdapter,
  MessageState,
  MessageStatus,
  ThreadMessageLike,
} from "@assistant-ui/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";

import {
  conversationExchangeNamed,
  conversationExchangeParts,
  conversationIndicatedNamed,
  conversationIndicator,
  conversationBoxRestored,
  conversationTurnStoppable,
} from "../../core/conversation.ts";
import type { ConversationExchange } from "../../core/conversation.ts";
import type { RunPrompt } from "../../core/runConfiguration.ts";
import { ConversationComposer } from "./ConversationComposer.tsx";
import type {
  ConversationComposerButton,
  ConversationComposerProps,
} from "./ConversationComposer.tsx";
import {
  ConversationAnswerMessage,
  ConversationAskMessage,
  ConversationIndicated,
  ConversationLettingHeld,
  ConversationPaced,
  ConversationWorkOpen,
} from "./ConversationExchange.tsx";
import {
  ConversationEarlier,
  ConversationPrompt,
} from "./ConversationPrompt.tsx";
import type { ConversationEarlierProps } from "./ConversationPrompt.tsx";
import { ConversationWaiting } from "./ConversationWaiting.tsx";
import { Notice } from "../ui/Notice.tsx";

export type {
  ConversationComposerProps,
  ConversationSent,
} from "./ConversationComposer.tsx";
export type { ConversationEarlierProps } from "./ConversationPrompt.tsx";

function conversationStatus(exchange: ConversationExchange): MessageStatus {
  const standing = exchange.standing;
  switch (standing.standing) {
    case "Running":
      return { type: "running" };
    case "Answered":
      return { type: "complete", reason: "stop" };
    case "Failed":
      return {
        type: "incomplete",
        reason: "error",
        error: standing.failure ?? null,
      };
    case "Abandoned":
    case "Stopped":
      return { type: "incomplete", reason: "cancelled" };
    case "Open":
    case "Markers":
      return { type: "incomplete", reason: "other" };
  }
}

/**
 * One exchange as the two messages the library holds a turn as: the ask, and
 * the answer it is still waiting for or already has, which holds each text of
 * the answer in the order it was written. They are named as the exchange is,
 * because the library begins a message again when its name changes.
 */
function conversationExchangeMessages(
  exchange: ConversationExchange,
): readonly ThreadMessageLike[] {
  const named = conversationExchangeNamed(exchange);
  return [
    {
      id: `${named}-ask`,
      role: exchange.ask?.ask === "Message" ? "user" : "system",
      content: [
        {
          type: "text",
          text: exchange.ask?.ask === "Message" ? exchange.ask.text : "",
        },
      ],
      metadata: { custom: { exchange, side: "Ask" } },
    },
    {
      id: `${named}-answer`,
      role: "assistant",
      content: conversationExchangeParts(exchange).flatMap((part) =>
        part.part === "Text"
          ? [{ type: "text" as const, text: part.text }]
          : [],
      ),
      status: conversationStatus(exchange),
      metadata: { custom: { exchange, side: "Answer" } },
    },
  ];
}

const conversationMessagesMade = new WeakMap<
  ConversationExchange,
  readonly ThreadMessageLike[]
>();

function conversationMessages(
  exchanges: readonly ConversationExchange[],
): readonly ThreadMessageLike[] {
  return exchanges.flatMap((exchange) => {
    const made =
      conversationMessagesMade.get(exchange) ??
      conversationExchangeMessages(exchange);
    conversationMessagesMade.set(exchange, made);
    return made;
  });
}

function conversationMessageKept(
  message: ThreadMessageLike,
): ThreadMessageLike {
  return message;
}

/** Whether any exchange is still being worked, which is what the library's own
 * affordances watch. */
function conversationRunning(
  exchanges: readonly ConversationExchange[],
): boolean {
  return exchanges.some((exchange) => exchange.standing.standing === "Running");
}

function conversationAppendedText(message: AppendMessage): string {
  return message.content
    .flatMap((part) => (part.type === "text" ? [part.text] : []))
    .join("");
}

/** How long after a press of Stop, or a click that sent, the composer's button
 * takes no other: the second press of a double click, and nothing a member
 * pressed after seeing what the button had become. */
export const conversationStopBeatMs = 300;

/** The last press of its button the surface took. */
interface ConversationStopPress {
  readonly atMs: number;
  answered: boolean;
}

/** What the surface holds of the presses of its button. */
interface ConversationStopBeat {
  /** Whether a press of `button` now is one to do nothing for. */
  readonly ignores: (button: ConversationComposerButton) => boolean;
  /** Whether `button` is drawn as one whose press does nothing. */
  readonly rests: (button: ConversationComposerButton) => boolean;
  /** Notes a press of Stop as taken, answered when `stop` is. */
  readonly pressed: (stop: Promise<void>) => void;
  /** Notes a click that sent, which no door answers. */
  readonly sent: () => void;
}

/** What is drawn of the last press: its beat, and a stop no door has answered. */
interface ConversationStopResting {
  readonly beat: boolean;
  readonly unanswered: boolean;
}

/** The presses the surface took of its button, and what is drawn of the last:
 * an older stop's answer changes nothing drawn of a newer press. The beat is
 * drawn as over by the clock a press is asked against, so a timer that fires
 * ahead of that clock waits out what is left of it. */
function useConversationStopBeat(): ConversationStopBeat {
  const last = useRef<ConversationStopPress | undefined>(undefined);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [resting, setResting] = useState<ConversationStopResting>({
    beat: false,
    unanswered: false,
  });
  useEffect(
    () => () => {
      clearTimeout(timer.current);
    },
    [],
  );
  const taken = useCallback((answered: boolean): ConversationStopPress => {
    const press = { atMs: performance.now(), answered };
    last.current = press;
    const over = (): void => {
      const leftMs = conversationStopBeatMs - (performance.now() - press.atMs);
      if (leftMs > 0) timer.current = setTimeout(over, leftMs);
      else setResting((was) => ({ ...was, beat: false }));
    };
    clearTimeout(timer.current);
    timer.current = setTimeout(over, conversationStopBeatMs);
    setResting({ beat: true, unanswered: !answered });
    return press;
  }, []);
  const ignores = useCallback((button: ConversationComposerButton) => {
    const press = last.current;
    if (press === undefined) return false;
    if (performance.now() - press.atMs < conversationStopBeatMs) return true;
    return button === "Stop" && !press.answered;
  }, []);
  const pressed = useCallback(
    (stop: Promise<void>) => {
      const press = taken(false);
      const answered = (): void => {
        press.answered = true;
        if (last.current === press)
          setResting((was) => ({ ...was, unanswered: false }));
      };
      stop.then(answered, answered);
    },
    [taken],
  );
  const sent = useCallback(() => {
    taken(true);
  }, [taken]);
  return useMemo(
    () => ({
      ignores,
      rests: (button) =>
        resting.beat || (button === "Stop" && resting.unanswered),
      pressed,
      sent,
    }),
    [ignores, pressed, sent, resting],
  );
}

function useConversationRuntime(props: {
  readonly exchanges: readonly ConversationExchange[];
  readonly composer: ConversationComposerProps | undefined;
  /** The turn a press of Stop ends, where there is one. */
  readonly stoppable: string | undefined;
  readonly beat: ConversationStopBeat;
  /** Told whether a send is on its way, as one begins and as it ends. */
  readonly onSending: (sending: boolean) => void;
}): AssistantRuntime {
  const setSending = props.onSending;
  const dispatchRef = useRef<(message: AppendMessage) => Promise<void>>(() =>
    Promise.resolve(),
  );
  const restoreRef = useRef<(text: string) => void>(() => undefined);
  const queue = useMemo<ExternalThreadQueueAdapter>(
    () => ({
      items: [],
      steerItems: [],
      enqueue: (message) => void dispatchRef.current(message),
      steer: (message) => void dispatchRef.current(message),
      move: () => undefined,
      edit: () => undefined,
      remove: () => undefined,
    }),
    [],
  );
  const dispatch = async (message: AppendMessage): Promise<void> => {
    const composer = props.composer;
    if (composer === undefined) return;
    const text = conversationAppendedText(message);
    setSending(true);
    const sent = await composer.onSend(text);
    setSending(false);
    if (sent === "Kept") restoreRef.current(text);
  };
  const onStop = props.composer?.onStop;
  const { stoppable, beat } = props;
  const runtime = useExternalStoreRuntime<ThreadMessageLike>({
    queue,
    messages: conversationMessages(props.exchanges),
    isRunning: conversationRunning(props.exchanges),
    isSendDisabled: props.composer === undefined || !props.composer.takes,
    convertMessage: conversationMessageKept,
    onNew: dispatch,
    ...(onStop === undefined
      ? {}
      : {
          onCancel: () => {
            if (stoppable !== undefined) beat.pressed(onStop(stoppable));
            return Promise.resolve();
          },
        }),
  });
  const led = useRef<string | undefined>(undefined);
  useEffect(() => {
    dispatchRef.current = dispatch;
    restoreRef.current = (text) => {
      const box = runtime.thread.composer;
      const restored = conversationBoxRestored(
        { text: box.getState().text, back: led.current },
        text,
      );
      led.current = restored.back;
      box.setText(restored.text);
    };
  });
  useConversationBack(props.composer?.back, restoreRef);
  return runtime;
}

/** Puts a message the page handed back while the box was not drawn into the
 * box, once for each the page hands it. */
function useConversationBack(
  back: ConversationComposerProps["back"],
  restore: { readonly current: (text: string) => void },
): void {
  const put = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (back === undefined || put.current === back.text) {
      put.current = back?.text;
      return;
    }
    put.current = back.text;
    restore.current(back.text);
    back.taken();
  });
}

function conversationMessageDrawn(value: {
  readonly message: MessageState;
}): ReactNode {
  return value.message.role === "assistant" ? (
    <ConversationAnswerMessage />
  ) : (
    <ConversationAskMessage />
  );
}

/** The way back to the newest words, on a band under the column for as long
 * as the reader is not at its foot. */
function ConversationBottom(): ReactNode {
  const atBottom = useThreadViewport((viewport) => viewport.isAtBottom);
  if (atBottom) return null;
  return (
    <div className="conversation-bottom-band">
      <ThreadPrimitive.ScrollToBottom
        className="conversation-bottom"
        aria-label="Scroll to bottom"
      >
        <svg viewBox="0 0 16 16" aria-hidden="true" className="size-3">
          <path
            d="M8 3 L8 13 M4 9 L8 13 L12 9"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </ThreadPrimitive.ScrollToBottom>
    </div>
  );
}

/** Nothing said yet: the column's own name and one line about it, held in the
 * middle of the empty space above the composer. */
function ConversationEmpty(props: {
  readonly title: string | undefined;
  readonly sentence: string;
}): ReactNode {
  return (
    <div className="flex min-h-full flex-col items-center justify-center gap-2 text-center">
      {props.title === undefined ? null : <h2>{props.title}</h2>}
      <p className="text-ink-3">{props.sentence}</p>
    </div>
  );
}

/** What the scrolling column holds: what it is still reading, what it has
 * nothing to draw, or the thread itself. A caller that worded no empty state
 * gets none, which is what a chat nobody has typed in yet wants. */
function ConversationBody(props: {
  readonly reading: boolean;
  readonly empty: boolean;
  readonly emptyTitle: string | undefined;
  readonly sentence: string | undefined;
}): ReactNode {
  if (props.reading) return <Notice tone="info" inline detail="Loading…" />;
  if (props.empty)
    return props.sentence === undefined ? null : (
      <ConversationEmpty title={props.emptyTitle} sentence={props.sentence} />
    );
  return (
    <ThreadPrimitive.Messages>
      {conversationMessageDrawn}
    </ThreadPrimitive.Messages>
  );
}

/** How every exchange under it is drawn: its work open or not, its text paced
 * or not, which of them holds the one thing that moves, whether an engine is
 * what runs for a turn nothing is drawn of, and whether text of any of them is
 * still being let out. */
function ConversationDrawn(props: {
  readonly workOpen: boolean;
  readonly paced: boolean;
  /** The name of the exchange holding the one thing that moves. */
  readonly named: string | undefined;
  readonly engine: boolean;
  readonly children: ReactNode;
}): ReactNode {
  const { named, engine } = props;
  const indicated = useMemo(() => ({ named, engine }), [named, engine]);
  return (
    <ConversationWorkOpen.Provider value={props.workOpen}>
      <ConversationPaced.Provider value={props.paced}>
        <ConversationIndicated.Provider value={indicated}>
          <ConversationLettingHeld>{props.children}</ConversationLettingHeld>
        </ConversationIndicated.Provider>
      </ConversationPaced.Provider>
    </ConversationWorkOpen.Provider>
  );
}

/** What a page hands the surface to draw. */
export interface ConversationProps {
  readonly exchanges: readonly ConversationExchange[];
  readonly composer?: ConversationComposerProps;
  /** The one line a column with nothing in it says. A caller that words none
   * draws nothing at all, which is what a chat nobody has typed in yet wants:
   * the composer under it already says what to do. */
  readonly empty?: string;
  readonly emptyTitle?: string;
  /** Whether the exchanges are still being read, which the column says in
   * their place and the composer below it does not wait on. */
  readonly reading?: boolean;
  /** Whether this mount is the pane's own scroller — lead, thread and chat,
   * whose wrapper gave up its inset for it — rather than a panel that already
   * pads itself. */
  readonly pane?: boolean;
  /** What a run was handed, drawn as the first message of its thread. */
  readonly prompt?: RunPrompt;
  /** The read of earlier records a page can make, offered at the top. */
  readonly earlier?: ConversationEarlierProps;
  /** Whether each exchange's work draws open, which is how a run is read:
   * its steps are the conversation rather than the way to an answer. */
  readonly workOpen?: boolean;
  /** Whether an answer still being written is let out at an even pace, which
   * is what a page that hears its turns as they are written asks for. */
  readonly paced?: boolean;
}

/**
 * The conversation as a page holds it: a column of exchanges that scrolls, and
 * the composer beneath it. A bounded height pins the composer to the foot of
 * it, and an unbounded one — a transcript inside a panel — leaves both in
 * normal flow.
 */
export function Conversation(props: ConversationProps): ReactNode {
  const reading = props.reading === true;
  const activeExchanges = reading ? [] : props.exchanges;
  const [sending, setSending] = useState(false);
  const indicator = conversationIndicator(activeExchanges, {
    drawn: props.composer !== undefined,
    sending,
  });
  const stoppable =
    props.composer?.onStop === undefined
      ? undefined
      : conversationTurnStoppable(activeExchanges, indicator);
  const beat = useConversationStopBeat();
  const runtime = useConversationRuntime({
    exchanges: activeExchanges,
    composer: props.composer,
    stoppable,
    beat,
    onSending: setSending,
  });
  const composed = props.composer !== undefined;
  const inset = props.pane === true ? "px-4 py-4" : "";
  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <ThreadPrimitive.Root className="conversation flex h-full min-h-0 flex-col">
        <ThreadPrimitive.Viewport className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto">
          <div
            className={`conversation-column mx-auto flex w-full flex-col gap-6 ${inset}`}
          >
            {props.prompt === undefined ? null : (
              <ConversationPrompt prompt={props.prompt} />
            )}
            {props.earlier === undefined ? null : (
              <ConversationEarlier {...props.earlier} />
            )}
            <ConversationDrawn
              workOpen={props.workOpen === true}
              paced={props.paced === true}
              named={conversationIndicatedNamed(activeExchanges, indicator)}
              engine={composed}
            >
              <ConversationBody
                reading={reading}
                empty={props.exchanges.length === 0}
                emptyTitle={props.emptyTitle}
                sentence={props.empty}
              />
            </ConversationDrawn>
            {indicator.indicator === "Engine" ? <ConversationWaiting /> : null}
          </div>
        </ThreadPrimitive.Viewport>
        <ConversationBottom />
        {props.composer === undefined ? null : (
          <div
            className={`conversation-column mx-auto w-full ${props.pane === true ? "conversation-foot" : "pt-4"}`}
          >
            <ConversationComposer
              {...props.composer}
              busy={sending}
              stops={stoppable !== undefined}
              ignores={beat.ignores}
              rests={beat.rests(stoppable === undefined ? "Send" : "Stop")}
              onSendClick={beat.sent}
            />
          </div>
        )}
      </ThreadPrimitive.Root>
    </AssistantRuntimeProvider>
  );
}
