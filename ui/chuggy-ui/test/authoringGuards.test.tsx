/**
 * What stands between a dirty authoring screen and leaving it: a route away
 * asks and the answer decides, the tab's unload is refused, and the exits a
 * submit's own ending makes are let through without asking. Beside it, what
 * this browser keeps of a screen's images, read back whatever is stored.
 */

import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
  useParams,
} from "@tanstack/react-router";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, expect, test, vi } from "vitest";

import {
  ticketYamlImagesKept,
  ticketYamlImagesStored,
  ticketYamlStoreKey,
  useAuthoringGuards,
} from "../app/browser/editor/authoringGuards.tsx";
import { CreationTicketLink } from "../app/browser/TicketCreation.tsx";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.localStorage.clear();
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

const atlas = { tenant: "acme", project: "atlas" };

/** A dirty creation screen drawing the way to a ticket its submit found
 * already made, and the ticket's screen, which says where it was reached. */
function drawnLinked(): void {
  const root = createRootRoute({ component: () => <Outlet /> });
  const Creation = (): ReactNode => {
    useAuthoringGuards(true);
    return <CreationTicketLink partition={atlas} ticket={12} />;
  };
  const Ticket = (): ReactNode => {
    const at: Record<string, string | undefined> = useParams({ strict: false });
    return (
      <p>{`reached ${String(at["tenant"])}/${String(at["project"])}#${String(at["ticket"])}`}</p>
    );
  };
  const routes = ["new", "$ticket"].map((leaf) =>
    createRoute({
      getParentRoute: () => root,
      path: `/$tenant/$project/tickets/${leaf}`,
      component: leaf === "new" ? Creation : Ticket,
    }),
  );
  render(
    <RouterProvider
      router={createRouter({
        history: createMemoryHistory({
          initialEntries: ["/acme/atlas/tickets/new"],
        }),
        routeTree: root.addChildren(routes),
      })}
    />,
  );
}

/** The note the link is drawn in has said what is left behind, so the guard's
 * question would be asked twice. */
test("the way to a ticket a submit found already made is taken without asking", async () => {
  const asked = confirming(false);
  drawnLinked();
  fireEvent.click(await screen.findByRole("link", { name: "Ticket 12" }));
  expect(await screen.findByText("reached acme/atlas#12")).toBeDefined();
  expect(asked).not.toHaveBeenCalled();
});

/** Whatever this browser holds where one screen keeps its images, replaced
 * by what the case says is stored there. */
function planted(key: string, stored: string): void {
  ticketYamlImagesKept(key, ["planted"]);
  for (let at = 0; at < window.localStorage.length; at += 1) {
    const name = window.localStorage.key(at);
    if (name !== null && window.localStorage.getItem(name) === '["planted"]')
      window.localStorage.setItem(name, stored);
  }
}

test.each([
  ["another ticket of its project", ticketYamlStoreKey(atlas, 13)],
  ["a new ticket of its project", ticketYamlStoreKey(atlas, undefined)],
  [
    "its ticket in another project",
    ticketYamlStoreKey({ ...atlas, project: "other" }, 12),
  ],
])("the images one screen kept are not read by %s", (_said, other) => {
  const own = ticketYamlStoreKey(atlas, 12);
  ticketYamlImagesKept(own, ["artifact-1"]);
  expect(ticketYamlImagesStored(own)).toStrictEqual(["artifact-1"]);
  expect(ticketYamlImagesStored(other)).toStrictEqual([]);
});

/** The value is this browser's and anything may have written it, so only the
 * text in a list is ever read as an image, and nothing stored throws. */
test.each([
  ["a list of more than text", '[1,null,"a",["b"],{"c":1},""]', ["a", ""]],
  ["no list", '{"0":"a"}', []],
  ["nothing that parses", "{", []],
])("images stored as %s are read as the text listed", (_said, stored, read) => {
  const key = ticketYamlStoreKey(atlas, 12);
  planted(key, stored);
  expect(ticketYamlImagesStored(key)).toStrictEqual(read);
});
