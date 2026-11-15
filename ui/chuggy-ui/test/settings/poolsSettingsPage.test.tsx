/**
 * The Pools settings page, mounted: the project's pools as a listing, each
 * with its platforms, its version and when it registered; the line an empty
 * roster is said in; the line a cut one is; and nothing that adds a pool, for
 * an administrator or anyone else.
 */

// jscpd:ignore-start -- renderer tests must declare their own hoisted mock factories
import { cleanup, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { ReactNode } from "react";

import { PoolsSettingsPage } from "../../app/browser/settings/PoolsSettingsPage.tsx";
import { drawnStrict, answer, sectionOf } from "../screenHarness.tsx";
import type { SentRequest } from "../screenHarness.tsx";
import { leadPartition } from "../leadFixture.ts";
import { resizeObserverStubbed } from "../resizeObserver.ts";

vi.mock("@tanstack/react-router", () => ({
  createLink: (component: unknown) => component,
  Link: (props: { readonly children?: ReactNode }) => (
    <a href="/">{props.children}</a>
  ),
  useParams: () => ({ ...leadPartition }),
}));
// jscpd:ignore-end -- the case's own doubles resume here

beforeEach(() => {
  resizeObserverStubbed();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const pool = {
  pool: "shame",
  capabilities: ["Platform:Linux:Amd64"],
  registeredAt: "2026-09-29T00:00:00Z",
  live: false,
};

const pools = { truncated: false, pools: [pool] };

/** Granted every route, which is what an administrator of the project reads. */
const administered = {
  work: { route: "InCluster", source: "Project" },
  evaluation: { route: "InCluster", source: "Override" },
  choices: ["InCluster", "Pool"],
};

async function drawPools(listed: unknown): Promise<readonly SentRequest[]> {
  const drawn = await drawnStrict(<PoolsSettingsPage />, (request) => {
    if (request.url.endsWith("/worker-pools")) return answer(listed);
    if (request.url.endsWith("/execution-placement"))
      return answer(administered);
    return answer({}, 404);
  });
  return drawn.sent;
}

function rows(): readonly HTMLElement[] {
  return within(sectionOf("Pools")).getAllByRole("row");
}

test("each pool is a row naming it, its platforms and when it registered, under the line that says what pools are", async () => {
  await drawPools(pools);
  const section = sectionOf("Pools");
  expect(section.textContent).toContain(
    "Shared machines registered to run this project's agents.",
  );
  expect(
    within(section)
      .getAllByRole("columnheader")
      .map((header) => header.textContent),
  ).toStrictEqual(["Runner", "Platforms", "Version", "Registered"]);
  expect(rows()[1]?.textContent).toMatch(/^shameLinux Amd64/u);
  expect(within(rows()[1] ?? section).getByRole("rowheader").textContent).toBe(
    "shame",
  );
});

test("a pool's version is drawn, Outdated where chuggy pins a later one, and a dash where none is known", async () => {
  await drawPools({
    truncated: false,
    pools: [
      {
        ...pool,
        pool: "behind",
        runner: { package: "chuggy-linux", version: "0.9.0", pinned: "0.10.0" },
      },
      {
        ...pool,
        pool: "current",
        runner: {
          package: "chuggy-linux",
          version: "0.10.0",
          pinned: "0.10.0",
        },
      },
      { ...pool, pool: "unnamed" },
    ],
  });
  expect(rows()[1]?.textContent).toMatch(/0\.9\.0Outdated/u);
  expect(rows()[2]?.textContent).toMatch(/0\.10\.0/u);
  expect(rows()[2]?.textContent).not.toMatch(/Outdated/u);
  expect(rows()[3]?.textContent).toMatch(/Linux Amd64—/u);
});

test("a roster holding more than one read answers says so under its rows", async () => {
  await drawPools({ ...pools, truncated: true });
  expect(within(sectionOf("Pools")).getByText("More not shown")).toBeTruthy();
  cleanup();
  await drawPools(pools);
  expect(screen.queryByText("More not shown")).toBeNull();
});

test("a project with no pool says so, and nothing goes under the line", async () => {
  await drawPools({ truncated: false, pools: [] });
  const section = sectionOf("Pools");
  expect(within(section).getByText("No pools")).toBeTruthy();
  expect(within(section).queryByRole("table")).toBeNull();
  expect(within(section).queryAllByRole("button")).toHaveLength(0);
});

test("an administrator is offered no pool to add, and nothing is minted", async () => {
  for (const listed of [pools, { truncated: false, pools: [] }]) {
    const sent = await drawPools(listed);
    expect(screen.queryAllByRole("button")).toHaveLength(0);
    expect(sent.filter((one) => one.method !== "GET")).toHaveLength(0);
    cleanup();
  }
});
