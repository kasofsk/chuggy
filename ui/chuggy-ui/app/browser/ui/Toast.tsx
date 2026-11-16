/**
 * A line that arrives on its own, over the page's corner, in one of two tones.
 *
 * Radix's toast, one viewport for every line, each with a Dismiss of its own
 * and announced as it arrives, its tone's mark and word before it so neither
 * tone is told by colour alone. A failure is a refusal its reader already
 * missed once: it is announced assertively and no timer closes it. A success
 * is announced politely and closes itself after `--duration-toast-read`, its
 * time paused while the pointer is over the toasts or focus is in them. A line
 * dismissed, by its reader or its time, is handed back through `onDismiss`, so
 * what is drawn is the caller's alone.
 */

import { Toast as RadixToast } from "radix-ui";
import { useState } from "react";
import type { ReactNode } from "react";

import { useCopyText } from "../../copy/CopyProvider.tsx";
import type { CopyOrData } from "../../core/copy.ts";
import { buttonLookClassName } from "./Button.tsx";
import { StatusBadge } from "./StatusBadge.tsx";
import { Tooltip } from "./Tooltip.tsx";
import "./Toast.css";

/** What Radix replaces with the viewport's keys, handed to the catalog as
 * data so a wording keeps it whole. */
const toastHotkeyPlaceholder = "{hotkey}";

export const toastTones = ["Failure", "Success"] as const;
export type ToastTone = (typeof toastTones)[number];

export interface ToastLine {
  readonly id: number;
  readonly tone: ToastTone;
  readonly line: string;
  /** On hover of the line, for a reader reporting it. */
  readonly detail?: CopyOrData | undefined;
}

/** The token a success's time is read from. */
export const toastReadToken = "--duration-toast-read";

/** A CSS time in milliseconds; one that does not read as a time is no
 * timer, so a success it would have closed stays until its Dismiss. */
export function toastReadMsOf(time: string): number {
  const read = /^\s*(\d+(?:\.\d+)?)(ms|s)\s*$/.exec(time);
  if (read === null) return Number.POSITIVE_INFINITY;
  const amount = Number(read[1]);
  return read[2] === "s" ? amount * 1000 : amount;
}

function useToastReadMs(): number {
  const [readMs] = useState(() =>
    toastReadMsOf(
      getComputedStyle(document.documentElement).getPropertyValue(
        toastReadToken,
      ),
    ),
  );
  return readMs;
}

function ToastWord(props: { readonly tone: ToastTone }): ReactNode {
  const text = useCopyText();
  return props.tone === "Failure" ? (
    <StatusBadge tone="fail" size="small">
      {text({ id: "ui-toast-failure" })}
    </StatusBadge>
  ) : (
    <StatusBadge tone="pass" size="small">
      {text({ id: "ui-toast-success" })}
    </StatusBadge>
  );
}

export function Toasts(props: {
  readonly toasts: readonly ToastLine[];
  readonly onDismiss: (id: number) => void;
}): ReactNode {
  const text = useCopyText();
  const readMs = useToastReadMs();
  return (
    <RadixToast.Provider label={text({ id: "ui-toasts" })}>
      {props.toasts.map((toast) => (
        <RadixToast.Root
          key={toast.id}
          className="toast"
          data-tone={toast.tone}
          type={toast.tone === "Failure" ? "foreground" : "background"}
          duration={
            toast.tone === "Failure" ? Number.POSITIVE_INFINITY : readMs
          }
          onOpenChange={(open) => {
            if (!open) props.onDismiss(toast.id);
          }}
        >
          <RadixToast.Description className="toast-said">
            <ToastWord tone={toast.tone} />
            <span className="toast-line">
              <Tooltip text={toast.detail}>
                <span>{toast.line}</span>
              </Tooltip>
            </span>
          </RadixToast.Description>
          <RadixToast.Close
            className={buttonLookClassName({ variant: "quiet", size: "sm" })}
          >
            {text({ id: "ui-dismiss" })}
          </RadixToast.Close>
        </RadixToast.Root>
      ))}
      <RadixToast.Viewport
        className="toast-viewport"
        label={text({
          id: "ui-toasts-held",
          args: { hotkey: toastHotkeyPlaceholder },
        })}
      />
    </RadixToast.Provider>
  );
}
