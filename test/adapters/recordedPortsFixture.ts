/**
 * Every port of the native app as a deployment composes it, each recording that
 * it was reached and failing the call, for a suite whose answer under test is
 * the authentication hook's: a refusal it sent is told apart from a `404` some
 * port answered.
 */

import type { createNativeHttpApp } from "../../src/adapters/http/server.ts";

/** What the app takes after its web and its authentication. */
type NativeHttpPorts =
  Parameters<typeof createNativeHttpApp> extends [
    unknown,
    unknown,
    ...infer Rest,
  ]
    ? Rest
    : never;

/** A port no case writes, recording each call as `port.method` and failing it. */
export function recordedPort(reached: string[], port: string): never {
  return new Proxy(
    {},
    {
      get: (_target, method) => () => {
        reached.push(`${port}.${String(method)}`);
        return Promise.reject(new Error(`${port} is not served here`));
      },
    },
  ) as never;
}

/** Every port after the authentication, recorded into `reached`, the member chat being `chat`. */
export function recordedPorts(
  reached: string[],
  chat: unknown = recordedPort(reached, "chat"),
): NativeHttpPorts {
  const port = (name: string) => recordedPort(reached, name);
  return [
    port("readiness"),
    port("installation"),
    undefined,
    port("events"),
    port("selectorSettings"),
    port("forgeCredentials"),
    port("onboarding"),
    port("creation"),
    port("placement"),
    port("sessionPlacement"),
    port("threadLive"),
    port("actionReports"),
    port("actionReach"),
    port("landings"),
    port("personalRunners"),
    port("ownerFallback"),
    port("threadLimits"),
    chat as never,
    port("inbox"),
    port("agentAccounts"),
    undefined,
    port("landingQueues"),
    { projects: port("projectDeletion"), tenants: port("tenantDeletion") },
    port("takes"),
    port("proposalMerges"),
    port("accessTokens"),
  ];
}
