/**
 * The locomotive: drawn and moving in the Loading card, and nowhere else.
 *
 * The primitive is asserted first with no provider around it, the way every
 * other primitive is; `App` is mocked no further than the route tree its
 * `SignedIn` branch never reaches from these phases, so a real session
 * snapshot is what drives which card is drawn.
 */

import { QueryClient } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

import type { SessionHolder, SessionPhase } from "../app/core/sessionHolder.ts";
import { App } from "../app/browser/App.tsx";
import { SessionProvider } from "../app/browser/session.tsx";
import { Locomotive } from "../app/browser/ui/Locomotive.tsx";
import { styleless } from "./styleless.ts";

vi.mock("../app/browser/routes.tsx", () => ({ consoleRouter: {} }));
vi.mock("@tanstack/react-router", () => ({
  RouterProvider: () => null,
  createLink: (component: unknown) => component,
}));

afterEach(cleanup);

function holderAt(phase: SessionPhase): SessionHolder {
  const snapshot = { phase, reason: undefined, configuration: undefined };
  return {
    load: () => Promise.resolve(),
    completeCallback: () => Promise.resolve({ result: "None" as const }),
    signIn: () => Promise.resolve(),
    signOut: () => Promise.resolve(),
    bearer: () => Promise.resolve(undefined),
    refresh: () => Promise.resolve(true),
    refuse: () => undefined,
    refreshDueAtMs: () => undefined,
    generation: () => 1,
    snapshot: () => snapshot,
    subscribe: () => () => undefined,
  };
}

test("the locomotive draws its engine as a sprite of more than one frame, and carries an accessible name, with no provider", () => {
  const view = render(<Locomotive />);
  const drawn = screen.getByRole("img", { name: /chuggy/i });
  expect(drawn.classList.contains("locomotive")).toBe(true);
  const frames = drawn.querySelectorAll("svg.locomotive-frame");
  expect(frames.length).toBeGreaterThan(1);
  for (const frame of frames) {
    expect(frame.querySelector("rect")).not.toBeNull();
  }
  expect(view.container.querySelector("[style]")).toBeNull();
  styleless();
});

test("the Loading card draws the locomotive", () => {
  render(
    <SessionProvider holder={holderAt("Loading")}>
      <App queryClient={new QueryClient()} />
    </SessionProvider>,
  );
  expect(screen.getByRole("img", { name: /chuggy/i })).not.toBeNull();
  styleless();
});

test("a phase that is not Loading draws no locomotive", () => {
  render(
    <SessionProvider holder={holderAt("SignedOut")}>
      <App queryClient={new QueryClient()} />
    </SessionProvider>,
  );
  expect(screen.getByRole("button", { name: "sign in" })).not.toBeNull();
  expect(screen.queryByRole("img")).toBeNull();
  styleless();
});
