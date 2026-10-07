/**
 * What the creation screen's suites stand in for: the YAML editor as a plain
 * text area, and an API that creates a draft and settles its release as
 * succeeded.
 */

import type { Answer } from "./answeringApi.ts";
import { creationDraft, creationPartition } from "./ticketCreationFixture.ts";
import { ticketInstants } from "./ticketInstants.ts";

/** The editor stood in for, because what these suites check is the screen
 * around it; `ticketEditor.test.tsx` mounts the real one. */
export default function TicketEditorDouble(props: {
  readonly value: string;
  readonly onChange: (text: string) => void;
}) {
  return (
    <textarea
      aria-label="Ticket YAML"
      value={props.value}
      onChange={(event) => {
        props.onChange(event.target.value);
      }}
    />
  );
}

/** A draft created, its release accepted and settled, and the project read
 * listing the ticket it made. */
export function ticketReleasing(method: string, path: string): Answer {
  if (method === "POST" && path.endsWith("/drafts"))
    return { status: 201, body: creationDraft };
  if (method === "POST" && path.endsWith("/operations"))
    return { status: 202, body: { operation: "op", state: "Pending" } };
  if (path.includes("/operations/"))
    return {
      status: 200,
      body: {
        operation: "op",
        acceptedAt: "2026-08-26T00:00:00Z",
        state: "Succeeded",
        decidedSequence: 42,
      },
    };
  return {
    status: 200,
    body: {
      partition: creationPartition,
      sequence: 42,
      tickets: [
        {
          ticket: creationDraft.ticket,
          phase: "Pending",
          sequence: 42,
          ...ticketInstants,
        },
      ],
    },
  };
}
