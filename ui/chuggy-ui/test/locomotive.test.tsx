/**
 * The locomotive: drawn and moving in the Loading card, and nowhere else.
 *
 * The primitive is asserted first with no provider around it, the way every
 * other primitive is; `App` is mocked no further than the route tree its
 * `SignedIn` branch never reaches from these phases, so a real session
 * snapshot is what drives which card is drawn.
 */

import { QueryClient } from "@tanstack/react-query";
import { cleanup, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

import type { SessionHolder, SessionPhase } from "../app/core/sessionHolder.ts";
import { App } from "../app/browser/App.tsx";
import { SessionProvider } from "../app/browser/session.tsx";
import { Locomotive } from "../app/browser/ui/Locomotive.tsx";
import locomotiveSheet from "../app/browser/ui/Locomotive.css?raw";
import tokenSheet from "../app/styles/tokens.css?raw";
import { sheetDeclared, sheetRules } from "./sheet.ts";
import { styleless } from "./styleless.ts";
import { renderCopied } from "./copied.tsx";

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

test("the locomotive draws an animated sprite and carries an accessible name, with no provider", () => {
  const view = renderCopied(<Locomotive />);
  const drawn = screen.getByRole("img", { name: /chuggy/i });
  expect(drawn.classList.contains("locomotive")).toBe(true);
  const rects = Array.from(
    drawn.querySelectorAll("svg.locomotive-sprite rect"),
  );
  expect(rects.length).toBeGreaterThan(0);
  const frameIndexes = new Set(
    rects.map((rect) => Math.floor(Number(rect.getAttribute("x")) / 16)),
  );
  expect(frameIndexes.size).toBeGreaterThan(1);
  expect(view.container.querySelector("[style]")).toBeNull();
  styleless();
});

test("every pixel of the locomotive is filled from a token the tokens define", () => {
  renderCopied(<Locomotive />);
  const rules = sheetRules(locomotiveSheet, []);
  const rects = Array.from(
    screen
      .getByRole("img", { name: /chuggy/i })
      .querySelectorAll("svg.locomotive-sprite rect"),
  );
  const filled = new Set(
    rects.map((rect) => {
      expect(rect.hasAttribute("fill")).toBe(false);
      return sheetDeclared(rules, rect, "fill");
    }),
  );
  expect(filled.size).toBeGreaterThan(1);
  for (const fill of filled) {
    const token = /^var\((--locomotive-[a-z-]+)\)$/u.exec(fill)?.[1];
    expect(token, fill).toBeDefined();
    expect(tokenSheet).toContain(`${token ?? ""}: #`);
  }
});

test("the Loading card draws the locomotive", () => {
  renderCopied(
    <SessionProvider holder={holderAt("Loading")}>
      <App
        queryClient={
          new QueryClient({ defaultOptions: { queries: { retry: false } } })
        }
      />
    </SessionProvider>,
  );
  expect(screen.getByRole("img", { name: /chuggy/i })).not.toBeNull();
  styleless();
});

test("a phase that is not Loading draws no locomotive", () => {
  renderCopied(
    <SessionProvider holder={holderAt("SignedOut")}>
      <App
        queryClient={
          new QueryClient({ defaultOptions: { queries: { retry: false } } })
        }
      />
    </SessionProvider>,
  );
  expect(screen.getByRole("button", { name: "Sign in" })).not.toBeNull();
  expect(screen.queryByRole("img")).toBeNull();
  styleless();
});
