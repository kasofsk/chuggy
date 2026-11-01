/**
 * The line of the screen that is not drawing: what the ticket rows read when
 * the cache asks for a first page, a next page, or the pages again, and which
 * of those it asks again on its own when one fails.
 *
 * It is the query's own page read run by the cache's infinite query, and
 * replacing either half silently undoes a fix the rows depend on, so it is
 * driven here against a real query cache and a recording transport rather
 * than a renderer.
 */

import {
  InfiniteQueryObserver,
  QueryClient,
  focusManager,
} from "@tanstack/react-query";
import { expect, test } from "vitest";

import { panelPagesOptions } from "../app/browser/api.ts";

import type { ApiPorts } from "../app/core/apiRequest.ts";
import { ticketListAskDefault } from "../app/core/projectTableFilters.ts";
import { projectTicketPagesMax } from "../app/core/projectTicketPages.ts";
import {
  panelQueryDefaults,
  panelQueryRetriesMax,
} from "../app/core/panelQueryDefaults.ts";
import { ticketRowsQuery } from "../app/core/ticketQueries.ts";
import { ticketInstants } from "./ticketInstants.ts";

const partition = { tenant: "acme", project: "atlas" };

/** How a case answers one project read: a body, or a status it fails with. */
type Served = Readonly<Record<string, unknown>> | number;

/** Every project read recorded, each answered by `served` from what it asked. */
function recording(served: (asked: URLSearchParams, at: number) => Served): {
  readonly ports: ApiPorts;
  readonly asked: URLSearchParams[];
} {
  const asked: URLSearchParams[] = [];
  return {
    asked,
    ports: {
      fetch: (url) => {
        const params = new URL(url, "http://stub").searchParams;
        asked.push(params);
        const body = served(params, asked.length);
        return Promise.resolve({
          status: typeof body === "number" ? body : 200,
          headers: { get: () => null },
          text: () =>
            Promise.resolve(
              JSON.stringify(
                typeof body === "number"
                  ? { error: "InternalError", message: "the read failed" }
                  : { partition, sequence: 1, ...body },
              ),
            ),
        } as unknown as Response);
      },
      bearer: () => Promise.resolve("token"),
      sleepMs: () => Promise.resolve(),
    },
  };
}

function pending(ticket: number): unknown {
  return { ticket, phase: "Pending", sequence: 1, ...ticketInstants };
}

/** An active read that always has another page, one ticket a page. */
function endless(_asked: URLSearchParams, at: number): Served {
  return { tickets: [pending(at)], nextCursor: `after-${String(at)}` };
}

/** The unfiltered rows' infinite query over `ports` on the console's defaults,
 * as the bridge builds it, or as it would for a list whose reread behind held
 * pages is asked again. */
function observed(ports: ApiPorts, rereadHeldAgain = false) {
  const client = new QueryClient({
    defaultOptions: { queries: { ...panelQueryDefaults, retryDelay: 0 } },
  });
  const options = panelPagesOptions(ports, client, {
    ...ticketRowsQuery(partition, ticketListAskDefault),
    rereadHeldAgain,
  });
  return {
    client,
    observer: new InfiniteQueryObserver(client, options),
    pages: () => client.getQueryData(options.queryKey)?.pages.length,
  };
}

test("a first read of an entry nothing has written asks for one page", async () => {
  const held = recording(endless);
  const read = observed(held.ports);
  await read.observer.refetch();
  expect(held.asked.length).toBe(1);
  expect(read.pages()).toBe(1);
});

test("a reread reads every page the entry holds and no more, however many the wire offers", async () => {
  const held = recording(endless);
  const read = observed(held.ports);
  await read.observer.refetch();
  await read.observer.fetchNextPage();
  await read.observer.fetchNextPage();
  expect(held.asked.map((asked) => asked.get("cursor"))).toStrictEqual([
    null,
    "after-1",
    "after-2",
  ]);
  await read.observer.refetch();
  expect(held.asked.slice(3).map((asked) => asked.get("cursor"))).toStrictEqual(
    [null, "after-4", "after-5"],
  );
  expect(read.pages()).toBe(3);
});

test("a reread that fails partway keeps every page the entry held", async () => {
  let failing = false;
  const held = recording((asked, at) =>
    failing && asked.has("cursor") ? 500 : endless(asked, at),
  );
  const read = observed(held.ports);
  await read.observer.refetch();
  await read.observer.fetchNextPage();
  const before = read.client.getQueryData(read.observer.options.queryKey);
  failing = true;
  const answered = await read.observer.refetch();
  expect(answered.isRefetchError).toBe(true);
  expect(read.client.getQueryData(read.observer.options.queryKey)).toBe(before);
});

test("a reread stops early where the wire says no page follows", async () => {
  let ended = false;
  const held = recording((asked, at) =>
    ended ? { tickets: [pending(at)] } : endless(asked, at),
  );
  const read = observed(held.ports);
  await read.observer.refetch();
  await read.observer.fetchNextPage();
  await read.observer.fetchNextPage();
  ended = true;
  const before = held.asked.length;
  await read.observer.refetch();
  expect(held.asked.length - before).toBe(2);
});

test("no page is offered past the page budget, however many the wire offers", async () => {
  const held = recording(endless);
  const read = observed(held.ports);
  await read.observer.refetch();
  for (let page = 1; page < projectTicketPagesMax; page += 1)
    await read.observer.fetchNextPage();
  expect(read.pages()).toBe(projectTicketPagesMax);
  expect(read.observer.getCurrentResult().hasNextPage).toBe(false);
});

/** The active list is empty, and what finished behind it is two pages. */
function emptyActive(asked: URLSearchParams): Served {
  if (asked.get("active") === "true") return { tickets: [] };
  return asked.get("cursor") === "finished-1"
    ? { tickets: [pending(1)] }
    : { tickets: [pending(2)], nextCursor: "finished-1" };
}

test("a refetch over an empty active page reads the pages the reader had, however often it runs", async () => {
  const held = recording(emptyActive);
  const read = observed(held.ports);
  await read.observer.refetch();
  await read.observer.fetchNextPage();
  expect(read.pages()).toBe(2);
  await read.observer.refetch();
  await read.observer.refetch();
  expect(read.pages()).toBe(2);
  expect(read.observer.getCurrentResult().data?.tickets).toStrictEqual([
    pending(2),
  ]);
  expect(
    held.asked.map((asked) =>
      asked.get("active") === "true" ? "active" : asked.get("cursor"),
    ),
  ).toStrictEqual([
    "active",
    null,
    null,
    "active",
    null,
    null,
    "active",
    null,
    null,
  ]);
});

/** The tab leaving view and coming back, and whatever read that began over. */
async function focused(read: ReturnType<typeof observed>): Promise<void> {
  read.client.mount();
  focusManager.setFocused(false);
  focusManager.setFocused(true);
  focusManager.setFocused(undefined);
  await new Promise((resolve) => setTimeout(resolve, 0));
  await read.client
    .getQueryCache()
    .find({ queryKey: read.observer.options.queryKey })
    ?.promise?.catch(() => undefined);
  read.client.unmount();
}

test("a first read that fails is asked again up to the bound, and read again on focus", async () => {
  const held = recording(() => 500);
  const read = observed(held.ports);
  const unsubscribe = read.observer.subscribe(() => undefined);
  await read.observer.refetch();
  expect(held.asked.length).toBe(panelQueryRetriesMax + 1);
  await focused(read);
  expect(held.asked.length).toBe(2 * (panelQueryRetriesMax + 1));
  unsubscribe();
});

/** One page answered, and every read after it failing. */
async function failingAfterOne(rereadHeldAgain: boolean) {
  let failing = false;
  const held = recording((asked, at) => (failing ? 500 : endless(asked, at)));
  const read = observed(held.ports, rereadHeldAgain);
  const unsubscribe = read.observer.subscribe(() => undefined);
  await read.observer.refetch();
  failing = true;
  const asked = (): number => held.asked.length - 1;
  return { read, asked, focused: () => focused(read), unsubscribe };
}

test("a failed press is asked once, is not read again on focus, and can be pressed again", async () => {
  for (const rereadHeldAgain of [false, true]) {
    const held = await failingAfterOne(rereadHeldAgain);
    const pressed = await held.read.observer.fetchNextPage();
    expect(pressed.isFetchNextPageError).toBe(true);
    expect(held.asked()).toBe(1);
    await held.focused();
    expect(held.asked()).toBe(1);
    await held.read.observer.fetchNextPage();
    expect(held.asked()).toBe(2);
    expect(held.read.pages()).toBe(1);
    held.unsubscribe();
  }
});

test("a ticket list's reread behind held pages is asked once and not read again on focus", async () => {
  const held = await failingAfterOne(false);
  const answered = await held.read.observer.refetch();
  expect(answered.isRefetchError).toBe(true);
  expect(held.asked()).toBe(1);
  await held.focused();
  expect(held.asked()).toBe(1);
  held.unsubscribe();
});

test("a list whose reread behind held pages is asked again retries it and reads it again on focus", async () => {
  const held = await failingAfterOne(true);
  await held.read.observer.refetch();
  expect(held.asked()).toBe(panelQueryRetriesMax + 1);
  await held.focused();
  expect(held.asked()).toBe(2 * (panelQueryRetriesMax + 1));
  held.unsubscribe();
});
