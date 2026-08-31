/**
 * The ticket page's action panel, on the decision the phase alone cannot make:
 * a ticket in `Finalizing` enables no public mutation, so every button on
 * screen here came from the ticket's own open question.
 *
 * The answer settles without journalling anything — approval is operational
 * protocol rather than `Core` state — so no `Ticket` frame follows it and the
 * open questions are read again once the follow ends. Both halves are driven:
 * the re-read a reader with a degraded stream depends on, and the frame a live
 * one is served by.
 */

// jscpd:ignore-start -- the imports and vi.mock factories a case cannot hoist out
import { QueryClient } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import type { ReactNode } from "react";

import type { PartitionIdentity } from "../../../src/contract/http.ts";
import { TicketPage } from "../app/browser/TicketPage.tsx";
import {
  answer,
  apiDouble,
  openedStream,
  operationAt,
  ScreenHarness,
  settled,
  turned,
} from "./screenHarness.tsx";
import { frame } from "./streamDouble.ts";
import type * as BrowserPorts from "../app/browser/ports.ts";
import { ticketInstants } from "./ticketInstants.ts";

const atlas: PartitionIdentity = { tenant: "acme", project: "atlas" };

vi.mock("../app/browser/ports.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof BrowserPorts>()),
  sleepMs: () => Promise.resolve(),
}));

vi.mock("@tanstack/react-router", () => ({
  createLink: (component: unknown) => component,
  Link: (props: { readonly children?: ReactNode }) => (
    <a href="/">{props.children}</a>
  ),
  useParams: () => ({ ...atlas, ticket: "11" }),
}));
// jscpd:ignore-end -- the case's own doubles resume here

/** The runner has no globals, so a case's tree is torn down here rather than by
 * the library's own hook — a second case would otherwise read the first's. */
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const approval = {
  action: "action-eleven",
  kind: "FinalizationApproval",
  authorizingSequence: 51,
  admits: ["Approve", "Decline"],
};

const blocked = {
  action: "action-blocked",
  kind: "HandoffBlock",
  authorizingSequence: 52,
  admits: ["AbandonHandoff"],
};

/** One ticket waiting on an approval, until an answer has been submitted. */
function serving(asked: () => unknown): (url: string) => Response {
  return (url) => {
    if (url.includes("/native-actions"))
      return answer({ actions: asked() === undefined ? [approval] : [] });
    if (url.includes("/executions")) return answer({ executions: [] });
    if (url.includes("/drafts/")) return answer({}, 404);
    return answer({
      ticket: 11,
      phase: "Finalizing",
      sequence: 51,
      ...ticketInstants,
    });
  };
}

function mounted(): {
  readonly api: ReturnType<typeof apiDouble>;
  readonly server: ReturnType<typeof openedStream>;
} {
  const api = apiDouble({
    operation: operationAt("Answered"),
    route: (url) => serving(() => api.submitted())(url),
  });
  vi.stubGlobal("fetch", api.fetch);
  const server = openedStream();
  render(
    <ScreenHarness
      partition={atlas}
      client={new QueryClient()}
      transport={server.ports.fetch}
    >
      <TicketPage />
    </ScreenHarness>,
  );
  return { api, server };
}

test("an open approval is offered as approve and decline, and answered once", async () => {
  const held = mounted();
  await settled();
  expect(screen.getByRole("button", { name: "Approve" })).toBeDefined();
  expect(screen.getByRole("button", { name: "Decline" })).toBeDefined();

  await turned(() => {
    screen.getByRole("button", { name: "Approve" }).click();
  });
  expect(held.api.submitted()).toMatchObject({
    mutation: {
      mutation: "ResolveNativeAction",
      action: "action-eleven",
      authorizingSequence: 51,
      resolution: "Approve",
    },
  });

  await settled();
  expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Decline" })).toBeNull();
  expect(screen.getByText(/No action in this phase/u)).toBeDefined();
});

/** The frame carries the per-ticket read's own body, so the page's query has to
 * sit under the key the cache command writes or a change would land beside it. */
test("a frame moves what the page offers without the page reading again", async () => {
  const held = mounted();
  await settled();
  expect(screen.getByRole("button", { name: "Approve" })).toBeDefined();

  await turned(() => {
    held.server.push(
      frame("NativeAction", "12", {
        version: 1,
        resource: "11",
        representation: { actions: [blocked] },
      }),
    );
  });
  await settled();
  expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
  expect(screen.getByRole("button", { name: "Abandon" })).toBeDefined();
  expect(held.api.submitted()).toBeUndefined();
});
