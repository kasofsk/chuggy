/**
 * The Configuration panel over a real, non-empty canonical document, and the
 * one structural rule the Brief and Provenance rows must keep: the accordion
 * row is the only heading either draws, never a second one repeating it.
 *
 * The canonical body is read from `chuggy-development-sonnet.json` itself, not
 * a copied fixture, so the settings grid, the Instructions and the Evaluation
 * list are asserted against what the repository actually declares; the Review
 * tab, which a declared document with stages never draws, is asserted over the
 * same document with its stages taken out.
 */

import { QueryClient } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { ReactNode } from "react";

import type { ConfigurationOverrides } from "../../../src/contract/configurationOverrides.ts";
import type { PartitionIdentity } from "../../../src/contract/http.ts";
import { TicketPage } from "../app/browser/TicketPage.tsx";
import { viewportDeskEm } from "../app/browser/shell/viewport.ts";
import {
  answer,
  apiDouble,
  openedStream,
  ScreenHarness,
  settled,
  ticketPageAmbientRoute,
  turned,
} from "./screenHarness.tsx";
import { ticketInstants } from "./ticketInstants.ts";
import { resizeObserverStubbed } from "./resizeObserver.ts";
import { viewportAtEm } from "./viewport.ts";
import type * as BrowserPorts from "../app/browser/ports.ts";

const atlas: PartitionIdentity = { tenant: "acme", project: "atlas" };

/** Read at build time by Vite rather than by Node's own `fs`, since `.chug/`
 * is a dot directory a glob skips unless told to search it. */
const declarations = import.meta.glob<string>(
  "../../../.chug/configurations/*.json",
  { query: "?raw", import: "default", eager: true, exhaustive: true },
);
const sonnetRaw =
  declarations["../../../.chug/configurations/chuggy-development-sonnet.json"];
if (sonnetRaw === undefined)
  throw new Error("no chuggy-development-sonnet configuration declared");
const declared: unknown = JSON.parse(sonnetRaw);
const canonical = JSON.stringify(
  (declared as { readonly configuration: unknown }).configuration,
);

// jscpd:ignore-start -- renderer tests must declare their own hoisted mock factories
vi.mock("../app/browser/ports.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof BrowserPorts>()),
  sleepMs: () => Promise.resolve(),
}));

vi.mock("@tanstack/react-router", () => ({
  useParams: () => ({ ...atlas, ticket: "9" }),
  createLink: (component: unknown) => component,
  Link: (props: { readonly children?: ReactNode }) => (
    <a href="/">{props.children}</a>
  ),
}));
// jscpd:ignore-end -- the case's own doubles resume here

beforeEach(() => {
  resizeObserverStubbed();
  viewportAtEm(viewportDeskEm);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const revision = "r-sonnet-1";
const version = { name: "chuggy-development-sonnet", number: 1 };
const digest = "d".repeat(64);

async function drawTicket(
  served: string = canonical,
  overrides?: ConfigurationOverrides,
): Promise<void> {
  const api = apiDouble({
    operation: { operation: "op-one", state: "Pending" },
    route: (url) => {
      const ambient = ticketPageAmbientRoute(url);
      if (ambient !== undefined) return ambient;
      if (url.includes("/executions")) return answer({ executions: [] });
      if (url.includes("/configurations/"))
        return answer({
          partition: atlas,
          revision,
          canonical: served,
          digest,
          version,
        });
      if (url.includes("/drafts/"))
        return answer({
          partition: atlas,
          ticket: 9,
          authoringVersion: 1,
          state: "Released",
          releasedAuthoringVersion: 1,
          configurationRevision: revision,
          authoring: { dependencies: [], program: [] },
        });
      return answer({
        ticket: 9,
        phase: "Work",
        sequence: 3,
        ...ticketInstants,
        configurationRevision: revision,
        configurationVersion: version,
        ...(overrides === undefined ? {} : { overrides }),
      });
    },
  });
  vi.stubGlobal("fetch", api.fetch);
  render(
    <ScreenHarness
      partition={atlas}
      client={new QueryClient()}
      transport={openedStream().ports.fetch}
    >
      <TicketPage />
    </ScreenHarness>,
  );
  await settled();
}

async function sectionOpened(name: string): Promise<void> {
  await turned(() => {
    screen.getByRole("button", { name: new RegExp(`^${name}`, "u") }).click();
  });
  await settled();
}

test("the Brief and Provenance rows draw no second heading of their own", async () => {
  await drawTicket();
  await sectionOpened("Brief");
  await sectionOpened("Provenance");
  expect(screen.getAllByRole("heading", { name: /Brief/iu })).toHaveLength(1);
  expect(
    screen.queryAllByRole("heading", { name: /^Provenance$/iu }),
  ).toHaveLength(0);
  expect(
    screen.getByRole("heading", {
      name: /Configuration chuggy-development-sonnet/u,
    }),
  ).toBeDefined();
});

test("the settings grid reads the model off its own flag and the tools off the allow-list", async () => {
  await drawTicket();
  await sectionOpened("Provenance");
  expect(screen.getByText("Sonnet")).toBeDefined();
  expect(screen.getByText("--model=sonnet")).toBeDefined();
  expect(screen.getByText("Claude Code")).toBeDefined();
  expect(screen.getByText("Single agent")).toBeDefined();
  expect(
    screen.getByText("Bash · Edit · Read · Write · Glob · Grep"),
  ).toBeDefined();
  expect(screen.getByText("chuggy-github-worker · claude-code")).toBeDefined();
  expect(screen.getByText("Network · Workspace writable")).toBeDefined();
  expect(screen.getByText("npm ci")).toBeDefined();
  expect(
    screen.getByText("Completes task").nextElementSibling?.textContent,
  ).toBe("No");
});

const workText =
  "Implement the requested change and add focused regression coverage.";
const reviewText =
  "Read .chug/tasks/review-change.md and review the change exactly as that brief requires.";

/** The Instructions block alone, since the Evaluation section below it can
 * carry the very same sentence as a stage's own instructions. */
function instructions(): HTMLElement {
  const region = document.querySelector(".ticket-config-instructions");
  if (!(region instanceof HTMLElement))
    throw new Error("no instructions block");
  return region;
}

test("the Instructions draw the shared brief and the work's own words, and no Review where stages brief the review", async () => {
  await drawTicket();
  await sectionOpened("Provenance");
  expect(
    within(instructions()).getByText(
      /Develop Chuggy itself in the same repository-native/u,
    ),
  ).toBeDefined();
  expect(within(instructions()).getByText(workText)).toBeDefined();
  expect(within(instructions()).getByText("Regression coverage")).toBeDefined();
  expect(within(instructions()).queryByRole("tab")).toBeNull();
  expect(within(instructions()).queryByRole("tabpanel")).toBeNull();
  expect(within(instructions()).queryByText(reviewText)).toBeNull();
});

test("a configuration with no stages draws a Review tab, Work first", async () => {
  const unstaged = Object.fromEntries(
    Object.entries(JSON.parse(canonical) as Record<string, unknown>).filter(
      ([key]) => key !== "evaluations",
    ),
  );
  await drawTicket(JSON.stringify(unstaged));
  await sectionOpened("Provenance");
  expect(within(instructions()).queryByText(reviewText)).toBeNull();
  await turned(() => {
    /** Radix selects a tab on `mousedown`, not `click`, and jsdom's own
     * `.click()` never raises the former. */
    fireEvent.mouseDown(
      within(instructions()).getByRole("tab", { name: "Review" }),
    );
  });
  expect(within(instructions()).getByText(reviewText)).toBeDefined();
  expect(within(instructions()).getByText("Regression coverage")).toBeDefined();
  expect(within(instructions()).queryByText(workText)).toBeNull();
});

test("the evaluation list draws one row per stage, its checks or its instructions and practices", async () => {
  await drawTicket();
  await sectionOpened("Provenance");
  expect(screen.getByText("Stage 1 · Check")).toBeDefined();
  expect(screen.getByText(".chug/tasks/ci.sh")).toBeDefined();
  const stage2 = screen
    .getByText("Stage 2 · Review")
    .closest(".ticket-config-evaluation-row");
  if (!(stage2 instanceof HTMLElement)) throw new Error("no stage 2 row");
  expect(within(stage2).getByText("Changed call paths")).toBeDefined();
  expect(within(stage2).getByText("Acceptance criteria")).toBeDefined();
});

test("the panel keeps the digest and the full revision on a caption line", async () => {
  await drawTicket();
  await sectionOpened("Provenance");
  expect(screen.getByText("revision").nextElementSibling?.textContent).toBe(
    revision,
  );
  expect(screen.getByText("Digest").nextElementSibling?.textContent).toBe(
    `${digest.slice(0, 12)}…${digest.slice(-6)}`,
  );
});

const caption = "As configured · a run's exact prompt is in its conversation";

test("a ticket with no overrides is drawn as its pinned configuration, marking nothing", async () => {
  await drawTicket();
  await sectionOpened("Provenance");
  expect(within(instructions()).getByText(caption)).toBeDefined();
  expect(screen.queryByText("Overridden")).toBeNull();
  expect(screen.queryByText("Also overridden")).toBeNull();
  expect(screen.queryByText("Pinned ·")).toBeNull();
  expect(screen.getByRole("button", { name: "Canonical JSON" })).toBeDefined();
});

/** The cell a field is drawn in, by the name over it. */
function cell(name: string): HTMLElement {
  const found = screen
    .getAllByText(name)
    .map((one) => one.closest(".ticket-config-cell"))
    .find((one) => one instanceof HTMLElement);
  if (!(found instanceof HTMLElement)) throw new Error(`no ${name} cell`);
  return found;
}

test("a model the ticket overrode is drawn in the model's place, marked overridden", async () => {
  const sonnetMode = (
    JSON.parse(canonical) as {
      readonly worker: { readonly mode: { readonly arguments: string[] } };
    }
  ).worker.mode;
  await drawTicket(canonical, {
    worker: {
      mode: {
        type: "SingleAgent",
        agent: "Claude",
        arguments: sonnetMode.arguments.map((argument) =>
          argument === "--model=sonnet" ? "--model=opus" : argument,
        ),
      },
    },
  });
  await sectionOpened("Provenance");
  expect(within(cell("Model")).getByText("Opus")).toBeDefined();
  expect(within(cell("Model")).getByText("--model=opus")).toBeDefined();
  expect(within(cell("Model")).getByText("Overridden")).toBeDefined();
  expect(screen.queryByText("Sonnet")).toBeNull();
  expect(within(cell("Setup")).queryByText("Overridden")).toBeNull();
  expect(screen.getByText("Pinned ·")).toBeDefined();
  expect(
    screen.getByRole("button", { name: "Pinned canonical JSON" }),
  ).toBeDefined();
  expect(screen.getByText("revision").nextElementSibling?.textContent).toBe(
    revision,
  );
});

test("an override the panel has no place for is listed under it by name, with its value", async () => {
  await drawTicket(canonical, {
    worker: { files: [{ path: "notes.md", content: "remember this" }] },
  });
  await sectionOpened("Provenance");
  expect(screen.getByText("Also overridden")).toBeDefined();
  const listed = screen.getByText("worker.files").closest("div");
  expect(listed?.textContent).toContain("remember this");
  expect(listed?.textContent).toContain("notes.md");
});

test("instructions the ticket overrode are drawn as the override, and the caption no longer says as configured", async () => {
  await drawTicket(canonical, {
    work: { instructions: ["Do it the overridden way."] },
  });
  await sectionOpened("Provenance");
  expect(
    within(instructions()).getByText("Do it the overridden way."),
  ).toBeDefined();
  expect(within(instructions()).queryByText(workText)).toBeNull();
  expect(within(instructions()).queryByText(caption)).toBeNull();
  expect(
    within(instructions()).getByText(
      "As configured with this ticket's overrides · a run's exact prompt is in its conversation",
    ),
  ).toBeDefined();
  const heading = within(instructions()).getByRole("heading", {
    name: /^Instructions/u,
  });
  expect(within(heading).getByText("Overridden")).toBeDefined();
});
