/**
 * The Runners page: the pools registered to the project, and the one command
 * that adds another.
 *
 * ADD IS AN ADMINISTRATOR'S PRESS. The page offers it only where the
 * execution placement read says this reader may choose a route, the same
 * signal the settings page's own Edit is gated on, so a reader with no choice
 * to make there is given no Add here either.
 */

// jscpd:ignore-start -- renderer tests must declare their own hoisted mock factories
import { QueryClient } from "@tanstack/react-query";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { ReactNode } from "react";

import { RunnersPage } from "../app/browser/RunnersPage.tsx";
import {
  answer,
  openedStream,
  press,
  ScreenHarness,
  scriptedFetch,
  sectionOf,
  settled,
} from "./screenHarness.tsx";
import type { SentRequest } from "./screenHarness.tsx";
import { leadPartition } from "./leadFixture.ts";
import { styleless } from "./styleless.ts";
import type * as BrowserPorts from "../app/browser/ports.ts";

const copied = vi.hoisted(() => ({ texts: [] as string[], allowed: true }));

vi.mock("../app/browser/ports.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof BrowserPorts>()),
  sleepMs: () => Promise.resolve(),
  currentOrigin: () => "https://chuggy.test",
  clipboardWritten: (text: string) => {
    copied.texts.push(text);
    return Promise.resolve(copied.allowed);
  },
}));

vi.mock("@tanstack/react-router", () => ({
  createLink: (component: unknown) => component,
  Link: (props: { readonly children?: ReactNode }) => (
    <a href="/">{props.children}</a>
  ),
  useParams: () => ({ ...leadPartition }),
}));
// jscpd:ignore-end -- the case's own doubles resume here

beforeEach(() => {
  copied.texts.length = 0;
  copied.allowed = true;
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** Granted every route, so the reader may administer the pool roster. */
const granted = {
  work: { route: "InCluster", source: "Project" },
  evaluation: { route: "InCluster", source: "Override" },
  choices: ["InCluster", "Pool"],
};

const pools = {
  truncated: false,
  pools: [
    {
      pool: "shame",
      capabilities: ["Platform:Linux:Amd64"],
      registeredAt: "2026-09-29T00:00:00Z",
    },
  ],
};

interface Drawing {
  readonly placement?: unknown;
  readonly listed?: unknown;
  /** What a write answers, in the order the page makes them. */
  readonly written?: readonly Response[];
}

async function drawPage(
  drawing: Drawing = {},
): Promise<readonly SentRequest[]> {
  const placement: unknown = drawing.placement ?? granted;
  const listed: unknown = drawing.listed ?? pools;
  const written = [...(drawing.written ?? [])];
  const scripted = scriptedFetch((request) => {
    if (request.method !== "GET") return written.shift() ?? answer({}, 503);
    if (request.url.endsWith("/worker-pools")) return answer(listed);
    return answer(placement);
  });
  vi.stubGlobal("fetch", scripted.fetch);
  render(
    <ScreenHarness
      partition={leadPartition}
      client={new QueryClient()}
      transport={openedStream().ports.fetch}
    >
      <RunnersPage />
    </ScreenHarness>,
  );
  await settled();
  return scripted.sent;
}

test("a reader who may choose nothing is offered no runner to add, and still reads the runners", async () => {
  await drawPage({ placement: { ...granted, choices: [] } });
  expect(screen.queryByRole("button", { name: "Add runner" })).toBeNull();
  expect(
    within(sectionOf("Runners")).getAllByRole("row")[1]?.textContent,
  ).toMatch(/^shame/u);
});

test("a registered pool is a row naming its platforms", async () => {
  await drawPage();
  const rows = within(sectionOf("Runners")).getAllByRole("row");
  expect(rows[1]?.textContent).toMatch(/^shameLinux Amd64/u);
});

test("a project with no pool says so", async () => {
  await drawPage({ listed: { truncated: false, pools: [] } });
  expect(
    within(sectionOf("Runners")).getByText("No runner registered"),
  ).toBeTruthy();
});

test("adding a runner mints a token for the Linux platforms and hands over one command, copied by one press", async () => {
  const sent = await drawPage({
    written: [answer({ token: "tok-1", expiresAtMs: Date.now() + 60_000 })],
  });
  await press("Add runner");
  const minted = sent.find((one) => one.method === "POST");
  expect(minted?.url.endsWith("/worker-pool-registration-tokens")).toBe(true);
  expect(minted?.body).toStrictEqual({
    capabilities: ["Platform:Linux:Amd64", "Platform:Linux:Arm64"],
    lifetimeSecs: 3600,
  });
  const command =
    "chuggy-linux register --api https://chuggy.test --token=tok-1";
  expect(screen.getByLabelText("Command").textContent).toBe(command);
  await press("Copy");
  expect(copied.texts).toStrictEqual([command]);
  expect(screen.getByRole("button", { name: "Copied" })).toBeTruthy();
  styleless();
});

test("a copy the browser blocks says so", async () => {
  copied.allowed = false;
  await drawPage({
    written: [answer({ token: "tok-1", expiresAtMs: Date.now() + 60_000 })],
  });
  await press("Add runner");
  await press("Copy");
  expect(screen.getByText("Copy blocked")).toBeTruthy();
});

test("Done puts the command away and reads the pools again", async () => {
  const sent = await drawPage({
    written: [answer({ token: "tok-1", expiresAtMs: Date.now() + 60_000 })],
  });
  const before = sent.filter((one) => one.url.endsWith("/worker-pools")).length;
  await press("Add runner");
  await press("Done");
  expect(screen.queryByLabelText("Command")).toBeNull();
  expect(
    sent.filter((one) => one.url.endsWith("/worker-pools")).length,
  ).toBeGreaterThan(before);
});
