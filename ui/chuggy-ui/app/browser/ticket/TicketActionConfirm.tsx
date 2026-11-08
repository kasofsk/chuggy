/**
 * The question a dispatch, a revoke or a draft's deletion is asked before it
 * is sent, in a dialog over the page: what it does, then Cancel and the button
 * that sends it.
 */

import type { ReactNode } from "react";

import { Button } from "../ui/Button.tsx";
import { Dialog } from "../ui/Dialog.tsx";
import { useCopyText } from "../../copy/CopyProvider.tsx";

export function TicketActionConfirm(props: {
  readonly title: string;
  readonly confirm: string;
  readonly danger?: boolean;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly onConfirm: () => void;
  readonly children: ReactNode;
}): ReactNode {
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
            {text({ id: "ticket-cancel" })}
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
