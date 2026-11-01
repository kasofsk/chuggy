/**
 * The chat pane's slice: a move is written to the browser's store only where
 * the viewport divides and read back by the next store, and each project's
 * record holds its pick whether or not a pane is drawn.
 */

import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";
import type { ReactNode } from "react";

import type { PartitionIdentity } from "../../../src/contract/http.ts";
import {
  chatPaneHoldOf,
  chatPaneMoved,
  chatPaneOpenedAt,
  chatPaneOpenPressed,
  chatPanePickedAt,
  chatPaneRecordAt,
} from "../app/browser/shell/chatPanes.ts";
import {
  consoleStore,
  useConsoleDispatch,
  useConsoleSelector,
} from "../app/browser/store.ts";
import type { ConsoleStore } from "../app/browser/store.ts";
import { chatPaneHoldState, chatPaneStoreKey } from "../app/core/chatPane.ts";
import { ConsoleStoreProvided } from "./consoleStoreProvided.tsx";

afterEach(() => {
  cleanup();
  localStorage.removeItem(chatPaneStoreKey);
});

const atlas: PartitionIdentity = { tenant: "acme", project: "atlas" };
const borealis: PartitionIdentity = { tenant: "acme", project: "borealis" };

const leftDocked = { placement: "Left", presentation: "Docked" } as const;

test("a move at two columns is stored, and a new store reads it back", () => {
  const store = consoleStore();
  store.dispatch(chatPaneMoved(leftDocked, true));
  expect(chatPaneHoldOf(store.getState()).stored).toStrictEqual(leftDocked);
  expect(localStorage.getItem(chatPaneStoreKey)).toBe(
    JSON.stringify(leftDocked),
  );
  const reloaded = chatPaneHoldOf(consoleStore().getState());
  expect(chatPaneHoldState(reloaded, true)).toStrictEqual(leftDocked);
});

test("a move below two columns is held and stores nothing, and a new store holds none of it", () => {
  const store = consoleStore();
  store.dispatch(
    chatPaneMoved({ placement: "Right", presentation: "Collapsed" }, false),
  );
  expect(
    chatPaneHoldState(chatPaneHoldOf(store.getState()), false),
  ).toStrictEqual({ placement: "Right", presentation: "Collapsed" });
  expect(localStorage.getItem(chatPaneStoreKey)).toBeNull();
  const reloaded = chatPaneHoldOf(consoleStore().getState());
  expect(reloaded.stored).toBeUndefined();
  expect(chatPaneHoldState(reloaded, false).presentation).toBe("Full");
});

test("New's key stands until an open answers in its project, and only there", () => {
  const store = consoleStore();
  const first = store.dispatch(chatPaneOpenPressed(atlas));
  expect(store.dispatch(chatPaneOpenPressed(atlas))).toBe(first);
  const other = store.dispatch(chatPaneOpenPressed(borealis));
  expect(other).not.toBe(first);
  store.dispatch(chatPaneOpenedAt({ partition: atlas, session: "opened" }));
  const record = chatPaneRecordAt(store.getState(), atlas);
  expect(record.picked).toBe("opened");
  expect(record.openKey).toBeUndefined();
  expect(store.dispatch(chatPaneOpenPressed(atlas))).not.toBe(first);
  expect(store.dispatch(chatPaneOpenPressed(borealis))).toBe(other);
});

function Pick(): ReactNode {
  const dispatch = useConsoleDispatch();
  const picked = useConsoleSelector(
    (state) => chatPaneRecordAt(state, atlas).picked,
  );
  return (
    <button
      type="button"
      onClick={() => {
        dispatch(chatPanePickedAt({ partition: atlas, session: "picked" }));
      }}
    >
      {picked ?? "none"}
    </button>
  );
}

function picking(store: ConsoleStore, drawn: boolean): ReactNode {
  return (
    <ConsoleStoreProvided store={store}>
      {drawn ? <Pick /> : null}
    </ConsoleStoreProvided>
  );
}

function shown(): string {
  return screen.getByRole("button").textContent ?? "";
}

/** A thread's own page draws no pane, so what the reader picked has to be
 * held by something that page does not take away. */
test("a pick outlives the part that made it, and is there when that part is drawn again", () => {
  const store = consoleStore();
  const view = render(picking(store, true));
  expect(shown()).toBe("none");
  act(() => {
    screen.getByRole("button").click();
  });
  expect(shown()).toBe("picked");
  view.rerender(picking(store, false));
  expect(screen.queryByRole("button")).toBeNull();
  view.rerender(picking(store, true));
  expect(shown()).toBe("picked");
});
