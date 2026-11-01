/**
 * A line that arrives on its own, over the page's corner: a refusal the screen
 * that asked for it is no longer there to draw.
 *
 * Radix's toast, one viewport for every line, each with a Dismiss of its own
 * and announced as it arrives. A line closed by its timer or its Dismiss is
 * handed back through `onDismiss`, so what is drawn is the caller's alone.
 */

import { Toast as RadixToast } from "radix-ui";
import type { ReactNode } from "react";

import { buttonLookClassName } from "./Button.tsx";
import "./Toast.css";

export interface ToastLine {
  readonly id: number;
  readonly line: string;
}

export function Toasts(props: {
  readonly toasts: readonly ToastLine[];
  readonly onDismiss: (id: number) => void;
}): ReactNode {
  return (
    <RadixToast.Provider label="Refusal">
      {props.toasts.map((toast) => (
        <RadixToast.Root
          key={toast.id}
          className="toast"
          type="foreground"
          onOpenChange={(open) => {
            if (!open) props.onDismiss(toast.id);
          }}
        >
          <RadixToast.Description className="toast-line">
            {toast.line}
          </RadixToast.Description>
          <RadixToast.Close
            className={buttonLookClassName({ variant: "quiet", size: "sm" })}
          >
            Dismiss
          </RadixToast.Close>
        </RadixToast.Root>
      ))}
      <RadixToast.Viewport className="toast-viewport" />
    </RadixToast.Provider>
  );
}
