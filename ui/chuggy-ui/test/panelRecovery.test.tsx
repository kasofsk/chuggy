/**
 * A read no frame names, as a panel draws it once it has failed: read again
 * when the tab comes back into view, when the network comes back, and when
 * Retry is pressed, and drawn as it was with `Not updated` where a read failed
 * behind an answer.
 *
 * The cache is the console's own defaults, with no retry: what is asserted is
 * what reads a failed read again, and a retry would be a read nobody asked for.
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, expect, test } from "vitest";

import { usePanelCallerResource } from "../app/browser/api.ts";
import { DataPanel } from "../app/browser/DataPanel.tsx";
import { SessionProvider } from "../app/browser/session.tsx";
import type { ApiResult } from "../app/core/apiRequest.ts";
import { panelQueryDefaults } from "../app/core/panelQueryDefaults.ts";
import { holderDouble, settled, turned } from "./screenHarness.tsx";

afterEach(cleanup);

const fault = {
  outcome: "Fault",
  code: "InternalError",
  status: 500,
} as const;

interface Probe {
  failing: boolean;
  reads: number;
  answered: string;
}

function Probed(props: {
  readonly read: () => Promise<ApiResult<string>>;
}): ReactNode {
  const state = usePanelCallerResource<string>("probe", props.read);
  return (
    <DataPanel title="Probe" state={state}>
      {(value) => <p>{value}</p>}
    </DataPanel>
  );
}

async function drawProbe(probe: Probe): Promise<QueryClient> {
  const client = new QueryClient({
    defaultOptions: { queries: { ...panelQueryDefaults, retry: false } },
  });
  render(
    <SessionProvider holder={holderDouble()}>
      <QueryClientProvider client={client}>
        <Probed
          read={() => {
            probe.reads += 1;
            const result: ApiResult<string> = probe.failing
              ? fault
              : { outcome: "Ok", value: probe.answered };
            return Promise.resolve(result);
          }}
        />
      </QueryClientProvider>
    </SessionProvider>,
  );
  await settled();
  return client;
}

/** A read that has never answered, failed and drawn as that. */
async function drawnFailed(): Promise<Probe> {
  const probe: Probe = { failing: true, reads: 0, answered: "answered" };
  await drawProbe(probe);
  expect(screen.getByText(/^Failed to load · /u)).toBeDefined();
  probe.failing = false;
  return probe;
}

async function windowSays(...events: readonly string[]): Promise<void> {
  await turned(() => {
    for (const event of events) window.dispatchEvent(new Event(event));
  });
  await settled();
}

test("a failed read is read again when the tab comes back into view", async () => {
  const probe = await drawnFailed();
  const before = probe.reads;
  await windowSays("visibilitychange");
  expect(probe.reads).toBeGreaterThan(before);
  expect(screen.getByText("answered")).toBeDefined();
});

test("a failed read is read again when the network comes back", async () => {
  const probe = await drawnFailed();
  const before = probe.reads;
  await windowSays("offline", "online");
  expect(probe.reads).toBeGreaterThan(before);
  expect(screen.getByText("answered")).toBeDefined();
});

test("a failed read is read again when Retry is pressed", async () => {
  const probe = await drawnFailed();
  const before = probe.reads;
  await turned(() => {
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  });
  await settled();
  expect(probe.reads).toBe(before + 1);
  expect(screen.getByText("answered")).toBeDefined();
  expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
});

test("a read that answered is not read again when the tab comes back into view", async () => {
  const probe: Probe = { failing: false, reads: 0, answered: "answered" };
  await drawProbe(probe);
  const before = probe.reads;
  await windowSays("visibilitychange");
  expect(probe.reads).toBe(before);
});

test("a read that fails behind an answer keeps it drawn, says Not updated, and Retry reads it again", async () => {
  const probe: Probe = { failing: false, reads: 0, answered: "first" };
  const client = await drawProbe(probe);
  probe.failing = true;
  await turned(() => void client.invalidateQueries());
  await settled();
  expect(screen.getByText("first")).toBeDefined();
  expect(screen.getByText("Not updated")).toBeDefined();
  expect(screen.queryByText(/^Failed to load · /u)).toBeNull();
  probe.failing = false;
  probe.answered = "second";
  await turned(() => {
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  });
  await settled();
  expect(screen.getByText("second")).toBeDefined();
  expect(screen.queryByText("Not updated")).toBeNull();
});
