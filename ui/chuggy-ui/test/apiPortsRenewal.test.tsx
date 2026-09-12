/**
 * What the console does when the API refuses a session it still believes in.
 *
 * THE SCREEN WITH NO WAY OUT IS WHAT THIS PREVENTS. `Sign out` sits on the bar,
 * the landing page does not draw the bar, and the router draws the landing page
 * only once the holder says `SignedIn` — so a session the API refuses and the
 * holder keeps is a console whose every read fails and whose only remedy is the
 * browser's own storage. The renewal port is what closes that, and these cases
 * drive a real holder rather than a double, because the snapshot the reader is
 * drawn from is exactly what forgetting the session in the wrong order loses.
 */

import { renderHook } from "@testing-library/react";
import { expect, test } from "vitest";
import type { ReactNode } from "react";

import { useApiPorts } from "../app/browser/api.ts";
import { SessionProvider } from "../app/browser/session.tsx";
import {
  createSessionHolder,
  sessionRefreshTokenKey,
} from "../app/core/sessionHolder.ts";
import type { SessionHolder } from "../app/core/sessionHolder.ts";
import { sessionHarness } from "./sessionHolderHarness.ts";
import type { SessionHarness } from "./sessionHolderHarness.ts";

/** A holder signed in from a stored token, whose issuer renews or does not. */
async function signedIn(renews: boolean): Promise<SessionHolder> {
  const held: SessionHarness = sessionHarness();
  held.persistent.held.set(sessionRefreshTokenKey, "renew");
  const holder = createSessionHolder(held.ports);
  await holder.load();
  if (!renews)
    held.answer = () => {
      throw new Error("the issuer would not renew this session");
    };
  return holder;
}

function portsOf(holder: SessionHolder) {
  const wrapper = (props: { readonly children: ReactNode }): ReactNode => (
    <SessionProvider holder={holder}>{props.children}</SessionProvider>
  );
  return renderHook(() => useApiPorts(), { wrapper }).result.current;
}

test("a token the issuer replaces renews, and the session is left standing", async () => {
  const holder = await signedIn(true);

  expect(await portsOf(holder).renew?.()).toBe(true);
  expect(holder.snapshot().phase).toBe("SignedIn");
  expect(holder.snapshot().reason).toBeUndefined();
});

test("a session the issuer will not renew is signed out and said to be", async () => {
  const holder = await signedIn(false);

  expect(await portsOf(holder).renew?.()).toBe(false);
  expect(holder.snapshot().phase).toBe("SignedOut");
  expect(holder.snapshot().reason).toContain("refused");
});

/** A token the issuer mints happily and the API rejects anyway — an audience or
 * a key set changed under a stored session — is the other way out of itself. */
test("a fresh token the API refuses too ends the session", async () => {
  const holder = await signedIn(true);

  await portsOf(holder).refused?.();

  expect(holder.snapshot().phase).toBe("SignedOut");
  expect(holder.snapshot().reason).toContain("refused");
});
