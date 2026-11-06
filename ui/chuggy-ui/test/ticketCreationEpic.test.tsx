/**
 * The epic a ticket joins as it is made, offered from the project's Active
 * epics in the creation form.
 */

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { answeringApi } from "./answeringApi.ts";
import { creationFormDrawn } from "./creationFormDrawn.tsx";
import { resizeObserverStubbed } from "./resizeObserver.ts";
import { answer } from "./screenHarness.tsx";
import { creationOffers } from "./ticketCreationFixture.ts";

beforeEach(() => {
  resizeObserverStubbed();
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const billing = {
  number: 7,
  revision: 1,
  title: "Billing",
  visibility: "Active",
  progress: {
    byPhase: {
      Pending: 0,
      Work: 0,
      Evaluation: 0,
      Finalization: 0,
      Done: 0,
      Escalated: 0,
      Revoked: 0,
    },
    drafts: 0,
    done: 0,
    total: 0,
  },
  status: "empty",
  waitingOnOutside: [],
};

/** The form over a project whose Active epics are the ones given. */
function drawnOver(epics: readonly unknown[]): string[] {
  const asked: string[] = [];
  vi.stubGlobal("fetch", (input: RequestInfo | URL) => {
    const url = input instanceof Request ? input.url : String(input);
    asked.push(url);
    return Promise.resolve(
      url.includes("/epics") ? answer({ epics }) : answer({}, 404),
    );
  });
  const { ports } = answeringApi(() => ({ status: 404, body: {} }));
  render(creationFormDrawn(ports, creationOffers));
  return asked;
}

test("the creation form offers the project's Active epics, by title", async () => {
  const asked = drawnOver([billing]);
  await waitFor(() => {
    expect(screen.getAllByText("Epic").length).toBeGreaterThan(0);
  });
  expect(
    asked.some(
      (url) => url.includes("/epics?") && url.includes("visibility=Active"),
    ),
  ).toBe(true);
});
