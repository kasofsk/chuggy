/**
 * The open chat pane's header: the thread's title, at most New and the
 * control that puts the pane away, and one menu holding everything else by
 * its word — History, Open, Copy link, Rename, Full screen and Close. Where the
 * viewport does not divide, putting the pane away is Back, at the row's start.
 */

import shellSheet from "../app/browser/shell/shell.css?raw";
import {
  act,
  cleanup,
  fireEvent,
  screen,
  within,
} from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import type { ThreadEntryResponse } from "../../../src/contract/responses.ts";
import { consoleQueryClient } from "../app/core/consoleWrite.ts";
import { chatPaneStoreKey, chatPaneToggled } from "../app/core/chatPane.ts";
import { SessionProvider } from "../app/browser/session.tsx";
import { useChatPane } from "../app/browser/shell/chatPaneHeld.ts";
import { ChatPaneHeader } from "../app/browser/shell/ChatPaneHeader.tsx";
import { viewportTwoColumnEm } from "../app/browser/shell/viewport.ts";
import { CopyProvider } from "../app/browser/ui/copyHeld.tsx";
import type { CopyWrite } from "../app/browser/ui/copyHeld.tsx";
import {
  chatPaneMenuChosen,
  chatPaneMenuOffers,
  chatPaneMenuOpened,
} from "./chatPaneMenu.tsx";
import { ConsoleStoreBareProvided } from "./consoleStoreBare.tsx";
import { renderCopied } from "./copied.tsx";
import { resizeObserverStubbed } from "./resizeObserver.ts";
import { Routed } from "./routed.tsx";
import { holderDouble, settled, turned } from "./screenHarness.tsx";
import { sheetDeclared, sheetRules } from "./sheet.ts";
import {
  threadEntry,
  threadMineSession,
  threadOtherSession,
  threadPartition,
} from "./threadFixture.ts";
import { viewportAtEm, viewportDeskEm } from "./viewport.ts";

beforeEach(() => {
  resizeObserverStubbed();
});

afterEach(() => {
  cleanup();
  localStorage.removeItem(chatPaneStoreKey);
  vi.unstubAllGlobals();
});

const threads = [
  threadEntry({ session: threadOtherSession, owner: "ada", title: "theirs" }),
  threadEntry({
    session: threadMineSession,
    owner: "geoff",
    mine: true,
    title: "mine",
  }),
];

/** Where the pane stands as the store holds it, said beside the header, and
 * the strip's own press, which opens it under two columns. */
function PaneSaid(): ReactNode {
  const held = useChatPane();
  return (
    <>
      <output aria-label="pane">{`${held.state.placement} ${held.state.presentation}`}</output>
      <button
        type="button"
        onClick={() => {
          held.moveTo(chatPaneToggled(held.state));
        }}
      >
        strip
      </button>
    </>
  );
}

function paneSaid(): string {
  return screen.getByRole("status", { name: "pane" }).textContent;
}

/** The header as the open pane draws it, over `thread` or over none. */
async function headerDrawn(
  drawn: {
    readonly thread?: ThreadEntryResponse | undefined;
    readonly viewOnly?: boolean;
    readonly narrow?: boolean;
    readonly write?: CopyWrite;
    readonly onChoose?: (session: string) => void;
  } = {},
): Promise<HTMLElement> {
  viewportAtEm(
    drawn.narrow === true ? viewportTwoColumnEm - 1 : viewportDeskEm,
  );
  const viewOnly = drawn.viewOnly ?? false;
  renderCopied(
    <QueryClientProvider client={consoleQueryClient()}>
      <SessionProvider holder={holderDouble()}>
        <CopyProvider write={drawn.write ?? (() => Promise.resolve(true))}>
          <ConsoleStoreBareProvided>
            <Routed>
              <ChatPaneHeader
                partition={threadPartition}
                thread={drawn.thread}
                viewOnly={viewOnly}
                placement="Right"
                start={
                  viewOnly ? null : <button type="button" aria-label="New" />
                }
                said={null}
                history={{
                  threads,
                  session: drawn.thread?.session,
                  onChoose: drawn.onChoose ?? vi.fn(),
                }}
              />
              <PaneSaid />
            </Routed>
          </ConsoleStoreBareProvided>
        </CopyProvider>
      </SessionProvider>
    </QueryClientProvider>,
  );
  await settled();
  const header = document.querySelector("header");
  if (header === null) throw new Error("no header drawn");
  return header;
}

const own = threadEntry({
  session: threadMineSession,
  mine: true,
  title: "mine",
});

/** The names of the header's buttons, in its order. */
function buttonsNamed(header: HTMLElement): readonly string[] {
  return within(header)
    .getAllByRole("button")
    .map((button) => button.getAttribute("aria-label") ?? button.textContent);
}

test("beside the pages the header is the title, New, Collapse and the menu, and nothing else", async () => {
  const header = await headerDrawn({ thread: own });
  expect(
    within(header).getByRole("heading", { level: 2, name: "mine" }),
  ).toBeDefined();
  expect(buttonsNamed(header)).toStrictEqual(["New", "Collapse", "Chat menu"]);
});

test("every former control of the header is an item of the menu, by its word", async () => {
  await headerDrawn({ thread: own });
  expect(await chatPaneMenuOffers()).toStrictEqual([
    "History",
    "Open",
    "Copy link",
    "Rename",
    "Full screen",
    "Close",
  ]);
});

test("a stranger's thread offers no Rename", async () => {
  await headerDrawn({
    thread: threadEntry({ session: threadOtherSession, title: "theirs" }),
  });
  expect(await chatPaneMenuOffers()).toStrictEqual([
    "History",
    "Open",
    "Copy link",
    "Full screen",
    "Close",
  ]);
});

/** Reading a thread is not changing it, so a reader who may change nothing
 * still reaches the history, its page and its address. */
test("a reader who may change nothing is offered neither New, Rename nor Close", async () => {
  const header = await headerDrawn({ thread: own, viewOnly: true });
  expect(buttonsNamed(header)).toStrictEqual(["Collapse", "Chat menu"]);
  expect(await chatPaneMenuOffers()).toStrictEqual([
    "History",
    "Open",
    "Copy link",
    "Full screen",
  ]);
});

test("a pane holding no thread is titled New chat, and its menu offers what is the pane's", async () => {
  const header = await headerDrawn();
  expect(
    within(header).getByRole("heading", { level: 2, name: "New chat" }),
  ).toBeDefined();
  expect(await chatPaneMenuOffers()).toStrictEqual(["History", "Full screen"]);
});

/** Each glyph's hidden name is also what a pointer or a keyboard focus
 * reveals. */
test.each(["Collapse", "Chat menu"])(
  "%s names itself again as a tooltip on focus",
  async (name) => {
    const header = await headerDrawn({ thread: own });
    const button = within(header).getByRole("button", { name });
    const trigger = button.closest('[tabindex="0"]');
    if (trigger === null) throw new Error(`no tooltip trigger around ${name}`);
    fireEvent.focus(trigger);
    expect((await screen.findByRole("tooltip")).textContent).toBe(name);
  },
);

test("under two columns the header leads with Back, offers no Collapse and no Full screen, and Back puts the pane away", async () => {
  const header = await headerDrawn({ thread: own, narrow: true });
  expect(buttonsNamed(header)).toStrictEqual(["Back", "New", "Chat menu"]);
  expect(header.firstElementChild?.textContent).toBe("Back");
  expect(await chatPaneMenuOffers()).toStrictEqual([
    "History",
    "Open",
    "Copy link",
    "Rename",
    "Close",
  ]);
  await turned(() => {
    fireEvent.click(screen.getByRole("button", { name: "strip" }));
  });
  expect(paneSaid()).toBe("Bottom Full");
  await turned(() => {
    fireEvent.click(within(header).getByRole("button", { name: "Back" }));
  });
  expect(paneSaid()).toBe("Bottom Collapsed");
});

test("Full screen fills the frame and Exit full screen puts it back", async () => {
  await headerDrawn({ thread: own });
  expect(paneSaid()).toBe("Right Docked");
  await chatPaneMenuChosen("Full screen");
  expect(paneSaid()).toBe("Right Full");
  await chatPaneMenuChosen("Exit full screen");
  expect(paneSaid()).toBe("Right Docked");
});

test("History opens a dialog titled at the level under the page's, whose choice holds a thread and closes it", async () => {
  const onChoose = vi.fn();
  await headerDrawn({ thread: own, onChoose });
  await chatPaneMenuChosen("History");
  const history = screen.getByRole("dialog", { name: "History" });
  expect(
    within(history).getByRole("heading", { level: 2, name: "History" }),
  ).toBeDefined();
  expect(
    within(history)
      .getAllByRole("heading", { level: 3 })
      .map((heading) => heading.textContent),
  ).toStrictEqual(["Yours", "Everyone else's"]);
  expect(
    within(history)
      .getByRole("button", { name: /^mine,/ })
      .getAttribute("aria-current"),
  ).toBe("true");
  await turned(() => {
    fireEvent.click(within(history).getByRole("button", { name: /^theirs,/ }));
  });
  await settled();
  expect(onChoose).toHaveBeenCalledWith(threadOtherSession);
  expect(screen.queryByRole("dialog")).toBeNull();
});

/** A real anchor is what lets a reader open the page in a tab of its own. */
test("Open is a link to the thread's own page", async () => {
  await headerDrawn({ thread: own });
  const open = within(await chatPaneMenuOpened()).getByRole("menuitem", {
    name: "Open",
  });
  expect(open.tagName).toBe("A");
  expect(open.getAttribute("href")).toBe(
    `/${threadPartition.tenant}/${threadPartition.project}/threads/${threadMineSession}`,
  );
});

test("Copy link writes the whole address of the page Open goes to, and says it did", async () => {
  const write = vi.fn<CopyWrite>(() => Promise.resolve(true));
  await headerDrawn({ thread: own, write });
  const menu = await chatPaneMenuOpened();
  const href =
    within(menu).getByRole("menuitem", { name: "Open" }).getAttribute("href") ??
    "";
  await act(async () => {
    fireEvent.click(within(menu).getByRole("menuitem", { name: "Copy link" }));
    await Promise.resolve();
  });
  expect(write).toHaveBeenCalledWith(`${location.origin}${href}`);
  expect(screen.getByRole("menu")).toBe(menu);
  expect(within(menu).getByRole("menuitem", { name: "Copied" })).toBeDefined();
});

/** Rename opens the editor in the title's place, and the menu stands aside so
 * the focus it hands back on closing does not take the editor's. */
test("Rename puts the editor in the title's place, with the menu aside, and leaving it abandons the rename", async () => {
  const header = await headerDrawn({ thread: own });
  await chatPaneMenuChosen("Rename");
  const editor = screen.getByRole("textbox", { name: "Chat title" });
  expect(document.activeElement).toBe(editor);
  expect(within(header).queryByRole("heading")).toBeNull();
  expect(screen.queryByRole("button", { name: "Chat menu" })).toBeNull();
  fireEvent.blur(editor);
  expect(screen.queryByRole("textbox", { name: "Chat title" })).toBeNull();
  expect(screen.getByRole("button", { name: "Chat menu" })).toBeDefined();
});

/** Closing cannot be undone, so Close asks first and Cancel sends nothing. */
test("Close asks what closing does before it closes", async () => {
  const header = await headerDrawn({ thread: own });
  await chatPaneMenuChosen("Close");
  expect(
    within(header).getByRole("group", { name: "Close this chat?" }),
  ).toBeDefined();
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(screen.queryByRole("group", { name: "Close this chat?" })).toBeNull();
});

/** A glyph of the header is the touch height under a coarse pointer at any
 * width, and Back, with its word on its face, is at every pointer. */
test("under a coarse pointer every glyph of the header is the touch height, and Back is at any pointer", async () => {
  const header = await headerDrawn({ thread: own, narrow: true });
  const glyph = within(header).getByRole("button", { name: "New" });
  glyph.classList.add("btn-icon");
  const back = within(header).getByRole("button", { name: "Back" });
  const fine = sheetRules(shellSheet, []);
  const coarse = sheetRules(shellSheet, ["(pointer: coarse)"]);
  for (const property of ["width", "height"]) {
    expect(sheetDeclared(fine, glyph, property)).toBe("");
    expect(sheetDeclared(coarse, glyph, property)).toBe("var(--height-touch)");
  }
  expect(sheetDeclared(fine, back, "min-height")).toBe("var(--height-touch)");
});
