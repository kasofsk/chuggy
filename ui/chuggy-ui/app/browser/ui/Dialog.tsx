/**
 * A short interruption over the page: a roster to pick from, a choice to make
 * before going on.
 *
 * Radix's dialog in its non-modal form, which is the one that mounts no
 * `<style>` element — the modal form's scroll lock appends one and the served
 * `style-src 'self'` refuses it. The trigger is drawn as a button so a caller
 * hands a label rather than a control, and the whole of what is open is the
 * caller's own state.
 */

import { Dialog as RadixDialog } from "radix-ui";
import type { ReactNode } from "react";

import { buttonLookClassName } from "./Button.tsx";
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
        <RadixDialog.Content
          aria-describedby={undefined}
          className="fixed inset-x-4 top-6 z-20 mx-auto grid max-w-aside gap-4 rounded-3 border border-edge bg-surface-1 p-5 outline-none"
        >
          <RadixDialog.Title className="text-md font-strong text-ink-1">
            {props.title}
          </RadixDialog.Title>
          {props.children}
          <RadixDialog.Close
            className={buttonLookClassName({ variant: "quiet", size: "sm" })}
          >
            Close
          </RadixDialog.Close>
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}
