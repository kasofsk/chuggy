/**
 * The Catalog page: which version it opens on, the entries it lists, what an
 * entry chosen in the address shows, and a version 1 configuration drawn as
 * a ticket's page draws one.
 */

// jscpd:ignore-start -- renderer tests must declare their own hoisted mock factories
import { QueryClient } from "@tanstack/react-query";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import type { ReactNode } from "react";

import { CatalogPage } from "../app/browser/catalog/CatalogPage.tsx";
import type { CatalogQuery } from "../app/core/catalogConfigurations.ts";
import { leadPartition } from "./leadFixture.ts";
import {
  answer,
  openedStream,
  ScreenHarness,
  settled,
} from "./screenHarness.tsx";
import { creationCatalogCanonical } from "./ticketCreationFixture.ts";
import type * as BrowserPorts from "../app/browser/ports.ts";

vi.mock("../app/browser/ports.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof BrowserPorts>()),
  sleepMs: () => Promise.resolve(),
}));

vi.mock("@tanstack/react-router", () => ({
  createLink:
    (Component: (props: Record<string, unknown>) => ReactNode) =>
    (props: Record<string, unknown>) => {
      const { to, params, ...rest } = props;
      void params;
      return <Component {...rest} href={String(to)} />;
    },
  Link: (props: {
    readonly search?: CatalogQuery;
    readonly className?: string;
    readonly "aria-current"?: "true";
    readonly children?: ReactNode;
  }) => (
    <a
      href={`?${new URLSearchParams({ ...props.search }).toString()}`}
      className={props.className}
      aria-current={props["aria-current"]}
    >
      {props.children}
    </a>
  ),
  useParams: () => leadPartition,
  useNavigate: () => () => Promise.resolve(),
}));
// jscpd:ignore-end -- the case's own doubles resume here

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function listed(
  revision: string,
  name: string,
  number: number,
  catalog: boolean,
): unknown {
  return {
    revision,
    digest: String(number % 10).repeat(64),
    createdAt: "2026-10-01T00:00:00Z",
    provenance: {
      source: "Repository",
      repository: "https://forge.test/kasofsk/chuggy",
      commit: "cfaca0a0f14ec03845a4e01458ac6c3a56d52a23",
      path: `.chug/configurations/${name}.json`,
      name,
    },
    version: { name, number },
    readiness: "Ready",
    image: "an-image",
    practices: [],
    finalization: { approvalRequired: false },
    evaluationStagesCount: 1,
    ...(catalog
      ? {
          catalog: {
            workloads: ["build"],
            plans: ["review"],
            finalizers: [],
            defaults: { work: "build", evaluation: "review" },
          },
        }
      : {}),
  };
}

const versionOne = JSON.stringify({ image: "an-image" });

const canonicals: Readonly<Record<string, string>> = {
  r4: creationCatalogCanonical,
  r2: creationCatalogCanonical,
  r5: versionOne,
};

async function drawPage(
  query: CatalogQuery,
  configurations: readonly unknown[] = [
    listed("r5", "basic-coding", 3, false),
    listed("r4", "chuggy-development", 2, true),
    listed("r2", "chuggy-development", 1, true),
  ],
): Promise<readonly string[]> {
  const sent: string[] = [];
  vi.stubGlobal("fetch", (url: string) => {
    sent.push(url);
    const revision = /\/configurations\/([^/?]+)$/u.exec(url)?.[1];
    if (revision !== undefined)
      return Promise.resolve(
        answer({
          partition: leadPartition,
          revision,
          canonical: canonicals[revision] ?? "{}",
          digest: "a".repeat(64),
        }),
      );
    return Promise.resolve(answer({ configurations }));
  });
  render(
    <ScreenHarness
      partition={leadPartition}
      client={new QueryClient()}
      transport={openedStream().ports.fetch}
    >
      <CatalogPage query={query} />
    </ScreenHarness>,
  );
  await settled();
  return sent;
}

test("the page opens on the newest catalog and lists its entries by what each is", async () => {
  const sent = await drawPage({});
  expect(sent.some((url) => url.endsWith("/configurations/r4"))).toBe(true);
  expect(
    screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent),
  ).toStrictEqual([
    "Workloads 4",
    "Evaluation plans 2",
    "Finalizers 2",
    "Prompts 1",
  ]);
  const workloads = screen.getByRole("region", { name: "Workloads" });
  expect(
    within(workloads)
      .getByRole("link", { name: /^build/u })
      .getAttribute("href"),
  ).toBe("?configuration=r4&entry=workloads%2Fbuild");
  expect(within(workloads).getByText("Default work")).toBeTruthy();
  expect(screen.queryByRole("article")).toBeNull();
});

test("an entry the address names is shown beside the list, with what it uses and what uses it", async () => {
  await drawPage({ configuration: "r4", entry: "plans/gated" });
  const detail = screen.getByRole("article", { name: "gated" });
  expect(within(detail).getByText("Stage 2 · gates")).toBeTruthy();
  const uses = within(detail).getByRole("region", { name: "Uses" });
  expect(
    within(uses)
      .getAllByRole("link")
      .map((link) => link.textContent),
  ).toStrictEqual(["review", "gates"]);
  expect(
    within(within(detail).getByRole("region", { name: "Used by" })).getByText(
      "Nothing in the catalog.",
    ),
  ).toBeTruthy();
  expect(
    screen.getByRole("link", { name: /^gated/u }).getAttribute("aria-current"),
  ).toBe("true");
});

test("an entry the catalog does not hold is said to be missing", async () => {
  await drawPage({ configuration: "r4", entry: "plans/nowhere" });
  expect(screen.getByRole("alert").textContent).toBe(
    "Nothing in this catalog is plans/nowhere.",
  );
});

test("a configuration with several versions offers them, and says where the drawn one was read", async () => {
  await drawPage({ configuration: "r2" });
  expect(screen.getByRole("button", { name: /Version/u })).toBeTruthy();
  expect(
    screen.getByText(".chug/configurations/chuggy-development.json"),
  ).toBeTruthy();
});

test("a version 1 configuration is drawn as no catalog", async () => {
  await drawPage({ configuration: "r5" });
  expect(screen.getByText("Version 1 configuration")).toBeTruthy();
  expect(screen.queryByRole("region", { name: "Workloads" })).toBeNull();
  expect(screen.queryByRole("button", { name: /Version/u })).toBeNull();
});

test("a project that imported nothing says so", async () => {
  await drawPage({}, []);
  expect(screen.getByText("No configuration imported")).toBeTruthy();
});
