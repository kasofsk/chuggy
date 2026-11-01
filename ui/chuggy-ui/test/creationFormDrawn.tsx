/**
 * The creation form as a case draws it: under the session and the cache it
 * writes through, on a context read Ready with the offers the case names, and
 * with whatever else the case says laid over that.
 */

import { QueryClientProvider } from "@tanstack/react-query";
import type { ComponentProps, ReactNode } from "react";

import { SessionProvider } from "../app/browser/session.tsx";
import { CreationForm } from "../app/browser/TicketCreation.tsx";
import type { ApiPorts } from "../app/core/apiRequest.ts";
import type { CreationOffer } from "../app/core/ticketCreation.ts";
import { creationContextList } from "../app/core/ticketCreationRun.ts";
import { holderDouble, queryClientUnretried } from "./screenHarness.tsx";
import { creationPartition } from "./ticketCreationFixture.ts";

export function creationFormDrawn(
  ports: ApiPorts,
  offers: readonly CreationOffer[],
  extra: Partial<ComponentProps<typeof CreationForm>> = {},
): ReactNode {
  return (
    <SessionProvider holder={holderDouble()}>
      <QueryClientProvider client={queryClientUnretried()}>
        <CreationForm
          ports={ports}
          partition={creationPartition}
          queryKey={creationContextList(creationPartition).key}
          context={{
            context: "Ready",
            offers,
            partial: false,
            repositories: [],
          }}
          start="Waits"
          onCreated={() => undefined}
          existing={() => null}
          {...extra}
        />
      </QueryClientProvider>
    </SessionProvider>
  );
}
