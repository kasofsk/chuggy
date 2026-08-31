// jscpd:ignore-start -- renderer tests must declare their own hoisted mock factories
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
  ScreenHarness,
  settled,
} from "./screenHarness.tsx";
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
// jscpd:ignore-end

/**
 * The identities a label replaced, on the page they were replaced on.
 *
 * `labels.ts` is proved to return both halves of every label, and that says
 * nothing about whether a component draws the second one: a `title` deleted at
 * a call site takes the revision and the image reference off the page
 * altogether, with no way back to them, and every pure suite stays green. So
 * each site is mounted and asked for the identity, not for the name — the name
 * is the half a reader can already see.
 */

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const revision = "repository:cfaca0a0f14ec03845a4e01458ac6c3a56d52a23:chuggy";

const image =
  "registry.chuggy.internal/chuggy/worker@sha256:9949c442a2f0a5cd0f0a5b1c8b6e0a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f";

const authoring = {
  dependencies: [],
  program: [],
  workFanout: 1,
  reworkPolicy: { type: "BudgetedRework", value: 1 },
  finalizationPricing: "DeadlineOnly",
  resumePricing: "RetryFree",
  finalizer: "NoFinalizer",
};

const execution = {
  execution: "e1",
  ticket: 11,
  task: 1,
  taskKind: "Work",
  cluster: "rig",
  configurationRevision: revision,
  requirementIdentity: "requirement-a",
  requirement: {
    mode: "Container",
    operatingSystem: "Linux",
    architecture: "Amd64",
    image,
  },
  requirementDigest: "b".repeat(64),
  requirementSource: "TicketDefault",
  platformDefaultVersion: 1,
  status: "Running",
  retriesSpent: 0,
  registeredAt: "2026-08-26T10:00:00.000Z",
};

interface Named {
  readonly version?: { readonly name: string; readonly number: number };
  readonly worker?: { readonly name: string; readonly version: string };
}

/** The whole ticket page, with the catalog's answers as a case chooses them. */
async function drawTicket(named: Named): Promise<void> {
  const api = apiDouble({
    operation: { operation: "op-one", state: "Pending" },
    route: (url) => {
      if (url.includes("/dispatch-view"))
        return answer({ result: "Stale", reason: "TokenStale" });
      if (url.includes("/native-actions")) return answer({ actions: [] });
      if (url.includes("/executions"))
        return answer({
          executions: [
            {
              ...execution,
              ...(named.version === undefined
                ? {}
                : { configurationVersion: named.version }),
              ...(named.worker === undefined ? {} : { worker: named.worker }),
            },
          ],
        });
      if (url.includes("/configurations/"))
        return answer({
          partition: atlas,
          revision,
          canonical: "{}",
          digest: "c".repeat(64),
          ...(named.version === undefined ? {} : { version: named.version }),
        });
      if (url.includes("/drafts/"))
        return answer({
          partition: atlas,
          ticket: 11,
          authoringVersion: 1,
          state: "Released",
          configurationRevision: revision,
          authoring,
          ...(named.version === undefined
            ? {}
            : { configurationVersion: named.version }),
        });
      return answer({
        ticket: 11,
        phase: "Working",
        sequence: 7,
        ...ticketInstants,
      });
    },
  });
  vi.stubGlobal("fetch", api.fetch);
  render(
    <ScreenHarness
      partition={atlas}
      client={new QueryClient()}
      transport={openedStream().ports.fetch}
    >
      <TicketPage />
    </ScreenHarness>,
  );
  await settled();
}

/** The one element carrying a drawn phrase, whose `title` is the question. */
function drawn(text: string): HTMLElement {
  const found = screen.getByText(text);
  expect(found).toBeDefined();
  return found;
}

const named: Named = {
  version: { name: "chuggy", number: 12 },
  worker: { name: "chuggy-worker", version: "v3" },
};

test("the revision a ticket was released under stays reachable from its name", async () => {
  await drawTicket(named);
  const releasedUnder = drawn("chuggy #12");
  expect(releasedUnder.getAttribute("title")).toBe(revision);
});

test("the configuration panel keeps the revision its heading no longer shows", async () => {
  await drawTicket(named);
  expect(
    screen.getByRole("heading", { name: /configuration chuggy #12/u }),
  ).toBeDefined();
  expect(screen.getByText("revision").nextElementSibling?.textContent).toBe(
    revision,
  );
});

test("an execution names its worker and keeps the image reference on hover", async () => {
  await drawTicket(named);
  const ranOn = drawn("Linux/Amd64 chuggy-worker v3");
  expect(ranOn.getAttribute("title")).toBe(image);
});

test("a page the catalog named nothing on draws the identities themselves", async () => {
  await drawTicket({});
  expect(screen.getAllByText(revision).length).toBeGreaterThan(0);
  const ranOn = drawn("Linux/Amd64 worker@sha256:9949c442");
  expect(ranOn.getAttribute("title")).toBe(image);
});
