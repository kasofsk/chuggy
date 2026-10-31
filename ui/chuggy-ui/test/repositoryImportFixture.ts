/**
 * A project's repository listing in which bindings' newest imports were
 * refused, for the screens that draw a notice of it.
 */

import { answer } from "./screenHarness.tsx";

/** A refused import of one declaration file, as the listing answers it. */
export const repositoryImportRefused = {
  attemptedAt: "2026-10-17T09:30:00.000000Z",
  commit: "cfaca0a0f14ec03845a4e01458ac6c3a56d52a23",
  outcome: {
    result: "DeclarationsRefused",
    refusals: [
      {
        path: ".chug/configurations/basic-coding.json",
        fault: "EnvelopeInvalid",
      },
    ],
    refusalCount: 1,
  },
};

/** One binding of `repository`, retired where `retiredAt` is given, its newest import refused. */
export function repositoryImportRefusedBinding(
  repository: string,
  retiredAt?: string,
): unknown {
  return {
    repository,
    boundAt: "2026-09-11T00:00:00Z",
    landing: { mode: "Push" },
    pipelinesWritable: false,
    configured: true,
    lastImport: repositoryImportRefused,
    ...(retiredAt === undefined ? {} : { retiredAt }),
  };
}

/** `served`, answering the repository listing with `repositories` and anything else as it does. */
export function repositoryImportListed(
  repositories: readonly unknown[],
  served: (url: string) => Response,
): (url: string) => Response {
  return (url) =>
    url.endsWith("/repositories") ? answer({ repositories }) : served(url);
}

/** What lays the repository listing over a case's own `fetch`. */
export function repositoryImportListedOver(
  repositories: readonly unknown[],
): (served: typeof fetch) => typeof fetch {
  return (served) =>
    ((url: string, init?: RequestInit) =>
      url.endsWith("/repositories")
        ? Promise.resolve(answer({ repositories }))
        : served(url, init)) as typeof fetch;
}
