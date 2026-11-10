/**
 * The write the Tickets tab adds and removes members through, which its Add
 * dialog sends too: a revision sent, and the epic read again where the
 * revision it was sent at was stale.
 */

import { useQueryClient } from "@tanstack/react-query";

import type { EpicWriteRequest } from "../../../../../src/contract/epics.ts";
import type { PartitionIdentity } from "../../../../../src/contract/http.ts";
import { epicsInvalidated } from "../../core/epics.ts";
import { epicTicketsWrite } from "../../core/epicTickets.ts";
import { useConsoleWrite } from "../consoleWrite.tsx";

export function useEpicTicketsWriting(partition: PartitionIdentity) {
  const client = useQueryClient();
  const writing = useConsoleWrite(epicTicketsWrite(partition), {
    drawn: true,
  });
  /** Sends a revision, and reads the epic again where it was stale. */
  const send = (request: EpicWriteRequest, onSent?: () => void): void => {
    writing.mutate(request, {
      onSuccess: () => onSent?.(),
      onError: (refused) => {
        const failure = refused.failure;
        if (failure?.outcome === "Conflict" && failure.code === "StaleRevision")
          void epicsInvalidated(client, partition);
      },
    });
  };
  return { writing, send };
}

export type EpicTicketsWriting = ReturnType<typeof useEpicTicketsWriting>;
