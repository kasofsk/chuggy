/**
 * The chat pane's state as the shell holds it: the viewport's default until
 * the reader moves the pane, and where they put it from then on.
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
  expect(named(chatPaneDefaultAt(false))).not.toBe(
    named(chatPaneDefaultAt(true)),
  );
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
