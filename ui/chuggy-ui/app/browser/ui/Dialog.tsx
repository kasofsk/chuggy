/**
 * A short interruption over the page: a roster to pick from, a choice to make
 * before going on.
 *
 * Radix's dialog in its non-modal form, which is the one that mounts no
 * `<style>` element — the modal form's scroll lock appends one and the served
 * `style-src 'self'` refuses it. The trigger is drawn as a button so a caller
 * hands a label rather than a control, and the whole of what is open is the
 * caller's own state.
 *
 * It is never taller than the viewport. The title and Close stand at its edges
 * and the caller's body scrolls between them, so a roster of any length is
 * reached by scrolling the dialog rather than a page the dialog is fixed over.
 * A child that holds a scroller of its own can give way instead, which is how
 * a list keeps the box above it in view. A scroller is drawn out by a focus
 * ring's width and padded back in, so the ring a control draws at its edge is
 * not clipped.
 */

import { Dialog as RadixDialog } from "radix-ui";
import type { ReactNode } from "react";

import { buttonLookClassName } from "./Button.tsx";
import "./Dialog.css";
import type { ButtonSize, ButtonVariant } from "./Button.tsx";

export function Dialog(props: {
  readonly title: string;
  readonly trigger: string;
  readonly triggerVariant?: ButtonVariant;
  readonly triggerSize?: ButtonSize;
  readonly triggerDisabled?: boolean;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly children: ReactNode;
}): ReactNode {
  return (
    <RadixDialog.Root
      modal={false}
      open={props.open}
      onOpenChange={props.onOpenChange}
    >
      <RadixDialog.Trigger
        disabled={props.triggerDisabled ?? false}
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
            className="pointer-events-auto mx-auto flex max-h-full max-w-aside flex-col gap-4 rounded-3 border border-edge bg-surface-1 p-5 outline-none"
          >
            <RadixDialog.Title className="text-md font-strong text-ink-1">
              {props.title}
            </RadixDialog.Title>
            <div className="dialog-body -m-1 flex min-h-0 flex-col gap-4 overflow-y-auto p-1">
              {props.children}
            </div>
            <RadixDialog.Close
              className={buttonLookClassName({ variant: "quiet", size: "sm" })}
            >
              Close
            </RadixDialog.Close>
          </RadixDialog.Content>
        </div>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}
