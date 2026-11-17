/**
 * The tooltip: no tab stop of its own around a control, a focusable trigger
 * only where the caller says the child abbreviates the text, the text bound as
 * the trigger's description, an abbreviation's text opened by a press, a
 * disabled control's text still reachable from the keyboard, Escape closing it where focus is, and no runtime
 * `<style>` element while it is open — the served policy refuses one.
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { ChatPaneIconButton } from "../app/browser/shell/chatPaneIcons.tsx";
import { Tooltip, tooltipTriggerWrapping } from "../app/browser/ui/Tooltip.tsx";
import { renderCopied } from "./copied.tsx";
import { resizeObserverStubbed } from "./resizeObserver.ts";
import { styleless } from "./styleless.ts";

beforeEach(resizeObserverStubbed);

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

test("around a control the tooltip adds no tab stop, and the control's focus opens it as the control's description", async () => {
  const { container } = render(
    <Tooltip trigger="control" text="what pressing does">
      <button type="button">Press</button>
    </Tooltip>,
  );
  const button = screen.getByRole("button", { name: "Press" });
  expect(button.hasAttribute("tabindex")).toBe(false);
  expect(container.querySelector("[tabindex]")).toBeNull();
  button.focus();
  const content = await screen.findByRole("tooltip");
  expect(content.textContent).toBe("what pressing does");
  expect(button.getAttribute("aria-describedby")).toBe(content.id);
  expect(
    screen.getByRole("button", { description: "what pressing does" }),
  ).toBe(button);
});

test("a wrapper around a disabled control takes the focus the control cannot, and its focus opens the text", async () => {
  render(
    <Tooltip trigger={tooltipTriggerWrapping(true)} text="why it waits">
      <span>
        <button type="button" disabled>
          Send
        </button>
      </span>
    </Tooltip>,
  );
  const button = screen.getByRole("button", { name: "Send" });
  const wrapper = button.parentElement;
  if (wrapper === null) throw new Error("no wrapper around Send");
  expect(wrapper.getAttribute("tabindex")).toBe("0");
  wrapper.focus();
  expect(document.activeElement).toBe(wrapper);
  const content = await screen.findByRole("tooltip");
  expect(content.textContent).toBe("why it waits");
});

test.each([
  { disabled: true, stops: 1 },
  { disabled: false, stops: 0 },
])(
  "an icon button disabled=$disabled keeps its label reachable from the keyboard, with $stops stop added",
  async ({ disabled, stops }) => {
    const { container } = render(
      <ChatPaneIconButton
        glyph="new"
        label="New"
        disabled={disabled}
        onClick={() => undefined}
      />,
    );
    const button = screen.getByRole("button", { name: "New" });
    expect(container.querySelectorAll("[tabindex]").length).toBe(stops);
    const focused = disabled ? button.parentElement : button;
    if (focused === null) throw new Error("no wrapper around New");
    focused.focus();
    expect(document.activeElement).toBe(focused);
    expect((await screen.findByRole("tooltip")).textContent).toBe("New");
  },
);

test("an abbreviation is focusable, and the text appears on focus as its description", async () => {
  const { container } = render(
    <Tooltip trigger="abbreviation" text="the full reason">
      <span>short</span>
    </Tooltip>,
  );
  const trigger = screen.getByText("short");
  expect(trigger.getAttribute("tabindex")).toBe("0");
  styleless();
  trigger.focus();
  const content = await screen.findByRole("tooltip");
  expect(content.textContent).toBe("the full reason");
  expect(trigger.getAttribute("aria-describedby")).toBe(content.id);
  styleless();
  expect(container.querySelector("[style]")).toBeNull();
});

test("a press on an abbreviation opens its text, as a touch screen with nothing to hover presses it", async () => {
  render(
    <Tooltip trigger="abbreviation" text="2026-11-17 09:30">
      <span>3 minutes ago</span>
    </Tooltip>,
  );
  const trigger = screen.getByText("3 minutes ago");
  fireEvent.pointerDown(trigger, { pointerType: "touch" });
  fireEvent.click(trigger);
  expect((await screen.findByRole("tooltip")).textContent).toBe(
    "2026-11-17 09:30",
  );
});

test("a press on an abbreviation inside a link is the link's, and opens no text", () => {
  render(
    <a href="#elsewhere">
      <Tooltip trigger="abbreviation" text="the whole name">
        <span>the name</span>
      </Tooltip>
    </a>,
  );
  fireEvent.click(screen.getByText("the name"));
  expect(screen.queryByRole("tooltip")).toBeNull();
});

test("a decoration makes nothing focusable, and gives its text to assistive technology beside the child", () => {
  const { container } = render(
    <Tooltip trigger="decoration" text="the whole of it">
      <span>part</span>
    </Tooltip>,
  );
  expect(container.querySelector("[tabindex]")).toBeNull();
  const spoken = screen.getByText("the whole of it");
  expect(spoken.className).toBe("visually-hidden");
  expect(screen.queryByRole("tooltip")).toBeNull();
});

test("Escape closes the open tooltip and leaves focus where it was", async () => {
  render(
    <Tooltip trigger="control" text="what pressing does">
      <button type="button">Press</button>
    </Tooltip>,
  );
  const button = screen.getByRole("button", { name: "Press" });
  button.focus();
  await screen.findByRole("tooltip");
  fireEvent.keyDown(document.activeElement ?? document.body, {
    key: "Escape",
  });
  expect(screen.queryByRole("tooltip")).toBeNull();
  expect(document.activeElement).toBe(button);
  expect(button.hasAttribute("aria-describedby")).toBe(false);
});

test("absent text draws the child alone", () => {
  render(
    <Tooltip trigger="abbreviation" text={undefined}>
      <span>plain</span>
    </Tooltip>,
  );
  const drawn = screen.getByText("plain");
  expect(drawn.hasAttribute("tabindex")).toBe(false);
  expect(screen.queryByRole("tooltip")).toBeNull();
  styleless();
});

test("a descriptor is drawn in the catalog's words", async () => {
  renderCopied(
    <Tooltip trigger="abbreviation" text={{ id: "api-reason-deadline" }}>
      <span>short</span>
    </Tooltip>,
  );
  fireEvent.focus(screen.getByText("short"));
  const content = await screen.findByRole("tooltip");
  expect(content.textContent).toBe("the request outlived its deadline");
});
