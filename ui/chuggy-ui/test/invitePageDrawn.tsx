/**
 * The invite page drawn as the console's root mounts it, under `StrictMode`
 * and over the holder's doubles, against a plane a case scripts: what it sent
 * the plane of a token, the buttons it draws, and the page taken down and
 * mounted again in the same document.
 */

import { render, screen } from "@testing-library/react";
import { StrictMode } from "react";
import type { ReactNode } from "react";
import { vi } from "vitest";

import type { ConsoleConfiguration } from "../app/core/configuration.ts";
import type { InviteHolder } from "../app/core/inviteHolder.ts";
import type { SessionHolder, SessionPhase } from "../app/core/sessionHolder.ts";
import { InvitePage, InviteProvider } from "../app/browser/InvitePage.tsx";
import { SessionProvider } from "../app/browser/session.tsx";
import { inviteBrowser, inviteSession } from "./inviteDouble.ts";
import type { InviteBrowser } from "./inviteDouble.ts";
import { answer, scriptedFetch, settled } from "./screenHarness.tsx";
import type { SentRequest } from "./screenHarness.tsx";

const redemptionPath = "/access/v1/invite-links/redemptions";

/** What a tenant's link answers its redemption with. */
export const inviteGranted = {
  tenant: "acme",
  role: "Member",
  projects: [{ project: "atlas", roles: ["Viewer"] }],
};

function page(session: SessionHolder, invite: InviteHolder): ReactNode {
  return (
    <StrictMode>
      <SessionProvider holder={session}>
        <InviteProvider holder={invite}>
          <InvitePage />
        </InviteProvider>
      </SessionProvider>
    </StrictMode>
  );
}

export interface InviteOpened {
  readonly browser: InviteBrowser;
  readonly signIns: readonly (string | undefined)[];
  readonly sent: readonly SentRequest[];
  /** The page taken down and mounted again in the same document. */
  readonly remount: () => Promise<void>;
}

/** The page opened under `StrictMode`, as the console's root mounts it. */
export async function inviteOpened(
  phase: SessionPhase,
  at: Parameters<typeof inviteBrowser>[0],
  served: {
    readonly answered?: (request: SentRequest) => Response | Promise<Response>;
    readonly configuration?: ConsoleConfiguration;
  } = {},
): Promise<InviteOpened> {
  const { browser, holder } = inviteBrowser(at);
  const { session, signIns } = inviteSession(phase, served.configuration);
  const scripted = scriptedFetch(
    served.answered ?? (() => answer(inviteGranted)),
  );
  vi.stubGlobal("fetch", scripted.fetch);
  let view = render(page(session, holder));
  await settled();
  return {
    browser,
    signIns,
    sent: scripted.sent,
    remount: async () => {
      view.unmount();
      view = render(page(session, holder));
      await settled();
    },
  };
}

/** What the page sent the plane of a token, a body a send, in order. */
export function inviteRedemptionsSent(
  sent: readonly SentRequest[],
): readonly unknown[] {
  return sent
    .filter((request) => request.url.endsWith(redemptionPath))
    .map((request) => request.body);
}

export function inviteButtonsDrawn(): readonly (string | null)[] {
  return screen.queryAllByRole("button").map((button) => button.textContent);
}
