/**
 * One repository's page: the landing it defaults to, and what it declares that
 * a ticket here is run and finished under.
 *
 * THE CONFLICT IS THE CASE WITH TEETH. Two administrators editing one binding
 * must not clobber each other, so what is asserted about a `409` is the second
 * write's `expected` — the reader is left fenced against what now stands, not
 * against what this page read before somebody else wrote.
 */

// jscpd:ignore-start -- renderer tests must declare their own hoisted mock factories
import { QueryClient } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, assert, expect, test, vi } from "vitest";
import type { ReactNode } from "react";

import { RepositoryPage } from "../app/browser/repositories/RepositoryPage.tsx";
import {
  answer,
  openedStream,
  ScreenHarness,
  settled,
  turned,
} from "./screenHarness.tsx";
import { leadPartition } from "./leadFixture.ts";
import { styleless } from "./styleless.ts";
import type * as BrowserPorts from "../app/browser/ports.ts";

vi.mock("../app/browser/ports.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof BrowserPorts>()),
  sleepMs: () => Promise.resolve(),
}));

const routed = vi.hoisted(() => ({ repository: "" }));

vi.mock("@tanstack/react-router", () => ({
  createLink: (component: unknown) => component,
  Link: (props: { readonly to?: string; readonly children?: ReactNode }) => (
    <a href={props.to ?? "/"}>{props.children}</a>
  ),
  useParams: () => ({ ...leadPartition, repository: routed.repository }),
}));
// jscpd:ignore-end -- the case's own doubles resume here

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const chuggy = "https://forge.test/kasofsk/chuggy";
const commit = "a".repeat(40);

function binding(mode: string, repository = chuggy) {
  return { repository, boundAt: "2026-09-11T00:00:00Z", landing: { mode } };
}

const declarations = {
  repository: chuggy,
  commit,
  reworkLimit: 5,
  cloudProject: "kasofsk/atlas",
  executionProfiles: ["coding", "review"],
  finalizers: ["git-merge.yaml", "pull-request.yaml"],
};

interface Sent {
  readonly method: string;
  readonly url: string;
  readonly body: unknown;
}

interface Init {
  readonly method?: string;
  readonly body?: string;
}

interface Drawing {
  readonly repository?: string;
  readonly bound?: readonly unknown[];
  /** Each PUT takes the next of these, so a conflict can be followed by a write. */
  readonly written?: readonly Response[];
  readonly declares?: () => Response;
}

async function drawPage(drawing: Drawing = {}): Promise<readonly Sent[]> {
  routed.repository = drawing.repository ?? chuggy;
  const bound = drawing.bound ?? [binding("Push")];
  const written = [...(drawing.written ?? [])];
  const declares = drawing.declares ?? (() => answer(declarations));
  const sent: Sent[] = [];
  const fetching = ((url: string, init?: Init) => {
    sent.push({
      method: init?.method ?? "GET",
      url,
      body: init?.body === undefined ? undefined : JSON.parse(init.body),
    });
    if (init?.method === "PUT")
      return Promise.resolve(
        written.shift() ?? answer({ repository: binding("Push") }),
      );
    if (url.includes("/repositories/declarations"))
      return Promise.resolve(declares());
    return Promise.resolve(answer({ repositories: bound }));
  }) as unknown as typeof fetch;
  vi.stubGlobal("fetch", fetching);
  render(
    <ScreenHarness
      partition={leadPartition}
      client={new QueryClient()}
      transport={openedStream().ports.fetch}
    >
      <RepositoryPage />
    </ScreenHarness>,
  );
  await settled();
  return sent;
}

function sectionOf(title: string): HTMLElement {
  return screen.getByRole("region", { name: new RegExp(`^${title}`) });
}

/** Which landing the radio group reports as chosen, whatever it is drawn as. */
function chosenLanding(): string | undefined {
  return ["Push", "Pull request", "Pull request, then merge"].find(
    (label) =>
      screen
        .getByRole("radio", { name: label })
        .getAttribute("aria-checked") === "true",
  );
}

async function press(name: string): Promise<void> {
  await turned(() => {
    fireEvent.click(screen.getByRole("button", { name }));
  });
  await settled();
}

test("the page reads its own binding, and says what it lands as", async () => {
  await drawPage({ bound: [binding("PullRequest")] });
  expect(
    within(sectionOf("Landing")).getByText(
      "How a finished ticket lands. A ticket may choose otherwise.",
    ),
  ).toBeTruthy();
  expect(screen.getByRole("heading", { name: "kasofsk/chuggy" })).toBeTruthy();
  expect(chosenLanding()).toBe("Pull request");
  styleless();
});

test("a repository this project does not bind draws nothing but Not bound", async () => {
  await drawPage({ repository: "https://forge.test/kasofsk/none" });
  expect(screen.getByText("Not bound")).toBeTruthy();
  expect(screen.queryByRole("region", { name: /^Landing/ })).toBeNull();
  expect(screen.queryByRole("region", { name: /^Declares/ })).toBeNull();
});

test("a saved landing is written against the mode the page read", async () => {
  const sent = await drawPage();
  await press("Edit");
  fireEvent.click(screen.getByRole("radio", { name: "Pull request" }));
  await press("Save changes");
  const put = sent.find((one) => one.method === "PUT");
  assert(put !== undefined);
  expect(put.url.endsWith("/repositories/landing")).toBe(true);
  expect(put.body).toStrictEqual({
    repository: chuggy,
    expected: { mode: "Push" },
    landing: { mode: "PullRequest" },
  });
  expect(screen.getByText("Written")).toBeTruthy();
});

/**
 * The second write is the whole case: a draft left fenced against the mode this
 * page read would clobber whoever moved it, and would do so silently.
 */
test("a landing that moved under the write says so, and rebases onto what stands", async () => {
  const sent = await drawPage({
    written: [
      answer(
        {
          error: {
            code: "RepositoryLandingMoved",
            message: "the landing moved under this write",
          },
          repository: binding("PullRequestMerge"),
        },
        409,
      ),
      answer({ repository: binding("Push") }),
    ],
  });
  await press("Edit");
  fireEvent.click(screen.getByRole("radio", { name: "Pull request" }));
  await press("Save changes");
  expect(screen.getByText("Landing moved")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Reload" })).toBeTruthy();
  fireEvent.click(screen.getByRole("radio", { name: "Push" }));
  await press("Save changes");
  const puts = sent.filter((one) => one.method === "PUT");
  expect(puts).toHaveLength(2);
  expect(puts[1]?.body).toStrictEqual({
    repository: chuggy,
    expected: { mode: "PullRequestMerge" },
    landing: { mode: "Push" },
  });
});

test("a refused write says so and leaves the edit open", async () => {
  await drawPage({
    written: [answer({ error: { code: "NotEnabled", message: "no" } }, 403)],
  });
  await press("Edit");
  fireEvent.click(screen.getByRole("radio", { name: "Pull request" }));
  await press("Save changes");
  expect(screen.getByText(/^Failed · /)).toBeTruthy();
  expect(screen.getByRole("button", { name: "Save changes" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Reload" })).toBeNull();
});

test("cancelling a choice leaves the landing the page read", async () => {
  await drawPage();
  await press("Edit");
  fireEvent.click(screen.getByRole("radio", { name: "Pull request" }));
  await press("Cancel");
  expect(chosenLanding()).toBe("Push");
});

test("the declarations are read for this repository and drawn as its rosters", async () => {
  const sent = await drawPage();
  const declares = sent.find((one) =>
    one.url.includes("/repositories/declarations"),
  );
  assert(declares !== undefined);
  expect(declares.url).toContain(`repository=${encodeURIComponent(chuggy)}`);
  const section = within(sectionOf("Declares"));
  expect(section.getByText("5")).toBeTruthy();
  expect(section.getByText("coding, review")).toBeTruthy();
  expect(section.getByText("git-merge.yaml, pull-request.yaml")).toBeTruthy();
  expect(section.getByText(commit.slice(0, 12))).toBeTruthy();
  styleless();
});

/**
 * A repository that declares no finalizer and one whose roster did not arrive
 * are different facts, and a section drawing nothing states neither.
 */
test("a roster the repository declares nothing in says so", async () => {
  await drawPage({
    declares: () =>
      answer({ ...declarations, executionProfiles: [], finalizers: [] }),
  });
  expect(
    within(sectionOf("Declares")).getAllByText("None declared"),
  ).toHaveLength(2);
});

test("a refused declarations read is said in its own section, not the page", async () => {
  await drawPage({ declares: () => answer({}, 503) });
  expect(
    within(sectionOf("Declares")).getByText(/^Failed to load/),
  ).toBeTruthy();
  expect(sectionOf("Landing")).toBeTruthy();
});
