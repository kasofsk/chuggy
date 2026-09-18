/**
 * The ticket authoring page, once its textarea became a CodeMirror editor.
 *
 * THE TRAFFIC IS THE CASE WITH TEETH. The editor owns the document, so what
 * proves it is wired is not a textarea's value but that the catalog and the
 * validation are actually asked for against the tip the server resolves, and
 * that the body the create finally carries is the text the editor holds.
 */

// jscpd:ignore-start -- renderer tests must declare their own hoisted mock factories
import { QueryClient } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { ReactNode } from "react";

import { AdoptedTicketCreation } from "../app/browser/AdoptedTickets.tsx";
import {
  answer,
  openedStream,
  ScreenHarness,
  settled,
} from "./screenHarness.tsx";
import { leadPartition } from "./leadFixture.ts";
import { resizeObserverStubbed } from "./resizeObserver.ts";
import type * as BrowserPorts from "../app/browser/ports.ts";

vi.mock("../app/browser/ports.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof BrowserPorts>()),
  sleepMs: () => Promise.resolve(),
}));

vi.mock("@tanstack/react-router", () => ({
  createLink: (component: unknown) => component,
  Link: (props: { readonly to?: string; readonly children?: ReactNode }) => (
    <a href={props.to ?? "/"}>{props.children}</a>
  ),
  useParams: () => ({ ...leadPartition }),
  useNavigate: () => () => Promise.resolve(),
}));
// jscpd:ignore-end -- the case's own doubles resume here

const commit = "a".repeat(40);
const mountAttemptsMax = 20;

/** The editor arrives on a dynamic import, so a fixed number of flushes can miss it. */
async function mounted(): Promise<Element | null> {
  for (let attempt = 0; attempt < mountAttemptsMax; attempt += 1) {
    await settled();
    const host = document.querySelector(".ticket-editor-host");
    if (host?.shadowRoot?.querySelector(".cm-editor")) return host;
  }
  return null;
}

interface Sent {
  readonly method: string;
  readonly url: string;
  readonly body: string | undefined;
}

beforeEach(() => {
  resizeObserverStubbed();
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

afterEach(() => {
  vi.useRealTimers();
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function drawn(): readonly Sent[] {
  const sent: Sent[] = [];
  const fetching = ((
    url: string,
    init?: { method?: string; body?: string },
  ) => {
    sent.push({
      method: init?.method ?? "GET",
      url,
      ...(init?.body === undefined ? {} : { body: init.body }),
    } as Sent);
    if (url.includes("/catalog") && url.includes("path="))
      return Promise.resolve(
        answer({
          path: "workloads/work.yaml",
          origin: "Git",
          content: "prompt: run\n",
        }),
      );
    if (url.includes("/catalog"))
      return Promise.resolve(
        answer({ entries: [{ path: "workloads/work.yaml", origin: "Git" }] }),
      );
    if (url.includes("/validate"))
      return Promise.resolve(answer({ valid: true, findings: [], commit }));
    return Promise.resolve(answer({ identity: "made", accepted: "Accepted" }));
  }) as unknown as typeof fetch;
  vi.stubGlobal("fetch", fetching);
  render(
    <ScreenHarness
      partition={leadPartition}
      client={new QueryClient()}
      transport={openedStream().ports.fetch}
    >
      <AdoptedTicketCreation />
    </ScreenHarness>,
  );
  return sent;
}

test("the editor draws the document the form opens on", async () => {
  drawn();
  const host = await mounted();
  expect(screen.getByText("Ticket YAML")).toBeDefined();
  expect(screen.queryByLabelText("Catalog commit")).toBeNull();
  expect(screen.getByRole("button", { name: "Fold all" })).toBeDefined();
  expect(host?.shadowRoot?.textContent).toContain("title: Describe the change");
});

test("the catalog and the validation are asked for without a commit", async () => {
  const sent = drawn();
  await mounted();
  vi.advanceTimersByTime(1_000);
  await settled();
  const listed = sent.find((request) => request.url.includes("/catalog?"));
  expect(listed?.url).not.toContain("commit=");
  const validated = sent.find((request) => request.url.endsWith("/validate"));
  expect(validated?.method).toBe("POST");
  expect(validated?.body).toContain("version: 2");
});

test("creating carries the text the editor holds, as YAML", async () => {
  const sent = drawn();
  await mounted();
  vi.advanceTimersByTime(1_000);
  await settled();
  fireEvent.submit(screen.getByRole("button", { name: "Create ticket" }));
  await settled();
  const created = sent.find((request) => request.url.endsWith("/tickets"));
  expect(created?.method).toBe("POST");
  expect(created?.body).toContain("finalization: finalizers/pull-request.yaml");
});
