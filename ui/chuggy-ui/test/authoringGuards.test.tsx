/**
 * What stands between a dirty authoring screen and leaving it: a route away
 * asks and the answer decides, the tab's unload is refused, and the one exit a
 * settled submit makes is let through without asking.
 */

import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, expect, test, vi } from "vitest";

import { useAuthoringGuards } from "../app/browser/editor/authoringGuards.tsx";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** The screen under guard, whose two exits are the router's own navigation:
 * one a reader takes, and one a settled submit takes after releasing. */
function Authoring(props: {
  readonly dirty: boolean;
  readonly leave: () => void;
}): ReactNode {
  const guard = useAuthoringGuards(props.dirty);
  return (
    <>
      <p>authoring</p>
      <button type="button" onClick={props.leave}>
        leave
      </button>
      <button
        type="button"
        onClick={() => {
          guard.release();
          props.leave();
        }}
      >
        released
      </button>
    </>
  );
}

function drawn(dirty: boolean): void {
  const root = createRootRoute({ component: () => <Outlet /> });
  const away = createRoute({
    getParentRoute: () => root,
    path: "/away",
    component: () => <p>away</p>,
  });
  const leave = (): void => {
    router.history.push(away.fullPath);
  };
  const router = createRouter({
    history: createMemoryHistory({ initialEntries: ["/"] }),
    routeTree: root.addChildren([
      createRoute({
        getParentRoute: () => root,
        path: "/",
        component: () => <Authoring dirty={dirty} leave={leave} />,
      }),
      away,
    ]),
  });
  render(<RouterProvider router={router} />);
}

function confirming(answer: boolean) {
  const asked = vi.fn(() => answer);
  vi.stubGlobal("confirm", asked);
  return asked;
}

test("a dirty screen asks before a route away, and staying stays", async () => {
  const asked = confirming(false);
  drawn(true);
  fireEvent.click(await screen.findByText("leave"));
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(asked).toHaveBeenCalledOnce();
  expect(screen.queryByText("away")).toBeNull();
});

test("a dirty screen the author agrees to leave is left", async () => {
  confirming(true);
  drawn(true);
  fireEvent.click(await screen.findByText("leave"));
  expect(await screen.findByText("away")).toBeDefined();
});

test("a released screen is left without asking", async () => {
  const asked = confirming(false);
  drawn(true);
  fireEvent.click(await screen.findByText("released"));
  expect(await screen.findByText("away")).toBeDefined();
  expect(asked).not.toHaveBeenCalled();
});

test("a clean screen is left without asking", async () => {
  const asked = confirming(false);
  drawn(false);
  fireEvent.click(await screen.findByText("leave"));
  expect(await screen.findByText("away")).toBeDefined();
  expect(asked).not.toHaveBeenCalled();
});

test("only a dirty screen refuses the tab's unload", async () => {
  drawn(true);
  await screen.findByText("authoring");
  const dirtyUnload = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(dirtyUnload);
  expect(dirtyUnload.defaultPrevented).toBe(true);
  cleanup();
  drawn(false);
  await screen.findByText("authoring");
  const cleanUnload = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(cleanUnload);
  expect(cleanUnload.defaultPrevented).toBe(false);
});
