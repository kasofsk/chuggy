/**
 * The card drawn when the console could not load, through the browser's own
 * network port: a request that got no answer is told from one that answered
 * with something unusable, and only the first is offered a retry.
 *
 * `App` is mocked no further than the route tree, which only a signed-in
 * session reaches, and which draws a marker here so that state can be seen.
 */

import { QueryClient } from "@tanstack/react-query";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

import { App } from "../app/browser/App.tsx";
import { fetchJson } from "../app/browser/ports.ts";
import { SessionProvider, sessionBegin } from "../app/browser/session.tsx";
import {
  createSessionHolder,
  sessionRefreshTokenKey,
} from "../app/core/sessionHolder.ts";
import type { SessionHolder } from "../app/core/sessionHolder.ts";
import {
  sessionHarness,
  sessionHarnessConfiguration as configuration,
  sessionHarnessDiscovery as discovery,
} from "./sessionHolderHarness.ts";

vi.mock("../app/browser/routes.tsx", () => ({ consoleRouter: {} }));
vi.mock("@tanstack/react-router", () => ({
  RouterProvider: () => "Routed",
  createLink: (component: unknown) => component,
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const discoveryAddress = `${discovery.issuer}/.well-known/openid-configuration`;

type Served = (url: string) => Promise<Response>;

function json(body: unknown, status = 200): Promise<Response> {
  return Promise.resolve(new Response(JSON.stringify(body), { status }));
}

function noAnswer(): Promise<Response> {
  return Promise.reject(new TypeError("Failed to fetch"));
}

/** Every request this load makes, answered as a working deployment would. */
const working: Served = (url) =>
  url === "/config.json" ? json(configuration) : json(discovery);

/** The network, as `served` holds it at the moment each request is made. */
function network(): { served: Served } {
  const held = { served: working };
  vi.stubGlobal("fetch", (url: string) => held.served(url));
  return held;
}

async function mounted(refreshToken?: string): Promise<SessionHolder> {
  const harness = sessionHarness();
  if (refreshToken !== undefined)
    harness.persistent.held.set(sessionRefreshTokenKey, refreshToken);
  const holder = createSessionHolder({ ...harness.ports, fetchJson });
  render(
    <SessionProvider holder={holder}>
      <App queryClient={new QueryClient()} />
    </SessionProvider>,
  );
  await act(() => sessionBegin(holder));
  return holder;
}

test("a configuration that got no answer is Unreachable, and Retry loads it into Sign in", async () => {
  const held = network();
  held.served = (url) => (url === "/config.json" ? noAnswer() : working(url));
  await mounted();
  expect(screen.getByRole("heading", { name: "Unreachable" })).toBeTruthy();
  expect(screen.getByText("No answer from /config.json")).toBeTruthy();
  held.served = working;
  act(() => {
    screen.getByRole("button", { name: "Retry" }).click();
  });
  await waitFor(() => {
    expect(screen.getByRole("button", { name: "Sign in" })).toBeTruthy();
  });
  expect(screen.queryByText("No answer from /config.json")).toBeNull();
});

test("a retry that loads a held session signs in", async () => {
  const held = network();
  held.served = noAnswer;
  await mounted("renew");
  held.served = working;
  act(() => {
    screen.getByRole("button", { name: "Retry" }).click();
  });
  await waitFor(() => {
    expect(screen.getByText("Routed")).toBeTruthy();
  });
});

/** The body arrives after the status, and losing it on the way is the network's
 * failure, not a configuration that is not JSON. */
test("a configuration whose body is lost on the way is Unreachable", async () => {
  const held = network();
  held.served = (url) =>
    url === "/config.json"
      ? Promise.resolve(
          new Response(
            new ReadableStream({
              start: (controller) => {
                controller.error(new TypeError("network error"));
              },
            }),
          ),
        )
      : working(url);
  await mounted();
  expect(screen.getByRole("heading", { name: "Unreachable" })).toBeTruthy();
});

test.each([
  ["a 404", () => json({}, 404), "/config.json answered 404"],
  [
    "a page that is not JSON",
    () => Promise.resolve(new Response("<!doctype html>")),
    "/config.json answered nothing usable",
  ],
  [
    "JSON that is not a configuration",
    () => json({ issuer: configuration.issuer }),
    "/config.json answered nothing usable",
  ],
])(
  "a configuration answering %s is Not configured, named, with no Retry",
  async (_answer, answer: () => Promise<Response>, detail) => {
    const held = network();
    held.served = (url) => (url === "/config.json" ? answer() : working(url));
    await mounted();
    expect(
      screen.getByRole("heading", { name: "Not configured" }),
    ).toBeTruthy();
    expect(screen.getByText(detail)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
  },
);

test("an issuer that answered with something unusable is named by its host", async () => {
  const held = network();
  held.served = (url) =>
    url === discoveryAddress ? json({}, 404) : working(url);
  await mounted();
  expect(screen.getByRole("heading", { name: "Not configured" })).toBeTruthy();
  expect(screen.getByText("auth.example answered 404")).toBeTruthy();
  expect(screen.queryByText(/config\.json/u)).toBeNull();
});
