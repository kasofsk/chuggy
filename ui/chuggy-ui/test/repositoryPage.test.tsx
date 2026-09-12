/**
 * One repository's page: the landing it defaults to, the finalizer that runs
 * after evaluation, and what it declares under `.chug/configurations`.
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
import { afterEach, expect, test, vi } from "vitest";
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

const chuggy = "https://forge.test/kasofsk/chuggy";

const routed = vi.hoisted(() => ({ repository: "" }));

vi.mock("@tanstack/react-router", () => ({
  createLink:
    (Component: (props: Record<string, unknown>) => ReactNode) =>
    (props: Record<string, unknown>) => {
      const { to, params, ...rest } = props;
      void params;
      return <Component {...rest} href={String(to)} />;
    },
  Link: (props: { readonly children?: ReactNode }) => (
    <a href="/">{props.children}</a>
  ),
  useParams: () => ({ ...leadPartition, repository: routed.repository }),
}));
// jscpd:ignore-end -- the case's own doubles resume here

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function binding(mode: string, repository = chuggy): unknown {
  return {
    repository,
    boundAt: "2026-09-11T00:00:00Z",
    landing: { mode },
  };
}

const initialization = {
  configuration: {
    partition: leadPartition,
    revision: "r6",
    canonical: "{}",
    digest: "a".repeat(64),
  },
  fence: { projectSequence: 41, configurationDigest: "a".repeat(64) },
  defaults: {
    dependencies: [],
    program: [{ fanout: 1, combinator: "UnanimousPass" }],
    workFanout: 1,
    reworkPolicy: { type: "BudgetedRework", value: 0 },
    finalizationPricing: "DeadlineOnly",
    resumePricing: "RetryCharged",
    finalizer: "ManagedFinalizer",
  },
  choices: {
    stages: [{ fanout: 1, combinator: "UnanimousPass" }],
    programStagesMax: 2,
    workFanouts: [1],
    reworkPolicies: [{ type: "BudgetedRework", value: 0 }],
    finalizationPricings: ["DeadlineOnly"],
    resumePricings: ["RetryCharged"],
    finalizers: ["ManagedFinalizer"],
  },
  dependencyCandidates: [],
  dependencyCandidatesTruncated: false,
};

function declared(
  revision: string,
  name: string,
  readiness: "Ready" | "Incomplete",
  repository = chuggy,
): unknown {
  const base = {
    revision,
    digest: "a".repeat(64),
    createdAt: "2026-08-26T00:00:00Z",
    provenance: {
      source: "Repository",
      repository,
      commit: "cfaca0a0f14ec03845a4e01458ac6c3a56d52a23",
      path: `configurations/${name}.json`,
      name,
    },
    version: { name, number: 12 },
  };
  return readiness === "Incomplete"
    ? { ...base, readiness }
    : {
        ...base,
        readiness,
        image: "forge.test/chuggy/worker:1",
        practices: [],
        workInstructionsCount: 1,
        reviewInstructionsCount: 1,
        finalization: { approvalRequired: true, handoff: "DirectCommit" },
        evaluationStagesCount: 2,
      };
}

const configurations = {
  configurations: [
    declared("r6", "chuggy", "Ready"),
    declared("r5", "nightly", "Incomplete"),
    declared("r4", "elsewhere", "Ready", "https://forge.test/gdoteof/scratch"),
  ],
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
  /** Which repository the address names, the default being the bound one. */
  readonly repository?: string;
  /** The bindings the project answers with. */
  readonly bound?: readonly unknown[];
  /** What the landing write answers with, in turn, each in the route's own
   * envelope: the row the write left, or the row it lost to. */
  readonly written?: readonly Response[];
  /** Whether every configurations page holds a cursor, so the walk hits the
   * budget rather than the listing's end. */
  readonly truncated?: boolean;
  /** The revisions the project answers with, the default being the fixture. */
  readonly declares?: readonly unknown[];
}

async function drawPage(drawing: Drawing = {}): Promise<readonly Sent[]> {
  routed.repository = drawing.repository ?? chuggy;
  const bound = drawing.bound ?? [binding("Push")];
  const written = [...(drawing.written ?? [])];
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
    if (url.includes("/draft-initializations/"))
      return Promise.resolve(answer(initialization));
    if (url.includes("/configurations"))
      return Promise.resolve(
        answer({
          configurations: drawing.declares ?? configurations.configurations,
          ...(drawing.truncated === true ? { nextCursor: "more" } : {}),
        }),
      );
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

/** The choice in force, which is the radio the group draws as checked. */
function chosenLanding(): string | undefined {
  return ["Push", "Pull request"].find(
    (name) =>
      screen.getByRole("radio", { name }).getAttribute("aria-checked") ===
      "true",
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
  const landing = sectionOf("Landing");
  expect(
    within(landing).getByText(
      "How a finished ticket lands. A ticket may choose otherwise.",
    ),
  ).toBeTruthy();
  expect(screen.getByRole("heading", { name: "kasofsk/chuggy" })).toBeTruthy();
  expect(
    screen.getByRole("link", { name: "Repositories" }).getAttribute("href"),
  ).toBe("/$tenant/$project/repositories");
  expect(chosenLanding()).toBe("Pull request");
  expect(
    within(landing)
      .getByRole<HTMLInputElement>("radio", { name: "Push" })
      .getAttribute("data-disabled"),
  ).not.toBe(null);
  styleless();
});

/** A repository the project does not bind has no landing to draw and no
 * configurations of its own to list, so the page says only that. */
test("a repository this project does not bind draws nothing but Not bound", async () => {
  await drawPage({ repository: "https://forge.test/kasofsk/none" });
  expect(screen.getByText("Not bound")).toBeTruthy();
  expect(screen.queryByRole("region", { name: /^Landing/u })).toBeNull();
  expect(screen.queryByRole("region", { name: /^Configurations/u })).toBeNull();
});

test("a saved landing is written against the mode the page read", async () => {
  const sent = await drawPage({
    written: [answer({ repository: binding("PullRequest") })],
  });
  await press("Edit");
  await turned(() => {
    fireEvent.click(screen.getByRole("radio", { name: "Pull request" }));
  });
  await press("Save changes");
  const wrote = sent.find((one) => one.method === "PUT");
  expect(wrote?.url.endsWith("/repositories/landing")).toBe(true);
  expect(wrote?.body).toStrictEqual({
    repository: chuggy,
    expected: { mode: "Push" },
    landing: { mode: "PullRequest" },
  });
  expect(screen.getByText("Written")).toBeTruthy();
  expect(chosenLanding()).toBe("Pull request");
  expect(screen.getByRole("button", { name: "Edit" })).toBeTruthy();
});

/**
 * The conflict answers the row as it now stands, and the reader chose the same
 * mode it moved to — so the draft takes it, the section says so, and the reload
 * is the one action offered.
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
          repository: binding("PullRequest"),
        },
        409,
      ),
      answer({ repository: binding("Push") }),
    ],
  });
  await press("Edit");
  await turned(() => {
    fireEvent.click(screen.getByRole("radio", { name: "Pull request" }));
  });
  await press("Save changes");
  expect(screen.getByText("Landing moved")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Reload" })).toBeTruthy();
  await turned(() => {
    fireEvent.click(screen.getByRole("radio", { name: "Push" }));
  });
  await press("Save changes");
  const writes = sent.filter((one) => one.method === "PUT");
  expect(writes.length).toBe(2);
  expect(writes[1]?.body).toStrictEqual({
    repository: chuggy,
    expected: { mode: "PullRequest" },
    landing: { mode: "Push" },
  });
});

test("a refused write says so and leaves the edit open", async () => {
  await drawPage({
    written: [answer({ error: { code: "NotEnabled", message: "no" } }, 403)],
  });
  await press("Edit");
  await turned(() => {
    fireEvent.click(screen.getByRole("radio", { name: "Pull request" }));
  });
  await press("Save changes");
  expect(
    screen.getByText("Failed · the API rejected this read as NotEnabled"),
  ).toBeTruthy();
  expect(screen.getByRole("button", { name: "Save changes" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Reload" })).toBeNull();
});

test("cancelling a choice leaves the landing the page read", async () => {
  await drawPage();
  await press("Edit");
  await turned(() => {
    fireEvent.click(screen.getByRole("radio", { name: "Pull request" }));
  });
  await press("Cancel");
  expect(chosenLanding()).toBe("Push");
});

test("the finalizer is the newest ready revision's, and says when it runs", async () => {
  await drawPage();
  const finalizer = sectionOf("Finalizer");
  expect(
    within(finalizer).getByText(
      "What a new ticket is authored to run. A ticket may choose otherwise.",
    ),
  ).toBeTruthy();
  expect(finalizer.textContent).toContain("Managed");
  expect(finalizer.textContent).toContain("Runs after evaluation passes");
});

/**
 * The listing is the project's, so a revision another repository declares must
 * not appear here — the row it would draw reads as this repository's.
 */
test("the configurations are this repository's own, incomplete rows saying so", async () => {
  await drawPage();
  const rows = within(sectionOf("Configurations")).getAllByRole("row");
  expect(
    rows.map((row) => [...row.children].map((cell) => cell.textContent)),
  ).toStrictEqual([
    ["Configuration", "Worker", "Stages", "Approval", "Handoff"],
    ["chuggy #12", "worker:1", "2", "Required", "Direct commit"],
    ["nightly #12", "Incomplete"],
  ]);
});

/**
 * The rows a budget stopped short of are indistinguishable from rows that do
 * not exist, so a walk that stopped says so instead of the page reading as a
 * repository that declares nothing.
 */
test("a walk the budget stopped says so, in place of the empty state", async () => {
  await drawPage({ truncated: true, declares: [] });
  const section = sectionOf("Configurations");
  expect(
    within(section).getByText("Not every configuration was read"),
  ).toBeTruthy();
  expect(within(section).queryByText("No configuration declared")).toBeNull();
  expect(within(section).queryByRole("table")).toBeNull();
});

test("a walk the budget stopped says so under the rows it did read", async () => {
  await drawPage({ truncated: true });
  const section = sectionOf("Configurations");
  expect(within(section).getAllByRole("row").length).toBe(3);
  expect(
    within(section).getByText("Not every configuration was read"),
  ).toBeTruthy();
  styleless();
});
