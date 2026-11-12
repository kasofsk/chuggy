/**
 * A short interruption over the page: a roster to pick from, a choice to make
 * before going on, a form or a grid to fill.
 *
 * Radix's modal dialog: while it is open the focus is held inside it, the page
 * behind is hidden from assistive technology and takes no press, and closing
 * returns the focus to the trigger. A dialog the caller opens from elsewhere
 * returns it to what held the focus when it opened, or, where that has left
 * the page, to what controls the popup it stood in, as a menu's trigger does
 * its items. Radix's own overlay is not drawn, because its scroll lock
 * appends a `<style>` element the served `style-src 'self'` refuses; the scrim
 * is drawn here, and the page behind it can still scroll.
 * The trigger is drawn as a button so a caller hands a label rather than a
 * control, or bare around what it holds, and the whole of what is open is the
 * caller's own state.
 *
 * Total over a foot of its own and one the caller hands it, each at a roster's
 * width, a form's, or an image's own: as wide as what it holds and never wider
 * than the viewport. Its own foot is Close; a caller's is the dialog's actions,
 * drawn at the right, and closing is then one of them. Beside those actions
 * stands the line a refusal left, where no length of body hides it, and while
 * the caller's request is unanswered nothing closes the dialog, so that line
 * always has somewhere to be drawn. A press outside is refused before Radix
 * counts it, so the next close still returns the focus to the trigger. A body
 * that cannot be shown again is `kept`: a press outside is refused the same
 * way, and the caller's own action or Escape closes it.
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
import { useLayoutEffect, useRef } from "react";
import type { ReactNode } from "react";

import { useCopyText } from "../../copy/CopyProvider.tsx";
import { buttonLookClassName } from "./Button.tsx";
import "./Dialog.css";
import { Notice } from "./Notice.tsx";
import type { ButtonSize, ButtonVariant } from "./Button.tsx";

export type DialogSize = "roster" | "form" | "image";

const dialogSizeClassNames: Record<DialogSize, string> = {
  roster: "max-w-aside",
  form: "max-w-measure",
  image: "w-fit max-w-full",
};

function DialogFoot(props: {
  readonly foot: ReactNode;
  readonly note: string | undefined;
}): ReactNode {
  const text = useCopyText();
  if (props.foot === undefined)
    return (
      <RadixDialog.Close
        className={buttonLookClassName({ variant: "quiet", size: "sm" })}
      >
        {text({ id: "ui-close" })}
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

/** The element that controls the popup `element` stands in, such as a menu's
 * trigger for one of its items. */
function controller(element: HTMLElement): HTMLElement | undefined {
  const controls = [...document.querySelectorAll("[aria-controls]")];
  for (
    let node: Element | null = element;
    node !== null;
    node = node.parentElement
  ) {
    const id = node.id;
    if (id === "") continue;
    const found = controls.find((control) =>
      (control.getAttribute("aria-controls") ?? "").split(" ").includes(id),
    );
    if (found instanceof HTMLElement) return found;
  }
  return undefined;
}

/** Where a dialog with no trigger of its own hands the focus back: what held
 * it when the dialog opened, or what controls the popup that stood in, once
 * that has left the page. */
function useOpener(open: boolean): () => HTMLElement | undefined {
  const opener = useRef<{
    readonly focused: HTMLElement;
    readonly controller: HTMLElement | undefined;
  }>(undefined);
  useLayoutEffect(() => {
    if (!open) return;
    const focused = document.activeElement;
    opener.current =
      focused instanceof HTMLElement && focused !== document.body
        ? { focused, controller: controller(focused) }
        : undefined;
  }, [open]);
  return () => {
    const held = opener.current;
    if (held === undefined) return undefined;
    if (held.focused.isConnected) return held.focused;
    return held.controller?.isConnected === true ? held.controller : undefined;
  };
}

export function Dialog(props: {
  readonly title: string;
  /** The button that opens it; absent where the caller opens it from elsewhere. */
  readonly trigger?: ReactNode;
  readonly triggerVariant?: ButtonVariant;
  readonly triggerSize?: ButtonSize;
  readonly triggerDisabled?: boolean;
  /** The trigger's name where its word is one several triggers on a page say. */
  readonly triggerNamed?: string;
  /** The trigger is drawn as what it holds, without a button's look. */
  readonly triggerBare?: boolean;
  /** A roster's width where absent. */
  readonly size?: DialogSize;
  /** The dialog's own actions, in place of Close. */
  readonly foot?: ReactNode;
  /** What a refusal left, drawn beside the caller's actions. */
  readonly note?: string | undefined;
  /** The caller's request is unanswered, and until it is nothing closes the dialog. */
  readonly busy?: boolean;
  /** A press outside does not close the dialog. */
  readonly kept?: boolean;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly children: ReactNode;
}): ReactNode {
  const width = dialogSizeClassNames[props.size ?? "roster"];
  const busy = props.busy === true;
  const opener = useOpener(props.open && props.trigger === undefined);
  return (
    <RadixDialog.Root
      open={props.open}
      onOpenChange={(open) => {
        if (open || !busy) props.onOpenChange(open);
      }}
    >
      {props.trigger === undefined ? null : (
        <RadixDialog.Trigger
          disabled={props.triggerDisabled ?? false}
          aria-label={props.triggerNamed}
          className={
            props.triggerBare === true
              ? "dialog-trigger-bare block max-w-full"
              : buttonLookClassName({
                  variant: props.triggerVariant,
                  size: props.triggerSize ?? "sm",
                })
          }
        >
          {props.trigger}
        </RadixDialog.Trigger>
      )}
      <RadixDialog.Portal>
        <div
          aria-hidden="true"
          className="fixed inset-0 z-[calc(var(--z-overlay)+20)] bg-scrim"
        />
        <div className="pointer-events-none fixed inset-x-4 inset-y-6 z-[calc(var(--z-overlay)+30)]">
          <RadixDialog.Content
            aria-describedby={undefined}
            onCloseAutoFocus={(event) => {
              if (props.trigger !== undefined) return;
              event.preventDefault();
              opener()?.focus();
            }}
            onInteractOutside={(event) => {
              if (busy || props.kept === true) event.preventDefault();
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
