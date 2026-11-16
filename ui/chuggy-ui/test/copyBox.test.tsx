/**
 * The box a text is copied from, over both ways its text breaks: the whole
 * text as code under what is said of it, the control that puts exactly that
 * text on the clipboard, and no control where no clipboard is held. A folded
 * box draws its bar alone until the bar is pressed, closes again on a second
 * press, and copies the whole text either way. A labelled control shows its
 * name as a word, and Copied in its place once the clipboard took the text.
 */

import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";

import { CopyBox, copyBoxBreaks } from "../app/browser/ui/CopyBox.tsx";
import { CopyProvider } from "../app/browser/ui/copyHeld.tsx";
import { styleless } from "./styleless.ts";
import { renderCopied } from "./copied.tsx";

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
    const view = renderCopied(
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
  const view = renderCopied(
    <CopyBox about="Linux" text={text} copyLabel="Copy" />,
  );
  expect(
    view.container.querySelector("code")?.classList.contains("break-all"),
  ).toBe(true);
});

test("the control puts exactly the text on the clipboard under the name it is given, and says so", async () => {
  const copied: string[] = [];
  renderCopied(
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
  const view = renderCopied(
    <CopyBox about="Linux" text={text} copyLabel="Copy" />,
  );
  expect(view.container.querySelector("code")?.textContent).toBe(text);
  expect(screen.queryByRole("button")).toBeNull();
});

/** A folded box under a clipboard that keeps what it is handed. */
function foldedCopied(): string[] {
  const copied: string[] = [];
  renderCopied(
    <CopyProvider
      write={(written) => {
        copied.push(written);
        return Promise.resolve(true);
      }}
    >
      <CopyBox
        about="Paste into Claude Code"
        text={text}
        copyLabel="Copy prompt"
        breaks="words"
        folded
      />
    </CopyProvider>,
  );
  return copied;
}

function bar(): HTMLElement {
  return screen.getByRole("button", { name: "Paste into Claude Code" });
}

test("a folded box starts as its bar alone, with none of its text drawn", () => {
  foldedCopied();
  expect(document.querySelector("code")).toBeNull();
  expect(screen.queryByText(text)).toBeNull();
  expect(bar().getAttribute("aria-expanded")).toBe("false");
  expect(screen.getByRole("button", { name: "Copy prompt" })).toBeDefined();
});

test("a folded box's bar opens its whole text, broken as asked, and folds it again", () => {
  foldedCopied();
  fireEvent.click(bar());
  const code = document.querySelector("code");
  expect(code?.textContent).toBe(text);
  expect(code?.classList.contains("wrap-anywhere")).toBe(true);
  expect(bar().getAttribute("aria-expanded")).toBe("true");
  fireEvent.click(bar());
  expect(document.querySelector("code")).toBeNull();
  expect(bar().getAttribute("aria-expanded")).toBe("false");
});

test("a folded box's control copies the whole text without opening it, and opening it is no copy", async () => {
  const copied = foldedCopied();
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Copy prompt" }));
    await Promise.resolve();
  });
  expect(copied).toStrictEqual([text]);
  expect(document.querySelector("code")).toBeNull();
  fireEvent.click(bar());
  expect(copied).toStrictEqual([text]);
});

/** A box whose control is labelled, open or folded, under a clipboard that
 * answers whether it took the text. */
function labelledCopied(folded: boolean, taken: boolean): string[] {
  const copied: string[] = [];
  renderCopied(
    <CopyProvider
      write={(written) => {
        copied.push(written);
        return Promise.resolve(taken);
      }}
    >
      <CopyBox
        about="Paste into Claude Code"
        text={text}
        copyLabel="Copy prompt"
        folded={folded}
        labelled
      />
    </CopyProvider>,
  );
  return copied;
}

/** The word a labelled control shows, by what is not unshown on it. */
function shownWord(control: HTMLElement): string | undefined {
  return [...control.querySelectorAll(".copy-word > span")]
    .filter((word) => !word.classList.contains("copy-word-unshown"))
    .map((word) => word.textContent)
    .join("");
}

test.each([false, true])(
  "a labelled control (folded: %s) shows its name as a word and is heard by it, then shows Copied in its place once written, still heard by its name",
  async (folded) => {
    const copied = labelledCopied(folded, true);
    const control = screen.getByRole("button", { name: "Copy prompt" });
    expect(shownWord(control)).toBe("Copy prompt");
    expect(control.textContent).toContain("Copy prompt");
    expect(document.querySelector(".copy-said")).toBeNull();
    await act(async () => {
      fireEvent.click(control);
      await Promise.resolve();
    });
    expect(copied).toStrictEqual([text]);
    expect(shownWord(control)).toBe("Copied");
    expect(screen.getByRole("button", { name: "Copy prompt" })).toBe(control);
    expect(screen.getByRole("status").textContent).toBe("Copied");
  },
);

test("a labelled control whose write is refused keeps showing its name", async () => {
  labelledCopied(false, false);
  const control = screen.getByRole("button", { name: "Copy prompt" });
  await act(async () => {
    fireEvent.click(control);
    await Promise.resolve();
  });
  expect(shownWord(control)).toBe("Copy prompt");
  expect(screen.getByRole("status").textContent).toBe("");
});
