/**
 * An image pasted into the composer, or picked with its paperclip: held over
 * the box as the bytes given, drawn from a `data:` URI of them, removable,
 * bounded in the box, handed up with the text at a press and handed back with
 * it where the page kept the message — and nothing of it on a surface that
 * takes no images.
 *
 * jsdom's file input fires a change at every pick, so the picker is given the
 * browser's own rule: a pick of what the input already holds fires none.
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

/** Picks `files` through the paperclip's input as a browser does, which fires
 * no change for a pick of what the input already holds. */
function picked(...files: readonly File[]): void {
  const input = document.querySelector<HTMLInputElement>('input[type="file"]');
  if (input === null) throw new Error("no picker is drawn");
  const opened = vi.spyOn(input, "click");
  fireEvent.click(screen.getByRole("button", { name: "Attach image" }));
  expect(opened).toHaveBeenCalledTimes(1);
  opened.mockRestore();
  const held = pickerHeld.get(input) ?? "";
  const chosen = files.map((file) => file.name).join(",");
  if (held === chosen) return;
  pickerHeld.set(input, chosen);
  Object.defineProperty(input, "value", {
    configurable: true,
    get: () => pickerHeld.get(input) ?? "",
    set: (value: string) => {
      pickerHeld.set(input, value);
    },
  });
  Object.defineProperty(input, "files", { configurable: true, value: files });
  fireEvent.change(input);
}

const pickerHeld = new WeakMap<HTMLInputElement, string>();

function previews(): readonly HTMLImageElement[] {
  return screen.queryAllByRole<HTMLImageElement>("img");
}

async function typed(text: string): Promise<void> {
  fireEvent.change(box(), { target: { value: text } });
  await waitFor(() => {
    expect(box().value).toBe(text);
  });
}

test("a pasted screenshot is held over the box, drawn from a data URI of its own bytes", async () => {
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
  expect(screen.queryByRole("button", { name: "Attach image" })).toBeNull();
  expect(document.querySelector('input[type="file"]')).toBeNull();
  expect(screen.queryByRole("status")).toBeNull();
  styleless();
});

test("the paperclip's picker offers the types the page takes, and what is picked is held as a paste is", async () => {
  const onEdit = vi.fn();
  render(
    <Conversation exchanges={[]} composer={composerOf(vi.fn(), { onEdit })} />,
  );
  expect(
    document.querySelector('input[type="file"]')?.getAttribute("accept"),
  ).toBe("image/png,image/jpeg");
  picked(shot([1, 2, 3]));
  await waitFor(() => {
    expect(previews()).toHaveLength(1);
  });
  expect(previews()[0]?.getAttribute("src")).toBe("data:image/png;base64,AQID");
  expect(onEdit).toHaveBeenCalledTimes(1);
  styleless();
});

test("one file picked, removed and picked again is held again, and picked twice is held twice", async () => {
  render(<Conversation exchanges={[]} composer={composerOf(vi.fn())} />);
  const one = shot([5]);
  picked(one);
  await waitFor(() => {
    expect(previews()).toHaveLength(1);
  });
  fireEvent.click(screen.getByRole("button", { name: "Remove image 1" }));
  await waitFor(() => {
    expect(previews()).toHaveLength(0);
  });
  picked(one);
  await waitFor(() => {
    expect(previews()).toHaveLength(1);
  });
  picked(one);
  await waitFor(() => {
    expect(previews()).toHaveLength(2);
  });
  styleless();
});

test("a pick past the bound takes what fits and says the bound as a paste does", async () => {
  render(
    <Conversation
      exchanges={[]}
      composer={composerOf(vi.fn(), {
        attaches: { ...attaches, countMax: 4 },
      })}
    />,
  );
  picked(shot([1]), shot([2]), shot([3]), shot([4]), shot([5]));
  await waitFor(() => {
    expect(previews()).toHaveLength(4);
  });
  expect(screen.getByRole("status").textContent).toBe("At most 4 images");
  styleless();
});

test("a pick of a type the page does not take is refused in the words a paste's is", async () => {
  render(<Conversation exchanges={[]} composer={composerOf(vi.fn())} />);
  picked(shot([1], "image/svg+xml"));
  await waitFor(() => {
    expect(screen.getByRole("status").textContent).toBe("Only PNG, JPEG");
  });
  expect(previews()).toHaveLength(0);
  styleless();
});

test("a box the door takes nothing more from offers no paperclip", async () => {
  const onSend = vi.fn<Sent>(() => Promise.resolve("Kept"));
  render(
    <Conversation
      exchanges={[]}
      composer={composerOf(onSend, { takes: false, holds: true })}
    />,
  );
  await Promise.resolve();
  expect(screen.queryByRole("button", { name: "Attach image" })).toBeNull();
  styleless();
});

test("an image larger than one slice of the encoder is encoded whole", () => {
  const bytes = new Uint8Array(0x8000 * 2 + 3).map((_, at) => at % 251);
  const decoded = Uint8Array.from(atob(conversationBase64(bytes)), (char) =>
    char.charCodeAt(0),
  );
  expect(decoded).toStrictEqual(bytes);
});
