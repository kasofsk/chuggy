/**
 * The question an action that cannot be taken back is asked before it is
 * sent, in a dialog over the page: what it does, then Cancel and the button
 * that sends it. A reversible end to one row is asked in place, by `Confirm`.
 */

import type { ReactNode } from "react";

import { useCopyText } from "../../copy/CopyProvider.tsx";
import { Button } from "./Button.tsx";
import { Dialog } from "./Dialog.tsx";

/** An action that cannot be taken back: destructive where it is `danger`,
 * irreversible otherwise. */
export interface ConfirmDialogProps {
  readonly title: string;
  readonly confirm: string;
  /** It destroys what it acts on, and its button is drawn as danger. */
  readonly danger?: boolean;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly onConfirm: () => void;
  readonly children: ReactNode;
}

export function ConfirmDialog(props: ConfirmDialogProps): ReactNode {
  const text = useCopyText();
  return (
    <Dialog
      title={props.title}
      open={props.open}
      onOpenChange={props.onOpenChange}
      foot={
        <>
          <Button
            variant="quiet"
            size="sm"
            onClick={() => {
              props.onOpenChange(false);
            }}
          >
            {text({ id: "ui-cancel" })}
          </Button>
          <Button
            variant={props.danger === true ? "danger" : "primary"}
            size="sm"
            onClick={() => {
              props.onOpenChange(false);
              props.onConfirm();
            }}
          >
            {props.confirm}
          </Button>
        </>
      }
    >
      <p className="text-ink-2 m-0 text-sm">{props.children}</p>
    </Dialog>
  );
}
