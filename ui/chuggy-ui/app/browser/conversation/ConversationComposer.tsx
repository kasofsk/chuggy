/**
 * The box a member types into, which knows nothing of the API: the page it is
 * mounted on owns the send, the turn identity and what a refusal means.
 *
 * A REFUSED SEND HANDS THE TEXT BACK, AND THE IMAGES WITH IT. The composer
 * clears at dispatch and the page's answer arrives after that, so a page that
 * could not take the message says `Kept` and the characters and the images
 * are put back in the box the reader is still looking at. A box that was not
 * drawn when the answer came is handed them as `back` when it next is.
 *
 * AN IMAGE PASTED OR DROPPED IS HELD, NOT SENT. The box holds its bytes under
 * the field, each with its own control to remove it, and hands them up with
 * the text at a press; the page owns the upload. A page that takes no images
 * hands no `attaches`, and its box offers nothing that looks as though it
 * would take one.
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
 * A POINTER'S PRESS OF THE BUTTON LEAVES THE CARET IN THE BOX. The button
 * turns into another or goes inert under the pointer, and focus it had taken
 * would fall to the page, where what a member types next goes nowhere.
 */

import { ComposerPrimitive, useAuiState } from "@assistant-ui/react";
import type { ClipboardEvent, DragEvent, MouseEvent, ReactNode } from "react";

import { textCodePointsCount } from "../../../../../src/contract/http.ts";
import {
  conversationAttachmentUri,
  conversationAttachRefusalLine,
} from "../../core/conversationAttachments.ts";
import type {
  ConversationAttaches,
  ConversationAttachment,
  ConversationAttachRefusal,
} from "../../core/conversationAttachments.ts";
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
  /** What the page takes as images with a message. Absent where it takes
   * none, and the box then takes no paste or drop of one. */
  readonly attaches?: ConversationAttaches;
  readonly onSend: (
    text: string,
    attached: readonly ConversationAttachment[],
  ) => Promise<ConversationSent>;
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
  readonly back?: {
    readonly text: string;
    readonly attached?: readonly ConversationAttachment[];
    readonly taken: () => void;
  };
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

/** What the surface holds of the images for the message being written. */
export interface ConversationComposerAttached {
  readonly attached: readonly ConversationAttachment[];
  /** Why the last paste took less than it held, until the next. */
  readonly attachRefused: ConversationAttachRefusal | undefined;
  readonly onAttach: (files: readonly File[]) => void;
  readonly onDetach: (attachment: ConversationAttachment) => void;
}

/** The images of a paste or a drop, which is every file it carries that says
 * it is one: the page's own types are the surface's to hold it to. */
function conversationFilesImages(files: FileList | undefined): File[] {
  return Array.from(files ?? []).filter((file) =>
    file.type.startsWith("image/"),
  );
}

/** The images held for the message, under the box, each removable, and how
 * many of the page's bound they are. */
function ConversationAttachments(props: {
  readonly attaches: ConversationAttaches | undefined;
  readonly attached: readonly ConversationAttachment[];
  readonly removes: boolean;
  readonly onDetach: (attachment: ConversationAttachment) => void;
}): ReactNode {
  if (props.attaches === undefined || props.attached.length === 0) return null;
  return (
    <div className="flex flex-wrap items-end gap-2">
      <ul aria-label="Images" className="flex flex-wrap gap-2">
        {props.attached.map((attachment, at) => (
          <li key={at} className="relative">
            <img
              className="rounded-2 border-edge block h-[calc(var(--space-7)*2)] max-w-full border"
              src={conversationAttachmentUri(attachment)}
              alt={`Image ${String(at + 1)}`}
            />
            {props.removes ? (
              <button
                type="button"
                className="bg-surface-inverse text-ink-inverse rounded-circle absolute top-1 right-1 px-1 text-xs"
                aria-label={`Remove image ${String(at + 1)}`}
                onMouseDown={conversationCaretKept}
                onClick={() => {
                  props.onDetach(attachment);
                }}
              >
                ×
              </button>
            ) : null}
          </li>
        ))}
      </ul>
      <span className="num text-ink-3 ml-auto text-xs">
        {props.attached.length} / {props.attaches.countMax}
      </span>
    </div>
  );
}

/** A pointer's press of a button takes no focus, so the caret stays in the box. */
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

/** The line over the box: what the page says of the last press, why the last
 * paste took less than it held, and the count once it is near the bound. */
function ConversationComposerNote(props: {
  readonly note: ReactNode;
  readonly attaches: ConversationAttaches | undefined;
  readonly attachRefused: ConversationAttachRefusal | undefined;
  readonly count: number;
  readonly charsMax: number;
}): ReactNode {
  return (
    <div className="conversation-note text-ink-3 flex flex-wrap items-baseline gap-3 text-xs">
      {props.note}
      {props.attaches === undefined ||
      props.attachRefused === undefined ? null : (
        <span role="status">
          {conversationAttachRefusalLine(props.attachRefused, props.attaches)}
        </span>
      )}
      {props.count < props.charsMax * conversationCounterShare ? null : (
        <span className="num ml-auto">
          {props.count} / {props.charsMax}
        </span>
      )}
    </div>
  );
}

/** What the box does with a paste or a drop: hands the images it carries up,
 * as an edit of the box, where the page takes images and the box takes
 * messages; and nothing otherwise, so the browser's own handling stands. A
 * removal is an edit of the box too. */
function conversationComposerTaken(
  props: ConversationComposerProps & ConversationComposerAttached,
  written: string,
): {
  readonly pasted: (event: ClipboardEvent<HTMLTextAreaElement>) => void;
  readonly detached: (attachment: ConversationAttachment) => void;
  readonly dropped: {
    readonly onDragOver?: (event: DragEvent<HTMLDivElement>) => void;
    readonly onDrop?: (event: DragEvent<HTMLDivElement>) => void;
  };
} {
  const takes = props.takes && props.attaches !== undefined;
  const taken = (
    files: FileList | undefined,
    event: { readonly preventDefault: () => void },
  ): void => {
    const images = conversationFilesImages(files);
    if (!takes || images.length === 0) return;
    event.preventDefault();
    props.onAttach(images);
    props.onEdit?.(written);
  };
  return {
    pasted: (event) => {
      taken(event.clipboardData.files, event);
    },
    detached: (attachment) => {
      props.onDetach(attachment);
      props.onEdit?.(written);
    },
    dropped: takes
      ? {
          onDragOver: (event) => {
            if (event.dataTransfer.types.includes("Files"))
              event.preventDefault();
          },
          onDrop: (event) => {
            taken(event.dataTransfer.files, event);
          },
        }
      : {},
  };
}

export function ConversationComposer(
  props: ConversationComposerProps &
    ConversationComposerSurface &
    ConversationComposerAttached,
): ReactNode {
  const written = useAuiState((state) => state.composer.text);
  const taken = conversationComposerTaken(props, written);
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
        <ConversationComposerNote
          note={props.note}
          attaches={props.attaches}
          attachRefused={props.attachRefused}
          count={textCodePointsCount(written)}
          charsMax={props.charsMax}
        />
        <div
          className="conversation-field bg-surface-1 border-edge-control rounded-3 border"
          {...taken.dropped}
        >
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
            addAttachmentOnPaste={false}
            onPaste={taken.pasted}
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
        <ConversationAttachments
          attaches={props.attaches}
          attached={props.attached}
          removes={props.takes}
          onDetach={taken.detached}
        />
      </ComposerPrimitive.Root>
    </ComposerPrimitive.Unstable_TriggerPopoverRoot>
  );
}
