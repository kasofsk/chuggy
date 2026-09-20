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
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";
import type { ReactNode } from "react";

import type { PartitionIdentity } from "../../../src/contract/http.ts";
import {
  projectListFolded,
  projectListReread,
  projectResourceKey,
} from "../app/core/projectQueryKeys.ts";
import type {
  ProjectList,
  ProjectResourceKind,
} from "../app/core/projectQueryKeys.ts";
import type { SessionHolder } from "../app/core/sessionHolder.ts";
import { usePanelList } from "../app/browser/api.ts";
import { SessionProvider } from "../app/browser/session.tsx";
import { ShellFrame, StreamBanner } from "../app/browser/Shell.tsx";
import {
  ProjectStreamProvider,
  useProjectListRefresh,
  useProjectStreamStatus,
} from "../app/browser/stream.tsx";
import { frame, streamServer } from "./streamDouble.ts";
import type { StreamServer } from "./streamDouble.ts";

afterEach(cleanup);

const atlas: PartitionIdentity = { tenant: "acme", project: "atlas" };
const beta: PartitionIdentity = { tenant: "acme", project: "beta" };
const ticket = { ticket: 3, state: "Working" };

type Transport = Parameters<typeof ProjectStreamProvider>[0]["transport"];

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
  readonly transport: Transport;
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

const ticketChange = frame("Ticket", "5", {
  version: 1,
  resource: "3",
  representation: ticket,
});

const sessionChange = frame("Session", "6", {
  version: 1,
  resource: JSON.stringify({
    session: "lead-atlas",
    kind: "Lead",
    turn: "turn-7",
  }),
  representation: { session: "lead-atlas" },
});

/**
 * A change frame stales its resource instead of installing a body no schema
 * here has read, so the entry keeps what the route answered and is marked to be
 * asked again.
 */
test("a live frame stales its resource rather than writing the frame's body", async () => {
  const client = new QueryClient();
  const held = projectResourceKey(atlas, "Ticket", "3");
  client.setQueryData(held, { ticket: 3, state: "Adopted" });
  const server = streamServer([
    {
      status: 200,
      chunks: [frame("ready", undefined, { version: 1 }), ticketChange],
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
  expect(client.getQueryData(held)).toEqual({ ticket: 3, state: "Adopted" });
  expect(client.getQueryState(held)?.isInvalidated).toBe(true);
});

test("a tombstone drops the entry rather than leaving it on the screen", async () => {
  const client = new QueryClient();
  const held = projectResourceKey(atlas, "Ticket", "3");
  client.setQueryData(held, ticket);
  const server = streamServer([
    {
      status: 200,
      chunks: [
        frame("Ticket", "7", {
          version: 1,
          resource: "3",
          representation: null,
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
  expect(client.getQueryData(held)).toBeUndefined();
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
  kind: ProjectResourceKind,
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
  const client = await refreshedEntry(namingList("Session", "sessions"), []);
  expect(client.getQueryData(namingList("Session", "sessions").key)).toEqual(
    [],
  );
});

/**
 * The project table's own entry, registered by name here rather than by
 * mounting the screen, so what is checked is that a `Ticket` frame stales it
 * and another kind's frame does not.
 */
test("a ticket frame stales the project table's entry", async () => {
  const table = projectListReread<unknown>(atlas, "Ticket", "table");
  const client = await refreshedEntry(table, "held");
  expect(client.getQueryState(table.key)?.isInvalidated).toBe(true);
});

test("a session frame leaves the project table's entry alone", async () => {
  const table = projectListReread<unknown>(atlas, "Ticket", "table");
  const client = await refreshedEntry(table, "held", sessionChange);
  expect(client.getQueryState(table.key)?.isInvalidated).toBe(false);
});

/**
 * The registration a panel gets for free: `usePanelList` is where a list's
 * refresh is put on the registry, so the project table is re-asked on a
 * `Ticket` frame without that screen doing anything about the stream at all.
 */
test("a list read through usePanelList is re-asked on its kind's frame", async () => {
  const client = new QueryClient();
  const table = projectListReread<number>(atlas, "Ticket", "table");
  let reads = 0;
  function Table(): ReactNode {
    usePanelList(table, () => {
      reads += 1;
      return Promise.resolve({ outcome: "Ok", value: reads });
    });
    return null;
  }
  const server = streamServer([
    { status: 200, chunks: [ticketChange], hold: true },
  ]);
  render(
    <Harness
      holder={holderDouble()}
      client={client}
      partition={atlas}
      transport={server.ports.fetch}
    >
      <Table />
    </Harness>,
  );
  await settled();
  expect(reads).toBeGreaterThan(1);
});

/**
 * A frame arriving while the entry is being read must not be swallowed: the
 * reread restarts the read in flight rather than joining it, so what answers
 * was asked for after the change existed.
 */
test("a frame arriving mid-read restarts the read rather than joining it", async () => {
  const client = new QueryClient();
  const table = projectListReread<number>(atlas, "Ticket", "table");
  client.setQueryData(table.key, 0);
  let reads = 0;
  function Table(): ReactNode {
    usePanelList(table, () => {
      reads += 1;
      return new Promise(() => undefined);
    });
    return null;
  }
  const server = streamServer([{ status: 200, chunks: [], hold: true }]);
  render(
    <Harness
      holder={holderDouble()}
      client={client}
      partition={atlas}
      transport={server.ports.fetch}
    >
      <Table />
    </Harness>,
  );
  await settled();
  expect(reads).toBe(1);
  await act(async () => {
    server.push(ticketChange);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  expect(reads).toBe(2);
});

/** A reset is the one frame that reaches every entry of the partition, because
 * it says the console's whole picture may be behind. */
test("a reset invalidates the partition the stream is open on", async () => {
  const client = new QueryClient();
  const held = projectResourceKey(atlas, "Ticket", "3");
  client.setQueryData(held, ticket);
  const server = streamServer([
    {
      status: 200,
      chunks: [frame("reset", undefined, { version: 1 })],
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
  expect(client.getQueryState(held)?.isInvalidated).toBe(true);
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
async function banner(transport: Transport): Promise<Element | null> {
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
  transport: Transport,
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
  return view.container
    .querySelector("[data-stream]")
    ?.getAttribute("data-stream");
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
function openingThenHanging(server: StreamServer): NonNullable<Transport> {
  let opens = 0;
  return (url, init) => {
    opens += 1;
    return opens === 1
      ? server.ports.fetch(url, init)
      : new Promise(() => undefined);
  };
}

function liveThenHolding(): StreamServer {
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

/**
 * A token renewal replaces the run, not the reader's place in the console, so
 * the reopen it starts is not a first open. Reading it as one takes the banner
 * down over screens still showing what they held before the renewal.
 */
test("a reopen after a token renewal is not read as a first open", async () => {
  const holder = holderDouble();
  const view = render(
    <Harness
      holder={holder}
      client={new QueryClient()}
      partition={atlas}
      transport={openingThenHanging(liveThenHolding())}
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
  const client = new QueryClient();
  const transport = openingThenHanging(liveThenHolding());
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
