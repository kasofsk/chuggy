/**
 * The chat pane's state as the shell holds it: the viewport's default until
 * the reader moves the pane, where they put it from then on, and the thread
 * they picked for it whether or not the pane is drawn.
 */

import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";
import type { ReactNode } from "react";

import {
  ChatPaneProvider,
  useChatPane,
} from "../app/browser/shell/chatPaneHeld.tsx";
import { chatPaneDefaultAt, chatPaneStoreKey } from "../app/core/chatPane.ts";
import type { ChatPaneState } from "../app/core/chatPane.ts";

afterEach(() => {
  cleanup();
  localStorage.removeItem(chatPaneStoreKey);
});

function named(state: ChatPaneState): string {
  return `${state.placement} ${state.presentation}`;
}

function Held(): ReactNode {
  const { state, moveTo } = useChatPane();
  return (
    <button
      type="button"
      onClick={() => {
        moveTo({ placement: "Left", presentation: "Docked" });
      }}
    >
      {named(state)}
    </button>
  );
}

function drawn(twoColumn: boolean): ReactNode {
  return (
    <ChatPaneProvider twoColumn={twoColumn}>
      <Held />
    </ChatPaneProvider>
  );
}

function shown(): string {
  return screen.getByRole("button").textContent ?? "";
}

test("a pane nobody has moved follows the viewport across a change of width", () => {
  expect(named(chatPaneDefaultAt(false))).toBe("Right Full");
  expect(named(chatPaneDefaultAt(true))).toBe("Right Docked");
  const view = render(drawn(false));
  expect(shown()).toBe(named(chatPaneDefaultAt(false)));
  view.rerender(drawn(true));
  expect(shown()).toBe(named(chatPaneDefaultAt(true)));
  view.rerender(drawn(false));
  expect(shown()).toBe(named(chatPaneDefaultAt(false)));
});

test("a pane the reader moved stays where they put it across a change of width", () => {
  const view = render(drawn(false));
  act(() => {
    screen.getByRole("button").click();
  });
  expect(shown()).toBe("Left Docked");
  view.rerender(drawn(true));
  expect(shown()).toBe("Left Docked");
});

const atlas = { tenant: "acme", project: "atlas" };

function Pick(): ReactNode {
  const { chosen, choose } = useChatPane();
  return (
    <button
      type="button"
      onClick={() => {
        choose({ partition: atlas, session: "picked" });
      }}
    >
      {chosen?.session ?? "none"}
    </button>
  );
}

function picking(drawn: boolean): ReactNode {
  return (
    <ChatPaneProvider twoColumn>{drawn ? <Pick /> : null}</ChatPaneProvider>
  );
}

/** A thread's own page draws no pane, so what the reader picked has to be
 * held by something that page does not take away. */
test("a pick outlives the part that made it, and is there when that part is drawn again", () => {
  const view = render(picking(true));
  expect(shown()).toBe("none");
  act(() => {
    screen.getByRole("button").click();
  });
  expect(shown()).toBe("picked");
  view.rerender(picking(false));
  expect(screen.queryByRole("button")).toBeNull();
  view.rerender(picking(true));
  expect(shown()).toBe("picked");
});
