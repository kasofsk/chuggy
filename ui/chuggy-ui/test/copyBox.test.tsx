/**
 * The box a text is copied from, over both ways its text breaks: the whole
 * text as code under what is said of it, the control that puts exactly that
 * text on the clipboard, and no control where no clipboard is held.
 */

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, expect, test } from "vitest";

import { CopyBox, copyBoxBreaks } from "../app/browser/ui/CopyBox.tsx";
import { CopyProvider } from "../app/browser/ui/copyHeld.tsx";
import { styleless } from "./styleless.ts";

afterEach(() => {
  styleless();
  cleanup();
});

const text = 'run "curl -fsS https://chuggy.example/setup -o ~/setup" now';

/** The class each way of breaking is drawn with, and the one the other is. */
const drawnAs = {
  anywhere: ["break-all", "wrap-anywhere"],
  words: ["wrap-anywhere", "break-all"],
} as const;

test("a box draws its whole text as code under what is said of it, broken the way it is asked to", () => {
  for (const breaks of copyBoxBreaks) {
    const view = render(
      <CopyBox about="Linux" text={text} copyLabel="Copy" breaks={breaks} />,
    );
    const code = view.container.querySelector("code");
    expect(code?.textContent).toBe(text);
    expect(screen.getByText("Linux")).toBeDefined();
    const [drawn, other] = drawnAs[breaks];
    expect(code?.classList.contains(drawn)).toBe(true);
    expect(code?.classList.contains(other)).toBe(false);
    expect(view.container.querySelector("[style]")).toBeNull();
    cleanup();
  }
});

test("a box asked nothing of its breaks is a command's, broken wherever its line ends", () => {
  const view = render(<CopyBox about="Linux" text={text} copyLabel="Copy" />);
  expect(
    view.container.querySelector("code")?.classList.contains("break-all"),
  ).toBe(true);
});

test("the control puts exactly the text on the clipboard under the name it is given, and says so", async () => {
  const copied: string[] = [];
  render(
    <CopyProvider
      write={(written) => {
        copied.push(written);
        return Promise.resolve(true);
      }}
    >
      <CopyBox about="Linux" text={text} copyLabel="Copy command" />
    </CopyProvider>,
  );
  expect(screen.getByRole("status").textContent).toBe("");
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Copy command" }));
    await Promise.resolve();
  });
  expect(copied).toStrictEqual([text]);
  expect(screen.getByRole("status").textContent).toBe("Copied");
});

test("a box under no clipboard draws its text and no control", () => {
  const view = render(<CopyBox about="Linux" text={text} copyLabel="Copy" />);
  expect(view.container.querySelector("code")?.textContent).toBe(text);
  expect(screen.queryByRole("button")).toBeNull();
});
