/**
 * What the console does when the API refuses a session it still believes in.
 *
 * THE SCREEN WITH NO WAY OUT IS WHAT THIS PREVENTS. `Sign out` sits on the bar,
 * the landing page does not draw the bar, and the router draws the landing page
 * only once the holder says `SignedIn` — so a session the API refuses and the
 * holder keeps is a console whose every read fails and whose only remedy is the
 * browser's own storage. The renewal port is what closes that, and these cases
 * are the two ends of it: a token the issuer replaces, and one it will not.
 */

import { renderHook } from "@testing-library/react";
import { expect, test } from "vitest";
import type { ReactNode } from "react";

import { useApiPorts } from "../app/browser/api.ts";
import { SessionProvider } from "../app/browser/session.tsx";
import type { SessionHolder } from "../app/core/sessionHolder.ts";

function holderDouble(refreshes: boolean): {
  readonly holder: SessionHolder;
  readonly signedOut: () => number;
  readonly reasons: readonly string[];
} {
  let signedOut = 0;
  const reasons: string[] = [];
  return {
    signedOut: () => signedOut,
    reasons,
    holder: {
      load: () => Promise.resolve(),
      completeCallback: () => Promise.resolve({ result: "None" as const }),
      signIn: () => Promise.resolve(),
      signOut: () => {
        signedOut += 1;
        return Promise.resolve();
      },
      bearer: () => Promise.resolve("token"),
      refresh: () => Promise.resolve(refreshes),
      refuse: (reason: string) => reasons.push(reason),
      refreshDueAtMs: () => undefined,
      generation: () => 1,
      snapshot: () => ({
        phase: "SignedIn" as const,
        reason: undefined,
        configuration: undefined,
      }),
      subscribe: () => () => undefined,
    },
  };
}

function portsOf(held: { readonly holder: SessionHolder }) {
  const wrapper = (props: { readonly children: ReactNode }): ReactNode => (
    <SessionProvider holder={held.holder}>{props.children}</SessionProvider>
  );
  return renderHook(() => useApiPorts(), { wrapper }).result.current;
}

test("a token the issuer replaces renews, and the session is left standing", async () => {
  const held = holderDouble(true);

  expect(await portsOf(held).renew?.()).toBe(true);
  expect(held.signedOut()).toBe(0);
  expect(held.reasons).toHaveLength(0);
});

test("a session the issuer will not renew is signed out and said to be", async () => {
  const held = holderDouble(false);

  expect(await portsOf(held).renew?.()).toBe(false);
  expect(held.signedOut()).toBe(1);
  expect(held.reasons).toHaveLength(1);
  expect(held.reasons[0]).toContain("refused");
});
