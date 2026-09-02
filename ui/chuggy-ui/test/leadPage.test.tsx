/**
 * The lead page: where the session stands, what its mailbox measured, what it
 * currently holds, and whether all of that moves when a turn does.
 *
 * THE LIVE CASE IS THE ONE WITH TEETH. The lead read is the `Session` frame's
 * own body, so a frame both rewrites the head and raises the batch count the
 * transcript walks to; a page that did not fold the kind would sit on the turn
 * and the entries it opened with while the lead went on deciding, and would
 * look exactly like a page with nothing to report.
 */

// jscpd:ignore-start -- renderer tests must declare their own hoisted mock factories
import { QueryClient } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import type { ReactNode } from "react";

import { LeadPage } from "../app/browser/LeadPage.tsx";
import {
  answer,
  apiDouble,
  openedStream,
  ScreenHarness,
  settled,
  turned,
} from "./screenHarness.tsx";
import { frame } from "./streamDouble.ts";
import {
  leadBody,
  leadPartition,
  leadRefusals,
  leadRouteAnswer,
  leadSession,
} from "./leadFixture.ts";
import type { LeadServed } from "./leadFixture.ts";
import type * as BrowserPorts from "../app/browser/ports.ts";

vi.mock("../app/browser/ports.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof BrowserPorts>()),
  sleepMs: () => Promise.resolve(),
}));

vi.mock("@tanstack/react-router", () => ({
  createLink: (component: unknown) => component,
  Link: (props: { readonly children?: ReactNode }) => (
    <a href="/">{props.children}</a>
  ),
  useParams: () => ({ ...leadPartition }),
}));
// jscpd:ignore-end -- the case's own doubles resume here

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** The page over a server whose batch count and turn count the case moves. */
async function drawLead(
  holding: () => LeadServed,
): Promise<ReturnType<typeof openedStream>> {
  const api = apiDouble({
    operation: { operation: "op-one", state: "Pending" },
    route: (url) => {
      const found = leadRouteAnswer(url, holding());
      return answer(found.body, found.status);
    },
  });
  vi.stubGlobal("fetch", api.fetch);
  const server = openedStream();
  render(
    <ScreenHarness
      partition={leadPartition}
      client={new QueryClient()}
      transport={server.ports.fetch}
    >
      <LeadPage />
    </ScreenHarness>,
  );
  await settled();
  return server;
}

const opening: LeadServed = {
  batches: 2,
  turns: 1,
  refusals: leadRefusals(false),
};

/** The rows of the Holding panel alone, the decision log drawing rows of its
 * own under the same primitive. */
function holdingEntries(): readonly string[] {
  const panel = screen
    .getByRole("heading", { name: "Holding" })
    .closest(".panel");
  return [...(panel?.querySelectorAll(".ledger-row .ledger-label") ?? [])].map(
    (label) => label.textContent ?? "",
  );
}

function logLines(): readonly HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>(".lead-log > li")];
}

test("the head names the session, its state and the cursor it stands on", async () => {
  await drawLead(() => opening);
  expect(screen.getByRole("heading", { name: "Lead" })).toBeDefined();
  expect(screen.getAllByText(leadSession).length).toBeGreaterThan(0);
  expect(screen.getByText("Open")).toBeDefined();
  expect(screen.getByText("Monitoring")).toBeDefined();
  expect(screen.getByText("1204")).toBeDefined();
});

test("the mailbox tail draws what the pod measured of each turn", async () => {
  await drawLead(() => opening);
  expect(screen.getByText("claude-opus-4")).toBeDefined();
  expect(screen.getByText("Answered")).toBeDefined();
  expect(screen.getByText("52k")).toBeDefined();
  expect(screen.getByText("$0.21")).toBeDefined();
});

/**
 * The Holding panel's whole claim. The store read carries four entries and the
 * lead holds the two from the compaction boundary on, so a page that drew the
 * read as the held would put two conversations the lead has forgotten in front
 * of a reader as what it is working from.
 */
test("what the lead holds is a marked subset of the log and not the whole of it", async () => {
  await drawLead(() => opening);
  expect(holdingEntries()).toStrictEqual(["Entry 3", "Entry 4"]);
  expect(logLines().length).toBe(5);
});

/** The seam sits above the entry the compaction cut at, so the entries below it
 * read as gone and the ones after it as held. */
test("the seam is drawn once, above the boundary entry and nowhere else", async () => {
  await drawLead(() => opening);
  const lines = logLines();
  const seams = lines.flatMap((line, at) =>
    line.className === "lead-seam" ? [at] : [],
  );
  expect(seams).toStrictEqual([2]);
  expect(lines[3]?.dataset["holding"]).toBe("true");
  expect(lines[0]?.dataset["holding"]).toBeUndefined();
});

test("a project with no lead is a page saying so, not five empty panels", async () => {
  const api = apiDouble({
    operation: { operation: "op-one", state: "Pending" },
    route: (url) =>
      url.includes("/lead")
        ? answer({ error: { code: "NotFound", message: "no" } }, 404)
        : answer({ partition: leadPartition, sequence: 1, tickets: [] }),
  });
  vi.stubGlobal("fetch", api.fetch);
  render(
    <ScreenHarness
      partition={leadPartition}
      client={new QueryClient()}
      transport={openedStream().ports.fetch}
    >
      <LeadPage />
    </ScreenHarness>,
  );
  await settled();
  expect(screen.getByRole("heading", { name: "No lead" })).toBeDefined();
});

/**
 * A turn moving arrives as a `Session` frame carrying the lead's own body, and
 * the transcript follows it because the batch count it walks to is in that
 * body. A page not folding the kind stays on the turn and the entries it
 * opened with.
 */
test("a Session frame moves the turn tail and walks the transcript on", async () => {
  let served: LeadServed = opening;
  const server = await drawLead(() => served);
  expect(logLines().length).toBe(5);
  served = { ...opening, batches: 3, turns: 2 };
  await turned(() => {
    server.push(
      frame("Session", "40", {
        version: 1,
        resource: leadSession,
        representation: leadBody(3, 2),
      }),
    );
  });
  await settled();
  expect(screen.getByText("third decision")).toBeDefined();
  expect(logLines().length).toBe(6);
  expect(holdingEntries()).toStrictEqual(["Entry 3", "Entry 4", "Entry 5"]);
});
