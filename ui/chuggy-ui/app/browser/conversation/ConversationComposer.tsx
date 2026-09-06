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

import { buttonLookClassName } from "../ui/Button.tsx";

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

export function ConversationComposer(
  props: ConversationComposerProps & { readonly busy: boolean },
): ReactNode {
  const length = useAuiState((state) => state.composer.text.length);
  return (
    <ComposerPrimitive.Root className="grid min-w-0 gap-2">
      <ComposerPrimitive.Input
        className="w-full"
        rows={4}
        maxLength={props.charsMax}
        submitMode="enter"
        aria-label="Message"
        onChange={
          props.onEdit === undefined ? undefined : () => props.onEdit?.()
        }
      />
      <div className="flex flex-wrap items-center gap-3">
        <span className="num text-ink-3 text-xs">
          {length} / {props.charsMax}
        </span>
        <ComposerPrimitive.Send
          className={buttonLookClassName({ variant: "primary" })}
          aria-busy={props.busy}
        >
          Send
        </ComposerPrimitive.Send>
        {props.note}
      </div>
    </ComposerPrimitive.Root>
  );
}
