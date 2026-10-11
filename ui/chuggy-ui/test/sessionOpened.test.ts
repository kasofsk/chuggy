/**
 * The session of a document in a browser, as the console's own entry builds
 * it: the entry is imported as the document's script is, over that document's
 * two stores, its address and its events.
 *
 * Only the network and the lock manager are doubles, and the route tree, which
 * is a marker that renews when it is pressed. So what is checked is the wiring
 * nothing else can see: that this session renews under the origin's turn,
 * hears the store change and the document shown again, is told where the
 * document was loaded, and gives a request the network never answers up.
 */

import { afterEach, expect, test, vi } from "vitest";

import { fetchJsonWaitMs } from "../app/browser/ports.ts";
import { sessionHolderOpened } from "../app/browser/session.tsx";
import {
  sessionRefreshTokenKey,
  sessionRenewalLockName,
  sessionTransactionKey,
} from "../app/core/sessionHolder.ts";
import {
  sessionHarnessConfiguration as configuration,
  sessionHarnessDiscovery as discovery,
} from "./sessionHolderHarness.ts";

vi.mock("../app/browser/routes.tsx", () => ({ consoleRouter: {} }));

/** The route tree of one loaded document, drawn over the modules that
 * document loaded: a button that renews its session when pressed. */
async function routeTree(): Promise<object> {
  const { createElement } = await import("react");
  const { useSessionHolder } = await import("../app/browser/session.tsx");
  return {
    RouterProvider: function Routed() {
      const holder = useSessionHolder();
      const renew = (): void => {
        void holder.refresh();
      };
      return createElement("button", { onClick: renew }, "Routed");
    },
    createLink: (component: unknown) => component,
  };
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(navigator, "locks");
  localStorage.clear();
  sessionStorage.clear();
  history.replaceState(null, "", "/");
});

interface Network {
  /** The grant each request of the token endpoint was made under. */
  readonly grants: string[];
  /** Keeps what the token endpoint answers from arriving until called. */
  readonly hold: () => () => void;
  /** Has the token endpoint answer nothing, until the request is given up. */
  silent: boolean;
}

function json(body: unknown): Response {
  return new Response(JSON.stringify(body));
}

function network(): Network {
  let arriving: Promise<void> = Promise.resolve();
  const held: Network = {
    grants: [],
    silent: false,
    hold: () => {
      let release = (): void => undefined;
      arriving = new Promise<void>((resolve) => {
        release = resolve;
      });
      return release;
    },
  };
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    if (url === "/config.json") return json(configuration);
    if (url !== discovery.token_endpoint) return json(discovery);
    const form = typeof init.body === "string" ? init.body : "";
    const grant = new URLSearchParams(form).get("grant_type");
    held.grants.push(grant ?? "");
    if (held.silent)
      return new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => {
          reject(new DOMException("the request was given up", "AbortError"));
        });
      });
    await arriving;
    return json({
      access_token: `access by ${String(grant)}`,
      refresh_token: `renew by ${String(grant)}`,
      expires_in: 600,
    });
  });
  return held;
}

/** A lock manager that grants at once, and says what it was asked and holds.
 * It is given to the document's own navigator, which the entry reads more of. */
function lockManager(): { readonly asked: string[]; held: number } {
  const turns = { asked: [] as string[], held: 0 };
  Object.defineProperty(navigator, "locks", {
    configurable: true,
    value: {
      request: async (
        name: string,
        _options: unknown,
        granted: () => Promise<unknown>,
      ): Promise<unknown> => {
        turns.asked.push(name);
        turns.held += 1;
        try {
          return await granted();
        } finally {
          turns.held -= 1;
        }
      },
    },
  });
  return turns;
}

/** A document loaded afresh: the entry run once more, into a root of its own. */
async function entered(): Promise<void> {
  document.body.innerHTML = '<div id="root"></div>';
  vi.resetModules();
  vi.doMock("@tanstack/react-router", routeTree);
  await import("../app/browser/main.tsx");
}

/** Waits until the document draws `text`, as a person reading it would. */
async function drawn(text: string): Promise<void> {
  await vi.waitFor(() => {
    expect(document.body.textContent).toContain(text);
  });
}

test("the console's session renews under the origin's turn, and is ended when another document empties the store", async () => {
  const served = network();
  const turns = lockManager();
  localStorage.setItem(sessionRefreshTokenKey, "stored");
  await entered();
  await drawn("Routed");

  document.querySelector("button")?.click();
  await vi.waitFor(() => {
    expect(localStorage.getItem(sessionRefreshTokenKey)).toBe(
      "renew by refresh_token",
    );
  });
  expect(served.grants).toEqual(["refresh_token"]);
  expect(turns.asked).toEqual([sessionRenewalLockName]);

  localStorage.removeItem(sessionRefreshTokenKey);
  dispatchEvent(new StorageEvent("storage", { key: sessionRefreshTokenKey }));
  await drawn("Signed out");
});

test("it is ended as the document is shown again out of the back-forward cache, the store emptied meanwhile", async () => {
  network();
  localStorage.setItem(sessionRefreshTokenKey, "stored");
  await entered();
  await drawn("Routed");

  localStorage.removeItem(sessionRefreshTokenKey);
  dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }));

  await drawn("Signed out");
});

test("a document the redirect brought back presents nothing of the stored session, and is the sign-in it completes", async () => {
  const served = network();
  lockManager();
  localStorage.setItem(sessionRefreshTokenKey, "stored");
  sessionStorage.setItem(
    sessionTransactionKey,
    JSON.stringify({ state: "sent", verifier: "kept", returnPath: "/back" }),
  );
  history.replaceState(null, "", "/auth/callback?code=granted&state=sent");
  const release = served.hold();

  await entered();
  await vi.waitFor(() => {
    expect(served.grants).toEqual(["authorization_code"]);
  });
  await drawn("Loading");
  expect(document.body.textContent).not.toContain("Routed");
  release();
  await drawn("Routed");

  expect(served.grants).toEqual(["authorization_code"]);
  expect(localStorage.getItem(sessionRefreshTokenKey)).toBe(
    "renew by authorization_code",
  );
  expect(location.pathname).toBe("/back");
});

test("a renewal the network never answers is given up at its bound, the turn with it, and the session kept", async () => {
  vi.useFakeTimers();
  const served = network();
  const turns = lockManager();
  localStorage.setItem(sessionRefreshTokenKey, "stored");
  const holder = sessionHolderOpened();
  await holder.load();
  served.silent = true;
  let answered: boolean | undefined;

  void holder.refresh().then((renewed) => {
    answered = renewed;
  });
  await vi.advanceTimersByTimeAsync(fetchJsonWaitMs - 1);
  expect({ answered, held: turns.held }).toEqual({
    answered: undefined,
    held: 1,
  });
  await vi.advanceTimersByTimeAsync(1);

  expect({ answered, held: turns.held }).toEqual({ answered: false, held: 0 });
  expect(holder.snapshot().phase).toBe("SignedIn");
  expect(localStorage.getItem(sessionRefreshTokenKey)).toBe("stored");
});
