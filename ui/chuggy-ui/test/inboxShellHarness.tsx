/** The shell mounted over an inbox screen's doubles, so a case reads the bar's badge and the list as one value. */

import { QueryClient } from "@tanstack/react-query";
import { vi } from "vitest";

import type { PartitionIdentity } from "../../../src/contract/http.ts";
import { Shell } from "../app/browser/Shell.tsx";
import { renderCopied } from "./copied.tsx";
import {
  apiDouble,
  openedStream,
  operationAt,
  ScreenHarness,
} from "./screenHarness.tsx";
import { viewportAtEm, viewportDeskEm } from "./viewport.ts";

export function inboxShellMounted(
  partition: PartitionIdentity,
  route: (url: string) => Response,
): {
  readonly api: ReturnType<typeof apiDouble>;
  readonly server: ReturnType<typeof openedStream>;
} {
  const api = apiDouble({ operation: operationAt("Pending"), route });
  viewportAtEm(viewportDeskEm);
  vi.stubGlobal("fetch", api.fetch);
  const server = openedStream();
  renderCopied(
    <ScreenHarness
      partition={partition}
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
      transport={server.ports.fetch}
    >
      <Shell partition={partition} />
    </ScreenHarness>,
  );
  return { api, server };
}
