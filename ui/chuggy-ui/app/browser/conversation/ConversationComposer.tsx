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
  /** Called when the reader changes the text, so the page can drop a note
   * about a press this text has since moved past. Fired on the box's own
   * change event, not on a programmatic restore of a kept message. */
  readonly onEdit?: () => void;
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
  if (!props.takes)
    return (
      <div className="text-ink-3 flex flex-wrap justify-center gap-3 text-center">
        <span>Closed</span>
        {props.note}
      </div>
    );
  return (
    <ComposerPrimitive.Root className="grid min-w-0 gap-1">
      <div className="conversation-field bg-surface-1 border-edge-control rounded-3 grid min-w-0 gap-2 border p-3">
        <ComposerPrimitive.Input
          className="conversation-input w-full min-w-0 resize-none border-0"
          minRows={1}
          maxRows={conversationRowsMax}
          maxLength={props.charsMax}
          submitMode="enter"
          aria-label="Message"
          onChange={
            props.onEdit === undefined ? undefined : () => props.onEdit?.()
          }
        />
        <ComposerPrimitive.Send
          className="rounded-circle bg-surface-inverse text-ink-inverse disabled:bg-surface-2 disabled:text-ink-3 ml-auto flex size-6 items-center justify-center border-0"
          aria-busy={props.busy}
        >
          <ConversationSendGlyph />
          <span className="visually-hidden">Send</span>
        </ComposerPrimitive.Send>
      </div>
      <div className="text-ink-3 flex flex-wrap items-baseline gap-3 text-xs">
        {props.note}
        {count < props.charsMax * conversationCounterShare ? null : (
          <span className="num ml-auto">
            {count} / {props.charsMax}
          </span>
        )}
      </div>
    </ComposerPrimitive.Root>
  );
}
