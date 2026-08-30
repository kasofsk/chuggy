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
  projectListReread,
  projectResourceKey,
} from "../app/core/projectQueryKeys.ts";
import type { ProjectList } from "../app/core/projectQueryKeys.ts";
import type { SessionHolder } from "../app/core/sessionHolder.ts";
import { SessionProvider } from "../app/browser/session.tsx";
import { StreamBanner } from "../app/browser/Shell.tsx";
import {
  ProjectStreamProvider,
  useProjectListRefresh,
  useProjectStreamStatus,
} from "../app/browser/stream.tsx";
import { frame, streamServer } from "./streamDouble.ts";

const atlas: PartitionIdentity = { tenant: "acme", project: "atlas" };
const beta: PartitionIdentity = { tenant: "acme", project: "beta" };
const ticket = { ticket: 3, phase: "Working", sequence: 9 };

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

/**
 * One `Ticket` change naming ticket 3, offered to one registered list, so that
 * what separates the cases below is the list's own declaration alone. The
 * client is handed back because a reread leaves its entry where it is and marks
 * it, which is a state rather than a value.
 */
async function refreshedEntry(
  list: ProjectList<readonly string[]>,
  held: readonly string[],
): Promise<QueryClient> {
  const client = new QueryClient();
  client.setQueryData(list.key, held);
  const server = streamServer([
    {
      status: 200,
      chunks: [
        frame("Ticket", "5", {
          version: 1,
          resource: "3",
          representation: ticket,
        }),
      ],
      hold: true,
    },
  ]);
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

/** A list of the ticket named in its own name, which is the shape of the
 * dispatch entry a ticket page reads. */
function followingList(ticketFollowed: string): ProjectList<readonly string[]> {
  return projectListReread<readonly string[]>(
    atlas,
    "Ticket",
    `dispatch:${ticketFollowed}`,
    (change) => change.resource === ticketFollowed,
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

test("a list that rereads is marked stale by the frame it follows", async () => {
  const list = followingList("3");
  const client = await refreshedEntry(list, ["held"]);
  expect(client.getQueryState(list.key)?.isInvalidated).toBe(true);
});

test("a list that rereads is left alone by another resource's frame", async () => {
  const list = followingList("9");
  const client = await refreshedEntry(list, ["held"]);
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
  return view.container.querySelector(".banner");
}

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
