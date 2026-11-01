/**
 * A creation form left after a submit that kept its draft, and come back to:
 * the draft is still the one every later submit goes back to, and the form
 * says so before anything is pressed. The form is unmounted and mounted again
 * under the providers that hold it, as a reader leaving for another screen of
 * the project does.
 */

import { QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { CreationForm } from "../app/browser/TicketCreation.tsx";
import { SessionProvider } from "../app/browser/session.tsx";
import { creationContextList } from "../app/core/ticketCreationRun.ts";
import { answeringApi } from "./answeringApi.ts";
import type { Sent } from "./answeringApi.ts";
import { ConsoleStoreProvided } from "./consoleStoreProvided.tsx";
import { resizeObserverStubbed } from "./resizeObserver.ts";
import {
  holderDouble,
  queryClientUnretried,
  settled,
  visitHeld,
} from "./screenHarness.tsx";
import {
  creationDraft,
  creationOffers,
  creationPartition,
} from "./ticketCreationFixture.ts";
import {
  ticketDoor,
  ticketDoorAnswers,
  ticketRefusedFirst,
} from "./ticketReleasing.tsx";

beforeEach(() => {
  resizeObserverStubbed();
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** The form over a door deciding each release as `decide` says, under one
 * tab's providers, and the way out of it and back. */
function drawnReturnable(decide: (nth: number) => string): {
  readonly sent: Sent[];
  readonly created: number[];
  readonly visited: (here: boolean) => Promise<void>;
} {
  const held = answeringApi(ticketDoorAnswers(ticketDoor(), decide));
  const created: number[] = [];
  const visit = visitHeld();
  render(
    <SessionProvider holder={holderDouble()}>
      <QueryClientProvider client={queryClientUnretried()}>
        <ConsoleStoreProvided>
          <visit.Visited>
            <CreationForm
              ports={held.ports}
              partition={creationPartition}
              queryKey={creationContextList(creationPartition).key}
              context={{
                context: "Ready",
                offers: creationOffers,
                partial: false,
                repositories: [],
              }}
              start="Waits"
              onCreated={(ticket) => created.push(ticket)}
              existing={() => null}
            />
          </visit.Visited>
        </ConsoleStoreProvided>
      </QueryClientProvider>
    </SessionProvider>,
  );
  return { sent: held.sent, created, visited: visit.visited };
}

function typeIntent(text: string): void {
  fireEvent.change(screen.getByPlaceholderText("what this ticket is for"), {
    target: { value: text },
  });
}

async function submitted(): Promise<void> {
  fireEvent.click(screen.getByRole("button", { name: "Create ticket" }));
  await settled();
}

function draftsCreated(sent: readonly Sent[]): number {
  return sent.filter(
    (one) => one.method === "POST" && one.path.endsWith("/drafts"),
  ).length;
}

function draftRevisions(sent: readonly Sent[]): number {
  return sent.filter(
    (one) =>
      one.method === "PUT" &&
      one.path.endsWith(`/drafts/${String(creationDraft.ticket)}`),
  ).length;
}

test.each([
  ["Not released", ticketRefusedFirst],
  ["Maybe released", (nth: number) => (nth === 1 ? "Pending" : "Succeeded")],
])(
  "a form come back to over a draft its refusal left %s says so, and its next submit revises that draft",
  async (standing, decide) => {
    const drawn = drawnReturnable(decide);
    typeIntent("ship it");
    await submitted();
    expect(document.querySelector(".panel-failed")?.textContent).toContain(
      `Draft 12 kept · ${standing}`,
    );

    await drawn.visited(false);
    await drawn.visited(true);
    expect(document.querySelector(".panel-note")?.textContent).toBe(
      `Draft 12 kept · ${standing}`,
    );
    typeIntent("ship that");
    fireEvent.click(screen.getByRole("button", { name: "Create ticket" }));
    await waitFor(() => {
      expect(drawn.created).toStrictEqual([creationDraft.ticket]);
    });

    expect(draftsCreated(drawn.sent)).toBe(1);
    expect(draftRevisions(drawn.sent)).toBe(1);
  },
);
