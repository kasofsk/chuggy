/**
 * The invite page drawn as the console's root mounts it, under `StrictMode`
 * and the console's cache and over the holder's doubles, against a plane a
 * case scripts: what it sent the plane of a token, the buttons it draws, and
 * the page taken down and mounted again in the same document. A summary is
 * answered apart from every other request, a tenant's link from octo-maker
 * unless a case says otherwise.
 */

import { QueryClientProvider } from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";
import { screen } from "@testing-library/react";
import { renderCopied } from "./copied.tsx";
import { StrictMode } from "react";
import type { ReactNode } from "react";
import { vi } from "vitest";

import type { ConsoleConfiguration } from "../app/core/configuration.ts";
import { consoleQueryClient } from "../app/core/consoleWrite.ts";
import type { InviteHolder } from "../app/core/inviteHolder.ts";
import type { SessionHolder, SessionPhase } from "../app/core/sessionHolder.ts";
import { InvitePage, InviteProvider } from "../app/browser/InvitePage.tsx";
import { SessionProvider } from "../app/browser/session.tsx";
import { inviteBrowser, inviteSession } from "./inviteDouble.ts";
import type { InviteBrowser } from "./inviteDouble.ts";
import { answer, scriptedFetch, settled } from "./screenHarness.tsx";
import type { SentRequest } from "./screenHarness.tsx";

const redemptionPath = "/access/v1/invite-links/redemptions";
const summaryPath = "/access/v1/invite-links/summaries";

/** What a tenant's open link is summarized as. */
export const inviteJoinSummary = {
  state: "Open",
  kind: "Tenant",
  displayName: "Acme Co",
  role: "Member",
  mintedBy: "octo-maker",
};

/** What a tenant's link answers its redemption with. */
export const inviteGranted = {
  tenant: "acme",
  role: "Member",
  projects: [{ project: "atlas", roles: ["Viewer"] }],
};

function page(
  session: SessionHolder,
  invite: InviteHolder,
  client: QueryClient,
): ReactNode {
  return (
    <StrictMode>
      <QueryClientProvider client={client}>
        <SessionProvider holder={session}>
          <InviteProvider holder={invite}>
            <InvitePage />
          </InviteProvider>
        </SessionProvider>
      </QueryClientProvider>
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
    readonly summarized?: (
      request: SentRequest,
    ) => Response | Promise<Response>;
    readonly configuration?: ConsoleConfiguration;
  } = {},
): Promise<InviteOpened> {
  const { browser, holder } = inviteBrowser(at);
  const { session, signIns } = inviteSession(phase, served.configuration);
  const answered = served.answered ?? (() => answer(inviteGranted));
  const summarized = served.summarized ?? (() => answer(inviteJoinSummary));
  const scripted = scriptedFetch((request) =>
    request.url.endsWith(summaryPath) ? summarized(request) : answered(request),
  );
  vi.stubGlobal("fetch", scripted.fetch);
  const client = consoleQueryClient();
  let view = renderCopied(page(session, holder, client));
  await settled();
  return {
    browser,
    signIns,
    sent: scripted.sent,
    remount: async () => {
      view.unmount();
      view = renderCopied(page(session, holder, client));
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

/** What the page sent the plane of a token to summarize, a body a read, in order. */
export function inviteSummariesSent(
  sent: readonly SentRequest[],
): readonly unknown[] {
  return sent
    .filter((request) => request.url.endsWith(summaryPath))
    .map((request) => request.body);
}

export function inviteButtonsDrawn(): readonly (string | null)[] {
  return screen.queryAllByRole("button").map((button) => button.textContent);
}
