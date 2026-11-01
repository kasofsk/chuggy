/**
 * The control that ends a thread, on the thread's own page and beside its row
 * in the listing.
 *
 * IT IS OFFERED ON ANY THREAD THAT IS NOT CLOSED, whoever's it is. The door is
 * the project's `Mutate` and not the thread's owner, because a thread files
 * drafts and does nothing else, so ending one takes nothing its owner cannot
 * file again from a new one — and an orphaned thread, still acting for a member
 * who is gone, is the one most worth ending. There is no confirmation: the
 * thread stays readable, and the member opens another.
 *
 * A CLOSE ARRIVES ON THE PAGE THE WAY EVERY OTHER MOVE DOES. The close writes a
 * `Session` frame, the frame stales the read, and the read answers the thread
 * closed — so this refreshes nothing itself, for the reason the composer does
 * not. What it draws is the one press in flight, and the one refusal the last
 * press met.
 */

import type { ReactNode } from "react";

import type { PartitionIdentity } from "../../../../../src/contract/http.ts";
import { threadHomeOf } from "../../core/threadHome.ts";
import { useConsoleWrite } from "../consoleWrite.tsx";
import { Button, type ButtonSize, type ButtonVariant } from "../ui/Button.tsx";
import { Notice } from "../ui/Notice.tsx";
import { threadCloseWrite } from "./ThreadEntryLabel.tsx";

export function ThreadClose(props: {
  readonly partition: PartitionIdentity;
  readonly session: string;
  readonly variant: ButtonVariant;
  readonly size?: ButtonSize;
}): ReactNode {
  const closing = useConsoleWrite(
    threadCloseWrite(threadHomeOf(props.partition), props.session),
    { drawn: true },
  );
  return (
    <>
      <Button
        variant={props.variant}
        size={props.size}
        busy={closing.isPending}
        disabled={closing.isPending}
        onClick={() => {
          closing.mutate(undefined);
        }}
      >
        Close
      </Button>
      {closing.error === null ? null : (
        <Notice tone="danger" inline detail={closing.error.message} />
      )}
    </>
  );
}
