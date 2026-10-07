/**
 * The brief panel, on the one decision it makes: whether the ticket carries a
 * brief at all.
 *
 * A ticket released before briefs were kept has none, and the panel that drew
 * an empty intent for it would read as a person who wrote nothing down. The
 * links are the other half — they are somebody else's URLs, so what they open
 * must not reach back into this document.
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

import {
  ticketResponseSchema,
  type TicketResponse,
} from "../../../src/contract/responses.ts";
import type { PanelState } from "../app/core/freshness.ts";
import { TicketBrief } from "../app/browser/TicketProvenance.tsx";
import { SessionProvider } from "../app/browser/session.tsx";
import { answer, holderDouble } from "./screenHarness.tsx";
import { ticketInstants } from "./ticketInstants.ts";

/** The runner has no globals, so the tree one case rendered is torn down here
 * rather than by the library's own hook. */
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const briefPartition = { tenant: "acme", project: "atlas" };

/** Ticket 7 as its own read answers it, with the brief it was released with. */
function released(brief?: TicketResponse["brief"]): PanelState<TicketResponse> {
  return {
    state: "Ready",
    observedAtMs: 0,
    value: ticketResponseSchema.parse({
      ticket: 7,
      phase: "Pending",
      sequence: 1,
      ...ticketInstants,
      configurationRevision: "r1",
      ...(brief === undefined ? {} : { brief }),
    }),
  };
}

test("a brief is drawn as its intent, its links and its branch", () => {
  render(
    <TicketBrief
      partition={briefPartition}
      state={released({
        intent: "make the console show a ticket",
        links: ["https://example.test/one", "https://example.test/two"],
        branch: "refs/heads/rt/console-ticket-page",
      })}
    />,
  );
  expect(screen.getByText("make the console show a ticket")).toBeDefined();
  expect(screen.getByText("refs/heads/rt/console-ticket-page")).toBeDefined();
  const links = screen.getAllByRole("link");
  expect(links.map((link) => link.getAttribute("href"))).toEqual([
    "https://example.test/one",
    "https://example.test/two",
  ]);
});

test("a link this console did not write cannot reach back through what it opens", () => {
  render(
    <TicketBrief
      partition={briefPartition}
      state={released({
        intent: "an intent",
        links: ["https://example.test/one"],
      })}
    />,
  );
  for (const link of screen.getAllByRole("link"))
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
});

test("the check lines a brief appends are drawn one per line, in order", () => {
  render(
    <TicketBrief
      partition={briefPartition}
      state={released({
        intent: "an intent",
        links: [],
        checks: ["npm run lint", "npm test"],
      })}
    />,
  );
  const lines = screen.getByText("checks").nextElementSibling;
  expect(
    [...(lines?.querySelectorAll("li") ?? [])].map((li) => li.textContent),
  ).toEqual(["npm run lint", "npm test"]);
});

/**
 * The panel is handed what the API answered, so a case that hand-builds its
 * value agrees with the panel about a shape neither side got from the wire.
 */
test("the lines a brief appends survive the wire's own parse into the panel", () => {
  const body: unknown = {
    ticket: 7,
    phase: "Pending",
    sequence: 1,
    ...ticketInstants,
    brief: {
      intent: "an intent",
      links: [],
      checks: ["npm run lint", "npm test"],
    },
  };
  render(
    <TicketBrief
      partition={briefPartition}
      state={{
        state: "Ready",
        observedAtMs: 0,
        value: ticketResponseSchema.parse(body),
      }}
    />,
  );
  const lines = screen.getByText("checks").nextElementSibling;
  expect(
    [...(lines?.querySelectorAll("li") ?? [])].map((li) => li.textContent),
  ).toEqual(["npm run lint", "npm test"]);
});

test("a brief appending no check lines says so rather than drawing an empty list", () => {
  render(
    <TicketBrief
      partition={briefPartition}
      state={released({ intent: "an intent", links: [] })}
    />,
  );
  expect(screen.getByText("checks").nextElementSibling?.textContent).toBe(
    "none",
  );
});

test("a brief with no branch says so rather than drawing an empty field", () => {
  render(
    <TicketBrief
      partition={briefPartition}
      state={released({ intent: "an intent", links: [] })}
    />,
  );
  expect(screen.queryAllByRole("link")).toEqual([]);
  expect(screen.getByText("branch").nextElementSibling?.textContent).toBe(
    "none",
  );
});

/** The landing is one field, so the mode is on it whether or not a reference
 * is: a reader who sees no reference has still been told how it lands. */
function landingLine(): string | undefined {
  return screen.getByText("landing").nextElementSibling?.textContent;
}

test("a brief that names where its work lands draws that reference too", () => {
  render(
    <TicketBrief
      partition={briefPartition}
      state={released({
        intent: "an intent",
        links: [],
        branch: "refs/heads/rt/console-ticket-page",
        finalization: { mode: "Push", target: "refs/heads/release/next" },
      })}
    />,
  );
  expect(landingLine()).toBe("Push · lands on refs/heads/release/next");
});

/** A proposal into a reference and a push onto it name the same reference, so
 * the mode before it is the only thing that tells the two apart. */
test("a brief proposing its work into a reference does not say it lands there", () => {
  render(
    <TicketBrief
      partition={briefPartition}
      state={released({
        intent: "an intent",
        links: [],
        branch: "refs/heads/rt/console-ticket-page",
        finalization: { mode: "PullRequest", target: "refs/heads/main" },
      })}
    />,
  );
  expect(landingLine()).toBe("Pull request · into refs/heads/main");
});

/** A brief released before a landing was recorded on the wire carries no
 * `finalization` at all, so the field it would be read in is absent rather
 * than saying "None". */
test("a brief carrying no finalization draws no landing at all", () => {
  render(
    <TicketBrief
      partition={briefPartition}
      state={released({
        intent: "an intent",
        links: [],
        branch: "refs/heads/rt/console-ticket-page",
      })}
    />,
  );
  expect(screen.queryByText("landing")).toBeNull();
});

/** The contract lets a finalization name a mode and no reference, which is the
 * work landing on the branch it was done on. */
test("a finalization naming no reference is still read back as its mode", () => {
  render(
    <TicketBrief
      partition={briefPartition}
      state={released({
        intent: "an intent",
        links: [],
        branch: "refs/heads/rt/console-ticket-page",
        finalization: { mode: "Push" },
      })}
    />,
  );
  expect(landingLine()).toBe("Push");
});

test("a ticket with no brief says why, and draws no empty intent", () => {
  render(<TicketBrief partition={briefPartition} state={released()} />);
  expect(screen.getByText(/released before a brief was kept/u)).toBeDefined();
  expect(screen.queryByText("intent")).toBeNull();
  expect(screen.queryAllByRole("link")).toEqual([]);
});

/** Each image is read through the project's own authenticated read and drawn
 * from a `data:` URI of what it answered, the only image source the console's
 * document admits. */
test("a brief's images are drawn as images, from the project's read of each", async () => {
  const read: string[] = [];
  vi.stubGlobal("fetch", (url: string) => {
    read.push(url);
    return Promise.resolve(
      answer({ content: "AQID", mediaType: "image/png", encoding: "base64" }),
    );
  });
  render(
    <SessionProvider holder={holderDouble()}>
      <QueryClientProvider client={new QueryClient()}>
        <TicketBrief
          partition={briefPartition}
          state={released({
            intent: "an intent",
            links: [],
            images: ["artifact-1", "artifact-2"],
          })}
        />
      </QueryClientProvider>
    </SessionProvider>,
  );
  await waitFor(() => {
    expect(screen.getAllByRole("img")).toHaveLength(2);
  });
  expect(
    screen.getAllByRole("img").map((image) => image.getAttribute("src")),
  ).toStrictEqual(["data:image/png;base64,AQID", "data:image/png;base64,AQID"]);
  expect(read.map((url) => url.split("/").at(-1))).toStrictEqual([
    "artifact-1",
    "artifact-2",
  ]);
});
