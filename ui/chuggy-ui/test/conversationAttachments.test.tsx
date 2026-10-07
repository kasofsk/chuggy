/**
 * An image pasted into the composer: held under the box as the bytes pasted,
 * drawn from a `data:` URI of them, removable, bounded in the box, handed up
 * with the text at a press and handed back with it where the page kept the
 * message — and nothing of it on a surface that takes no images.
 */

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { Conversation } from "../app/browser/conversation/Conversation.tsx";
import type {
  ConversationComposerProps,
  ConversationSent,
} from "../app/browser/conversation/Conversation.tsx";
import { conversationBase64 } from "../app/core/conversationAttachments.ts";
import type { ConversationAttachment } from "../app/core/conversationAttachments.ts";
import { resizeObserverStubbed } from "./resizeObserver.ts";
import { elementScrollToStubbed } from "./scrolling.ts";
import { styleless } from "./styleless.ts";

beforeEach(() => {
  resizeObserverStubbed();
  elementScrollToStubbed();
});

afterEach(() => {
  cleanup();
});

const attaches = { countMax: 2, mediaTypes: ["image/png", "image/jpeg"] };

type Sent = (
  text: string,
  attached: readonly ConversationAttachment[],
) => Promise<ConversationSent>;

function composerOf(
  onSend: Sent,
  more: Partial<ConversationComposerProps> = {},
): ConversationComposerProps {
  return { takes: true, charsMax: 40, attaches, onSend, ...more };
}

function box(): HTMLTextAreaElement {
  return screen.getByRole<HTMLTextAreaElement>("textbox", { name: "Message" });
}

function shot(bytes: readonly number[], type = "image/png"): File {
  return new File([new Uint8Array(bytes)], "shot", { type });
}

function pasted(...files: readonly File[]): void {
  fireEvent.paste(box(), { clipboardData: { files, types: ["Files"] } });
}

function previews(): readonly HTMLImageElement[] {
  return screen.queryAllByRole<HTMLImageElement>("img");
}

async function typed(text: string): Promise<void> {
  fireEvent.change(box(), { target: { value: text } });
  await waitFor(() => {
    expect(box().value).toBe(text);
  });
}

test("a pasted screenshot is held under the box, drawn from a data URI of its own bytes", async () => {
  render(<Conversation exchanges={[]} composer={composerOf(vi.fn())} />);
  pasted(shot([1, 2, 3]));
  await waitFor(() => {
    expect(previews()).toHaveLength(1);
  });
  expect(previews()[0]?.getAttribute("src")).toBe("data:image/png;base64,AQID");
  expect(screen.getByText("1 / 2")).toBeDefined();
  styleless();
});

test("a pasted image has its own control, which removes it and says the box was edited", async () => {
  const onEdit = vi.fn();
  render(
    <Conversation exchanges={[]} composer={composerOf(vi.fn(), { onEdit })} />,
  );
  pasted(shot([1]), shot([2]));
  await waitFor(() => {
    expect(previews()).toHaveLength(2);
  });
  fireEvent.click(screen.getByRole("button", { name: "Remove image 1" }));
  await waitFor(() => {
    expect(previews()).toHaveLength(1);
  });
  expect(previews()[0]?.getAttribute("src")).toBe("data:image/png;base64,Ag==");
  expect(onEdit).toHaveBeenCalledTimes(2);
  styleless();
});

test("a paste past the bound takes what fits and says the bound in the box", async () => {
  render(<Conversation exchanges={[]} composer={composerOf(vi.fn())} />);
  pasted(shot([1]), shot([2]), shot([3]));
  await waitFor(() => {
    expect(previews()).toHaveLength(2);
  });
  expect(screen.getByRole("status").textContent).toBe("At most 2 images");
  styleless();
});

test("a paste of a type the page does not take is refused in the box, naming the types it does", async () => {
  render(<Conversation exchanges={[]} composer={composerOf(vi.fn())} />);
  pasted(shot([1], "image/svg+xml"));
  await waitFor(() => {
    expect(screen.getByRole("status").textContent).toBe("Only PNG, JPEG");
  });
  expect(previews()).toHaveLength(0);
  styleless();
});

test("a press hands the images up with the text and clears both from the box", async () => {
  const onSend = vi.fn<Sent>(() => Promise.resolve("Sent"));
  render(<Conversation exchanges={[]} composer={composerOf(onSend)} />);
  pasted(shot([7]));
  await waitFor(() => {
    expect(previews()).toHaveLength(1);
  });
  await typed("look at this");
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
  await waitFor(() => {
    expect(onSend).toHaveBeenCalledTimes(1);
  });
  const [text, attached] = onSend.mock.calls[0] ?? [];
  expect(text).toBe("look at this");
  expect(attached?.map((one) => [one.mediaType, [...one.content]])).toEqual([
    ["image/png", [7]],
  ]);
  await waitFor(() => {
    expect(previews()).toHaveLength(0);
  });
  styleless();
});

test("a press the page kept hands back the images with the characters, the same images pressed again", async () => {
  const onSend = vi.fn<Sent>(() => Promise.resolve("Kept"));
  render(<Conversation exchanges={[]} composer={composerOf(onSend)} />);
  pasted(shot([7]));
  await waitFor(() => {
    expect(previews()).toHaveLength(1);
  });
  await typed("try once more");
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
  await waitFor(() => {
    expect(box().value).toBe("try once more");
  });
  await waitFor(() => {
    expect(previews()).toHaveLength(1);
  });
  fireEvent.keyDown(box(), { key: "Enter" });
  await waitFor(() => {
    expect(onSend).toHaveBeenCalledTimes(2);
  });
  const [first, second] = onSend.mock.calls.map(([, attached]) => attached);
  expect(second?.[0]).toBe(first?.[0]);
  styleless();
});

test("a message handed back while the box was away puts its images back too", async () => {
  const kept = { mediaType: "image/png", content: new Uint8Array([9]) };
  const taken = vi.fn();
  render(
    <Conversation
      exchanges={[]}
      composer={composerOf(vi.fn(), {
        back: { text: "from before", attached: [kept], taken },
      })}
    />,
  );
  await waitFor(() => {
    expect(box().value).toBe("from before");
  });
  expect(previews()[0]?.getAttribute("src")).toBe("data:image/png;base64,CQ==");
  expect(taken).toHaveBeenCalledTimes(1);
  styleless();
});

test("a surface that takes no images takes no paste of one, and offers nothing that looks as though it would", async () => {
  render(
    <Conversation
      exchanges={[]}
      composer={{ takes: true, charsMax: 40, onSend: vi.fn() }}
    />,
  );
  pasted(shot([1]));
  await Promise.resolve();
  expect(previews()).toHaveLength(0);
  expect(screen.queryByRole("list", { name: "Images" })).toBeNull();
  expect(screen.queryByRole("status")).toBeNull();
  styleless();
});

test("an image larger than one slice of the encoder is encoded whole", () => {
  const bytes = new Uint8Array(0x8000 * 2 + 3).map((_, at) => at % 251);
  const decoded = Uint8Array.from(atob(conversationBase64(bytes)), (char) =>
    char.charCodeAt(0),
  );
  expect(decoded).toStrictEqual(bytes);
});
