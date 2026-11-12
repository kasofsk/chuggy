/**
 * The Catalog page: one repository's configurations and the fragments they
 * hold where the address names no configuration, the repository chosen in the
 * address, the entries a configuration lists, what an entry chosen in the
 * address shows, a version 1 configuration drawn as a ticket's page draws one,
 * and the repository's head read only where the address asks for it.
 */

// jscpd:ignore-start -- renderer tests must declare their own hoisted mock factories
import { QueryClient } from "@tanstack/react-query";
import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import { renderCopied } from "./copied.tsx";
import { act } from "react";
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
import {
  creationCatalogCanonical,
  creationCatalogStagesNamedCanonical,
} from "./ticketCreationFixture.ts";
import type * as BrowserPorts from "../app/browser/ports.ts";

const navigated = vi.hoisted((): unknown[] => []);

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
  useNavigate: () => (to: unknown) => {
    navigated.push(to);
    return Promise.resolve();
  },
}));
// jscpd:ignore-end -- the case's own doubles resume here

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  navigated.length = 0;
});

const chuggy = "https://forge.test/kasofsk/chuggy";

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
  r3: creationCatalogStagesNamedCanonical,
  r5: versionOne,
};

/** The head as the repository's default branch declares chuggy-development, under a digest. */
function headDeclaring(digest: string): unknown {
  return {
    head: {
      state: "Ready",
      branch: "main",
      commit: "e".repeat(40),
      configurations: [
        {
          name: "chuggy-development",
          path: ".chug/configurations/chuggy-development.json",
          revision: "r9",
          canonical: creationCatalogCanonical,
          digest,
        },
      ],
    },
  };
}

async function drawPage(
  query: CatalogQuery,
  configurations: readonly unknown[] = [
    listed("r5", "basic-coding", 3, false),
    listed("r4", "chuggy-development", 2, true),
    listed("r2", "chuggy-development", 1, true),
  ],
  head: unknown = headDeclaring("2".repeat(64)),
  failing: readonly string[] = [],
): Promise<readonly string[]> {
  const sent: string[] = [];
  vi.stubGlobal("fetch", (url: string) => {
    sent.push(url);
    if (url.includes("/configurations/imports/head?"))
      return Promise.resolve(answer(head));
    const revision = /\/configurations\/([^/?]+)$/u.exec(url)?.[1];
    if (revision !== undefined && failing.includes(revision))
      return Promise.resolve(answer({ error: "Unavailable" }, 503));
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
  renderCopied(
    <ScreenHarness
      partition={leadPartition}
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
      transport={openedStream().ports.fetch}
    >
      <CatalogPage query={query} />
    </ScreenHarness>,
  );
  await settled();
  return sent;
}

/** A configuration imported from another repository, at another commit. */
function listedElsewhere(revision: string, name: string): unknown {
  return {
    ...(listed(revision, name, 3, true) as Record<string, unknown>),
    provenance: {
      source: "Repository",
      repository: "https://forge.test/kasofsk/elsewhere",
      commit: "b".repeat(40),
      path: `.chug/configurations/${name}.json`,
      name,
    },
  };
}

const twoRepositories = [
  listed("r5", "basic-coding", 3, false),
  listed("r4", "chuggy-development", 2, true),
  listedElsewhere("r6", "elsewhere-development"),
];

function drawnRepository(): string | null {
  return screen.getByRole("heading", { level: 2 }).textContent;
}

test("with no configuration in the address, the page draws the repository imported last with its configurations and their fragments", async () => {
  const sent = await drawPage({}, twoRepositories);
  expect(drawnRepository()).toBe("kasofsk/chuggy");
  expect(sent.some((url) => url.endsWith("/configurations/r4"))).toBe(true);
  expect(sent.some((url) => url.endsWith("/configurations/r6"))).toBe(false);
  const declared = screen.getByRole("region", { name: "Configurations" });
  expect(
    within(declared)
      .getAllByRole("link", { name: /^(basic|chuggy)/u })
      .map((link) => [link.textContent, link.getAttribute("href")]),
  ).toStrictEqual([
    ["basic-coding", "?configuration=r5"],
    ["chuggy-development", "?configuration=r4"],
  ]);
  expect(within(declared).getByText("Version 1 configuration")).toBeTruthy();
  expect(
    screen
      .getAllByRole("heading", { level: 3 })
      .map((heading) => heading.textContent),
  ).toStrictEqual([
    "Configurations 2",
    "Workloads 4",
    "Evaluation plans 2",
    "Landings 2",
    "Prompts 1",
  ]);
  const workloads = screen.getByRole("region", { name: "Workloads" });
  expect(
    within(workloads)
      .getAllByRole("link", { name: "chuggy-development" })
      .map((link) => link.getAttribute("href")),
  ).toContain("?configuration=r4&entry=workloads%2Fbuild");
  expect(screen.queryByRole("article")).toBeNull();
});

test("the repository the address names is the one drawn, and choosing another writes it into the address", async () => {
  await drawPage(
    { repository: "https://forge.test/kasofsk/elsewhere" },
    twoRepositories,
  );
  expect(drawnRepository()).toBe("kasofsk/elsewhere");
  const picker = screen.getByRole("button", { name: /^Repository/u });
  act(() => {
    fireEvent.keyDown(picker, { key: "ArrowDown" });
  });
  const menu = await screen.findByRole("menu");
  act(() => {
    within(menu).getByRole("menuitemradio", { name: "kasofsk/chuggy" }).click();
  });
  expect(navigated).toStrictEqual([
    expect.objectContaining({ search: { repository: chuggy } }),
  ]);
});

test("an address naming a repository the listing does not hold draws the one imported last", async () => {
  await drawPage(
    { repository: "https://forge.test/kasofsk/gone" },
    twoRepositories,
  );
  expect(drawnRepository()).toBe("kasofsk/chuggy");
});

test("a configuration whose read fails says so in its row, and the fragments say they are of those read", async () => {
  await drawPage(
    {},
    [
      listed("r4", "chuggy-development", 2, true),
      listed("r3", "chuggy-review", 1, true),
    ],
    undefined,
    ["r3"],
  );
  const declared = screen.getByRole("region", { name: "Configurations" });
  const failed = within(declared)
    .getByRole("link", { name: "chuggy-review" })
    .closest("li");
  if (failed === null) throw new Error("the row is drawn");
  expect(within(failed).getByRole("button", { name: "Retry" })).toBeTruthy();
  expect(
    screen.getByText(
      "The parts of a configuration that could not be read are not listed.",
    ),
  ).toBeTruthy();
  expect(
    within(screen.getByRole("region", { name: "Workloads" })).queryByRole(
      "link",
      { name: "chuggy-review" },
    ),
  ).toBeNull();
});

test("an incomplete configuration is listed as one, and not read", async () => {
  const sent = await drawPage({}, [
    listed("r4", "chuggy-development", 2, true),
    {
      ...(listed("r3", "chuggy-review", 1, false) as Record<string, unknown>),
      readiness: "Incomplete",
    },
  ]);
  const incomplete = within(
    screen.getByRole("region", { name: "Configurations" }),
  )
    .getByRole("link", { name: "chuggy-review" })
    .closest("li");
  expect(incomplete?.textContent).toContain("Incomplete");
  expect(sent.some((url) => url.endsWith("/configurations/r3"))).toBe(false);
});

test("a configuration chosen in the address is drawn with its entries, and links back to its repository", async () => {
  await drawPage({ configuration: "r4" });
  expect(
    screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent),
  ).toStrictEqual([
    "Workloads 4",
    "Evaluation plans 2",
    "Landings 2",
    "Prompts 1",
  ]);
  const workloads = screen.getByRole("region", { name: "Workloads" });
  expect(
    within(workloads)
      .getByRole("link", { name: /^build/u })
      .getAttribute("href"),
  ).toBe("?configuration=r4&entry=workloads%2Fbuild");
  expect(within(workloads).getByText("Default work")).toBeTruthy();
  expect(
    screen
      .getByRole("link", { name: "All of kasofsk/chuggy" })
      .getAttribute("href"),
  ).toBe(`?${new URLSearchParams({ repository: chuggy }).toString()}`);
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

test("a plan whose stages are named in free text is listed and shown under those names", async () => {
  await drawPage({ configuration: "r3", entry: "plans/gated" }, [
    listed("r3", "chuggy-development", 3, true),
  ]);
  expect(
    within(screen.getByRole("region", { name: "Evaluation plans" })).getByText(
      "Code Review → Checks · étape 2",
    ),
  ).toBeTruthy();
  const detail = screen.getByRole("article", { name: "gated" });
  expect(within(detail).getByText("Stage 1 · Code Review")).toBeTruthy();
  expect(within(detail).getByText("Stage 2 · Checks · étape 2")).toBeTruthy();
});

test("an entry the catalog does not hold is said to be missing", async () => {
  await drawPage({ configuration: "r4", entry: "plans/nowhere" });
  expect(screen.getByRole("alert").textContent).toBe(
    "Nothing in this catalog is plans/nowhere.",
  );
});

test("a configuration with several versions offers them, and says where the drawn one was read", async () => {
  await drawPage({ configuration: "r2" });
  expect(screen.getByRole("button", { name: /Revision/u })).toBeTruthy();
  expect(
    screen.getByText(".chug/configurations/chuggy-development.json"),
  ).toBeTruthy();
});

test("a version 1 configuration is drawn as no catalog", async () => {
  await drawPage({ configuration: "r5" });
  expect(screen.getByText("Version 1 configuration")).toBeTruthy();
  expect(screen.queryByRole("region", { name: "Workloads" })).toBeNull();
  expect(screen.queryByRole("button", { name: /Revision/u })).toBeNull();
});

test("a project that imported nothing says so", async () => {
  await drawPage({}, []);
  expect(screen.getByText("No configuration imported")).toBeTruthy();
});

test("the repository's head is not read unless the address asks for it", async () => {
  const sent = await drawPage({ configuration: "r4" });
  expect(sent.some((url) => url.includes("/imports/head"))).toBe(false);
  expect(screen.queryByRole("status")).toBeNull();
});

test("an address asking for a head that matches the newest import says so", async () => {
  const sent = await drawPage({ configuration: "r4", source: "head" });
  expect(sent.find((url) => url.includes("/imports/head"))).toContain(
    `repository=${encodeURIComponent(chuggy)}`,
  );
  expect(screen.getByRole("status").textContent).toBe(
    "The repository's main at eeeeeee declares chuggy-development as its newest import stored it. Show the import",
  );
});

test("an address asking for the head draws the head's catalog, its links keeping the head", async () => {
  await drawPage(
    { configuration: "r4", source: "head" },
    undefined,
    headDeclaring("f".repeat(64)),
  );
  expect(screen.getByRole("status").textContent).toContain(
    "Showing chuggy-development as the repository's main at eeeeeee declares it.",
  );
  expect(
    screen.getByRole("link", { name: "Show the import" }).getAttribute("href"),
  ).toBe("?configuration=r4");
  expect(
    within(screen.getByRole("region", { name: "Workloads" }))
      .getByRole("link", { name: /^build/u })
      .getAttribute("href"),
  ).toBe("?configuration=r4&source=head&entry=workloads%2Fbuild");
});

test("a head an import would refuse lists why, and draws the import", async () => {
  await drawPage({ configuration: "r4", source: "head" }, undefined, {
    head: {
      state: "ConfigurationsRefused",
      branch: "main",
      commit: "e".repeat(40),
      faults: [
        {
          path: ".chug/configurations/chuggy-development.json",
          fault: "EnvelopeInvalid",
        },
      ],
    },
  });
  expect(screen.getByRole("status").textContent).toContain(
    "An import of the repository's main at eeeeeee would be refused.",
  );
  expect(
    within(screen.getByRole("status")).getByRole("listitem").textContent,
  ).toBe(".chug/configurations/chuggy-development.json · EnvelopeInvalid");
});

test("an address asking for a head that declares no such configuration says so, and draws the import", async () => {
  await drawPage({ configuration: "r4", source: "head" }, undefined, {
    head: {
      state: "ConfigurationsAbsent",
      branch: "main",
      commit: "e".repeat(40),
    },
  });
  expect(screen.getByRole("status").textContent).toContain(
    "The repository's main at eeeeeee declares no chuggy-development.",
  );
  expect(screen.getByRole("link", { name: "Show the import" })).toBeTruthy();
  expect(
    within(screen.getByRole("region", { name: "Workloads" }))
      .getByRole("link", { name: /^build/u })
      .getAttribute("href"),
  ).toBe("?configuration=r4&entry=workloads%2Fbuild");
});

test("a head is compared with the newest import from its own repository, not another's", async () => {
  const elsewhere = {
    ...(listed("r6", "chuggy-development", 3, true) as Record<string, unknown>),
    provenance: {
      source: "Repository",
      repository: "https://forge.test/kasofsk/elsewhere",
      commit: "b".repeat(40),
      path: ".chug/configurations/chuggy-development.json",
      name: "chuggy-development",
    },
  };
  await drawPage(
    { configuration: "r4", source: "head" },
    [
      elsewhere,
      listed("r4", "chuggy-development", 2, true),
      listed("r2", "chuggy-development", 1, true),
    ],
    headDeclaring("2".repeat(64)),
  );
  expect(screen.getByRole("status").textContent).toContain(
    "declares chuggy-development as its newest import stored it.",
  );
});
