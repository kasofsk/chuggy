/**
 * A short interruption over the page: a roster to pick from, a choice to make
 * before going on, a form or a grid to fill.
 *
 * Radix's dialog in its non-modal form, which is the one that mounts no
 * `<style>` element — the modal form's scroll lock appends one and the served
 * `style-src 'self'` refuses it. The trigger is drawn as a button so a caller
 * hands a label rather than a control, and the whole of what is open is the
 * caller's own state.
 *
 * Total over a foot of its own and one the caller hands it, each at a roster's
 * width or a form's. Its own foot is Close; a caller's is the dialog's
 * actions, drawn at the right, and closing is then one of them. Beside those
 * actions stands the line a refusal left, where no length of body hides it,
 * and while the caller's request is unanswered nothing closes the dialog, so
 * that line always has somewhere to be drawn. A press outside is refused
 * before Radix counts it, so the next close still returns the focus to the
 * trigger.
 *
 * It is never taller than the viewport. The title and the foot stand at its
 * edges and the caller's body scrolls between them, so a roster of any length
 * is reached by scrolling the dialog rather than a page the dialog is fixed
 * over. A child that holds a scroller of its own can give way instead, which
 * is how a list keeps the box above it in view. A scroller is drawn out by a
 * focus ring's width and padded back in, so the ring a control draws at its
 * edge is not clipped.
 */

import { Dialog as RadixDialog } from "radix-ui";
import type { ReactNode } from "react";

import { buttonLookClassName } from "./Button.tsx";
import "./Dialog.css";
import { Notice } from "./Notice.tsx";
import type { ButtonSize, ButtonVariant } from "./Button.tsx";

function DialogFoot(props: {
  readonly foot: ReactNode;
  readonly note: string | undefined;
}): ReactNode {
  if (props.foot === undefined)
    return (
      <RadixDialog.Close
        className={buttonLookClassName({ variant: "quiet", size: "sm" })}
      >
        Close
      </RadixDialog.Close>
    );
  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      {props.note === undefined ? null : (
        <div className="me-auto min-w-0">
          <Notice tone="danger" inline role="status" detail={props.note} />
        </div>
      )}
      <div className="flex items-center gap-2">{props.foot}</div>
    </div>
  );
}

export function Dialog(props: {
  readonly title: string;
  readonly trigger: ReactNode;
  readonly triggerVariant?: ButtonVariant;
  readonly triggerSize?: ButtonSize;
  readonly triggerDisabled?: boolean;
  /** The trigger's name where its word is one several triggers on a page say. */
  readonly triggerNamed?: string;
  /** A form's width, where a roster's is too narrow for what the body holds. */
  readonly wide?: boolean;
  /** The dialog's own actions, in place of Close. */
  readonly foot?: ReactNode;
  /** What a refusal left, drawn beside the caller's actions. */
  readonly note?: string | undefined;
  /** The caller's request is unanswered, and until it is nothing closes the dialog. */
  readonly busy?: boolean;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly children: ReactNode;
}): ReactNode {
  const width = props.wide === true ? "max-w-measure" : "max-w-aside";
  const busy = props.busy === true;
  return (
    <RadixDialog.Root
      modal={false}
      open={props.open}
      onOpenChange={(open) => {
        if (open || !busy) props.onOpenChange(open);
      }}
    >
      <RadixDialog.Trigger
        disabled={props.triggerDisabled ?? false}
        aria-label={props.triggerNamed}
        className={buttonLookClassName({
          variant: props.triggerVariant,
          size: props.triggerSize ?? "sm",
        })}
      >
        {props.trigger}
      </RadixDialog.Trigger>
      <RadixDialog.Portal>
        <div aria-hidden="true" className="fixed inset-0 z-10 bg-scrim" />
        <div className="pointer-events-none fixed inset-x-4 inset-y-6 z-20">
          <RadixDialog.Content
            aria-describedby={undefined}
            onInteractOutside={(event) => {
              if (busy) event.preventDefault();
            }}
            className={`pointer-events-auto mx-auto flex max-h-full ${width} flex-col gap-4 rounded-3 border border-edge bg-surface-1 p-5 outline-none`}
          >
            <RadixDialog.Title className="text-md font-strong text-ink-1 wrap-anywhere">
              {props.title}
            </RadixDialog.Title>
            <div className="dialog-body -m-1 flex min-h-0 flex-col gap-4 overflow-y-auto p-1">
              {props.children}
            </div>
            <DialogFoot foot={props.foot} note={props.note} />
          </RadixDialog.Content>
        </div>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}
