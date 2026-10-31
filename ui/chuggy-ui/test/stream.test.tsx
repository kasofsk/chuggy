/**
 * The stream as the tree holds it: what a live frame does to the cache, what
 * makes the connection be replaced, and what a reader is told when it is not
 * live.
 *
 * The two reopens are the point — a project change and a token renewal both
 * leave a connection that is answering for the wrong thing, and neither is
 * visible from a unit test of the client alone.
 *
 * A wait as long as the grace is parked until a case says it has passed. The
 * ladder's floor passes at once, so a reopen takes a turn, and every longer
 * wait never passes, so a stream that fails over and over climbs one rung and
 * stays there. The banner speaks only where a case lets the grace run out.
 */

// jscpd:ignore-start -- renderer tests must declare their own hoisted mock factories
import {
  QueryClient,
  QueryClientProvider,
  useQuery,
} from "@tanstack/react-query";
import { act, render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";
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
import { usePanelList } from "../app/browser/api.ts";
import {
  ProjectStreamProvider,
  streamGraceMs,
  useProjectListRefresh,
  useProjectStreamStatus,
} from "../app/browser/stream.tsx";
import type * as BrowserPorts from "../app/browser/ports.ts";
import { streamReopenDelayMsMin } from "../app/core/streamConnection.ts";
import { frame, streamServer } from "./streamDouble.ts";
import type { StreamServer } from "./streamDouble.ts";
import { ticketInstants } from "./ticketInstants.ts";

const graces = vi.hoisted(() => ({ parked: [] as (() => void)[] }));

vi.mock("../app/browser/ports.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof BrowserPorts>()),
  sleepMs: (ms: number, signal?: AbortSignal) => {
    if (signal?.aborted === true) return Promise.reject(new Error("abandoned"));
    if (ms === streamReopenDelayMsMin) return Promise.resolve();
    return new Promise<void>((resolve, reject) => {
      if (ms === streamGraceMs) graces.parked.push(resolve);
      signal?.addEventListener(
        "abort",
        () => {
          reject(new Error("abandoned"));
        },
        { once: true },
      );
    });
  },
}));
// jscpd:ignore-end -- the case's own doubles resume here

const atlas: PartitionIdentity = { tenant: "acme", project: "atlas" };
const beta: PartitionIdentity = { tenant: "acme", project: "beta" };
const ticket = { ticket: 3, phase: "Work", sequence: 9, ...ticketInstants };

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
  for (let turn = 0; turn < 4; turn += 1)
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
}

/** Every wait as long as the grace let pass, and what that set off flushed. */
async function graceLapsed(): Promise<void> {
  for (const woken of graces.parked.splice(0)) woken();
  await settled();
}

async function renewed(holder: { renew: () => void }): Promise<void> {
  await act(async () => {
    holder.renew();
    await Promise.resolve();
  });
  await settled();
}

test("a live frame is written into the cache and nothing is refetched", async () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
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

/** A stream opened with no bearer is refused as a stranger's, and that
 * refusal is read as the API refusing the session. */
test("a stream under a session with no bearer to send is not opened", async () => {
  const server = streamServer([{ status: 200, hold: true }]);
  render(
    <Harness
      holder={{ ...holderDouble(), bearer: () => Promise.resolve(undefined) }}
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
      partition={atlas}
      transport={server.ports.fetch}
    />,
  );
  await settled();
  expect(server.headersSeen).toEqual([]);
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
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
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
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
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
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
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
  await renewed(holder);
  expect(server.headersSeen.length).toBe(2);
});

test("a stream that is not live says so where a reader will see it", async () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
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
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
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
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
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

test("a connection the API refuses says so once the grace has passed, and that it is not live", async () => {
  const server = streamServer([{ status: 401 }]);
  expect(await banner(server.ports.fetch)).toBeNull();
  await graceLapsed();
  const notice = document.querySelector(".notice-parked");
  expect(notice?.querySelector(".notice-head")?.textContent).toBe("Not live");
  expect(notice?.textContent).not.toContain("the API");
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
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
      partition={atlas}
      transport={openingThenHanging(server)}
    >
      <StreamBanner />
    </Harness>,
  );
  await settled();
  expect(view.container.querySelector(".notice-parked")).toBeNull();

  await renewed(holder);
  expect(view.container.querySelector(".notice-parked")).toBeNull();

  await graceLapsed();
  expect(
    view.container.querySelector(".notice-parked .notice-head")?.textContent,
  ).toBe("Reconnecting");
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
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
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

const sourceLive = frame("source", undefined, { version: 1, state: "live" });
const ready = frame("ready", undefined, { version: 1 });

/** The banner and the shell's own element over one transport, read together
 * because a healthy reopen has to leave both of them quiet. */
function shellDrawn(
  holder: SessionHolder,
  client: QueryClient,
  transport: Parameters<typeof ProjectStreamProvider>[0]["transport"],
): {
  readonly banner: () => Element | null;
  readonly stream: () => string | null | undefined;
} {
  const view = render(
    <Harness
      holder={holder}
      client={client}
      partition={atlas}
      transport={transport}
    >
      <ShellFrame>
        <StreamBanner />
      </ShellFrame>
    </Harness>,
  );
  return {
    banner: () => view.container.querySelector(".notice-parked"),
    stream: () =>
      view.container
        .querySelector("[data-stream]")
        ?.getAttribute("data-stream"),
  };
}

function clientMade(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

test("a stream the server ends at its routine age is opened again with no banner, and stays live past the grace", async () => {
  const server = streamServer([
    { status: 200, chunks: [ready, sourceLive] },
    { status: 200, chunks: [ready, sourceLive], hold: true },
  ]);
  const drawn = shellDrawn(holderDouble(), clientMade(), server.ports.fetch);
  await settled();
  await graceLapsed();
  expect(server.headersSeen.length).toBe(2);
  expect(drawn.banner()).toBeNull();
  expect(drawn.stream()).toBe("live");
});

test("a token renewal reopens from the cursor, replays the frame sent in the gap, and draws no banner", async () => {
  const client = clientMade();
  const holder = holderDouble();
  const replayed = { ...ticket, sequence: 10 };
  const server = streamServer([
    {
      status: 200,
      chunks: [ready, sourceLive, ticketChange],
      hold: true,
    },
    {
      status: 200,
      chunks: [
        ready,
        sourceLive,
        frame("Ticket", "6", {
          version: 1,
          resource: "3",
          representation: replayed,
        }),
      ],
      hold: true,
    },
  ]);
  const drawn = shellDrawn(holder, client, server.ports.fetch);
  await settled();
  await renewed(holder);
  await graceLapsed();
  expect(server.headersSeen[1]?.["last-event-id"]).toBe("5");
  expect(client.getQueryData(projectResourceKey(atlas, "Ticket", "3"))).toEqual(
    replayed,
  );
  expect(drawn.banner()).toBeNull();
  expect(drawn.stream()).toBe("live");
});

/** A renewal whose next open answers only when the case says, so the gap
 * between the two carrying connections is one the tree is drawn across. */
function renewalHeld(server: StreamServer): {
  readonly transport: NonNullable<
    Parameters<typeof ProjectStreamProvider>[0]["transport"]
  >;
  readonly answer: () => void;
} {
  let opens = 0;
  let answer = (): void => undefined;
  return {
    transport: (url, init) => {
      opens += 1;
      if (opens === 1) return server.ports.fetch(url, init);
      return new Promise((resolve) => {
        answer = () => {
          resolve(server.ports.fetch(url, init));
        };
      });
    },
    answer: () => {
      answer();
    },
  };
}

test("a stream that carries again after a gap reads again what failed, and leaves what is healthy", async () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  const reads = { failed: 0, healthy: 0 };
  function Reading(): ReactNode {
    useQuery({
      queryKey: projectResourceKey(atlas, "Ticket", "4"),
      queryFn: () => {
        reads.failed += 1;
        return Promise.reject(new Error("the API answered 500"));
      },
    });
    useQuery({
      queryKey: projectResourceKey(atlas, "Ticket", "3"),
      queryFn: () => {
        reads.healthy += 1;
        return Promise.resolve(ticket);
      },
    });
    return null;
  }
  const holder = holderDouble();
  const live = { status: 200, chunks: [ready, sourceLive], hold: true };
  const renewal = renewalHeld(streamServer([live, live]));
  render(
    <Harness
      holder={holder}
      client={client}
      partition={atlas}
      transport={renewal.transport}
    >
      <Reading />
    </Harness>,
  );
  await settled();
  expect(reads).toEqual({ failed: 1, healthy: 1 });

  await renewed(holder);
  expect(reads).toEqual({ failed: 1, healthy: 1 });
  await act(async () => {
    renewal.answer();
    await Promise.resolve();
  });
  await settled();
  expect(reads).toEqual({ failed: 2, healthy: 1 });
});

test("frames nothing on screen reads draw no list holder again, nor does a status that changes", async () => {
  const server = streamServer([
    { status: 200, chunks: [ready, sourceLive], hold: true },
  ]);
  const renders: number[] = [];
  function Holder(): ReactNode {
    renders.push(1);
    usePanelList(
      namingList("Draft", "drafts"),
      () => new Promise(() => undefined),
    );
    return null;
  }
  render(
    <Harness
      holder={holderDouble()}
      client={clientMade()}
      partition={atlas}
      transport={server.ports.fetch}
    >
      <Holder />
    </Harness>,
  );
  await settled();
  const before = renders.length;
  await act(async () => {
    for (let sequence = 10; sequence < 30; sequence += 1)
      server.push(
        frame("Ticket", String(sequence), {
          version: 1,
          resource: String(sequence),
          representation: { ...ticket, ticket: sequence, sequence },
        }),
      );
    await Promise.resolve();
  });
  await settled();
  expect(renders.length).toBe(before);
  await act(async () => {
    server.push(frame("source", undefined, { version: 1, state: "degraded" }));
    await Promise.resolve();
  });
  await settled();
  expect(renders.length).toBe(before);
});

test("a tombstone leaves what is mounted on its key in place until the read again answers", async () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  const key = projectResourceKey(atlas, "Ticket", "3");
  client.setQueryData(key, ticket);
  let answer: (answered: unknown) => void = () => undefined;
  function Mounted(): ReactNode {
    const query = useQuery({
      queryKey: key,
      queryFn: () =>
        new Promise((resolve) => {
          answer = resolve;
        }),
    });
    return (
      <p>{query.data === undefined ? "gone" : JSON.stringify(query.data)}</p>
    );
  }
  const server = streamServer([
    { status: 200, chunks: [ready, sourceLive], hold: true },
  ]);
  render(
    <Harness
      holder={holderDouble()}
      client={client}
      partition={atlas}
      transport={server.ports.fetch}
    >
      <Mounted />
    </Harness>,
  );
  await settled();
  await act(async () => {
    server.push(
      frame("Ticket", "7", { version: 1, resource: "3", representation: null }),
    );
    await Promise.resolve();
  });
  await settled();
  expect(screen.getByText(JSON.stringify(ticket))).toBeDefined();
  expect(client.getQueryState(key)?.fetchStatus).toBe("fetching");

  await act(async () => {
    answer("answered again");
    await Promise.resolve();
  });
  await settled();
  expect(screen.getByText(JSON.stringify("answered again"))).toBeDefined();
});
