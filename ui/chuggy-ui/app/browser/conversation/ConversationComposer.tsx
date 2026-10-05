/**
 * The box a member types into, which knows nothing of the API: the page it is
 * mounted on owns the send, the turn identity and what a refusal means.
 *
 * A REFUSED SEND HANDS THE TEXT BACK. The composer clears at dispatch and the
 * page's answer arrives after that, so a page that could not take the message
 * says `Kept` and the characters are put back in the box the reader is still
 * looking at. A box that was not drawn when the answer came is handed them as
 * `back` when it next is.
 *
 * WHILE A TURN CAN BE STOPPED THE BUTTON IS STOP, and Enter still sends, so a
 * message typed under an answer being written queues behind it. Escape stops
 * nothing: a stop is one press of the one control that says so.
 *
 * WHAT THE PAGE SAYS OF A PRESS IS SAID OVER THE BOX. The composer is held to
 * the foot of its pane, so a line over the box takes its room from the column
 * and the box and its button stay where they are as it comes and goes.
 *
 * A PRESS THE SURFACE SAYS TO IGNORE DOES NOTHING, AND THE BUTTON SAYS SO.
 * The button is asked at each press, so one too close behind a press of Stop
 * neither stops the turn behind nor sends what is in the box, and one too
 * close behind a click that sent does not stop what it sent. For that long it
 * is drawn as a button that takes no press, and it stays one a press can
 * land on, so the pointer and the caret are where they were when it ends.
 *
 * A PRESS OF THE BUTTON LEAVES THE CARET IN THE BOX. The button turns into
 * another or goes inert under the pointer, and focus it had taken would fall
 * to the page, where what a member types next goes nowhere.
 */

import { ComposerPrimitive, useAuiState } from "@assistant-ui/react";
import type { MouseEvent, ReactNode } from "react";

import { textCodePointsCount } from "../../../../../src/contract/http.ts";
import type { ConversationMentionItem } from "../../core/conversationMention.ts";
import { ConversationMentions } from "./ConversationMentions.tsx";

import "./conversation.css";

/** Whether the page took the message, or handed it back. */
export type ConversationSent = "Sent" | "Kept";

/** What the composer's one button is at a press. */
export type ConversationComposerButton = "Stop" | "Send";

export interface ConversationComposerProps {
  /** Whether the door still takes messages, so a closed thread is not a box a
   * member types into to learn that from the refusal. */
  readonly takes: boolean;
  readonly charsMax: number;
  readonly onSend: (text: string) => Promise<ConversationSent>;
  /** Stops the turn named, on a page that can stop one, and answers once the
   * page's door has, whatever it said. */
  readonly onStop?: (turn: string) => Promise<void>;
  /** The one line the last press is reported as, worded by the page. */
  readonly note?: ReactNode;
  /** Whether a box the door takes nothing more from stays drawn, read-only,
   * because a refusal handed text back into it; the note beneath says why.
   * Otherwise such a box is `Closed` and the note. */
  readonly holds?: boolean;
  /** Called with the text when the reader changes it, so the page can drop a
   * note about a press this text has since moved past. Fired on the box's own
   * change event, not on a programmatic restore of a kept message. */
  readonly onEdit?: (text: string) => void;
  /** A message the page handed back while this box was not drawn, which goes
   * in the box as a refused send's does; `taken` is called once it has. */
  readonly back?: { readonly text: string; readonly taken: () => void };
  /** Whether this box takes the caret as it mounts, which is for a thread the
   * reader just named — one they started, or picked out of the history. A box
   * that took focus on every mount would take it from the page on the first
   * paint, which nobody asked it to. */
  readonly focusOnMount?: boolean;
  /** The tickets the `@` list offers, which the page reads and this only shows
   * — the box knows nothing of the API, and a list it fetched for itself would
   * be the box knowing. Absent where the page offers none, and the list is then
   * never opened. */
  readonly mentions?: readonly ConversationMentionItem[];
}

/** The most rows the box grows to before it scrolls itself. */
const conversationRowsMax = 8;

/** The share of the bound past which the counter appears: a member typing a
 * sentence is answering, not spending a budget. */
const conversationCounterShare = 0.8;

function ConversationSendGlyph(): ReactNode {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className="size-3">
      <path
        d="M8 13 L8 3 M4 7 L8 3 L12 7"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ConversationStopGlyph(): ReactNode {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className="size-3">
      <rect x="3" y="3" width="10" height="10" rx="2" fill="currentColor" />
    </svg>
  );
}

/** What the surface asks of the composer's button beyond what a page does. */
interface ConversationComposerSurface {
  readonly busy: boolean;
  /** Whether a turn the page can stop is the thing moving. */
  readonly stops: boolean;
  /** Whether a press of the button now is one to do nothing for. */
  readonly ignores: (button: ConversationComposerButton) => boolean;
  /** Whether the button is drawn as one whose press does nothing. */
  readonly rests: boolean;
  /** Told of a click of Send that was taken. */
  readonly onSendClick: () => void;
}

/** A press of the button takes no focus, so the caret stays in the box. */
function conversationCaretKept(event: MouseEvent<HTMLButtonElement>): void {
  event.preventDefault();
}

/** The composer's one button: Stop while a turn can be stopped, and Send. */
function ConversationComposerPressed(
  props: ConversationComposerSurface,
): ReactNode {
  const pressed =
    (button: ConversationComposerButton) =>
    (event: MouseEvent<HTMLButtonElement>): void => {
      if (props.ignores(button)) event.preventDefault();
      else if (button === "Send") props.onSendClick();
    };
  const rests = props.rests ? true : undefined;
  if (props.stops)
    return (
      <ComposerPrimitive.Cancel
        className="conversation-send"
        aria-disabled={rests}
        onMouseDown={conversationCaretKept}
        onClick={pressed("Stop")}
      >
        <span className="conversation-send-mark">
          <ConversationStopGlyph />
        </span>
        <span className="visually-hidden">Stop</span>
      </ComposerPrimitive.Cancel>
    );
  return (
    <ComposerPrimitive.Send
      className="conversation-send"
      aria-busy={props.busy}
      aria-disabled={rests}
      onMouseDown={conversationCaretKept}
      onClick={pressed("Send")}
    >
      <span className="conversation-send-mark">
        <ConversationSendGlyph />
      </span>
      <span className="visually-hidden">Send</span>
    </ComposerPrimitive.Send>
  );
}

export function ConversationComposer(
  props: ConversationComposerProps & ConversationComposerSurface,
): ReactNode {
  const written = useAuiState((state) => state.composer.text);
  const count = textCodePointsCount(written);
  if (!props.takes && props.holds !== true)
    return (
      <div className="text-ink-3 flex flex-wrap justify-center gap-3 text-center">
        <span>Closed</span>
        {props.note}
      </div>
    );
  return (
    <ComposerPrimitive.Unstable_TriggerPopoverRoot>
      <ComposerPrimitive.Root className="relative flex flex-col gap-1">
        {props.mentions === undefined ? null : (
          <ConversationMentions items={props.mentions} />
        )}
        <div className="conversation-note text-ink-3 flex flex-wrap items-baseline gap-3 text-xs">
          {props.note}
          {count < props.charsMax * conversationCounterShare ? null : (
            <span className="num ml-auto">
              {count} / {props.charsMax}
            </span>
          )}
        </div>
        <div className="conversation-field bg-surface-1 border-edge-control rounded-3 border">
          <ComposerPrimitive.Input
            className="conversation-input w-full min-w-0 flex-1 resize-none border-0"
            minRows={1}
            maxRows={conversationRowsMax}
            maxLength={props.charsMax}
            readOnly={!props.takes}
            submitMode="enter"
            cancelOnEscape={false}
            aria-label="Message"
            placeholder="Message"
            autoFocus={props.focusOnMount === true}
            onChange={
              props.onEdit === undefined
                ? undefined
                : (event) => {
                    props.onEdit?.(event.target.value);
                  }
            }
          />
          <ConversationComposerPressed
            busy={props.busy}
            stops={props.stops}
            ignores={props.ignores}
            rests={props.rests}
            onSendClick={props.onSendClick}
          />
        </div>
      </ComposerPrimitive.Root>
    </ComposerPrimitive.Unstable_TriggerPopoverRoot>
  );
}
