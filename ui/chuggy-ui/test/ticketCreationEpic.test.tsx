/**
 * The epic a ticket joins as it is made, offered from the project's Active
 * epics in the creation form.
 */

import {
  cleanup,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { renderCopied } from "./copied.tsx";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { answeringApi } from "./answeringApi.ts";
import { creationFormDrawn } from "./creationFormDrawn.tsx";
import { resizeObserverStubbed } from "./resizeObserver.ts";
import { answer, turned } from "./screenHarness.tsx";
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

/** The form over a project whose Active epics are the ones given, a page
 * holding the ones `paged` names for the `after` it is asked with. */
function drawnOver(
  epics: readonly unknown[],
  paged: (after: string | null) => unknown = () => ({ epics }),
): string[] {
  const asked: string[] = [];
  vi.stubGlobal("fetch", (input: RequestInfo | URL) => {
    const url = input instanceof Request ? input.url : String(input);
    asked.push(url);
    return Promise.resolve(
      url.includes("/epics")
        ? answer(paged(new URL(url, "http://x").searchParams.get("after")))
        : answer({}, 404),
    );
  });
  const { ports } = answeringApi(() => ({ status: 404, body: {} }));
  renderCopied(creationFormDrawn(ports, creationOffers));
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

async function epicMenuOpened(): Promise<HTMLElement> {
  await waitFor(() => {
    expect(screen.getByRole("button", { name: /^Epic/u })).toBeTruthy();
  });
  await turned(() => {
    fireEvent.keyDown(screen.getByRole("button", { name: /^Epic/u }), {
      key: "ArrowDown",
    });
  });
  return screen.getByRole("menu");
}

test("an epic past the picker's first page is reached by asking for more, and the trigger names it", async () => {
  const shipping = { ...billing, number: 9, title: "Shipping" };
  const asked = drawnOver([], (after) =>
    after === null
      ? { epics: [billing], nextAfter: billing.number }
      : { epics: [shipping] },
  );
  const first = await epicMenuOpened();
  expect(within(first).queryByRole("menuitemradio", { name: "Shipping" })).toBe(
    null,
  );
  await turned(() => {
    fireEvent.click(
      within(first).getByRole("menuitem", { name: "More epics" }),
    );
  });
  const next = await epicMenuOpened();
  await waitFor(() => {
    expect(
      within(next).getByRole("menuitemradio", { name: "Shipping" }),
    ).toBeTruthy();
  });
  expect(asked.some((url) => url.includes("after=7"))).toBe(true);
  await turned(() => {
    fireEvent.click(
      within(next).getByRole("menuitemradio", { name: "Shipping" }),
    );
  });
  const back = await epicMenuOpened();
  await turned(() => {
    fireEvent.click(
      within(back).getByRole("menuitem", { name: "First epics" }),
    );
  });
  await waitFor(() => {
    expect(
      screen.getByRole("button", { name: /^Epic/u }).textContent,
    ).toContain("Shipping");
  });
});
