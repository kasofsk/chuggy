/**
 * The `/` list over the composer, driven through the box a member types in.
 *
 * WHAT IS BEING PROVED IS THE WIRING. The matching has its own cases in
 * `conversationCommand.test.ts`, and the keyboard is the library's. What no
 * other case can settle is that the trigger is registered beside the `@` one,
 * that a pick runs on the page and sends nothing, that Enter over a box that is
 * a command runs it whether or not the list is open, and that a `/` which is no
 * command still reaches the agent.
 */

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { Mock } from "vitest";

import { Conversation } from "../app/browser/conversation/Conversation.tsx";
import type {
  ConversationComposerProps,
  ConversationSent,
} from "../app/browser/conversation/Conversation.tsx";
import type { ConversationCommands } from "../app/browser/conversation/ConversationComposer.tsx";
import type { ConversationAttaches } from "../app/core/conversationAttachments.ts";
import { conversationCommandNames } from "../app/core/conversationCommand.ts";
import type { ConversationCommandName } from "../app/core/conversationCommand.ts";
import { resizeObserverStubbed } from "./resizeObserver.ts";
import { elementScrollToStubbed } from "./scrolling.ts";

beforeEach(() => {
  resizeObserverStubbed();
  elementScrollToStubbed();
});
afterEach(cleanup);

interface Composed {
  readonly composer: ConversationComposerProps;
  readonly onSend: Mock<ConversationComposerProps["onSend"]>;
  readonly onCommand: Mock<(name: ConversationCommandName) => void>;
  readonly onDismiss: Mock<() => void>;
}

function composerOf(said?: string, attaches?: ConversationAttaches): Composed {
  const onSend = vi.fn<ConversationComposerProps["onSend"]>(() =>
    Promise.resolve<ConversationSent>("Sent"),
  );
  const onCommand = vi.fn<(name: ConversationCommandName) => void>();
  const onDismiss = vi.fn<() => void>();
  const commands: ConversationCommands = {
    offered: conversationCommandNames,
    onCommand,
    said,
    onDismiss,
  };
  return {
    composer: {
      takes: true,
      charsMax: 200,
      onSend,
      commands,
      ...(attaches === undefined ? {} : { attaches }),
    },
    onSend,
    onCommand,
    onDismiss,
  };
}

function mounted(composed: Composed): void {
  render(<Conversation exchanges={[]} composer={composed.composer} />);
}

/** Typing, with the caret left where a member's would be. */
async function typed(text: string): Promise<HTMLTextAreaElement> {
  const box = screen.getByRole<HTMLTextAreaElement>("textbox");
  fireEvent.change(box, { target: { value: text } });
  box.setSelectionRange(text.length, text.length);
  fireEvent.select(box);
  await waitFor(() => {
    expect(box.value).toBe(text);
  });
  return box;
}

function offered(): readonly string[] {
  return screen.queryAllByRole("option").map((item) => item.textContent ?? "");
}

test("a `/` at the start of the box offers every command", async () => {
  mounted(composerOf());
  await typed("/");
  await waitFor(() => {
    expect(offered().map((item) => /^\/[a-z]+/u.exec(item)?.[0])).toStrictEqual(
      ["/status", "/usage", "/clear"],
    );
  });
});

test("a `/` in the middle of a sentence offers nothing", async () => {
  mounted(composerOf());
  await typed("see /");
  expect(offered()).toHaveLength(0);
});

test("picking a command runs it, sends nothing, and empties the box", async () => {
  const composed = composerOf();
  mounted(composed);
  const box = await typed("/us");
  await waitFor(() => {
    expect(offered()).toHaveLength(1);
  });
  const pick = screen.getAllByRole("option")[0];
  if (pick === undefined) throw new Error("expected /usage to be offered");
  fireEvent.click(pick);
  await waitFor(() => {
    expect(composed.onCommand).toHaveBeenCalledWith("usage");
  });
  expect(box.value).toBe("");
  expect(composed.onSend).not.toHaveBeenCalled();
});

test("Enter over a command the list is open on runs it", async () => {
  const composed = composerOf();
  mounted(composed);
  const box = await typed("/status");
  await waitFor(() => {
    expect(offered()).toHaveLength(1);
  });
  fireEvent.keyDown(box, { key: "Enter" });
  await waitFor(() => {
    expect(composed.onCommand).toHaveBeenCalledWith("status");
  });
  expect(composed.onSend).not.toHaveBeenCalled();
});

test("Enter over a command the list is closed on runs it rather than sending it", async () => {
  const composed = composerOf();
  mounted(composed);
  const box = await typed("/status ");
  expect(offered()).toHaveLength(0);
  fireEvent.keyDown(box, { key: "Enter" });
  await waitFor(() => {
    expect(composed.onCommand).toHaveBeenCalledWith("status");
  });
  expect(composed.onSend).not.toHaveBeenCalled();
});

test("a command sent with an image held runs, and the image waits for the next message", async () => {
  const composed = composerOf(undefined, {
    countMax: 2,
    mediaTypes: ["image/png"],
  });
  mounted(composed);
  const box = await typed("/status ");
  fireEvent.paste(box, {
    clipboardData: {
      files: [
        new File([new Uint8Array([1, 2, 3])], "shot", { type: "image/png" }),
      ],
      types: ["Files"],
    },
  });
  await waitFor(() => {
    expect(screen.queryAllByRole("img")).toHaveLength(1);
  });
  fireEvent.keyDown(box, { key: "Enter" });
  await waitFor(() => {
    expect(composed.onCommand).toHaveBeenCalledWith("status");
  });
  expect(composed.onSend).not.toHaveBeenCalled();
  expect(screen.queryAllByRole("img")).toHaveLength(1);

  await typed("hi");
  fireEvent.keyDown(box, { key: "Enter" });
  await waitFor(() => {
    expect(composed.onSend).toHaveBeenCalledTimes(1);
  });
  expect(composed.onSend.mock.calls[0]?.[0]).toBe("hi");
  expect(composed.onSend.mock.calls[0]?.[1]).toStrictEqual([
    { mediaType: "image/png", content: new Uint8Array([1, 2, 3]) },
  ]);
});

test("a `/` that is no command is sent as words", async () => {
  const composed = composerOf();
  mounted(composed);
  const box = await typed("/etc/hosts is empty");
  fireEvent.keyDown(box, { key: "Enter" });
  await waitFor(() => {
    expect(composed.onSend).toHaveBeenCalledWith("/etc/hosts is empty", []);
  });
  expect(composed.onCommand).not.toHaveBeenCalled();
});

test("what a command said stands over the box until it is dismissed", () => {
  const composed = composerOf("/status · Open");
  mounted(composed);
  expect(screen.getByRole("status").textContent).toContain("/status · Open");
  fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
  expect(composed.onDismiss).toHaveBeenCalledTimes(1);
});
