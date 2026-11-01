/**
 * A finalization approval reaching the inbox and leaving it, which no pure
 * function can express: the row's membership is the server's, read again on a
 * live frame, and the cache holds it between.
 *
 * `Finalization` is not a phase the inbox holds by itself, so every row on
 * screen is there because the server says a question is open on it. The shell
 * is mounted beside the screen, so the badge and the list are read as the one
 * value they are meant to be.
 */

// jscpd:ignore-start -- the imports and vi.mock factories a case cannot hoist out
import { QueryClient } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { ReactNode } from "react";

import type { PartitionIdentity } from "../../../src/contract/http.ts";
import type {
  InboxEntryResponse,
  ProjectNativeActionResponse,
  ProjectTicket,
} from "../../../src/contract/responses.ts";
import { InboxScreen } from "../app/browser/Inbox.tsx";
import { Shell } from "../app/browser/Shell.tsx";
import { resizeObserverStubbed } from "./resizeObserver.ts";
import { viewportAtEm, viewportDeskEm } from "./viewport.ts";
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
import { inboxAsked, inboxBody, inboxEntry } from "./inboxFixture.ts";
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
  Outlet: () => <InboxScreen partition={atlas} />,
  useNavigate: () => () => undefined,
  useParams: () => atlas,
  useRouterState: (options: {
    readonly select: (state: {
      readonly location: { readonly pathname: string };
    }) => unknown;
  }) => options.select({ location: { pathname: "/acme/atlas" } }),
}));
// jscpd:ignore-end -- the case's own doubles resume here

/** The runner has no globals, so a case's tree is torn down here rather than by
 * the library's own hook — a second case would otherwise read the first's. */
beforeEach(resizeObserverStubbed);

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const approval: ProjectNativeActionResponse = {
  ticket: 11,
  action: "action-eleven",
  kind: "FinalizationApproval",
  authorizingSequence: 51,
  admits: ["Approve", "Decline"],
};

const finalizing: ProjectTicket = {
  ticket: 11,
  title: "Land the release notes",
  phase: "Finalization",
  sequence: 6,
  ...ticketInstants,
};

const awaiting = inboxEntry(finalizing, { actions: [approval] });

/** The routes a mounted shell reads, the inbox answering what `inbox` holds or failing where it is `undefined`. */
function serving(inbox: () => readonly InboxEntryResponse[] | undefined) {
  return (url: string): Response => {
    if (inboxAsked(url)) {
      const entries = inbox();
      return entries === undefined
        ? answer({ error: { code: "InternalError", message: "fault" } }, 500)
        : answer(inboxBody(entries));
    }
    if (url.includes("/executions")) return answer({ executions: [] });
    if (url.includes("/tenants/"))
      return answer({ partition: atlas, sequence: 9, tickets: [] });
    return answer({ projects: [atlas] });
  };
}

/** The count the rail's inbox entry carries after its label, and nothing where
 * the inbox is clear. */
function badge(): string | undefined {
  const entry = screen.queryByRole("link", { name: /Inbox/u });
  const count = entry?.textContent?.replace("Inbox", "") ?? "";
  return count === "" ? undefined : count;
}

function openActions(actions: readonly unknown[]): string {
  return frame("NativeAction", "12", {
    version: 1,
    resource: "11",
    representation: { actions },
  });
}

function mounted(route: (url: string) => Response): {
  readonly api: ReturnType<typeof apiDouble>;
  readonly server: ReturnType<typeof openedStream>;
} {
  const api = apiDouble({ operation: operationAt("Pending"), route });
  viewportAtEm(viewportDeskEm);
  vi.stubGlobal("fetch", api.fetch);
  const server = openedStream();
  render(
    <ScreenHarness
      partition={atlas}
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
      transport={server.ports.fetch}
    >
      <Shell partition={atlas} />
    </ScreenHarness>,
  );
  return { api, server };
}

test("an approval opening puts its ticket in the inbox and its answer takes it out", async () => {
  let entries: readonly InboxEntryResponse[] = [];
  const { api, server } = mounted(serving(() => entries));
  await settled();
  expect(screen.getByText("Inbox is clear")).toBeDefined();
  expect(badge()).toBeUndefined();

  entries = [awaiting];
  await turned(() => {
    server.push(openActions([approval]));
  });
  await settled();
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

  entries = [];
  await turned(() => {
    server.push(openActions([]));
  });
  await settled();
  expect(screen.queryByRole("button", { name: "approve" })).toBeNull();
  expect(screen.getByText("Inbox is clear")).toBeDefined();
  expect(badge()).toBeUndefined();
});

/**
 * One read is one failed state. A reread that fails keeps the approval it last
 * drew answerable and the badge counting it, and says only that it was not
 * updated.
 */
test("a reread that fails leaves the approval it drew answerable, and counted", async () => {
  let entries: readonly InboxEntryResponse[] | undefined = [awaiting];
  const { server } = mounted(serving(() => entries));
  await settled();
  expect(badge()).toBe("1");
  entries = undefined;
  await turned(() => {
    server.push(openActions([approval]));
  });
  await settled();
  expect(badge()).toBe("1");
  expect(screen.getByRole("button", { name: "approve" })).toBeDefined();
  expect(screen.getByText("awaiting your approval")).toBeDefined();
  expect(screen.getByText("Not updated")).toBeDefined();
  expect(screen.queryByText("Inbox is clear")).toBeNull();
});

/** The served policy refuses `style-src` but `'self'`, so nothing drawn here —
 * loaded, answered or clicked — may append a runtime style element. */
test("nothing the inbox draws is a runtime style element", async () => {
  const held = mounted(serving(() => [awaiting]));
  await settled();
  expect(document.querySelectorAll("style").length).toBe(0);
  await turned(() => {
    screen.getByRole("button", { name: "approve" }).click();
  });
  expect(held.api.submissions()).toBe(1);
  expect(document.querySelectorAll("style").length).toBe(0);
});
