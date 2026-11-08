/**
 * A thread composer's hook mounted as a page mounts it: under the catalog, a
 * session, one query client for the life of the case, and a store over both,
 * so the store's client is the client the tree reads.
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { SessionProvider } from "../app/browser/session.tsx";
import { CopyProvider } from "../app/copy/CopyProvider.tsx";
import { ConsoleStoreProvided } from "./consoleStoreProvided.tsx";
import { holderDouble } from "./screenHarness.tsx";

export function threadSendWrapped(): (props: {
  readonly children: ReactNode;
}) => ReactNode {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const holder = holderDouble();
  return (props) => (
    <CopyProvider>
      <QueryClientProvider client={client}>
        <SessionProvider holder={holder}>
          <ConsoleStoreProvided>{props.children}</ConsoleStoreProvided>
        </SessionProvider>
      </QueryClientProvider>
    </CopyProvider>
  );
}
