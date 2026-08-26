/**
 * A finalization approval reaching the inbox and leaving it, which no pure
 * function can express: the row's membership is decided by two reads, a live
 * frame and the cache between them.
 *
 * `Finalizing` is not a phase the inbox's filter holds, so the phase page here
 * is empty throughout and every row on screen arrived because a question was
 * opened on the stream. The shell is mounted beside the screen, so the badge
 * and the list are read as the one value they are meant to be.
 */

// jscpd:ignore-start -- a vi.mock factory is hoisted into the file declaring it
import { QueryClient } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import type { ReactNode } from "react";

import type { PartitionIdentity } from "../../../src/contract/http.ts";
import { InboxScreen } from "../app/browser/Inbox.tsx";
import { Shell } from "../app/browser/Shell.tsx";
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
  Outlet: () => null,
  useNavigate: () => () => undefined,
  useParams: () => atlas,
}));
// jscpd:ignore-end -- the case's own doubles resume here

afterEach(() => {
  vi.unstubAllGlobals();
});

const approval = {
  action: "action-eleven",
  kind: "FinalizationApproval",
  authorizingSequence: 51,
  admits: ["Approve", "Decline"],
};

/** Nothing in an inbox phase and nothing open that a first read can see, so the
 * stream is the only way a row gets here. */
function served(url: string): Response {
  if (url.includes("/native-actions")) return answer({ actions: [] });
  if (url.includes("/executions")) return answer({ executions: [] });
  if (url.includes("/tenants/"))
    return answer({ partition: atlas, sequence: 9, tickets: [] });
  return answer({ projects: [atlas] });
}

function badge(): string | undefined {
  return (
    screen.queryByLabelText("tickets needing you")?.textContent ?? undefined
  );
}

function openActions(actions: readonly unknown[]): string {
  return frame("NativeAction", "12", {
    version: 1,
    resource: "11",
    representation: { actions },
  });
}

test("an approval opening puts its ticket in the inbox and its answer takes it out", async () => {
  const api = apiDouble({ operation: operationAt("Pending"), route: served });
  vi.stubGlobal("fetch", api.fetch);
  const server = openedStream();
  render(
    <ScreenHarness
      partition={atlas}
      client={new QueryClient()}
      transport={server.ports.fetch}
    >
      <Shell partition={atlas} />
      <InboxScreen partition={atlas} />
    </ScreenHarness>,
  );
  await settled();
  expect(screen.getByText(/nothing needs you here/u)).toBeDefined();
  expect(badge()).toBeUndefined();

  await turned(() => {
    server.push(openActions([approval]));
  });
  expect(screen.getByRole("button", { name: "approve" })).toBeDefined();
  expect(screen.getByRole("button", { name: "decline" })).toBeDefined();
  expect(screen.getByText("awaiting your approval")).toBeDefined();
  expect(badge()).toBe("1");

  await turned(() => {
    screen.getByRole("button", { name: "approve" }).click();
  });
  expect(api.submissions()).toBe(1);
  expect(
    screen.queryByRole("button", { name: "approve" }),
    "the answered row left the inbox before a frame said the question was answered",
  ).not.toBeNull();
  expect(badge()).toBe("1");

  await turned(() => {
    server.push(openActions([]));
  });
  expect(screen.queryByRole("button", { name: "approve" })).toBeNull();
  expect(screen.getByText(/nothing needs you here/u)).toBeDefined();
  expect(badge()).toBeUndefined();
});
