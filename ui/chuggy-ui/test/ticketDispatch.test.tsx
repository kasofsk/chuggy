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
  turned,
} from "./screenHarness.tsx";
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
  useParams: () => ({ ...atlas, ticket: "11" }),
}));
// jscpd:ignore-end

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const ticket = { ticket: 11, phase: "Pending", sequence: 7 };

const dispatchView = {
  result: "Page",
  token: {
    tenant: "acme",
    project: "atlas",
    recoveryEpoch: "epoch",
    schemaVersion: 1,
    watermark: 7,
    digest: "a".repeat(64),
  },
  candidates: [
    {
      ticket: 11,
      ticketVersion: 4,
      dependencies: [],
      workFanout: 1,
      program: [],
      reworkPolicy: { type: "BudgetedRework", value: 1 },
      finalizationPricing: "DeadlineOnly",
      resumePricing: "RetryFree",
      finalizer: "NoFinalizer",
      configurationRevision: "r1",
      configurationDigest: "b".repeat(64),
      configurationCanonical: "{}",
    },
  ],
  notificationCursor: 2,
};

test("a dispatchable ticket submits the version from the strict view", async () => {
  const api = apiDouble({
    operation: {
      operation: "op-one",
      acceptedAt: "2026-08-26T10:00:00Z",
      state: "Succeeded",
      decidedSequence: 8,
    },
    route: (url) => {
      if (url.includes("/dispatch-view")) return answer(dispatchView);
      if (url.includes("/native-actions")) return answer({ actions: [] });
      if (url.includes("/executions")) return answer({ executions: [] });
      if (url.includes("/drafts/")) return answer({}, 404);
      if (url.includes("/tickets/")) return answer(ticket);
      return answer({ partition: atlas, sequence: 8, tickets: [ticket] });
    },
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
  await settled();

  await turned(() => {
    screen.getByRole("button", { name: "dispatch" }).click();
  });

  expect(api.submitted()).toMatchObject({
    mutation: {
      mutation: "ManualDispatch",
      ticket: 11,
      expectedTicketVersion: 4,
    },
  });
});
