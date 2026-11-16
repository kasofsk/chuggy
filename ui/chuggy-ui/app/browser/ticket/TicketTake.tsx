/**
 * Take and Return in a ticket's header menu: the reader takes the ticket for
 * themselves, or returns one they took to its creator. Which is drawn is
 * `ticketTakeOffer`'s, and nothing here names any member but the reader,
 * because no door does.
 *
 * A TAKE WRITES NO JOURNAL ENTRY, so no `Ticket` frame follows it: the
 * project's ticket reads are read again once it lands, which is what draws the
 * owner it leaves on this page and in a list filtered by owner.
 */

import type { ReactNode } from "react";

import type { PartitionIdentity } from "../../../../../src/contract/http.ts";
import type { TicketTakeResponse } from "../../../../../src/contract/responses.ts";
import { apiReturnTicket, apiTakeTicket } from "../../core/apiRoutes.ts";
import { consoleWriteKey } from "../../core/consoleWrite.ts";
import type { ConsoleWrite } from "../../core/consoleWrite.ts";
import { failureWords } from "../../core/failureWords.ts";
import { projectPartitionKey } from "../../core/projectQueryKeys.ts";
import type { TicketTakeOffer } from "../../core/ticketOffers.ts";
import { useCopyText } from "../../copy/CopyProvider.tsx";
import { ConsoleWriteRefusedWords, useConsoleWrite } from "../consoleWrite.tsx";
import type { MoreMenuItem } from "../ui/MoreMenu.tsx";
import { Notice } from "../ui/Notice.tsx";

type TicketTakeKind = Exclude<TicketTakeOffer, "None">;

function ticketTakeWrite(
  partition: PartitionIdentity,
  ticket: number,
): ConsoleWrite<TicketTakeKind, TicketTakeResponse> {
  return {
    mutationKey: consoleWriteKey(
      "ticket-take",
      partition.tenant,
      partition.project,
      ticket,
    ),
    write: (ports, kind) =>
      kind === "Take"
        ? apiTakeTicket(ports, partition, ticket)
        : apiReturnTicket(ports, partition, ticket),
    refusal: (failure) => failureWords(failure).word,
    landed: (client) =>
      client.invalidateQueries({
        queryKey: [...projectPartitionKey(partition), "Ticket"],
      }),
  };
}

/** The one of Take and Return the header's menu offers, and the refusal of
 * the last press, which the header draws beside the menu. */
export function useTicketTake(
  partition: PartitionIdentity,
  ticket: number,
  offer: TicketTakeOffer,
): { readonly item: MoreMenuItem | undefined; readonly refused: ReactNode } {
  const text = useCopyText();
  const taking = useConsoleWrite(ticketTakeWrite(partition, ticket), {
    drawn: true,
  });
  return {
    item:
      offer === "None"
        ? undefined
        : {
            kind: "action",
            label: text({
              id: offer === "Take" ? "ticket-take" : "ticket-return",
            }),
            disabled: taking.isPending,
            onSelect: () => {
              taking.mutate(offer);
            },
          },
    refused:
      taking.error === null ? null : (
        <Notice tone="danger" inline role="status">
          <ConsoleWriteRefusedWords refused={taking.error} />
        </Notice>
      ),
  };
}
