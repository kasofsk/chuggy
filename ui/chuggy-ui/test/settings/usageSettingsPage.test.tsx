/**
 * The Usage page, mounted: each agent of the reader's own account drawn with
 * each window's newest reading and how long ago it was read, a stale one marked
 * so, the pause holding it and the press that tries it once past a limit; and
 * its thresholds and options written whole, a threshold outside the wire's
 * bounds refused in its own box before anything is sent.
 */

// jscpd:ignore-start -- renderer tests must declare their own hoisted mock factories
import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { ReactNode } from "react";

import { nativeHttpBasePath } from "../../../../src/contract/http.ts";
import { UsageSettingsPage } from "../../app/browser/settings/UsageSettingsPage.tsx";
import { copyTextEn } from "../../app/copy/catalog.ts";
import { copyOrDataText } from "../../app/core/copy.ts";
import { instantText } from "../../app/core/figures.ts";
import {
  answer,
  drawnStrict,
  press,
  sectionOf,
  settled,
  turned,
} from "../screenHarness.tsx";
import type { SentRequest } from "../screenHarness.tsx";
import { leadPartition } from "../leadFixture.ts";
import { resizeObserverStubbed } from "../resizeObserver.ts";
import type * as BrowserPorts from "../../app/browser/ports.ts";

const readAtMs = Date.parse("2026-10-03T10:00:00Z");

vi.mock("../../app/browser/ports.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof BrowserPorts>()),
  sleepMs: () => Promise.resolve(),
  nowMs: () => readAtMs,
}));

vi.mock("@tanstack/react-router", () => ({
  createLink: (component: unknown) => component,
  Link: (props: { readonly children?: ReactNode }) => (
    <a href="/">{props.children}</a>
  ),
  useParams: () => ({ tenant: leadPartition.tenant }),
}));
// jscpd:ignore-end -- the case's own doubles resume here

const accountsPath = `${nativeHttpBasePath}/agent-accounts`;

const limitUntil = "2026-10-03T14:00:00Z";

const settings = {
  fiveHourPercent: 80,
  sevenDayPercent: 90,
  pausesThreads: true,
};

/** Claude read two minutes ago in its five-hour window and last week in its
 * weekly one, whose window has reset since, and stopped by its provider;
 * Codex never read and paused by nothing. `claude` is laid over Claude's. */
function accounts(pressed = false, claude: object = {}): unknown {
  return {
    accounts: [
      {
        agent: "Claude",
        settings,
        readings: [
          {
            window: "five_hour",
            utilization: 0.42,
            resetsAt: limitUntil,
            observedAt: "2026-10-03T09:58:00Z",
          },
          {
            window: "seven_day",
            utilization: 0.95,
            resetsAt: "2026-10-01T00:00:00Z",
            observedAt: "2026-09-26T00:00:00Z",
          },
        ],
        limit: { observedAt: "2026-10-03T09:00:00Z", resetsAt: limitUntil },
        pause: { until: limitUntil, reasons: ["limit"], pressed },
        ...claude,
      },
      { agent: "Codex", settings, readings: [] },
    ],
  };
}

interface Drawing {
  pressed: boolean;
  /** Where set, laid over Claude's account. */
  claude?: object;
  /** Where set, the status a press is answered with. */
  pressStatus?: number;
}

let drawing: Drawing = { pressed: false };

beforeEach(() => {
  drawing = { pressed: false };
  resizeObserverStubbed();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function drawUsage(): Promise<readonly SentRequest[]> {
  const drawn = await drawnStrict(<UsageSettingsPage />, (request) => {
    const path = request.url.split("?")[0] ?? "";
    if (path === accountsPath)
      return answer(accounts(drawing.pressed, drawing.claude));
    if (path.endsWith("/presses"))
      return drawing.pressStatus === undefined
        ? answer(undefined, 204)
        : answer(
            { error: { code: "NotHardPaused", message: "No limit" } },
            drawing.pressStatus,
          );
    if (path.endsWith("/settings")) return answer(undefined, 204);
    return answer({}, 404);
  });
  await settled();
  return drawn.sent;
}

function written(sent: readonly SentRequest[]): readonly unknown[] {
  return sent
    .filter((one) => one.method !== "GET")
    .map((one) => [
      `${one.method} ${one.url.slice(accountsPath.length)}`,
      one.body,
    ]);
}

function reads(sent: readonly SentRequest[]): number {
  return sent.filter((one) => one.url === accountsPath).length;
}

test("each window's reading is drawn as its share and how long ago it was read, a stale one marked so, and a window never read says so", async () => {
  await drawUsage();
  const claude = sectionOf("Claude").textContent ?? "";
  expect(claude).toContain("Five-hour window");
  expect(claude).toContain("42 %");
  expect(claude).toContain("2m ago");
  expect(claude).toContain("pauses at 80 %");
  expect(claude).toContain("95 %");
  expect(within(sectionOf("Claude")).getAllByText("Stale")).toHaveLength(1);
  expect(claude).toContain("Chats and questionsPause with it");
  expect(claude).not.toMatch(/lead/iu);
  const codex = sectionOf("Codex").textContent ?? "";
  expect(codex).toContain("No reading");
  expect(codex).not.toContain("Paused");
});

test("a paused agent says why and until when in the reader's own zone, and a provider's limit offers a press", async () => {
  await drawUsage();
  const claude = within(sectionOf("Claude"));
  const line = sectionOf("Claude").textContent ?? "";
  expect(line).toContain("Paused · Provider limit");
  expect(line).toContain(
    `until ${copyOrDataText(copyTextEn, instantText(new Date(limitUntil), new Date(readAtMs)))}`,
  );
  expect(
    claude.getByRole("button", { name: "Try Claude again now" }),
  ).toBeTruthy();
  expect(
    within(sectionOf("Codex")).queryByRole("button", {
      name: "Try Codex again now",
    }),
  ).toBeNull();
});

test("a press tries the agent once and reads the account again, after which it says so and offers no second press", async () => {
  const sent = await drawUsage();
  const before = reads(sent);
  drawing.pressed = true;
  await press("Try Claude again now");
  expect(written(sent)).toStrictEqual([["POST /Claude/presses", undefined]]);
  expect(reads(sent)).toBeGreaterThan(before);
  expect(sectionOf("Claude").textContent).toContain("Trying once");
  expect(
    screen.queryByRole("button", { name: "Try Claude again now" }),
  ).toBeNull();
});

test("a press refused because no limit holds the agent any longer says so", async () => {
  drawing.pressStatus = 409;
  await drawUsage();
  await press("Try Claude again now");
  expect(sectionOf("Claude").textContent).toContain("No limit holds it");
});

const workUntil = "2026-10-03T12:00:00Z";

/** `home` read two minutes ago in its five-hour window and stale in its weekly
 * one, `work` over its five-hour threshold and paused by it, and `old` read
 * only in a window that has reset since. */
const twoCredentials = {
  readings: [
    {
      window: "five_hour",
      utilization: 0.85,
      resetsAt: workUntil,
      observedAt: "2026-10-03T09:58:00Z",
    },
  ],
  pause: { until: workUntil, reasons: ["five_hour"], pressed: false },
  credentials: [
    {
      name: "home",
      readings: [
        {
          window: "five_hour",
          utilization: 0.42,
          resetsAt: limitUntil,
          observedAt: "2026-10-03T09:50:00Z",
        },
        {
          window: "seven_day",
          utilization: 0.95,
          resetsAt: "2026-10-01T00:00:00Z",
          observedAt: "2026-09-26T00:00:00Z",
        },
      ],
    },
    {
      name: "old",
      readings: [
        {
          window: "seven_day",
          utilization: 0.61,
          resetsAt: "2026-10-01T00:00:00Z",
          observedAt: "2026-09-20T00:00:00Z",
        },
      ],
    },
    {
      name: "work",
      readings: [
        {
          window: "five_hour",
          utilization: 0.85,
          resetsAt: workUntil,
          observedAt: "2026-10-03T09:58:00Z",
        },
      ],
      pause: { until: workUntil, reasons: ["five_hour"], pressed: false },
    },
  ],
};

/** Each line of a window's field, of the Claude section. */
function windowLines(window: string): readonly string[] {
  return within(sectionOf("Claude"))
    .getAllByText(window)
    .map((label) => label.parentElement?.textContent ?? "");
}

test("an agent holding one credential, or read without the field, reads as its own, naming none", async () => {
  drawing.claude = {
    credentials: [
      {
        name: "home",
        readings: [
          {
            window: "five_hour",
            utilization: 0.42,
            resetsAt: limitUntil,
            observedAt: "2026-10-03T09:58:00Z",
          },
        ],
        pause: { until: limitUntil, reasons: ["limit"], pressed: false },
      },
    ],
  };
  await drawUsage();
  const claude = sectionOf("Claude").textContent ?? "";
  expect(claude).not.toContain("home");
  expect(claude).toContain("Paused · Provider limit");
  expect(claude).toContain("95 %");
  expect(
    within(sectionOf("Claude")).getAllByRole("button", {
      name: "Try Claude again now",
    }),
  ).toHaveLength(1);
});

test("an agent holding several credentials reads each current one's reading in each window under its name, and a pause line only for the one a pause holds", async () => {
  drawing.claude = twoCredentials;
  await drawUsage();
  const claude = sectionOf("Claude").textContent ?? "";
  expect(claude).not.toContain("old");
  expect(claude).not.toContain("61 %");
  expect(windowLines("Five-hour window").join("")).toMatch(
    /home42 %· 10m ago.*work85 %· 2m ago.*pauses at 80 %/u,
  );
  expect(windowLines("Weekly window").join("")).toMatch(
    /home95 %· 7d ago.*Stale.*workNo reading.*pauses at 90 %/u,
  );
  expect(claude).toContain("work · Paused · Five-hour window");
  expect(claude).not.toContain("home · Paused");
  expect(claude.match(/Paused/gu)).toHaveLength(1);
  expect(
    within(sectionOf("Claude")).queryByRole("button", {
      name: "Try Claude again now",
    }),
  ).toBeNull();
});

test("an agent whose credentials are none of them current reads each window as never read", async () => {
  const old = twoCredentials.credentials[1];
  drawing.claude = {
    readings: twoCredentials.readings,
    pause: undefined,
    credentials: [old, { ...old, name: "older" }],
  };
  await drawUsage();
  const claude = sectionOf("Claude").textContent ?? "";
  expect(claude).not.toMatch(/old|Paused/u);
  expect(within(sectionOf("Claude")).getAllByText("No reading")).toHaveLength(
    2,
  );
});

test("credentials each stopped at a limit draw a line each, the one a press lets through saying so, and the agent's press once", async () => {
  const limited = (pressed: boolean) => ({
    until: limitUntil,
    reasons: ["limit"],
    pressed,
  });
  drawing.claude = {
    readings: [],
    credentials: [
      { name: "home", readings: [], pause: limited(false) },
      { name: "work", readings: [], pause: limited(false) },
    ],
  };
  await drawUsage();
  const claude = sectionOf("Claude").textContent ?? "";
  expect(claude).toContain("home · Paused · Provider limit");
  expect(claude).toContain("work · Paused · Provider limit");
  expect(
    within(sectionOf("Claude")).getAllByRole("button", {
      name: "Try Claude again now",
    }),
  ).toHaveLength(1);
  drawing.claude = {
    ...drawing.claude,
    credentials: [
      { name: "home", readings: [], pause: limited(true) },
      { name: "work", readings: [], pause: limited(false) },
    ],
  };
  drawing.pressed = true;
  await press("Try Claude again now");
  expect(sectionOf("Claude").textContent?.match(/Trying once/gu)).toHaveLength(
    1,
  );
  expect(sectionOf("Claude").textContent).toContain(
    "home · Paused · Provider limit",
  );
  expect(
    screen.queryByRole("button", { name: "Try Claude again now" }),
  ).toBeNull();
});

/** One section's Edit pressed, of the two the page draws. */
async function editing(agent: string): Promise<HTMLElement> {
  await turned(() => {
    fireEvent.click(
      within(sectionOf(agent)).getByRole("button", { name: "Edit" }),
    );
  });
  return sectionOf(agent);
}

function typed(section: HTMLElement, name: string, value: string): void {
  fireEvent.change(within(section).getByRole("textbox", { name }), {
    target: { value },
  });
}

test.each(["0", "101", "8.5", ""])(
  "a threshold typed as %j is refused in its box and cannot be saved",
  async (value) => {
    const sent = await drawUsage();
    const section = await editing("Codex");
    typed(section, "Weekly window", value);
    expect(sectionOf("Codex").textContent).toContain("Whole percent, 1 to 100");
    const save = within(section).getByRole<HTMLButtonElement>("button", {
      name: "Save changes",
    });
    expect(save.disabled).toBe(true);
    expect(written(sent)).toStrictEqual([]);
  },
);

test("an agent's thresholds and options are written whole, at either end of the bounds", async () => {
  const sent = await drawUsage();
  const section = await editing("Codex");
  typed(section, "Five-hour window", "1");
  typed(section, "Weekly window", "100");
  await turned(() => {
    fireEvent.click(
      within(section).getByRole("checkbox", {
        name: "Chats and questions pause with it",
      }),
    );
  });
  await press("Save changes");
  expect(written(sent)).toStrictEqual([
    [
      "PUT /Codex/settings",
      {
        fiveHourPercent: 1,
        sevenDayPercent: 100,
        pausesThreads: false,
      },
    ],
  ]);
  expect(
    within(sectionOf("Codex")).queryByRole("button", { name: "Save changes" }),
  ).toBeNull();
});

test("an agent's lead is offered no option, since it always pauses with the account", async () => {
  await drawUsage();
  const section = await editing("Codex");
  expect(within(section).getAllByRole("checkbox")).toHaveLength(1);
  expect(section.textContent).not.toMatch(/lead/iu);
});
