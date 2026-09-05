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

import { useState } from "react";
import type { ReactNode } from "react";

import type { PartitionIdentity } from "../../../../../src/contract/http.ts";
import { apiCloseThread } from "../../core/apiRoutes.ts";
import { panelReason } from "../../core/freshness.ts";
import { useApiPorts } from "../api.ts";
import { Button, type ButtonSize, type ButtonVariant } from "../ui/Button.tsx";
import { Notice } from "../ui/Notice.tsx";

export function ThreadClose(props: {
  readonly partition: PartitionIdentity;
  readonly session: string;
  readonly variant: ButtonVariant;
  readonly size?: ButtonSize;
}): ReactNode {
  const ports = useApiPorts();
  const [closing, setClosing] = useState(false);
  const [refused, setRefused] = useState<string | undefined>(undefined);
  return (
    <>
      <Button
        variant={props.variant}
        size={props.size}
        busy={closing}
        disabled={closing}
        onClick={() => {
          setClosing(true);
          setRefused(undefined);
          void apiCloseThread(ports, props.partition, props.session).then(
            (closed) => {
              setClosing(false);
              if (closed.outcome !== "Ok") setRefused(panelReason(closed));
            },
          );
        }}
      >
        Close
      </Button>
      {refused === undefined ? null : (
        <Notice tone="danger" inline detail={`Refused · ${refused}`} />
      )}
    </>
  );
}
