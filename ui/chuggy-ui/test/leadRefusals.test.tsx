/**
 * The standing refusals, and whether they move when the lead refuses again.
 *
 * THE LIVE CASE IS THE ONE WITH TEETH. An `AgenticRefusal` frame names the
 * ticket the lead decided about, and this list is the project's standing rows
 * with each one's supersession decided against the ticket's current authoring
 * version — which the frame does not carry, so the entry is re-read rather than
 * folded. A panel registered for neither would sit on the rows it opened with
 * while the lead went on refusing.
 */

// jscpd:ignore-start -- renderer tests must declare their own hoisted mock factories
import { QueryClient } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import type { ReactNode } from "react";

import { LeadRefusals } from "../app/browser/lead/LeadRefusals.tsx";
import {
  answer,
  apiDouble,
  openedStream,
  ScreenHarness,
  settled,
  turned,
} from "./screenHarness.tsx";
import { frame } from "./streamDouble.ts";
import { leadPartition, leadRefusals, leadRouteAnswer } from "./leadFixture.ts";
import type { AgenticRefusalsResponse } from "../../../src/contract/responses.ts";
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

async function drawRefusals(
  holding: () => AgenticRefusalsResponse,
): Promise<ReturnType<typeof openedStream>> {
  const api = apiDouble({
    operation: { operation: "op-one", state: "Pending" },
    route: (url) => {
      const found = leadRouteAnswer(url, {
        batches: 2,
        turns: 1,
        refusals: holding(),
      });
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
      <LeadRefusals
        partition={leadPartition}
        nowMs={Date.parse("2026-09-01T12:00:00Z")}
      />
    </ScreenHarness>,
  );
  await settled();
  return server;
}

test("a standing refusal names its ticket, its version and its reason", async () => {
  await drawRefusals(() => leadRefusals(false));
  expect(screen.getByText("42")).toBeDefined();
  expect(screen.getByText("Standing")).toBeDefined();
  expect(screen.getByText("the brief names no reference")).toBeDefined();
});

/** A ticket authored again is still refused and is no longer binding, which is
 * a different word rather than a row that vanished. */
test("a refusal the ticket has outgrown is drawn as superseded", async () => {
  await drawRefusals(() => leadRefusals(true));
  expect(screen.getByText("Superseded")).toBeDefined();
  expect(screen.queryByText("Standing")).toBeNull();
});

test("a project the lead has refused nothing in says so", async () => {
  await drawRefusals(() => ({ refusals: [], more: false }));
  expect(screen.getByText("No refusals")).toBeDefined();
});

test("an AgenticRefusal frame reaches the rows the read gave", async () => {
  let served = leadRefusals(false);
  const server = await drawRefusals(() => served);
  expect(screen.getByText("the brief names no reference")).toBeDefined();
  served = leadRefusals(false, "the dependency is still open");
  await turned(() => {
    server.push(
      frame("AgenticRefusal", "50", {
        version: 1,
        resource: "42",
        representation: { ticket: 42, entries: [], more: false },
      }),
    );
  });
  await settled();
  expect(screen.getByText("the dependency is still open")).toBeDefined();
});
