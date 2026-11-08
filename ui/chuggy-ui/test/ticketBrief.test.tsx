/**
 * The brief's images: drawn only where the brief holds any, each from the
 * project's own read of it.
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import {
  ticketResponseSchema,
  type TicketResponse,
} from "../../../src/contract/responses.ts";
import { TicketBriefImages } from "../app/browser/TicketProvenance.tsx";
import { SessionProvider } from "../app/browser/session.tsx";
import { answer, holderDouble } from "./screenHarness.tsx";
import { renderCopied as drawn } from "./copied.tsx";
import { ticketInstants } from "./ticketInstants.ts";

/** The runner has no globals, so the tree one case rendered is torn down here
 * rather than by the library's own hook. */
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** The brief says who filed it by the address the project's people read
 * names, so every case draws it under a session; a server that knows nobody
 * leaves it the principal. A case that reads more stubs its own. */
beforeEach(() => {
  vi.stubGlobal("fetch", () =>
    Promise.resolve(answer({ error: "NotFound" }, 404)),
  );
});

function render(node: ReactNode): ReturnType<typeof drawn> {
  return drawn(
    <SessionProvider holder={holderDouble()}>
      <QueryClientProvider
        client={
          new QueryClient({ defaultOptions: { queries: { retry: false } } })
        }
      >
        {node}
      </QueryClientProvider>
    </SessionProvider>,
  );
}

const briefPartition = { tenant: "acme", project: "atlas" };

/** The brief ticket 7's own read answers, as it was released. */
function released(brief?: TicketResponse["brief"]): TicketResponse["brief"] {
  return ticketResponseSchema.parse({
    ticket: 7,
    phase: "Pending",
    sequence: 1,
    ...ticketInstants,
    configurationRevision: "r1",
    ...(brief === undefined ? {} : { brief }),
  }).brief;
}

/** Each image is read through the project's own authenticated read and drawn
 * from a `data:` URI of what it answered, the only image source the console's
 * document admits. */
test("a brief's images are drawn as images, from the project's read of each", async () => {
  const read: string[] = [];
  vi.stubGlobal("fetch", (url: string) => {
    read.push(url);
    return Promise.resolve(
      answer({ content: "AQID", mediaType: "image/png", encoding: "base64" }),
    );
  });
  render(
    <SessionProvider holder={holderDouble()}>
      <QueryClientProvider
        client={
          new QueryClient({ defaultOptions: { queries: { retry: false } } })
        }
      >
        <TicketBriefImages
          partition={briefPartition}
          brief={released({
            intent: "an intent",
            links: [],
            images: ["artifact-1", "artifact-2"],
          })}
        />
      </QueryClientProvider>
    </SessionProvider>,
  );
  await waitFor(() => {
    expect(screen.getAllByRole("img")).toHaveLength(2);
  });
  expect(
    screen.getAllByRole("img").map((image) => image.getAttribute("src")),
  ).toStrictEqual(["data:image/png;base64,AQID", "data:image/png;base64,AQID"]);
  expect(
    read
      .map((url) => url.split("/").at(-1))
      .filter((last) => last?.startsWith("artifact")),
  ).toStrictEqual(["artifact-1", "artifact-2"]);
});

test("a ticket with no brief, or a brief with no images, draws nothing", () => {
  const { container } = render(
    <TicketBriefImages partition={briefPartition} brief={released()} />,
  );
  expect(container.textContent).toBe("");
  cleanup();
  const none = render(
    <TicketBriefImages
      partition={briefPartition}
      brief={released({ intent: "an intent", links: [] })}
    />,
  );
  expect(none.container.querySelector("img, ul")).toBeNull();
});
