/**
 * The stream as the tree holds it: what a live frame does to the cache, what
 * makes the connection be replaced, and what a reader is told when it is not
 * live.
 *
 * The two reopens are the point — a project change and a token renewal both
 * leave a connection that is answering for the wrong thing, and neither is
 * visible from a unit test of the client alone.
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import type { ReactNode } from "react";

import type { PartitionIdentity } from "../../../src/contract/http.ts";
import type { ProjectChangeKind } from "../../../src/contract/events.ts";
import {
  projectListFolded,
  projectResourceKey,
} from "../app/core/projectQueryKeys.ts";
import type { ProjectList } from "../app/core/projectQueryKeys.ts";
import { creationContextList } from "../app/core/ticketCreationRun.ts";
import type { SessionHolder } from "../app/core/sessionHolder.ts";
import { SessionProvider } from "../app/browser/session.tsx";
import { ShellFrame, StreamBanner } from "../app/browser/Shell.tsx";
import {
  ProjectStreamProvider,
  useProjectListRefresh,
  useProjectStreamStatus,
} from "../app/browser/stream.tsx";
import { frame, streamServer } from "./streamDouble.ts";
import type { StreamServer } from "./streamDouble.ts";
import { ticketInstants } from "./ticketInstants.ts";

const atlas: PartitionIdentity = { tenant: "acme", project: "atlas" };
const beta: PartitionIdentity = { tenant: "acme", project: "beta" };
const ticket = { ticket: 3, phase: "Working", sequence: 9, ...ticketInstants };

function holderDouble(): SessionHolder & { renew: () => void } {
  let generation = 1;
  const listeners = new Set<() => void>();
  const snapshot = {
    phase: "SignedIn" as const,
    reason: undefined,
    configuration: undefined,
  };
  return {
    load: () => Promise.resolve(),
    completeCallback: () => Promise.resolve({ result: "None" as const }),
    signIn: () => Promise.resolve(),
    signOut: () => Promise.resolve(),
    bearer: () => Promise.resolve("token"),
    refresh: () => Promise.resolve(true),
    refuse: () => undefined,
    refreshDueAtMs: () => undefined,
    generation: () => generation,
    snapshot: () => snapshot,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    renew: () => {
      generation += 1;
      for (const listener of listeners) listener();
    },
  };
}

function Harness(props: {
  readonly holder: SessionHolder;
  readonly client: QueryClient;
  readonly partition: PartitionIdentity;
  readonly transport: Parameters<typeof ProjectStreamProvider>[0]["transport"];
  readonly children?: ReactNode;
}): ReactNode {
  return (
    <SessionProvider holder={props.holder}>
      <QueryClientProvider client={props.client}>
        <ProjectStreamProvider
          partition={props.partition}
          {...(props.transport === undefined
            ? {}
            : { transport: props.transport })}
        >
          {props.children}
        </ProjectStreamProvider>
      </QueryClientProvider>
    </SessionProvider>
  );
}

function Status(): ReactNode {
  const status = useProjectStreamStatus();
  return (
    <p>
      {status.connection}/{status.source}
    </p>
  );
}

async function settled(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

test("a live frame is written into the cache and nothing is refetched", async () => {
  const client = new QueryClient();
  const server = streamServer([
    {
      status: 200,
      chunks: [
        frame("ready", undefined, { version: 1 }),
        frame("Ticket", "5", {
          version: 1,
          resource: "3",
          representation: ticket,
        }),
      ],
      hold: true,
    },
  ]);
  render(
    <Harness
      holder={holderDouble()}
      client={client}
      partition={atlas}
      transport={server.ports.fetch}
    />,
  );
  await settled();
  expect(client.getQueryData(projectResourceKey(atlas, "Ticket", "3"))).toEqual(
    ticket,
  );
});

const ticketChange = frame("Ticket", "5", {
  version: 1,
  resource: "3",
  representation: ticket,
});

const configurationChange = frame("Configuration", "6", {
  version: 1,
  resource: "r2",
  representation: {
    partition: atlas,
    revision: "r2",
    canonical: "{}",
    digest: "d".repeat(64),
  },
});

/**
 * One change, offered to one registered list, so that what separates the cases
 * below is the list's own declaration alone. The client is handed back because
 * a reread leaves its entry where it is and marks it, which is a state rather
 * than a value.
 */
async function refreshedEntry<T>(
  list: ProjectList<T>,
  held: unknown,
  change = ticketChange,
): Promise<QueryClient> {
  const client = new QueryClient();
  client.setQueryData(list.key, held);
  const server = streamServer([{ status: 200, chunks: [change], hold: true }]);
  function Registered(): ReactNode {
    useProjectListRefresh(list);
    return null;
  }
  render(
    <Harness
      holder={holderDouble()}
      client={client}
      partition={atlas}
      transport={server.ports.fetch}
    >
      <Registered />
    </Harness>,
  );
  await settled();
  return client;
}

/** The resources its kind's frames named, which is the smallest fold that shows
 * which frames a registration was offered. */
function namingList(
  kind: ProjectChangeKind,
  name: string,
): ProjectList<readonly string[]> {
  return projectListFolded<readonly string[]>(
    atlas,
    kind,
    name,
    (previous, change) => [...(previous ?? []), change.resource],
  );
}

test("a registered list fold is offered the same representation", async () => {
  const client = await refreshedEntry(namingList("Ticket", "frontier"), []);
  expect(client.getQueryData(namingList("Ticket", "frontier").key)).toEqual([
    "3",
  ]);
});

test("a fold registered for one kind is not offered another kind's change", async () => {
  const client = await refreshedEntry(namingList("Draft", "drafts"), []);
  expect(client.getQueryData(namingList("Draft", "drafts").key)).toEqual([]);
});

/**
 * The creation screen's context is whichever revision is ready, which no one
 * frame's own revision settles — so any `Configuration` frame stales it, and a
 * `Ticket` frame, being another kind, does not. A reread names no resource, so
 * the kind is the whole of what separates these two.
 */
test("the creation context is staled by a configuration frame", async () => {
  const list = creationContextList(atlas);
  const client = await refreshedEntry(list, "held", configurationChange);
  expect(client.getQueryState(list.key)?.isInvalidated).toBe(true);
});

test("the creation context is left alone by a ticket frame", async () => {
  const list = creationContextList(atlas);
  const client = await refreshedEntry(list, "held");
  expect(client.getQueryState(list.key)?.isInvalidated).toBe(false);
});

test("a project change abandons the connection and opens the next one", async () => {
  const client = new QueryClient();
  const server = streamServer([
    { status: 200, chunks: [], hold: true },
    { status: 200, chunks: [], hold: true },
  ]);
  const holder = holderDouble();
  const view = render(
    <Harness
      holder={holder}
      client={client}
      partition={atlas}
      transport={server.ports.fetch}
    />,
  );
  await settled();
  view.rerender(
    <Harness
      holder={holder}
      client={client}
      partition={beta}
      transport={server.ports.fetch}
    />,
  );
  await settled();
  expect(server.aborts.length).toBeGreaterThanOrEqual(1);
  expect(server.headersSeen.length).toBe(2);
});

test("a renewed token reopens the stream rather than carrying the old one", async () => {
  const client = new QueryClient();
  const server = streamServer([
    { status: 200, chunks: [], hold: true },
    { status: 200, chunks: [], hold: true },
  ]);
  const holder = holderDouble();
  render(
    <Harness
      holder={holder}
      client={client}
      partition={atlas}
      transport={server.ports.fetch}
    />,
  );
  await settled();
  expect(server.headersSeen.length).toBe(1);
  await act(async () => {
    holder.renew();
    await Promise.resolve();
  });
  await settled();
  expect(server.headersSeen.length).toBe(2);
});

test("a stream that is not live says so where a reader will see it", async () => {
  const client = new QueryClient();
  const server = streamServer([
    {
      status: 200,
      chunks: [frame("source", undefined, { version: 1, state: "degraded" })],
      hold: true,
    },
  ]);
  render(
    <Harness
      holder={holderDouble()}
      client={client}
      partition={atlas}
      transport={server.ports.fetch}
    >
      <Status />
    </Harness>,
  );
  await settled();
  expect(screen.getByText("Open/degraded")).toBeDefined();
});

/** The banner over a transport the case chooses, so what is read is the one
 * thing the shell decides rather than the whole shell. */
async function banner(
  transport: Parameters<typeof ProjectStreamProvider>[0]["transport"],
): Promise<Element | null> {
  const view = render(
    <Harness
      holder={holderDouble()}
      client={new QueryClient()}
      partition={atlas}
      transport={transport}
    >
      <StreamBanner />
    </Harness>,
  );
  await settled();
  return view.container.querySelector(".notice-parked");
}

/** What the shell's own element says about the stream, which is not what the
 * banner says: the banner is silent for two opposite reasons. */
async function shellStream(
  transport: Parameters<typeof ProjectStreamProvider>[0]["transport"],
): Promise<string | null | undefined> {
  const view = render(
    <Harness
      holder={holderDouble()}
      client={new QueryClient()}
      partition={atlas}
      transport={transport}
    >
      <ShellFrame>
        <p>drawn</p>
      </ShellFrame>
    </Harness>,
  );
  await settled();
  return view.container.querySelector(".shell")?.getAttribute("data-stream");
}

test("the shell says the stream is live once it is carrying changes", async () => {
  const server = streamServer([
    {
      status: 200,
      chunks: [
        frame("ready", undefined, { version: 1 }),
        frame("source", undefined, { version: 1, state: "live" }),
      ],
      hold: true,
    },
  ]);
  expect(await shellStream(server.ports.fetch)).toBe("live");
});

test("the shell says the stream is not live while it is still opening", async () => {
  expect(await shellStream(() => new Promise(() => undefined))).toBe(
    "not-live",
  );
});

/**
 * A first connection has never had the chance to fail, so there is nothing to
 * tell a reader; a refused one has, and saying nothing then would leave a stale
 * screen silent.
 */
test("a connection that is still opening for the first time says nothing", async () => {
  expect(await banner(() => new Promise(() => undefined))).toBeNull();
});

test("a connection the API refuses says so where a reader will see it", async () => {
  const server = streamServer([{ status: 401 }]);
  expect(await banner(server.ports.fetch)).not.toBeNull();
});

/** A live connection, and then nothing: the second open never answers, which is
 * what a renewal onto an API that has stopped responding looks like. */
function openingThenHanging(
  server: StreamServer,
): NonNullable<Parameters<typeof ProjectStreamProvider>[0]["transport"]> {
  let opens = 0;
  return (url, init) => {
    opens += 1;
    return opens === 1
      ? server.ports.fetch(url, init)
      : new Promise(() => undefined);
  };
}

/**
 * A token renewal replaces the run, not the reader's place in the console, so
 * the reopen it starts is not a first open. Reading it as one takes the banner
 * down over screens still showing what they held before the renewal.
 */
test("a reopen after a token renewal is not read as a first open", async () => {
  const holder = holderDouble();
  const server = streamServer([
    {
      status: 200,
      chunks: [
        frame("ready", undefined, { version: 1 }),
        frame("source", undefined, { version: 1, state: "live" }),
      ],
      hold: true,
    },
  ]);
  const view = render(
    <Harness
      holder={holder}
      client={new QueryClient()}
      partition={atlas}
      transport={openingThenHanging(server)}
    >
      <StreamBanner />
    </Harness>,
  );
  await settled();
  expect(view.container.querySelector(".notice-parked")).toBeNull();

  await act(async () => {
    holder.renew();
    await Promise.resolve();
  });
  await settled();

  expect(view.container.querySelector(".notice-parked")).not.toBeNull();
});

/**
 * The other side of that: a different project is a first open of its own, and
 * what this console learnt about one partition's stream says nothing about the
 * next one's. Carrying it across would paint the alarm over the new project's
 * first paint, on every use of the switcher.
 */
test("a project change is a first open again rather than a reopen", async () => {
  const holder = holderDouble();
  const server = streamServer([
    {
      status: 200,
      chunks: [
        frame("ready", undefined, { version: 1 }),
        frame("source", undefined, { version: 1, state: "live" }),
      ],
      hold: true,
    },
  ]);
  const client = new QueryClient();
  const transport = openingThenHanging(server);
  const view = render(
    <Harness
      holder={holder}
      client={client}
      partition={atlas}
      transport={transport}
    >
      <StreamBanner />
    </Harness>,
  );
  await settled();
  expect(view.container.querySelector(".notice-parked")).toBeNull();

  view.rerender(
    <Harness
      holder={holder}
      client={client}
      partition={beta}
      transport={transport}
    >
      <StreamBanner />
    </Harness>,
  );
  await settled();

  expect(view.container.querySelector(".notice-parked")).toBeNull();
});
