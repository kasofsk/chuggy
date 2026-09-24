/**
 * The edit form as a person drives it: what it is prefilled with, what it
 * will not let them change, and what one click sends in what order.
 *
 * The API is a double that records every request, so what is asserted is the
 * traffic and the screen rather than a return value.
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import type {
  DraftResponse,
  TicketResponse,
} from "../../../src/contract/responses.ts";
import type { ApiPorts } from "../app/core/apiRequest.ts";
import { EditForm } from "../app/browser/TicketEdit.tsx";
import {
  creationDraft,
  creationInitialization,
  creationPartition,
  creationSummary,
} from "./ticketCreationFixture.ts";
import { ticketInstants } from "./ticketInstants.ts";
import { resizeObserverStubbed } from "./resizeObserver.ts";

beforeEach(resizeObserverStubbed);

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const ticket: TicketResponse = {
  ticket: 12,
  phase: "Pending",
  sequence: 42,
  ...ticketInstants,
  revision: 2,
};

const draft: DraftResponse = {
  ...creationDraft,
  state: "Released",
  authoringVersion: 3,
  releasedAuthoringVersion: 3,
  authoring: { ...creationDraft.authoring, dependencies: [7] },
  brief: {
    title: "Ship it",
    intent: "ship the thing",
    links: [],
    branch: "refs/heads/topic/one",
    finalization: { mode: "Push" },
  },
};

interface Sent {
  readonly method: string;
  readonly path: string;
  readonly body: unknown;
}

/** What the door answers the revision with, and the settled operation after. */
function api(revised: { readonly status: number; readonly body: unknown }): {
  readonly ports: ApiPorts;
  readonly sent: Sent[];
} {
  const sent: Sent[] = [];
  const answerOf = (method: string, path: string): unknown => {
    if (method === "PUT") return revised;
    if (method === "POST")
      return { status: 202, body: { operation: "op", state: "Pending" } };
    if (path.includes("/operations/"))
      return {
        status: 200,
        body: {
          operation: "op",
          acceptedAt: "2026-08-26T00:00:00Z",
          state: "Succeeded",
          decidedSequence: 43,
        },
      };
    return {
      status: 200,
      body: {
        partition: creationPartition,
        sequence: 43,
        tickets: [{ ...ticket, sequence: 43, revision: 3 }],
      },
    };
  };
  return {
    sent,
    ports: {
      fetch: (path, init) => {
        sent.push({
          method: init.method,
          path,
          body: init.body === undefined ? undefined : JSON.parse(init.body),
        });
        const answer = answerOf(init.method, path) as {
          readonly status: number;
          readonly body: unknown;
        };
        return Promise.resolve({
          status: answer.status,
          headers: { get: () => null },
          text: () => Promise.resolve(JSON.stringify(answer.body)),
        } as unknown as Response);
      },
      bearer: () => Promise.resolve("token"),
      sleepMs: () => Promise.resolve(),
    },
  };
}

function draw(ports: ApiPorts, updated: string[]): void {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <EditForm
        ports={ports}
        partition={creationPartition}
        subject={{ ticket, draft }}
        context={{
          context: "Ready",
          configuration: creationSummary("r3", "Ready"),
          initialization: creationInitialization,
          repositories: [],
        }}
        onUpdated={() => updated.push("updated")}
      />
    </QueryClientProvider>,
  );
}

function submit(): void {
  fireEvent.click(screen.getByText("revise and release"));
}

test("the form opens on the draft's current revision", () => {
  draw(api({ status: 200, body: draft }).ports, []);
  expect(
    screen.getByPlaceholderText<HTMLInputElement>("what this ticket is called")
      .value,
  ).toBe("Ship it");
  expect(
    screen.getByPlaceholderText<HTMLTextAreaElement>("what this ticket is for")
      .value,
  ).toBe("ship the thing");
  expect(
    screen.getByPlaceholderText<HTMLInputElement>("the branch name").value,
  ).toBe("topic/one");
});

test("the dependencies are drawn, and nowhere offered to change", () => {
  draw(api({ status: 200, body: draft }).ports, []);
  expect(screen.getByText("#7")).toBeDefined();
  expect(screen.getByText("fixed once the ticket was released")).toBeDefined();
  fireEvent.click(screen.getByRole("button", { name: /Advanced/u }));
  expect(screen.queryByText("ticket 7")).toBeNull();
  expect(screen.queryAllByRole("checkbox")).toEqual([]);
});

test("a submit revises the draft, then releases the update, then leaves", async () => {
  const held = api({ status: 200, body: { ...draft, authoringVersion: 4 } });
  const updated: string[] = [];
  draw(held.ports, updated);
  fireEvent.change(screen.getByPlaceholderText("what this ticket is for"), {
    target: { value: "ship the other thing" },
  });
  submit();
  await waitFor(() => {
    expect(updated).toStrictEqual(["updated"]);
  });
  const writes = held.sent.filter((one) => one.method !== "GET");
  expect(writes.map((one) => `${one.method} ${one.path}`)).toStrictEqual([
    expect.stringMatching(/^PUT .*\/drafts\/12$/u),
    expect.stringMatching(/^POST .*\/operations$/u),
  ]);
  expect(writes[0]?.body).toMatchObject({
    expectedVersion: 3,
    authoring: { dependencies: [7] },
    brief: { intent: "ship the other thing" },
  });
  expect(writes[1]?.body).toMatchObject({
    mutation: {
      mutation: "UpdateTicket",
      ticket: 12,
      expectedRevision: 2,
      authoringVersion: 4,
    },
  });
});

test("a revision the door locks is said in its own words, and nothing is released", async () => {
  const held = api({
    status: 409,
    body: { error: { code: "DependenciesLocked" } },
  });
  const updated: string[] = [];
  draw(held.ports, updated);
  submit();
  await screen.findByText(
    "what this ticket depends on cannot change once it is released",
  );
  expect(updated).toStrictEqual([]);
  expect(held.sent.some((one) => one.path.endsWith("/operations"))).toBe(false);
});
