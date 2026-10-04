/**
 * The box a member types into, which knows nothing of the API: the page it is
 * mounted on owns the send, the turn identity and what a refusal means.
 *
 * A REFUSED SEND HANDS THE TEXT BACK. The composer clears at dispatch and the
 * page's answer arrives after that, so a page that could not take the message
 * says `Kept` and the characters are put back in the box the reader is still
 * looking at.
 */

import { ComposerPrimitive, useAuiState } from "@assistant-ui/react";
import type { ReactNode } from "react";

import { textCodePointsCount } from "../../../../../src/contract/http.ts";
import type { ConversationMentionItem } from "../../core/conversationMention.ts";
import { ConversationMentions } from "./ConversationMentions.tsx";

import "./conversation.css";

/** Whether the page took the message, or handed it back. */
export type ConversationSent = "Sent" | "Kept";

export interface ConversationComposerProps {
  /** Whether the door still takes messages, so a closed thread is not a box a
   * member types into to learn that from the refusal. */
  readonly takes: boolean;
  readonly charsMax: number;
  readonly onSend: (text: string) => Promise<ConversationSent>;
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

export function ConversationComposer(
  props: ConversationComposerProps & { readonly busy: boolean },
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
        <div className="conversation-field bg-surface-1 border-edge-control rounded-3 border">
          <ComposerPrimitive.Input
            className="conversation-input w-full min-w-0 flex-1 resize-none border-0"
            minRows={1}
            maxRows={conversationRowsMax}
            maxLength={props.charsMax}
            readOnly={!props.takes}
            submitMode="enter"
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
          <ComposerPrimitive.Send
            className="conversation-send"
            aria-busy={props.busy}
          >
            <span className="conversation-send-mark">
              <ConversationSendGlyph />
            </span>
            <span className="visually-hidden">Send</span>
          </ComposerPrimitive.Send>
        </div>
        <div className="conversation-note text-ink-3 flex flex-wrap items-baseline gap-3 text-xs">
          {props.note}
          {count < props.charsMax * conversationCounterShare ? null : (
            <span className="num ml-auto">
              {count} / {props.charsMax}
            </span>
          )}
        </div>
      </ComposerPrimitive.Root>
    </ComposerPrimitive.Unstable_TriggerPopoverRoot>
  );
}
