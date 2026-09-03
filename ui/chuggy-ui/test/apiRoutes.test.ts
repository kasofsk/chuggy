/**
 * The routes, checked on the two things a caller cannot see going wrong: the
 * path a function asks for and where a paged read stops.
 *
 * A path is built from the contract's own `partitionPath`, so what is asserted
 * here is the segment and the query this console puts after it.
 */

import { expect, test } from "vitest";

import { nativeHttpBasePath } from "../../../src/contract/http.ts";
import {
  apiAgenticRefusals,
  apiConfiguration,
  apiDispatchView,
  apiExecutions,
  apiLead,
  apiLeadTranscript,
  apiNativeActions,
  apiProject,
  apiProjectInventory,
  apiProjectInventoryAll,
  apiSelectorHistory,
  apiSelectorSettings,
  apiSelectorSettingsHistory,
  apiTicket,
  apiTicketNativeActions,
  apiWriteSelectorSettings,
  projectInventoryPagesMax,
} from "../app/core/apiRoutes.ts";
import type { ApiPorts } from "../app/core/apiRequest.ts";
import { ticketInstants } from "./ticketInstants.ts";

const partition = { tenant: "acme", project: "at las" };

function recording(bodyFor: (url: string) => unknown): {
  readonly ports: ApiPorts;
  readonly urls: string[];
} {
  const urls: string[] = [];
  return {
    urls,
    ports: {
      fetch: (url) => {
        urls.push(url);
        return Promise.resolve({
          status: 200,
          headers: { get: () => null },
          text: () => Promise.resolve(JSON.stringify(bodyFor(url))),
        } as unknown as Response);
      },
      bearer: () => Promise.resolve("token"),
      sleepMs: () => Promise.resolve(),
    },
  };
}

const projectBody = {
  partition: { tenant: "acme", project: "at las" },
  sequence: 1,
  tickets: [],
};

test("a partition segment is encoded rather than pasted into the path", async () => {
  const held = recording(() => projectBody);
  await apiProject(held.ports, partition);
  expect(held.urls[0]).toBe(
    `${nativeHttpBasePath}/tenants/acme/projects/at%20las`,
  );
});

test("a project read carries the page and the fence it was asked for", async () => {
  const held = recording(() => projectBody);
  await apiProject(held.ports, partition, {
    after: 6,
    limit: 1,
    minimumSequence: 91,
  });
  expect(held.urls[0]).toBe(
    `${nativeHttpBasePath}/tenants/acme/projects/at%20las?after=6&limit=1&minimumSequence=91`,
  );
});

test("a project read omits the page fields it was not asked for", async () => {
  const held = recording(() => projectBody);
  await apiProject(held.ports, partition, { minimumSequence: 91 });
  expect(held.urls[0]).toBe(
    `${nativeHttpBasePath}/tenants/acme/projects/at%20las?minimumSequence=91`,
  );
});

test("each resource hangs from its partition under its own segment", async () => {
  const held = recording(() => ({
    ticket: 1,
    phase: "Working",
    sequence: 1,
    ...ticketInstants,
  }));
  await apiTicket(held.ports, partition, 12);
  expect(held.urls[0]).toBe(
    `${nativeHttpBasePath}/tenants/acme/projects/at%20las/tickets/12`,
  );
});

test("a dispatch read can address one ticket-sized candidate page", async () => {
  const held = recording(() => ({ result: "Reset" }));
  await apiDispatchView(held.ports, partition, { after: 11, limit: 1 });
  expect(held.urls[0]).toBe(
    `${nativeHttpBasePath}/tenants/acme/projects/at%20las/dispatch-view?after=11&limit=1`,
  );
});

test("a revision that looks like a path is one segment, not several", async () => {
  const held = recording(() => ({
    partition: { tenant: "acme", project: "at las" },
    revision: "repository:commit:work",
    canonical: "{}",
    digest: "a".repeat(64),
  }));
  await apiConfiguration(held.ports, partition, "repository:commit:work");
  expect(held.urls[0]).toBe(
    `${nativeHttpBasePath}/tenants/acme/projects/at%20las/configurations/repository%3Acommit%3Awork`,
  );
});

test("only the page fields a caller gave become query parameters", async () => {
  const held = recording(() => ({ executions: [] }));
  await apiExecutions(held.ports, partition, { ticket: 4 });
  expect(held.urls[0]).toBe(
    `${nativeHttpBasePath}/tenants/acme/projects/at%20las/executions?ticket=4`,
  );
});

test("a filter names every phase it selects, not only the last of them", async () => {
  const held = recording(() => projectBody);
  await apiProject(held.ports, partition, {
    order: "RecentActivity",
    limit: 100,
    phase: ["HandoffBlocked", "Escalated"],
  });
  expect(held.urls[0]).toBe(
    `${nativeHttpBasePath}/tenants/acme/projects/at%20las` +
      `?limit=100&order=RecentActivity&phase=HandoffBlocked&phase=Escalated`,
  );
});

test("an unfiltered page names no phase", async () => {
  const held = recording(() => projectBody);
  await apiProject(held.ports, partition, { order: "RecentActivity" });
  expect(held.urls[0]).toBe(
    `${nativeHttpBasePath}/tenants/acme/projects/at%20las?order=RecentActivity`,
  );
});

test("an executions page asks for the size it wants", async () => {
  const held = recording(() => ({ executions: [] }));
  await apiExecutions(held.ports, partition, {
    limit: 100,
    state: "NonTerminal",
  });
  expect(held.urls[0]).toBe(
    `${nativeHttpBasePath}/tenants/acme/projects/at%20las` +
      `/executions?limit=100&state=NonTerminal`,
  );
});

test("the inventory carries its cursor and stops when there is none", async () => {
  const held = recording((url) =>
    url.includes("cursor=next")
      ? { projects: [{ tenant: "acme", project: "beta" }] }
      : {
          projects: [{ tenant: "acme", project: "atlas" }],
          nextCursor: "next",
        },
  );
  const result = await apiProjectInventoryAll(held.ports);
  expect(held.urls.length).toBe(2);
  expect(result.outcome === "Ok" && result.value.length).toBe(2);
});

test("an inventory that never stops is stopped by the page budget", async () => {
  const held = recording(() => ({
    projects: [{ tenant: "acme", project: "atlas" }],
    nextCursor: "again",
  }));
  const result = await apiProjectInventoryAll(held.ports);
  expect(held.urls.length).toBe(projectInventoryPagesMax);
  expect(result.outcome === "Ok" && result.value.length).toBe(
    projectInventoryPagesMax,
  );
});

test("a ticket's open questions hang from that ticket's own segment", async () => {
  const held = recording(() => ({ actions: [] }));
  await apiTicketNativeActions(held.ports, partition, 12);
  expect(held.urls[0]).toBe(
    `${nativeHttpBasePath}/tenants/acme/projects/at%20las/tickets/12/native-actions`,
  );
});

test("the project's open questions are one segment under the partition", async () => {
  const held = recording(() => ({ actions: [] }));
  await apiNativeActions(held.ports, partition);
  expect(held.urls[0]).toBe(
    `${nativeHttpBasePath}/tenants/acme/projects/at%20las/native-actions`,
  );
  await apiNativeActions(held.ports, partition, {
    cursor: "after-eleven",
    limit: 100,
  });
  expect(held.urls[1]).toBe(
    `${nativeHttpBasePath}/tenants/acme/projects/at%20las` +
      `/native-actions?cursor=after-eleven&limit=100`,
  );
});

test("a page read on its own asks for exactly the cursor it was given", async () => {
  const held = recording(() => ({ projects: [] }));
  await apiProjectInventory(held.ports, { cursor: "opaque" });
  expect(held.urls[0]).toBe(`${nativeHttpBasePath}/projects?cursor=opaque`);
});

const partitionPath = `${nativeHttpBasePath}/tenants/acme/projects/at%20las`;

test("the lead and its transcript hang from one segment, the store from two", async () => {
  const held = recording((url) =>
    url.includes("/transcript")
      ? { stream: "1a2b", entries: [], held: [], elided: 0 }
      : {
          session: "lead-atlas",
          state: "Open",
          attention: "Monitoring",
          notificationCursor: 0,
          handoffNote: {},
          turns: [],
          streams: [],
        },
  );
  await apiLead(held.ports, partition);
  expect(held.urls[0]).toBe(`${partitionPath}/lead`);
  await apiLeadTranscript(held.ports, partition, {
    stream: "1a2b",
    after: 4,
    limit: 8,
  });
  expect(held.urls[1]).toBe(
    `${partitionPath}/lead/transcript?stream=1a2b&after=4&limit=8`,
  );
});

test("the standing refusals are read across the project", async () => {
  const held = recording(() => ({ refusals: [], more: false }));
  await apiAgenticRefusals(held.ports, partition, { limit: 32 });
  expect(held.urls[0]).toBe(`${partitionPath}/agentic-refusals?limit=32`);
});

/** The two arms are one route: the ascending one is resumed after the ordinal
 * already held, and the newest is a bounded page with no cursor at all. */
test("the decision log is read from whichever end the caller named", async () => {
  const held = recording(() => ({ decisions: [] }));
  await apiSelectorHistory(held.ports, partition, { after: 1201, limit: 50 });
  expect(held.urls[0]).toBe(
    `${partitionPath}/selector-history?after=1201&limit=50`,
  );
  await apiSelectorHistory(held.ports, partition, {
    limit: 50,
    order: "newest",
  });
  expect(held.urls[1]).toBe(
    `${partitionPath}/selector-history?limit=50&order=newest`,
  );
});

/** The write is a PUT of the whole override set under the revision it was read
 * at, which is what makes a concurrent write a conflict rather than a clobber. */
test("the settings are read, written whole and paged for their revisions", async () => {
  const settings = {
    partition: { tenant: "acme", project: "at las" },
    revision: 12,
    overrides: {},
    effective: {
      revision: 12,
      projectRevision: 12,
      mode: "Running",
      installationMode: "Running",
      dispatchMode: "Automatic",
      basePrompt: "choose",
      modelAllowlist: [],
      toolAllowlist: [],
      limits: {
        tokensPerDecision: 1,
        millisecondsPerDecision: 1,
        toolCallsPerDecision: 1,
        inputBytesPerDecision: 1,
        candidatePagesPerDecision: 1,
        concurrentDecisions: 1,
        selectionsPerMinute: 1,
      },
      operationalContextMaxAgeMs: 1,
    },
  };
  const held = recording((url) =>
    url.includes("/history") ? { revisions: [] } : settings,
  );
  await apiSelectorSettings(held.ports, partition);
  expect(held.urls[0]).toBe(`${partitionPath}/selector-settings`);
  await apiWriteSelectorSettings(held.ports, partition, {
    expectedRevision: 12,
    overrides: { northStar: "ship the console" },
  });
  expect(held.urls[1]).toBe(`${partitionPath}/selector-settings`);
  await apiSelectorSettingsHistory(held.ports, partition, { after: 3 });
  expect(held.urls[2]).toBe(
    `${partitionPath}/selector-settings/history?after=3`,
  );
});
