/**
 * The creation screen over a project's own reads, where the form suite beside
 * it is handed a context already read: what the screen does about a read that
 * came back short, and about one that fails under a form somebody is typing in.
 *
 * A project's reads are asked again whenever a configuration of it moves, so a
 * form is redrawn over a fresh answer many times in its life. The stream here
 * is one a case pushes that frame down.
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
import { resizeObserverStubbed } from "./resizeObserver.ts";
import {
  answer,
  configurationMoved,
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

const refused = (): Response =>
  answer({ error: { code: "InternalError" } }, 500);

/** One project's reads, any of which a case may have refused. */
function routed(
  unread: (url: string) => boolean,
): (request: SentRequest) => Response {
  return ({ url }) => {
    if (unread(url)) return refused();
    if (url.endsWith("/repositories"))
      return answer({
        repositories: [{ ...creationBinding(chuggy), configured: true }],
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

interface Drawn {
  readonly sent: readonly SentRequest[];
  /** A frame saying a configuration of this project moved, which is what
   * has the screen read its context again. */
  readonly moved: () => Promise<void>;
}

async function drawCreation(unread: (url: string) => boolean): Promise<Drawn> {
  const scripted = scriptedFetch(routed(unread));
  vi.stubGlobal("fetch", scripted.fetch);
  const server = openedStream();
  render(
    <ScreenHarness
      partition={creationPartition}
      client={new QueryClient()}
      transport={server.ports.fetch}
    >
      <TicketCreation />
    </ScreenHarness>,
  );
  await settled();
  let sequence = 42;
  return {
    sent: scripted.sent,
    moved: () => {
      sequence += 1;
      return configurationMoved(server, creationPartition, sequence);
    },
  };
}

function bindingsRead(sent: readonly SentRequest[]): number {
  return sent.filter((one) => one.url.endsWith("/repositories")).length;
}

function titleTyped(): string | undefined {
  return screen.queryByPlaceholderText<HTMLInputElement>(
    "what this ticket is called",
  )?.value;
}

/**
 * The read is asked again by a frame nobody at the form sent, so one that
 * fails would otherwise take the form and its typing for a reason the reader
 * can do nothing about. The answer the form was drawn from stands instead.
 */
test("a re-read that fails leaves the form standing, with what was typed in it", async () => {
  const failing = { on: false };
  const drawn = await drawCreation(
    (url) => failing.on && url.endsWith("/repositories"),
  );
  fireEvent.change(screen.getByPlaceholderText("what this ticket is called"), {
    target: { value: "Typed title" },
  });
  const before = bindingsRead(drawn.sent);
  failing.on = true;
  await drawn.moved();
  expect(bindingsRead(drawn.sent)).toBeGreaterThan(before);
  expect(titleTyped()).toBe("Typed title");
  expect(screen.queryByText(/^Failed to load · /u)).toBeNull();

  failing.on = false;
  await drawn.moved();
  expect(titleTyped()).toBe("Typed title");
});

test("a first read that fails is still the failure, there being no form to keep", async () => {
  await drawCreation((url) => url.endsWith("/repositories"));
  expect(titleTyped()).toBe(undefined);
  expect(screen.getByText(/^Failed to load · /u)).toBeTruthy();
});

/**
 * One of two offers went unread, which leaves one: the screen says the read
 * was short and asks, the one left not being known to be the only one.
 */
test("an offer that could not be read is left out, said, and the one left is asked about", async () => {
  await drawCreation((url) => url.endsWith("/n-sonnet"));
  expect(screen.getByText(configurationsPartialLabel)).toBeTruthy();
  const picker = screen.getByRole("button", { name: /^Configuration/u });
  expect(picker.textContent).toContain("Choose");
  await turned(() => {
    fireEvent.keyDown(picker, { key: "ArrowDown" });
  });
  expect(
    within(screen.getByRole("menu"))
      .getAllByRole("menuitemradio")
      .map((item) => item.textContent),
  ).toStrictEqual(["development"]);
});
