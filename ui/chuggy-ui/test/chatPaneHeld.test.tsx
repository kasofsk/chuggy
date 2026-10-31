/**
 * The chat pane's state as the shell holds it: the viewport's default until
 * the reader moves the pane, where they put it from then on, and the thread
 * they picked for it whether or not the pane is drawn. Below two columns it
 * opens whole on every load, and nothing moved there is stored.
 */

import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";
import type { ReactNode } from "react";

import {
  ChatPaneProvider,
  useChatPane,
  useChatPaneYields,
} from "../app/browser/shell/chatPaneHeld.tsx";
import {
  chatPaneDefaultAt,
  chatPaneStoreKey,
  chatPaneToggled,
} from "../app/core/chatPane.ts";
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

test("a pane the reader moved at two columns stays where they put it there, and opens whole below them", () => {
  const view = render(drawn(true));
  act(() => {
    screen.getByRole("button").click();
  });
  expect(shown()).toBe("Left Docked");
  view.rerender(drawn(false));
  expect(shown()).toBe(named(chatPaneDefaultAt(false)));
  view.rerender(drawn(true));
  expect(shown()).toBe("Left Docked");
});

function stored(state: ChatPaneState): void {
  localStorage.setItem(chatPaneStoreKey, JSON.stringify(state));
}

test("below two columns a stored docked or full pane opens whole, and at two columns what is stored wins", () => {
  for (const presentation of ["Docked", "Full"] as const) {
    stored({ placement: "Left", presentation });
    const view = render(drawn(false));
    expect(shown(), presentation).toBe(named(chatPaneDefaultAt(false)));
    view.rerender(drawn(true));
    expect(shown(), presentation).toBe(`Left ${presentation}`);
    cleanup();
  }
});

/** The pane's collapse and its strip's expand, and a screen pressed for in
 * the bar. */
function Moved(): ReactNode {
  const { state, moveTo } = useChatPane();
  const yields = useChatPaneYields();
  return (
    <>
      <output>{named(state)}</output>
      <button
        type="button"
        onClick={() => {
          moveTo(chatPaneToggled(state));
        }}
      >
        Toggle
      </button>
      <button type="button" onClick={yields}>
        Screen
      </button>
    </>
  );
}

function moving(twoColumn: boolean): ReactNode {
  return (
    <ChatPaneProvider twoColumn={twoColumn}>
      <Moved />
    </ChatPaneProvider>
  );
}

function pressed(name: string): void {
  act(() => {
    screen.getByRole("button", { name }).click();
  });
}

function movedTo(): string {
  return screen.getByRole("status").textContent ?? "";
}

const leftDocked = JSON.stringify({
  placement: "Left",
  presentation: "Docked",
});

test("below two columns a collapse and an expand come back whole, and store nothing", () => {
  localStorage.setItem(chatPaneStoreKey, leftDocked);
  render(moving(false));
  pressed("Toggle");
  expect(movedTo()).toBe("Right Collapsed");
  pressed("Toggle");
  expect(movedTo()).toBe(named(chatPaneDefaultAt(false)));
  expect(localStorage.getItem(chatPaneStoreKey)).toBe(leftDocked);
});

test("below two columns a reload after a collapse opens whole", () => {
  render(moving(false));
  pressed("Toggle");
  expect(movedTo()).toBe("Right Collapsed");
  cleanup();
  render(moving(false));
  expect(movedTo()).toBe(named(chatPaneDefaultAt(false)));
  expect(localStorage.getItem(chatPaneStoreKey)).toBeNull();
});

test("below two columns a screen pressed for while the pane is whole leaves the strip, and stores nothing", () => {
  localStorage.setItem(chatPaneStoreKey, leftDocked);
  render(moving(false));
  pressed("Screen");
  expect(movedTo()).toBe("Right Collapsed");
  pressed("Screen");
  expect(movedTo()).toBe("Right Collapsed");
  expect(localStorage.getItem(chatPaneStoreKey)).toBe(leftDocked);
});

test("at two columns a screen pressed for puts a whole pane back beside the pages, and stores it", () => {
  stored({ placement: "Left", presentation: "Full" });
  render(moving(true));
  pressed("Screen");
  expect(movedTo()).toBe("Left Docked");
  expect(localStorage.getItem(chatPaneStoreKey)).toBe(leftDocked);
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
