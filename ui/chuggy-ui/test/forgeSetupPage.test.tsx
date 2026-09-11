/**
 * The landing the forge sends a person back to, mounted.
 *
 * THE CASE WITH TEETH IS THE ONE THAT MUST NOT POST. An installation identity
 * is a fact about an account the caller may not administer, so a landing that
 * claimed on the identity alone would let a crafted link bind somebody else's
 * account to this tenant. What is asserted is therefore the traffic — that no
 * request left — and not only the words on the screen.
 */

// jscpd:ignore-start -- renderer tests must declare their own hoisted mock factories
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import type { ReactNode } from "react";

import { ForgeSetupPage } from "../app/browser/ForgeSetupPage.tsx";
import { SessionProvider } from "../app/browser/session.tsx";
import { forgeInstallTransactionKey } from "../app/core/forgeInstallation.ts";
import { forgeSetupStatusParam } from "../app/core/forgeSetup.ts";
import { answer, holderDouble, settled } from "./screenHarness.tsx";
import type * as BrowserPorts from "../app/browser/ports.ts";

interface Went {
  readonly href?: string;
  readonly replace?: boolean;
}

/**
 * ONE NAVIGATE, NOT ONE PER RENDER, WHICH IS WHAT THE ROUTER GIVES. The claim
 * effect names it among its dependencies, so a double that minted a fresh
 * function each render would re-run the claim on every draw and hide whether
 * the page's own decision survives one.
 */
const held = vi.hoisted(
  (): {
    arrived: Record<string, unknown>;
    went: Went[];
    navigate: (to: Went) => Promise<void>;
  } => {
    const went: Went[] = [];
    return {
      arrived: {},
      went,
      navigate: (to: Went): Promise<void> => {
        went.push(to);
        return Promise.resolve();
      },
    };
  },
);

vi.mock("../app/browser/ports.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof BrowserPorts>()),
  sleepMs: () => Promise.resolve(),
}));

vi.mock("@tanstack/react-router", () => ({
  useSearch: () => held.arrived,
  useNavigate: () => held.navigate,
}));
// jscpd:ignore-end -- the case's own doubles resume here

const transaction = {
  state: "a-state",
  app: "worker",
  tenant: "vteng",
  project: "chuggy",
  returnPath: "/vteng/chuggy/repositories",
};

const claimed = {
  forge: "github",
  app: "worker",
  account: "kasofsk",
  accountKind: "Organization",
  installationId: "42",
};

beforeEach(() => {
  held.arrived = {
    installationId: "42",
    action: "install",
    state: "a-state",
  };
  held.went.length = 0;
  sessionStorage.setItem(
    forgeInstallTransactionKey,
    JSON.stringify(transaction),
  );
});

afterEach(() => {
  cleanup();
  sessionStorage.clear();
  vi.unstubAllGlobals();
});

interface Sent {
  readonly method: string;
  readonly url: string;
  readonly body: unknown;
}

interface Init {
  readonly method?: string;
  readonly body?: string;
}

interface Landed {
  readonly sent: readonly Sent[];
  /** The page drawn again with nothing about the landing changed, which is what
   * a re-render is: the decision it already took has to survive one. */
  readonly redraw: () => void;
}

async function drawLanding(
  answered: () => Response = () => answer(claimed),
): Promise<Landed> {
  const sent: Sent[] = [];
  const fetching = ((url: string, init?: Init) => {
    sent.push({
      method: init?.method ?? "GET",
      url,
      body: init?.body === undefined ? undefined : JSON.parse(init.body),
    });
    return Promise.resolve(answered());
  }) as unknown as typeof fetch;
  vi.stubGlobal("fetch", fetching);
  const client = new QueryClient();
  const holder = holderDouble();
  const landing = (nudge: number): ReactNode => (
    <SessionProvider holder={holder}>
      <QueryClientProvider client={client}>
        <span>{nudge}</span>
        <ForgeSetupPage />
      </QueryClientProvider>
    </SessionProvider>
  );
  const view = render(landing(0));
  await settled();
  return {
    sent,
    redraw: () => {
      view.rerender(landing(1));
    },
  };
}

test("a matching state claims for the app the transaction names", async () => {
  const { sent } = await drawLanding();
  expect(sent).toHaveLength(1);
  expect(sent[0]?.method).toBe("POST");
  expect(sent[0]?.url).toContain("/tenants/vteng/forge-installations");
  expect(sent[0]?.body).toStrictEqual({
    forge: "github",
    app: "worker",
    installationId: "42",
  });
});

test("a landed claim goes back where the person left, saying so", async () => {
  await drawLanding();
  const url = new URL(held.went[0]?.href ?? "", "https://console.test");
  expect(url.pathname).toBe(transaction.returnPath);
  expect(url.searchParams.get(forgeSetupStatusParam)).toBe("Connected");
  expect(held.went[0]?.replace).toBe(true);
});

test("a state that is not this tab's claims nothing and goes nowhere", async () => {
  held.arrived = { ...held.arrived, state: "someone-else" };
  const { sent } = await drawLanding();
  expect(sent).toStrictEqual([]);
  expect(held.went).toStrictEqual([]);
  expect(screen.getByText("Not expected")).toBeTruthy();
});

test("a landing carrying no state claims nothing", async () => {
  held.arrived = { installationId: "42", action: "install" };
  expect((await drawLanding()).sent).toStrictEqual([]);
  expect(screen.getByText("Not expected")).toBeTruthy();
});

/** The transaction is spent on the first landing, so a reload — which is the
 * same address opened a second time — has nothing left to match against. */
test("the transaction is spent, and the landing opened again claims nothing", async () => {
  await drawLanding();
  expect(sessionStorage.getItem(forgeInstallTransactionKey)).toBeNull();
  cleanup();
  held.went.length = 0;
  expect((await drawLanding()).sent).toStrictEqual([]);
  expect(screen.getByText("Not expected")).toBeTruthy();
});

/** A `request` is somebody asking an owner to install; there is no installation
 * to claim yet, and the page says so rather than posting a claim for nothing. */
test("a request that awaits an owner claims nothing and says what it is", async () => {
  held.arrived = { ...held.arrived, action: "request" };
  expect((await drawLanding()).sent).toStrictEqual([]);
  expect(screen.getByText("Requested")).toBeTruthy();
});

/**
 * The word the landing carries back is the claim's own and not the landing's
 * hope for it. A refusal reported as a connection sends the reader back to a
 * page saying the account was added when no row was added, and the page has
 * nothing else to correct it with.
 */
test("a refused claim carries its own word back, not the landed one", async () => {
  await drawLanding(() =>
    answer(
      {
        error: {
          code: "InstallationClaimed",
          message: "The installation is claimed by another tenant.",
        },
      },
      409,
    ),
  );
  const url = new URL(held.went[0]?.href ?? "", "https://console.test");
  expect(url.searchParams.get(forgeSetupStatusParam)).toBe(
    "Claimed by another tenant",
  );
});

/**
 * The decision is taken once and kept, which is what a re-render would
 * otherwise undo: the transaction is spent by the taking, so a second taking
 * finds nothing and the landing that just claimed says it was not expected.
 */
test("the decision survives the page being drawn again", async () => {
  const landed = await drawLanding();
  landed.redraw();
  await settled();
  expect(landed.sent).toHaveLength(1);
  expect(screen.queryByText("Not expected")).toBeNull();
});
