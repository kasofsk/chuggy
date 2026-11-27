/**
 * The console's root as `main.tsx` mounts it, under a real session holder
 * over the harness' ports and the store made over that holder, signed in by
 * the refresh token the harness stores, against an API a case scripts: what
 * it sent under `/agreements/v1`, and the holder a case renews or reads.
 *
 * The configuration is the harness' with a case's own keys over it, and the
 * router is whatever the case's own mock of it draws.
 */

import { QueryClient } from "@tanstack/react-query";
import { act } from "@testing-library/react";
import { Provider } from "react-redux";
import { vi } from "vitest";

import { App } from "../app/browser/App.tsx";
import { apiFetch, sleepMs } from "../app/browser/ports.ts";
import { SessionProvider, sessionBegin } from "../app/browser/session.tsx";
import { consoleStore } from "../app/browser/store.ts";
import { apiPortsOver } from "../app/core/apiPorts.ts";
import {
  createSessionHolder,
  sessionRefreshTokenKey,
} from "../app/core/sessionHolder.ts";
import type { SessionHolder } from "../app/core/sessionHolder.ts";
import { renderCopied } from "./copied.tsx";
import { scriptedFetch, settled } from "./screenHarness.tsx";
import type { SentRequest } from "./screenHarness.tsx";
import {
  sessionHarness,
  sessionHarnessConfiguration,
} from "./sessionHolderHarness.ts";
import type { SessionHarness } from "./sessionHolderHarness.ts";

export const agreementStandingPath = "/agreements/v1/standing";
export const agreementSendPath = "/agreements/v1/agreements";

export interface AgreementMounted {
  readonly holder: SessionHolder;
  readonly harness: SessionHarness;
  readonly sent: readonly SentRequest[];
}

/** The root mounted and its session begun, configured with `configuration`
 * over the harness' own. */
export async function agreementMounted(
  answered: (request: SentRequest) => Response | Promise<Response>,
  configuration: Readonly<Record<string, unknown>> = { agreements: true },
): Promise<AgreementMounted> {
  const harness = sessionHarness();
  const sessionAnswer = harness.answer;
  harness.answer = (request) =>
    request === "/config.json"
      ? { ...sessionHarnessConfiguration, ...configuration }
      : sessionAnswer(request);
  harness.persistent.held.set(sessionRefreshTokenKey, "renew");
  const holder = createSessionHolder(harness.ports);
  const scripted = scriptedFetch(answered);
  vi.stubGlobal("fetch", scripted.fetch);
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const store = consoleStore({
    ports: apiPortsOver(holder, apiFetch, sleepMs),
    client,
  });
  renderCopied(
    <SessionProvider holder={holder}>
      <Provider store={store}>
        <App queryClient={client} />
      </Provider>
    </SessionProvider>,
  );
  await act(() => sessionBegin(holder));
  await settled();
  return { holder, harness, sent: scripted.sent };
}

/** Every request sent under `/agreements/v1`, as its method and path. */
export function agreementRequests(
  sent: readonly SentRequest[],
): readonly string[] {
  return sent
    .filter((request) => request.url.startsWith("/agreements/v1"))
    .map((request) => `${request.method} ${request.url}`);
}
