/**
 * The thread settings page: what the project's threads run under, the section
 * a reader opens one at a time, and what a write the revision moved under does.
 *
 * THE CONFLICT CASE IS THE ONE WITH TEETH. The settings are written whole, so a
 * write carrying no `expectedRevision` — or one that retried past a refusal —
 * would silently drop somebody else's North Star; the route answers `409` with
 * the settings that moved, and the section names that revision and stops.
 *
 * EVERY WRITE HERE IS THE WHOLE OVERRIDE SET, so a case that presses one button
 * asserts the whole body.
 */

// jscpd:ignore-start -- renderer tests must declare their own hoisted mock factories
import { QueryClient } from "@tanstack/react-query";
import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import { renderCopied } from "../copied.tsx";
import { afterEach, expect, test, vi } from "vitest";
import type { ReactNode } from "react";

import { ThreadSettingsPage } from "../../app/browser/settings/ThreadSettingsPage.tsx";
import {
  answer,
  openedStream,
  ScreenHarness,
  settled,
  turned,
} from "../screenHarness.tsx";
import { projectPartition } from "../projectFixture.ts";
import { styleless } from "../styleless.ts";
import type * as BrowserPorts from "../../app/browser/ports.ts";

vi.mock("../../app/browser/ports.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof BrowserPorts>()),
  sleepMs: () => Promise.resolve(),
}));

vi.mock("@tanstack/react-router", () => ({
  createLink: (component: unknown) => component,
  Link: (props: { readonly children?: ReactNode }) => (
    <a href="/">{props.children}</a>
  ),
  useParams: () => ({ ...projectPartition }),
}));
// jscpd:ignore-end -- the case's own doubles resume here

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const effective = {
  northStar: "ship the console",
  threadStandingRules: "- You act through your owner's own commands.",
};

function settingsBody(
  revision: number,
  overrides: unknown,
  resolved: Readonly<Record<string, unknown>> = {},
): unknown {
  return {
    partition: projectPartition,
    revision,
    overrides,
    effective: { ...effective, ...resolved },
  };
}

function revisionBody(revision: number, overrides: unknown): unknown {
  return {
    revision,
    overrides,
    administrator: { kind: "member", subject: "geoff@vteng.io" },
    recordedAt: "2026-09-05T17:13:00.000Z",
  };
}

interface SettingsServer {
  /** Every address the page asked, in order. */
  readonly asked: () => readonly string[];
  readonly written: () => unknown;
  readonly writes: () => readonly unknown[];
  readonly reads: () => number;
  /** Every read on the page asked again, as a refresh in the background asks. */
  readonly reread: () => Promise<void>;
}

interface SettingsInit {
  readonly method?: string;
  readonly body?: string;
}

interface SettingsScript {
  readonly answering?: () => {
    readonly body: unknown;
    readonly status: number;
  };
  readonly read?: unknown;
  readonly history?: unknown;
  /** Whether the settings read fails, asked at each read. */
  readonly failing?: () => boolean;
}

/** The page over a server whose answer to the write and whose read the case
 * decides, and whose history the case may fill. */
async function drawSettings(
  script: SettingsScript = {},
): Promise<SettingsServer> {
  const asked: string[] = [];
  const writes: unknown[] = [];
  let reads = 0;
  const read =
    script.read ?? settingsBody(12, { northStar: "ship the console" });
  const answering = script.answering ?? (() => ({ body: {}, status: 200 }));
  const fetching = ((url: string, init?: SettingsInit) => {
    asked.push(url);
    if (init?.method === "PUT") {
      writes.push(JSON.parse(init.body ?? "null"));
      const found = answering();
      return Promise.resolve(answer(found.body, found.status));
    }
    if (url.includes("/history"))
      return Promise.resolve(answer(script.history ?? { revisions: [] }));
    reads += 1;
    if (script.failing?.() === true)
      return Promise.resolve(answer({ error: { code: "InternalError" } }, 500));
    return Promise.resolve(answer(read));
  }) as unknown as typeof fetch;
  vi.stubGlobal("fetch", fetching);
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  renderCopied(
    <ScreenHarness
      partition={projectPartition}
      client={client}
      transport={openedStream().ports.fetch}
    >
      <ThreadSettingsPage />
    </ScreenHarness>,
  );
  await settled();
  return {
    asked: () => asked,
    written: () => writes[writes.length - 1],
    writes: () => writes,
    reads: () => reads,
    reread: async () => {
      await turned(() => void client.invalidateQueries());
      await settled();
    },
  };
}

function sectionOf(title: string): HTMLElement {
  return screen.getByRole("region", { name: new RegExp(`^${title}`) });
}

function press(name: string): void {
  fireEvent.click(screen.getByRole("button", { name }));
}

function edit(title: string): void {
  fireEvent.click(
    within(sectionOf(title)).getByRole("button", { name: "Edit" }),
  );
}

function save(): void {
  press("Save changes");
}

/** A box is reached by its role: the section around it answers to the same
 * name, because the card is labelled by the heading the box is named after. */
function box(name: string): HTMLInputElement | HTMLTextAreaElement {
  return screen.getByRole<HTMLInputElement>("textbox", { name });
}

test("the top bar names the revision the settings were read at", async () => {
  await drawSettings();
  const revision = screen.getByRole("heading", {
    name: "Chats",
  }).nextElementSibling;
  expect(revision?.textContent).toBe("Revision 12");
});

/** The page is what threads run under, and nothing of the lead is read. */
test("the page draws the North Star, the standing rules, the models and the revisions, and reads nothing of the lead", async () => {
  const server = await drawSettings();
  const titles = ["North Star", "Standing rules", "Models", "Revisions"];
  expect(screen.getAllByRole("region")).toStrictEqual(titles.map(sectionOf));
  expect(screen.queryByText("Base prompt")).toBeNull();
  expect(screen.queryByText("Limits")).toBeNull();
  expect(screen.queryByText("Lead model")).toBeNull();
  expect(screen.queryByText("No lead")).toBeNull();
  expect(
    server
      .asked()
      .filter(
        (url) => url.endsWith("/lead") || url.endsWith("/session-placement"),
      ),
  ).toStrictEqual([]);
});

/** A section is read until its Edit is pressed: the text stands whole and there
 * is no box, which is what makes the page a settings page and not a form. */
test("a section is read until its Edit is pressed", async () => {
  await drawSettings();
  expect(screen.queryByRole("textbox", { name: "North Star" })).toBeNull();
  expect(within(sectionOf("North Star")).getByText("ship the console"));
  await turned(() => {
    edit("North Star");
  });
  expect(box("North Star").value).toBe("ship the console");
  styleless();
});

/** One section edits at a time, so the rest stay readable and there is never a
 * second Save on the page for a reader to press by mistake. */
test("opening one section closes Edit on every other", async () => {
  await drawSettings();
  await turned(() => {
    edit("North Star");
  });
  expect(screen.getAllByRole("button", { name: "Save changes" })).toHaveLength(
    1,
  );
  for (const other of screen.getAllByRole("button", { name: "Edit" }))
    expect(other.hasAttribute("disabled")).toBe(true);
});

/** The pill is the only thing on the page that says a setting is nobody's
 * choice, and it sits on the section whose whole value is inherited. */
test("a section on the default carries the Default pill", async () => {
  await drawSettings();
  expect(within(sectionOf("North Star")).queryByText("Default")).toBeNull();
  expect(
    within(sectionOf("Standing rules")).getByText("Default"),
  ).toBeDefined();
});

/** Reset empties the box rather than writing, so the reader still sees what
 * they are about to give up and still has Cancel. */
test("Reset to default clears the box and marks the section as inherited", async () => {
  await drawSettings();
  await turned(() => {
    edit("North Star");
  });
  await turned(() => {
    press("Reset to default");
  });
  expect(box("North Star").value).toBe("");
  expect(within(sectionOf("North Star")).getByText("Default")).toBeDefined();
  await turned(save);
  await settled();
});

/** Cancel is not a save that writes the old value back: it takes the box back
 * to what the read gave and leaves the wire alone. */
test("Cancel takes the box back to the read and writes nothing", async () => {
  const server = await drawSettings();
  await turned(() => {
    edit("North Star");
  });
  await turned(() => {
    fireEvent.change(box("North Star"), {
      target: { value: "ship the settings page" },
    });
  });
  await turned(() => {
    press("Cancel");
  });
  expect(server.writes()).toHaveLength(0);
  await turned(() => {
    edit("North Star");
  });
  expect(box("North Star").value).toBe("ship the console");
});

/** Edits North Star to "ship the settings page" and saves the section — the
 * change every save-revision scenario below makes before it asserts on the
 * write. */
async function selectorSettingsPageNorthStarSaved(): Promise<void> {
  await turned(() => {
    edit("North Star");
  });
  await turned(() => {
    fireEvent.change(box("North Star"), {
      target: { value: "ship the settings page" },
    });
  });
  await turned(save);
  await settled();
}

test("saving a section writes every override whole, under the read revision", async () => {
  const server = await drawSettings({
    answering: () => ({
      body: settingsBody(13, { northStar: "ship the settings page" }),
      status: 200,
    }),
  });
  await selectorSettingsPageNorthStarSaved();
  expect(server.written()).toStrictEqual({
    expectedRevision: 12,
    overrides: { northStar: "ship the settings page" },
  });
  expect(within(sectionOf("North Star")).getByText("Written · 13"));
  expect(screen.queryByRole("button", { name: "Save changes" })).toBeNull();
});

test("the Models section reads Default for a row the project never set, and the value for one it did", async () => {
  await drawSettings({
    read: settingsBody(12, { threadEffort: "high" }),
  });
  const models = sectionOf("Models");
  for (const [row, value] of [
    ["Chat model", "Default"],
    ["Chat effort", "High"],
  ] as const) {
    const line = within(models).getByText(row).closest(".selector-limit");
    expect(line?.textContent, row).toContain(value);
  }
});

test("a thread model and effort chosen in the Models section are written beside the North Star", async () => {
  const server = await drawSettings({
    answering: () => ({
      body: settingsBody(13, {
        northStar: "ship the console",
        threadModel: "claude-sonnet-5-5",
        threadEffort: "medium",
      }),
      status: 200,
    }),
  });
  await turned(() => {
    edit("Models");
  });
  await turned(() => {
    fireEvent.change(box("Chat model"), {
      target: { value: "claude-sonnet-5-5" },
    });
  });
  await turned(() => {
    fireEvent.keyDown(screen.getByRole("button", { name: /^Chat effort/u }), {
      key: "ArrowDown",
    });
  });
  const menu = await screen.findByRole("menu");
  expect(
    within(menu)
      .getAllByRole("menuitemradio")
      .map((item) => item.textContent),
  ).toStrictEqual(["Default", "Low", "Medium", "High", "Extra high", "Max"]);
  await turned(() => {
    within(menu).getByRole("menuitemradio", { name: "Medium" }).click();
  });
  await turned(save);
  await settled();
  expect(server.written()).toStrictEqual({
    expectedRevision: 12,
    overrides: {
      northStar: "ship the console",
      threadModel: "claude-sonnet-5-5",
      threadEffort: "medium",
    },
  });
});

test("a model row offers the aliases and fills the box with the one chosen", async () => {
  await drawSettings();
  await turned(() => {
    edit("Models");
  });
  const aliases = within(
    box("Chat model").closest(".selector-limit") as HTMLElement,
  ).getByRole("button", { name: /^Alias/u });
  await turned(() => {
    fireEvent.keyDown(aliases, { key: "ArrowDown" });
  });
  const menu = await screen.findByRole("menu");
  expect(
    within(menu)
      .getAllByRole("menuitemradio")
      .map((item) => item.textContent),
  ).toStrictEqual(["opus", "sonnet", "haiku"]);
  await turned(() => {
    within(menu).getByRole("menuitemradio", { name: "haiku" }).click();
  });
  expect(box("Chat model").value).toBe("haiku");
});

test("a model the door refuses marks its own box with why and blocks the save", async () => {
  await drawSettings();
  await turned(() => {
    edit("Models");
  });
  const model = () => box("Chat model");
  const fault = () =>
    document.getElementById(model().getAttribute("aria-describedby") ?? "")
      ?.textContent;
  for (const [typed, said] of [
    ["claude sonnet", "No spaces or control characters"],
    ["-p", "Cannot start with -"],
    ["m".repeat(129), "At most 128 characters"],
  ] as const) {
    await turned(() => {
      fireEvent.change(model(), { target: { value: typed } });
    });
    expect(model().getAttribute("aria-invalid"), typed).toBe("true");
    expect(fault(), typed).toBe(said);
    expect(
      screen
        .getByRole("button", { name: "Save changes" })
        .hasAttribute("disabled"),
      typed,
    ).toBe(true);
  }
  await turned(() => {
    fireEvent.change(model(), { target: { value: "claude-opus-5-5" } });
  });
  expect(model().getAttribute("aria-invalid")).toBe("false");
});

test("a revision that moved under the write is named and not retried", async () => {
  const server = await drawSettings({
    answering: () => ({
      body: {
        error: {
          code: "SettingsRevisionConflict",
          message: "the selector settings moved under this write",
        },
        settings: settingsBody(14, { northStar: "somebody else's star" }),
      },
      status: 409,
    }),
  });
  await turned(() => {
    edit("North Star");
  });
  await turned(save);
  await settled();
  expect(within(sectionOf("North Star")).getByText("Conflict · 14"));
  expect(
    (server.written() as { readonly expectedRevision: number })
      .expectedRevision,
  ).toBe(12);
});

/** The 409 names who moved the revision, so the section says so instead of
 * the bare revision number a reader cannot act on. */
test("a conflict that names its mover reads who and when, not the bare revision", async () => {
  await drawSettings({
    answering: () => ({
      body: {
        error: { code: "SettingsRevisionConflict", message: "moved" },
        settings: settingsBody(14, { northStar: "somebody else's star" }),
        movedBy: {
          administrator: { kind: "member", subject: "dave@vteng.io" },
          recordedAt: "2026-09-05T17:20:00.000Z",
        },
      },
      status: 409,
    }),
  });
  await turned(() => {
    edit("North Star");
  });
  await turned(save);
  await settled();
  const section = sectionOf("North Star");
  expect(within(section).getByText(/Changed by/)).toBeDefined();
  expect(within(section).getByText("dave@vteng.io")).toBeDefined();
  expect(within(section).queryByText("Conflict · 14")).toBeNull();
  expect(within(section).getByRole("button", { name: "Reload" })).toBeDefined();
});

/**
 * A write that landed is the newest read, and nothing else will tell the page
 * so: the route raises no frame and nothing refetches. A second save that
 * resent the revision the first one moved would be told by this same tab that
 * somebody else wrote — a dead end reachable by saving twice.
 */
test("a second save is made against the revision the first one produced", async () => {
  let revision = 12;
  const server = await drawSettings({
    answering: () => {
      revision += 1;
      return { body: settingsBody(revision, {}), status: 200 };
    },
  });
  await turned(() => {
    edit("North Star");
  });
  await turned(save);
  await settled();
  await turned(() => {
    edit("North Star");
  });
  await turned(save);
  await settled();
  expect(
    server
      .writes()
      .map((body) => (body as { expectedRevision: number }).expectedRevision),
  ).toStrictEqual([12, 13]);
});

/**
 * THE CASE `expectedRevision` EXISTS FOR. This reader edits one model while
 * another administrator changes the North Star under them, so carrying every
 * drawn box forward would put this reader's stale North Star back on the wire
 * under a revision that by then matches — and the route would accept it, the
 * other write gone with nobody having typed a word of it.
 */
test("a conflict does not carry a box this reader never touched", async () => {
  let conflicting = true;
  const server = await drawSettings({
    answering: () => {
      if (conflicting) {
        conflicting = false;
        return {
          body: {
            error: { code: "SettingsRevisionConflict", message: "moved" },
            settings: settingsBody(14, { northStar: "somebody else's star" }),
          },
          status: 409,
        };
      }
      return { body: settingsBody(15, {}), status: 200 };
    },
    read: settingsBody(12, { northStar: "the original star" }),
  });
  await turned(() => {
    edit("Models");
  });
  await turned(() => {
    fireEvent.change(box("Chat model"), {
      target: { value: "haiku" },
    });
  });
  await turned(save);
  await settled();
  expect(within(sectionOf("Models")).getByText("Conflict · 14"));
  expect(box("Chat model").value).toBe("haiku");
  await turned(save);
  await settled();
  expect(server.written()).toStrictEqual({
    expectedRevision: 14,
    overrides: {
      northStar: "somebody else's star",
      threadModel: "haiku",
    },
  });
});

/**
 * THE REBASE IS PER ROW AND NOT PER SECTION: a model typed in *and* the effort
 * beside it moved under it. A rebase taking the reader's whole section wherever
 * one row in it was touched reads as harmless and is the lost update the
 * per-row rule exists to refuse.
 */
test("a conflict rebases an effort beside the model this reader typed", async () => {
  let conflicting = true;
  const server = await drawSettings({
    answering: () => {
      if (conflicting) {
        conflicting = false;
        return {
          body: {
            error: { code: "SettingsRevisionConflict", message: "moved" },
            settings: settingsBody(14, {
              threadModel: "opus",
              threadEffort: "high",
            }),
          },
          status: 409,
        };
      }
      return { body: settingsBody(15, {}), status: 200 };
    },
    read: settingsBody(12, { threadModel: "opus", threadEffort: "low" }),
  });
  await turned(() => {
    edit("Models");
  });
  await turned(() => {
    fireEvent.change(box("Chat model"), {
      target: { value: "haiku" },
    });
  });
  await turned(save);
  await settled();
  expect(box("Chat model").value).toBe("haiku");
  await turned(save);
  await settled();
  expect(server.written()).toStrictEqual({
    expectedRevision: 14,
    overrides: { threadModel: "haiku", threadEffort: "high" },
  });
});

/** A conflict rebased the draft but the page still holds the read it was seeded
 * from, so the one action it offers is asking the server again. */
test("Reload after a conflict reads the settings again", async () => {
  const server = await drawSettings({
    answering: () => ({
      body: {
        error: { code: "SettingsRevisionConflict", message: "moved" },
        settings: settingsBody(14, { northStar: "somebody else's star" }),
      },
      status: 409,
    }),
  });
  await turned(() => {
    edit("North Star");
  });
  await turned(() => {
    fireEvent.change(box("North Star"), {
      target: { value: "ship the settings page" },
    });
  });
  await turned(save);
  await settled();
  const before = server.reads();
  await turned(() => {
    press("Reload");
  });
  await settled();
  expect(server.reads()).toBeGreaterThan(before);
  expect(box("North Star").value).toBe("ship the settings page");
});

/**
 * A read can move under an open section at any moment, including between a Save
 * click and its answer. A reseed there takes back text the reader typed while
 * they were waiting, which is the one window in which they cannot see it go.
 */
test("text typed while a save is in flight survives the answer", async () => {
  await drawSettings({
    answering: () => ({
      body: settingsBody(13, { northStar: "ship the console" }),
      status: 200,
    }),
  });
  await turned(() => {
    edit("North Star");
  });
  await turned(() => {
    save();
    fireEvent.change(box("North Star"), {
      target: { value: "typed while the save was in flight" },
    });
  });
  await settled();
  await turned(() => {
    edit("North Star");
  });
  expect(
    box("North Star").value,
    "the answer to a save took back what was typed while it was in flight",
  ).toBe("typed while the save was in flight");
});

/** A read in the background that fails leaves an open section as the reader
 * left it, rather than taking the page and what they typed away. */
test("an open edit survives a read of the settings that fails behind it", async () => {
  const failing = { on: false };
  const server = await drawSettings({ failing: () => failing.on });
  await turned(() => {
    edit("North Star");
  });
  await turned(() => {
    fireEvent.change(box("North Star"), {
      target: { value: "typed before the read failed" },
    });
  });
  failing.on = true;
  const before = server.reads();
  await server.reread();
  expect(server.reads()).toBeGreaterThan(before);
  expect(box("North Star").value).toBe("typed before the read failed");
});

const history = {
  revisions: [
    revisionBody(15, {
      northStar: "ship the console",
      threadModel: "claude-opus-5-5",
    }),
    revisionBody(14, {
      northStar: "ship the console",
      threadModel: "sonnet",
    }),
    revisionBody(13, { northStar: "ship the console" }),
  ],
};

/** What each revision moved is derived from the override sets the history read
 * already carries, so the page says it without a server change. */
test("a revision row names the fields it moved and expands to the diff", async () => {
  await drawSettings({ history });
  const revisions = sectionOf("Revisions");
  expect(within(revisions).getAllByText("Chat model").length).toBeGreaterThan(
    0,
  );
  await turned(() => {
    fireEvent.click(
      within(revisions).getAllByRole("button", {
        name: "Diff",
      })[0] as HTMLElement,
    );
  });
  expect(within(sectionOf("Revisions")).getByText("sonnet")).toBeDefined();
  expect(
    within(sectionOf("Revisions")).getByText("claude-opus-5-5"),
  ).toBeDefined();
  styleless();
});

/** Restore is a write of that revision's overrides under the revision the page
 * holds, which is the whole override set like every other write here. */
test("Restore writes that revision's overrides under the current revision", async () => {
  const server = await drawSettings({
    answering: () => ({ body: settingsBody(16, {}), status: 200 }),
    history,
  });
  const restores = within(sectionOf("Revisions")).getAllByRole("button", {
    name: "Restore",
  });
  await turned(() => {
    fireEvent.click(restores[0] as HTMLElement);
  });
  await settled();
  expect(server.written()).toStrictEqual({
    expectedRevision: 12,
    overrides: {
      northStar: "ship the console",
      threadModel: "sonnet",
    },
  });
});

/** Restore is the Revisions card's own write, so a refusal is said on the
 * card that asked for it rather than nowhere at all. */
test("a Restore that fails says so on the Revisions card", async () => {
  const server = await drawSettings({
    answering: () => ({ body: {}, status: 500 }),
    history,
  });
  const restores = within(sectionOf("Revisions")).getAllByRole("button", {
    name: "Restore",
  });
  await turned(() => {
    fireEvent.click(restores[0] as HTMLElement);
  });
  await settled();
  expect(
    within(sectionOf("Revisions")).getByText("Server error"),
  ).toBeDefined();
  expect(server.writes()).toHaveLength(1);
});

/** The newest revision is what stands, so restoring it is an offer to write
 * what is already written. */
test("the newest revision is the one row with no Restore", async () => {
  await drawSettings({ history });
  expect(
    within(sectionOf("Revisions")).getAllByRole("button", { name: "Restore" }),
  ).toHaveLength(2);
});

/** The read is newest first, so the top row is the one standing and the bottom
 * row is the one whose predecessor the page did not read. */
test("the top row stands, the bottom row has no predecessor, and a diff reads older then newer", async () => {
  await drawSettings({ history });
  const rows = [
    ...sectionOf("Revisions").querySelectorAll<HTMLElement>(
      ".selector-revision",
    ),
  ];
  expect(rows.map((row) => row.querySelector(".num")?.textContent)).toEqual([
    "15",
    "14",
    "13",
  ]);
  expect(
    rows.map(
      (row) => within(row).queryAllByRole("button", { name: "Restore" }).length,
    ),
  ).toEqual([0, 1, 1]);
  expect(rows.map((row) => row.querySelector(".fig-dim") !== null)).toEqual([
    false,
    false,
    true,
  ]);
  await turned(() => {
    fireEvent.click(
      within(rows[0] as HTMLElement).getByRole("button", { name: "Diff" }),
    );
  });
  const revisions = sectionOf("Revisions");
  expect(revisions.querySelector(".selector-before")?.textContent).toBe(
    "sonnet",
  );
  expect(revisions.querySelector(".selector-after")?.textContent).toBe(
    "claude-opus-5-5",
  );
});

test("only the latest revisions stand until Show all is pressed", async () => {
  const many = {
    revisions: Array.from({ length: 7 }, (_unused, at) =>
      revisionBody(20 - at, { threadModel: `model-${String(at)}` }),
    ),
  };
  await drawSettings({ history: many });
  const rows = () =>
    sectionOf("Revisions").querySelectorAll(".selector-revision");
  expect(rows()).toHaveLength(5);
  await turned(() => {
    press("Show all 7");
  });
  expect(rows()).toHaveLength(7);
});

/** A setting a reader cannot see the end of is a setting they cannot check, so
 * a long passage stands whole at rest with nothing hiding any of it. */
test("a long passage is drawn whole, with no clip and no Show all", async () => {
  const long = "a".repeat(2000);
  await drawSettings({
    read: settingsBody(12, {}, { threadStandingRules: long }),
  });
  const prompt = sectionOf("Standing rules");
  expect(prompt.querySelector(".selector-clip")).toBeNull();
  expect(within(prompt).getByText(long));
  expect(within(prompt).queryByRole("button", { name: /Show all/ })).toBeNull();
  styleless();
});

/** The served policy refuses `style-src` but `'self'`, so nothing this page
 * draws — an edit, a save and a revision expanded included — may append a
 * runtime style element. */
test("nothing this page draws is a runtime style element", async () => {
  const server = await drawSettings({
    answering: () => ({ body: settingsBody(13, {}), status: 200 }),
    history,
  });
  styleless();
  await turned(() => {
    edit("Models");
  });
  styleless();
  await turned(() => {
    fireEvent.change(box("Chat model"), {
      target: { value: "haiku" },
    });
  });
  save();
  await settled();
  expect(server.writes()).toHaveLength(1);
  styleless();
});
