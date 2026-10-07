/**
 * The creation screen over a project's own reads, where the form suite beside
 * it is handed a context already read: what the screen does about a read that
 * came back short, and about a submit the project moved under whose re-read
 * then fails.
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
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { ReactNode } from "react";

import { TicketCreation } from "../app/browser/TicketCreation.tsx";
import { configurationsPartialLabel } from "../app/core/repositoryConfigurations.ts";
import { creationStaleSentence } from "../app/core/ticketCreationRun.ts";
import { resizeObserverStubbed } from "./resizeObserver.ts";
import {
  answer,
  openedStream,
  ScreenHarness,
  scriptedFetch,
  settled,
  turned,
} from "./screenHarness.tsx";
import type { SentRequest } from "./screenHarness.tsx";
import {
  creationBinding,
  creationDeclared,
  creationInitialization,
  creationListed,
  creationPartition,
} from "./ticketCreationFixture.ts";
import type * as BrowserPorts from "../app/browser/ports.ts";

vi.mock("../app/browser/ports.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof BrowserPorts>()),
  sleepMs: () => new Promise<void>(() => undefined),
}));

vi.mock("@tanstack/react-router", () => ({
  createLink: (component: unknown) => component,
  Link: (props: { readonly children?: ReactNode }) => (
    <a href="/">{props.children}</a>
  ),
  useBlocker: () => undefined,
  useNavigate: () => () => Promise.resolve(),
  useParams: () => ({ ...creationPartition }),
}));
// jscpd:ignore-end -- the case's own doubles resume here

beforeEach(() => {
  resizeObserverStubbed();
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const chuggy = "https://forge.test/kasofsk/chuggy";

const listing = {
  configurations: [
    creationDeclared("n-sonnet", chuggy, "development-sonnet"),
    creationDeclared("n-development", chuggy, "development"),
  ],
};

/** One project's reads, any of which a case may answer for itself. */
function routed(
  answered: (request: SentRequest) => Response | undefined,
): (request: SentRequest) => Response {
  return (request) => {
    const url = request.url;
    const own = answered(request);
    if (own !== undefined) return own;
    if (url.endsWith("/repositories"))
      return answer({
        repositories: [creationListed(creationBinding(chuggy), "Imported")],
      });
    if (url.includes("/configurations")) return answer(listing);
    if (!url.includes("/draft-initializations/"))
      return answer({
        partition: creationPartition,
        sequence: 42,
        tickets: [],
      });
    const revision = decodeURIComponent(url.slice(url.lastIndexOf("/") + 1));
    return answer({
      ...creationInitialization,
      configuration: { ...creationInitialization.configuration, revision },
    });
  };
}

async function drawCreation(
  answered: (request: SentRequest) => Response | undefined,
): Promise<readonly SentRequest[]> {
  const scripted = scriptedFetch(routed(answered));
  vi.stubGlobal("fetch", scripted.fetch);
  render(
    <ScreenHarness
      partition={creationPartition}
      client={new QueryClient()}
      transport={openedStream().ports.fetch}
    >
      <TicketCreation />
    </ScreenHarness>,
  );
  await settled();
  return scripted.sent;
}

const unreadable = (): Response =>
  answer({ error: { code: "InternalError" } }, 500);

function configurationPicker(): HTMLElement {
  return screen.getByRole("button", { name: /^Configuration/u });
}

async function offeredNames(): Promise<readonly (string | null)[]> {
  await turned(() => {
    fireEvent.keyDown(configurationPicker(), { key: "ArrowDown" });
  });
  return within(screen.getByRole("menu"))
    .getAllByRole("menuitemradio")
    .map((item) => item.textContent);
}

/**
 * One of two offers went unread, which leaves one: the screen says the read
 * was short and asks, the one left not being known to be the only one.
 */
test("an offer that could not be read is left out, said, and the one left is asked about", async () => {
  await drawCreation(({ url }) =>
    url.endsWith("/n-sonnet") ? unreadable() : undefined,
  );
  expect(screen.getByText(configurationsPartialLabel)).toBeTruthy();
  expect(configurationPicker().textContent).toContain("Choose");
  expect(await offeredNames()).toStrictEqual(["development"]);
});

/**
 * A submit the project moved under reads the project again and says so. Where
 * that read fails, saying so over a form still fenced where it was would be
 * false, so the failure is what the screen draws.
 */
test("a submit the project moved under, whose re-read fails, draws that failure", async () => {
  const failing = { on: false };
  const sent = await drawCreation(({ method, url }) => {
    if (method === "POST" && url.endsWith("/drafts"))
      return answer({ error: { code: "DraftInitializationStale" } }, 409);
    return failing.on && url.endsWith("/repositories")
      ? unreadable()
      : undefined;
  });
  await offeredNames();
  await turned(() => {
    fireEvent.click(screen.getByRole("menuitemradio", { name: "development" }));
  });
  fireEvent.change(screen.getByPlaceholderText("what this ticket is for"), {
    target: { value: "ship it" },
  });
  failing.on = true;
  await turned(() => {
    fireEvent.click(screen.getByRole("button", { name: "Create ticket" }));
  });
  await settled();
  expect(sent.filter((one) => one.method === "POST").length).toBe(1);
  expect(screen.getByText(/^Failed to load · /u)).toBeTruthy();
  expect(screen.queryByText(creationStaleSentence)).toBeNull();
});
