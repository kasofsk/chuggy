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
  projectListKey,
  projectResourceKey,
} from "../app/core/projectQueryKeys.ts";
import type { ProjectQueryKey } from "../app/core/projectQueryKeys.ts";
import type { SessionHolder } from "../app/core/sessionHolder.ts";
import { SessionProvider } from "../app/browser/session.tsx";
import {
  ProjectStreamProvider,
  useProjectListFold,
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
 * One `Ticket` change, and a list fold registered for whichever kind the case
 * is about, so that what separates the two cases below is the kind alone.
 */
async function foldedResources(
  registeredKind: ProjectChangeKind,
  key: ProjectQueryKey,
): Promise<unknown> {
  const client = new QueryClient();
  client.setQueryData(key, []);
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
  function Folder(): ReactNode {
    useProjectListFold(registeredKind, key, (previous, change) => [
      ...(previous as unknown[]),
      change.resource,
    ]);
    return null;
  }
  render(
    <Harness
      holder={holderDouble()}
      client={client}
      partition={atlas}
      transport={server.ports.fetch}
    >
      <Folder />
    </Harness>,
  );
  await settled();
  return client.getQueryData(key);
}

test("a registered list fold is offered the same representation", async () => {
  const folded = await foldedResources(
    "Ticket",
    projectListKey(atlas, "Ticket", "frontier"),
  );
  expect(folded).toEqual(["3"]);
});

test("a fold registered for one kind is not offered another kind's change", async () => {
  const folded = await foldedResources(
    "Draft",
    projectListKey(atlas, "Draft", "drafts"),
  );
  expect(folded).toEqual([]);
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
