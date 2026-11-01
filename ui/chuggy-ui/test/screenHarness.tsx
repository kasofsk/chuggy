/**
 * What every mounted screen in this console needs around it: the three
 * providers, a signed-in session, an API made of scripted responses, and a
 * flush that lets the reads behind a render finish.
 *
 * Written once because a case that built its own would be a second account of
 * what a screen is wrapped in, and the two would drift the first time a
 * provider was added. What stays with each case is what differs between them:
 * the `vi.mock` factories, which are hoisted into the file that declares them,
 * and the bodies each route answers with.
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { StrictMode, useSyncExternalStore } from "react";
import type { ReactNode } from "react";
import { vi } from "vitest";

import type { PartitionIdentity } from "../../../src/contract/http.ts";
import type { SessionHolder } from "../app/core/sessionHolder.ts";
import { SessionProvider } from "../app/browser/session.tsx";
import { ShellSlots, useShellSlotHolder } from "../app/browser/shell/slots.tsx";
import { ProjectStreamProvider } from "../app/browser/stream.tsx";
import type { ConsoleStore } from "../app/browser/store.ts";
import { ConsoleStoreProvided } from "./consoleStoreProvided.tsx";
import { frame, streamServer } from "./streamDouble.ts";
import type { StreamServer } from "./streamDouble.ts";

/** A render settles over several turns — a query resolves, a follow polls, an
 * invalidation reads again — so the tree is flushed a bounded number of times
 * rather than once. */
export const settleFlushesMax = 8;

/** A cache that never retries a read, so a case's failed read is one read. */
export function queryClientUnretried(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

export function holderDouble(): SessionHolder {
  return {
    load: () => Promise.resolve(),
    completeCallback: () => Promise.resolve({ result: "None" as const }),
    signIn: () => Promise.resolve(),
    signOut: () => Promise.resolve(),
    bearer: () => Promise.resolve("token"),
    refresh: () => Promise.resolve(true),
    refuse: () => undefined,
    refreshDueAtMs: () => undefined,
    generation: () => 1,
    snapshot: () => ({
      phase: "SignedIn" as const,
      reason: undefined,
      configuration: undefined,
    }),
    subscribe: () => () => undefined,
  };
}

export function answer(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/vnd.chuggy.v1+json" },
  });
}

/** One operation, in whatever state the case wants the actor to leave it in. */
export function operationAt(state: string): unknown {
  return {
    operation: "op-one",
    acceptedAt: "2026-08-26T10:00:00Z",
    state,
  };
}

export interface ApiDouble {
  readonly fetch: typeof fetch;
  readonly submissions: () => number;
  readonly submitted: () => unknown;
}

interface ApiDoubleInit {
  readonly method?: string;
  readonly body?: string;
}

/** What the read of a ticket's action reach answers for one that has landed
 * nowhere, which draws no row. */
export const ticketLandedNowhere = {
  repository: null,
  commit: null,
  actions: [],
};

/** What the read of a ticket's landings answers for one that has had none. */
export const ticketLandingsNone = { landings: [], truncated: false };

/**
 * The API as a case scripts it: every submission accepted and remembered, the
 * operation route answering one standing, a ticket's action reach answering
 * that it landed nowhere and its landings that it has had none unless the
 * case says what each answers, and every other route the case's own.
 */
export function apiDouble(served: {
  readonly operation: unknown;
  readonly route: (url: string) => Response;
  readonly reach?: (url: string) => Response | Promise<Response>;
  readonly landings?: (url: string) => Response | Promise<Response>;
}): ApiDouble {
  let submissions = 0;
  let submitted: unknown;
  const respond = (
    url: string,
    init?: ApiDoubleInit,
  ): Response | Promise<Response> => {
    if (init?.method === "POST") {
      submissions += 1;
      submitted = JSON.parse(init.body ?? "null");
      return answer({ operation: "op-one", state: "Pending" }, 202);
    }
    if (url.includes("/operations/")) return answer(served.operation);
    if (url.includes("/action-reach"))
      return served.reach?.(url) ?? answer(ticketLandedNowhere);
    if (url.includes("/landings"))
      return served.landings?.(url) ?? answer(ticketLandingsNone);
    return served.route(url);
  };
  return {
    submissions: () => submissions,
    submitted: () => submitted,
    fetch: ((url: string, init?: ApiDoubleInit) =>
      Promise.resolve(respond(url, init))) as unknown as typeof fetch,
  };
}

/** A request a page sent, its body parsed. */
export interface SentRequest {
  readonly method: string;
  readonly url: string;
  readonly body: unknown;
}

/** A fetch stub that records every request as a `SentRequest` and answers
 * each from the case's own route — what `drawnStrict`'s own fetching is a
 * case of, and a page not drawn under `StrictMode` needs just as much. */
export function scriptedFetch(
  answered: (request: SentRequest) => Response | Promise<Response>,
): {
  readonly fetch: typeof fetch;
  readonly sent: readonly SentRequest[];
} {
  const sent: SentRequest[] = [];
  const fetching = ((url: string, init?: ApiDoubleInit) => {
    const request: SentRequest = {
      method: init?.method ?? "GET",
      url,
      body: init?.body === undefined ? undefined : JSON.parse(init.body),
    };
    sent.push(request);
    return Promise.resolve(answered(request));
  }) as unknown as typeof fetch;
  return { fetch: fetching, sent };
}

/** An answer a case holds back and lets go, for what a page draws between a
 * press and its answer. */
export function heldAnswer(): {
  readonly answered: Promise<Response>;
  readonly release: (response: Response) => void;
} {
  let release: (response: Response) => void = () => undefined;
  const answered = new Promise<Response>((resolve) => {
    release = resolve;
  });
  return { answered, release };
}

export interface DrawnStrict {
  readonly sent: readonly SentRequest[];
  /** The page drawn again with nothing about it changed, which is what a
   * re-render is: a decision it already took has to survive one. */
  readonly redraw: () => void;
}

/** A page outside the partition drawn under `StrictMode`, as the console's
 * root draws it, which runs each effect twice as the page mounts. */
export async function drawnStrict(
  page: ReactNode,
  answered: (request: SentRequest) => Response | Promise<Response>,
): Promise<DrawnStrict> {
  const scripted = scriptedFetch(answered);
  vi.stubGlobal("fetch", scripted.fetch);
  const sent = scripted.sent;
  const client = queryClientUnretried();
  const holder = holderDouble();
  const drawn = (nudge: number): ReactNode => (
    <StrictMode>
      <SessionProvider holder={holder}>
        <QueryClientProvider client={client}>
          <ConsoleStoreProvided>
            <span>{nudge}</span>
            {page}
          </ConsoleStoreProvided>
        </QueryClientProvider>
      </SessionProvider>
    </StrictMode>
  );
  const view = render(drawn(0));
  await settled();
  return {
    sent,
    redraw: () => {
      view.rerender(drawn(1));
    },
  };
}

/** The two routes any mounted `TicketPage` reaches beside its own read, for a
 * case with nothing of its own to say about them: no native action offered,
 * and a dispatch view reset, which offers nothing to dispatch. `undefined`
 * where a case's route has already answered a URL of its own before falling
 * back to this one. */
export function ticketPageAmbientRoute(url: string): Response | undefined {
  if (url.includes("/dispatch-view")) return answer({ result: "Reset" });
  if (url.includes("/native-actions")) return answer({ actions: [] });
  return undefined;
}

/**
 * A stream that opens, says it is ready and live, and holds so a case can push.
 * The source frame is not decoration: a real open sends one before anything
 * else, and a double that left it out would leave every screen under it reading
 * on the fallback rather than on the frames the case pushes.
 */
export function openedStream(): StreamServer {
  return streamServer([
    {
      status: 200,
      chunks: [
        frame("ready", undefined, { version: 1 }),
        frame("source", undefined, { version: 1, state: "live" }),
      ],
      hold: true,
    },
  ]);
}

export type StreamTransport = NonNullable<
  Parameters<typeof ProjectStreamProvider>[0]["transport"]
>;

/** A place for a page's `TopBarSlot` and `DetailsSlot` content to land, the
 * way `Shell` gives them one, so a suite built on `ScreenHarness` alone can see
 * what a page draws there. */
function ScreenHarnessSlotSinks(): ReactNode {
  const holdTopBar = useShellSlotHolder("topBar");
  const holdDetails = useShellSlotHolder("details");
  return (
    <>
      <div ref={holdTopBar} />
      <div ref={holdDetails} />
    </>
  );
}

export function ScreenHarness(props: {
  readonly partition: PartitionIdentity;
  readonly client: QueryClient;
  readonly transport: StreamTransport;
  /** The case's own store, where what it holds must outlive this harness. */
  readonly store?: ConsoleStore;
  readonly children: ReactNode;
}): ReactNode {
  return (
    <SessionProvider holder={holderDouble()}>
      <QueryClientProvider client={props.client}>
        <ConsoleStoreProvided store={props.store}>
          <ProjectStreamProvider
            partition={props.partition}
            transport={props.transport}
          >
            <ShellSlots>
              <ScreenHarnessSlotSinks />
              {props.children}
            </ShellSlots>
          </ProjectStreamProvider>
        </ConsoleStoreProvided>
      </QueryClientProvider>
    </SessionProvider>
  );
}

/** One turn of the tree, which is also what wraps a click a case makes. The
 * second timer is the cache's: it tells its observers of a write a timer after
 * the write, so a frame the first turn delivered is drawn by the second. */
export async function turned(
  doing: () => void = () => undefined,
): Promise<void> {
  await act(async () => {
    doing();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

export async function settled(): Promise<void> {
  for (let flush = 0; flush < settleFlushesMax; flush += 1) await turned();
}

/** A `SettingsSection` or `Panel` card, reached by the heading it is labelled
 * by — the name a case asks for is the start of a longer accessible name,
 * since a card's own notice follows its title in the same label. */
export function sectionOf(title: string): HTMLElement {
  return screen.getByRole("region", { name: new RegExp(`^${title}`) });
}

/** A button pressed and the turns that follow it flushed, so what the press
 * set off — a read, a write, a redraw — has landed before a case asserts. */
export async function press(name: string): Promise<void> {
  await turned(() => {
    fireEvent.click(screen.getByRole("button", { name }));
  });
  await settled();
}

export interface Visit {
  readonly Visited: (props: { readonly children: ReactNode }) => ReactNode;
  /** The screen left or returned to, and what that set off flushed. */
  readonly visited: (here: boolean) => Promise<void>;
}

/** A screen that can be left and returned to under the providers that hold
 * it, as a reader leaves one for another screen of the same project. */
export function visitHeld(): Visit {
  let here = true;
  const listeners = new Set<() => void>();
  const subscribe = (listener: () => void): (() => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  };
  function Visited(props: { readonly children: ReactNode }): ReactNode {
    const present = useSyncExternalStore(subscribe, () => here);
    return present ? props.children : null;
  }
  return {
    Visited,
    visited: async (next) => {
      await turned(() => {
        here = next;
        for (const listener of listeners) listener();
      });
      await settled();
    },
  };
}
