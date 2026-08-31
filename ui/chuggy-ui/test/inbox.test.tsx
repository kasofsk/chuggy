/**
 * The one property the inbox screen owns that no pure function can express: an
 * answered row stays until the project says it moved.
 *
 * The core has no seam for the answer path — the click, the follow and the
 * cache are shell code by construction — so this is the lowest tier that can
 * express it, and the providers are `screenHarness.tsx`'s. The operation stays
 * pending, so the row is looked at while its answer is still in flight.
 */

import { QueryClient } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import type { ReactNode } from "react";

import type { PartitionIdentity } from "../../../src/contract/http.ts";
import { InboxScreen } from "../app/browser/Inbox.tsx";
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

const atlas: PartitionIdentity = { tenant: "acme", project: "atlas" };

vi.mock("../app/browser/ports.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof BrowserPorts>()),
  sleepMs: () => Promise.resolve(),
}));

vi.mock("@tanstack/react-router", () => ({
  Link: (props: { readonly children?: ReactNode }) => (
    <a href="/">{props.children}</a>
  ),
  useParams: () => atlas,
}));

/** The stubbed global goes back whatever a case did with it, including a case
 * that stops partway; the rendered tree is the testing library's own cleanup. */
afterEach(() => {
  vi.unstubAllGlobals();
});

const escalated = {
  ticket: 4,
  phase: "Escalated",
  sequence: 9,
  reason: "WorkFailed",
};

const working = { ticket: 4, phase: "Working", sequence: 11 };

/** One escalated ticket, nothing else open, and nothing that has run. */
function served(url: string): Response {
  if (url.includes("/native-actions")) return answer({ actions: [] });
  if (url.includes("/executions")) return answer({ executions: [] });
  return answer({ partition: atlas, sequence: 9, tickets: [escalated] });
}

test("an answered row stays until a Ticket frame moves it out of the section", async () => {
  const api = apiDouble({ operation: operationAt("Pending"), route: served });
  vi.stubGlobal("fetch", api.fetch);
  const server = openedStream();
  render(
    <ScreenHarness
      partition={atlas}
      client={new QueryClient()}
      transport={server.ports.fetch}
    >
      <InboxScreen partition={atlas} />
    </ScreenHarness>,
  );
  await settled();
  expect(screen.getByRole("button", { name: "resume" })).toBeDefined();

  await turned(() => {
    screen.getByRole("button", { name: "resume" }).click();
  });
  expect(api.submissions()).toBe(1);
  expect(
    screen.queryByRole("button", { name: "resume" }),
    "the answered row left the inbox before a frame said the ticket had moved",
  ).not.toBeNull();
  expect(screen.queryByText("Inbox is clear")).toBeNull();

  await turned(() => {
    server.push(
      frame("Ticket", "7", {
        version: 1,
        resource: "4",
        representation: working,
      }),
    );
  });
  expect(screen.queryByRole("button", { name: "resume" })).toBeNull();
  expect(screen.getByText("Inbox is clear")).toBeDefined();
});
