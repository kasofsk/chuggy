/**
 * The routes, checked on the two things a caller cannot see going wrong: the
 * path a function asks for and where a paged read stops.
 *
 * A path is built from the contract's own `partitionPath`, so what is asserted
 * here is the segment and the query this console puts after it.
 */

import { expect, test, vi } from "vitest";

import {
  nativeHttpBasePath,
  nativeHttpMediaType,
} from "../../../src/contract/http.ts";
import {
  apiAgentAccounts,
  apiBindProjectRepository,
  apiChatAbilities,
  apiChatThread,
  apiChatThreads,
  apiChatThreadTranscript,
  apiCloseChatThread,
  apiForgeAuthorization,
  apiOpenChatThread,
  apiRenameChatThread,
  apiSendChatThreadMessage,
  apiStopChatThreadTurn,
  apiConfiguration,
  apiConfigurations,
  apiConfigureProjectRepository,
  apiConnectorHistory,
  apiConnectors,
  apiDeregisterMemberRunner,
  apiDeleteDraft,
  apiDeregisterPersonalRunner,
  apiDispatchView,
  apiExecutions,
  apiForgeApps,
  apiForgeInstallationRepositories,
  apiForgeInstallations,
  apiHostedRuns,
  apiInbox,
  apiOpenThread,
  apiPersonalRunnerPermit,
  apiPressAgentAccount,
  apiRetireAgentAccountCredential,
  apiTurnOffAgentAccountCredential,
  apiTurnOnAgentAccountCredential,
  apiPersonalRunnerServes,
  apiProject,
  apiProjectAbilities,
  apiProjectInventory,
  apiProjectInventoryAll,
  apiProjectRepositories,
  apiRemoveConnector,
  apiRenameThread,
  apiSelectorSettings,
  apiSelectorSettingsHistory,
  apiStopThreadTurn,
  apiThreadTranscript,
  apiStopTimeoutMs,
  apiTicket,
  apiTicketActionReach,
  apiTicketDispatchView,
  apiTicketNativeActions,
  apiWriteAgentAccountSettings,
  apiWriteConnector,
  apiWriteProjectRepositoryLanding,
  apiWriteSelectorSettings,
  projectInventoryPagesMax,
} from "../app/core/apiRoutes.ts";
import { apiTimeoutMsDefault } from "../app/core/apiRequest.ts";
import type { ApiFetchInit, ApiPorts } from "../app/core/apiRequest.ts";
import { deliveryEveryMark } from "./ticketDeliveryFixture.ts";
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

/** Every request as it left, for the routes whose shape is the finding. */
function recordingRequests(
  bodyFor: (url: string, init: ApiFetchInit) => unknown,
): {
  readonly ports: ApiPorts;
  readonly requests: { readonly url: string; readonly init: ApiFetchInit }[];
} {
  const requests: { readonly url: string; readonly init: ApiFetchInit }[] = [];
  return {
    requests,
    ports: {
      fetch: (url, init) => {
        requests.push({ url, init });
        return Promise.resolve({
          status: 201,
          headers: { get: () => null },
          text: () => Promise.resolve(JSON.stringify(bodyFor(url, init))),
        } as unknown as Response);
      },
      bearer: () => Promise.resolve("token"),
      sleepMs: () => Promise.resolve(),
    },
  };
}

/** A server that never answers, which only a request's own deadline ends. */
function neverAnswering(): ApiPorts {
  return {
    fetch: (_url, init) =>
      new Promise((_resolve, reject) => {
        init.signal.addEventListener("abort", () => {
          reject(new Error("aborted"));
        });
      }),
    bearer: () => Promise.resolve("token"),
    sleepMs: () => Promise.resolve(),
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
    phase: "Work",
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

/** The route reads candidates after a ticket, so one ticket's own page starts
 * at the ticket before it, and the first ticket's at the head. */
test("one ticket's dispatch read is the page that would hold it", async () => {
  const held = recording(() => ({ result: "Reset" }));
  await apiTicketDispatchView(held.ports, partition, 12);
  await apiTicketDispatchView(held.ports, partition, 1);
  const view = `${nativeHttpBasePath}/tenants/acme/projects/at%20las/dispatch-view`;
  expect(held.urls).toStrictEqual([
    `${view}?after=11&limit=1`,
    `${view}?limit=1`,
  ]);
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
    phase: ["Revoked", "Escalated"],
  });
  expect(held.urls[0]).toBe(
    `${nativeHttpBasePath}/tenants/acme/projects/at%20las` +
      `?limit=100&order=RecentActivity&phase=Revoked&phase=Escalated`,
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

test("a configurations page asks for the newest of each name by name, and for every revision by saying nothing", async () => {
  const held = recording(() => ({ configurations: [] }));
  await apiConfigurations(held.ports, partition, {
    cursor: "next",
    latest: true,
  });
  await apiConfigurations(held.ports, partition);
  expect(held.urls).toStrictEqual([
    `${nativeHttpBasePath}/tenants/acme/projects/at%20las` +
      `/configurations?cursor=next&latest=true`,
    `${nativeHttpBasePath}/tenants/acme/projects/at%20las/configurations`,
  ]);
});

test("a project's bindings are read without reach by saying reach=false, and with it by saying nothing", async () => {
  const held = recording(() => ({ repositories: [] }));
  await apiProjectRepositories(held.ports, partition, { reach: false });
  await apiProjectRepositories(held.ports, partition, { reach: true });
  expect(held.urls).toStrictEqual([
    `${nativeHttpBasePath}/tenants/acme/projects/at%20las` +
      `/repositories?reach=false`,
    `${nativeHttpBasePath}/tenants/acme/projects/at%20las/repositories`,
  ]);
});

test("the inventory carries its cursor and stops when there is none", async () => {
  const held = recording((url) =>
    url.includes("cursor=next")
      ? { projects: [{ tenant: "acme", project: "beta", name: "Beta" }] }
      : {
          projects: [{ tenant: "acme", project: "atlas", name: "Atlas" }],
          nextCursor: "next",
        },
  );
  const result = await apiProjectInventoryAll(held.ports);
  expect(held.urls.length).toBe(2);
  expect(result.outcome === "Ok" && result.value.length).toBe(2);
});

test("an inventory that never stops is stopped by the page budget", async () => {
  const held = recording(() => ({
    projects: [{ tenant: "acme", project: "atlas", name: "Atlas" }],
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

test("a ticket's action reach hangs from that ticket's own segment and is read whole", async () => {
  const held = recording(() => deliveryEveryMark);
  const answered = await apiTicketActionReach(held.ports, partition, 12);
  expect(held.urls).toStrictEqual([
    `${nativeHttpBasePath}/tenants/acme/projects/at%20las/tickets/12/action-reach`,
  ]);
  expect(answered).toStrictEqual({ outcome: "Ok", value: deliveryEveryMark });
});

test("an action reach that is not the read's answer is unreadable rather than half read", async () => {
  const held = recording(() => ({
    ...deliveryEveryMark,
    actions: [{ action: "rig", name: "Rig", reach: "Reached" }],
  }));
  const answered = await apiTicketActionReach(held.ports, partition, 12);
  expect(answered.outcome).toBe("Unreadable");
});

test("an action reach that outlives the console's own deadline is a read that failed", async () => {
  vi.useFakeTimers();
  const ports = neverAnswering();
  const outcomes: string[] = [];
  void apiTicketActionReach(ports, partition, 12).then((answered) =>
    outcomes.push(answered.outcome),
  );
  await vi.advanceTimersByTimeAsync(apiTimeoutMsDefault - 1);
  expect(outcomes).toStrictEqual([]);
  await vi.advanceTimersByTimeAsync(1);
  expect(outcomes).toStrictEqual(["Unreachable"]);
  vi.useRealTimers();
});

test("the inbox is one segment under the partition, asking the page it is given", async () => {
  const held = recording(() => ({ entries: [], count: 0, more: false }));
  await apiInbox(held.ports, partition, {});
  expect(held.urls[0]).toBe(
    `${nativeHttpBasePath}/tenants/acme/projects/at%20las/inbox`,
  );
  await apiInbox(held.ports, partition, { cursor: "after-eleven", limit: 100 });
  expect(held.urls[1]).toBe(
    `${nativeHttpBasePath}/tenants/acme/projects/at%20las` +
      `/inbox?cursor=after-eleven&limit=100`,
  );
});

test("a page read on its own asks for exactly the cursor it was given", async () => {
  const held = recording(() => ({ projects: [] }));
  await apiProjectInventory(held.ports, { cursor: "opaque" });
  expect(held.urls[0]).toBe(`${nativeHttpBasePath}/projects?cursor=opaque`);
});

const partitionPath = `${nativeHttpBasePath}/tenants/acme/projects/at%20las`;

test("a thread's transcript hangs from its thread's segment, asking the page it is given", async () => {
  const held = recording(() => ({
    stream: "1a2b",
    entries: [],
    held: [],
    elided: 0,
  }));
  await apiThreadTranscript(held.ports, partition, "thread/1", {
    stream: "1a2b",
    after: 4,
    limit: 8,
  });
  expect(held.urls[0]).toBe(
    `${partitionPath}/threads/thread%2F1/transcript?stream=1a2b&after=4&limit=8`,
  );
});

test("the hosted-runs grant hangs from the partition and is read as given or not", async () => {
  const held = recording(() => ({ granted: false }));
  expect(await apiHostedRuns(held.ports, partition)).toStrictEqual({
    outcome: "Ok",
    value: { granted: false },
  });
  expect(held.urls[0]).toBe(`${partitionPath}/hosted-runs`);
});

test("the reader's abilities hang from the partition and are read door by door", async () => {
  const abilities = {
    principal: "issuer geoff",
    mutate: false,
    dispatch: false,
    manageSelector: false,
    overrideTicketConfig: false,
    skipPlannedEvaluations: false,
    mergeProposals: false,
    makeAccessTokens: false,
    administer: false,
    writeEpic: false,
  };
  const held = recording(() => abilities);
  expect(await apiProjectAbilities(held.ports, partition)).toStrictEqual({
    outcome: "Ok",
    value: abilities,
  });
  expect(held.urls[0]).toBe(`${partitionPath}/abilities`);
});

/** The write is a PUT of the whole override set under the revision it was read
 * at, which is what makes a concurrent write a conflict rather than a clobber. */
test("the settings are read, written whole and paged for their revisions", async () => {
  const settings = {
    partition: { tenant: "acme", project: "at las" },
    revision: 12,
    overrides: {},
    effective: {
      threadStandingRules: "- You act through your owner's own commands.",
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
  await apiSelectorSettingsHistory(held.ports, partition, { before: 3 });
  expect(held.urls[2]).toBe(
    `${partitionPath}/selector-settings/history?before=3`,
  );
});

/** The thread door takes only versioned JSON, and a request with no body has
 * no media type to be versioned: an open that posts nothing is refused before
 * it reaches the caller's identity. */
test("opening a thread posts the versioned empty object", async () => {
  const held = recordingRequests(() => ({
    session: "thread-1",
    state: "Open",
    mine: true,
    turns: 0,
    owner: "geoff",
    openedAt: "2026-09-02T09:00:00Z",
    lastActivityAt: "2026-09-02T10:00:00Z",
    hidden: false,
  }));
  const opened = await apiOpenThread(held.ports, partition, "thread-open-a");
  expect(opened.outcome).toBe("Ok");
  expect(held.requests).toHaveLength(1);
  const request = held.requests[0];
  expect(request?.url).toBe(`${partitionPath}/threads`);
  expect(request?.init.method).toBe("POST");
  expect(request?.init.body).toBe('{"key":"thread-open-a"}');
  expect(
    (request?.init.headers as Record<string, string>)["content-type"],
  ).toBe(nativeHttpMediaType);
});

/** Naming a thread posts the one field it writes to the door that names it,
 * and is answered the entry as it now stands. */
test("naming a thread posts one field to its own door", async () => {
  const entry = {
    session: "thread-1",
    state: "Open",
    mine: true,
    turns: 0,
    owner: "geoff",
    title: "the footer",
    openedAt: "2026-09-02T09:00:00Z",
    lastActivityAt: "2026-09-02T10:00:00Z",
    hidden: false,
  };
  const held = recordingRequests(() => entry);

  const named = await apiRenameThread(
    held.ports,
    partition,
    "thread-1",
    "the footer",
  );

  expect(named.outcome).toBe("Ok");
  expect(held.requests.map((request) => request.url)).toStrictEqual([
    `${partitionPath}/threads/thread-1/rename`,
  ]);
  expect(held.requests.map((request) => request.init.body)).toStrictEqual([
    JSON.stringify({ title: "the footer" }),
  ]);
  for (const request of held.requests) {
    expect(request.init.method).toBe("POST");
    expect(request.init.headers["content-type"]).toBe(nativeHttpMediaType);
  }
});

/** A member's own chat answers at its tenant's chat segment the doors a
 * project's thread answers under the partition, each by the same verb. */
test("a member's own chat hangs from its tenant, door by door", async () => {
  const held = recordingRequests(() => ({}));
  const chatPath = `${nativeHttpBasePath}/tenants/acme/chat`;
  await apiChatAbilities(held.ports, "acme");
  await apiChatThreads(held.ports, "acme");
  await apiOpenChatThread(held.ports, "acme", "thread-open-a");
  await apiChatThread(held.ports, "acme", "thread/1");
  await apiChatThreadTranscript(held.ports, "acme", "thread/1", {
    stream: "stream-1",
    after: 2,
  });
  await apiSendChatThreadMessage(held.ports, "acme", "thread/1", {
    turn: "turn-1",
    message: "hello",
  });
  await apiStopChatThreadTurn(held.ports, "acme", "thread/1", "turn-1");
  await apiRenameChatThread(held.ports, "acme", "thread/1", "the footer");
  await apiCloseChatThread(held.ports, "acme", "thread/1");
  expect(
    held.requests.map((request) => [request.init.method, request.url]),
  ).toStrictEqual([
    ["GET", `${chatPath}/abilities`],
    ["GET", `${chatPath}/threads`],
    ["POST", `${chatPath}/threads`],
    ["GET", `${chatPath}/threads/thread%2F1`],
    [
      "GET",
      `${chatPath}/threads/thread%2F1/transcript?stream=stream-1&after=2`,
    ],
    ["POST", `${chatPath}/threads/thread%2F1/messages`],
    ["POST", `${chatPath}/threads/thread%2F1/turns/turn-1/stop`],
    ["POST", `${chatPath}/threads/thread%2F1/rename`],
    ["POST", `${chatPath}/threads/thread%2F1/close`],
  ]);
  expect(held.requests[2]?.init.body).toBe('{"key":"thread-open-a"}');
});

const boundRepository = "https://forge.test/kasofsk/scratch";

/**
 * One body per forge route, chosen by the request rather than by the path: a
 * project's bindings are read and written at the same address, and the two
 * answer different shapes.
 */
function forgeBody(url: string, init: ApiFetchInit): unknown {
  if (init.method === "POST" && url.endsWith("/repositories"))
    return { repository: boundRepository };
  if (init.method === "POST") return { accounts: [], truncated: false };
  if (url.endsWith("/forge/github")) return { apps: [] };
  if (url.includes("/forge-installations/"))
    return { repositories: [], truncated: false };
  if (url.endsWith("/forge-installations"))
    return { installations: [], truncated: false };
  return { repositories: [] };
}

/** The forge routes asked for in turn, so the path each names is read against
 * the others rather than on its own. */
async function askForgeRoutes(ports: ApiPorts): Promise<void> {
  await apiForgeApps(ports);
  await apiForgeInstallations(ports, "acme");
  await apiForgeAuthorization(ports, "acme", {
    forge: "github",
    code: "a-code",
    redirectUri: "https://console.test/forge/github/callback",
    codeVerifier: "v".repeat(43),
  });
  await apiForgeInstallationRepositories(ports, "acme", "42");
  await apiProjectRepositories(ports, partition, { reach: true });
  await apiBindProjectRepository(
    ports,
    partition,
    { repository: boundRepository },
    "op-one",
  );
}

/**
 * A path naming the wrong tenant or the wrong segment reaches a route about
 * somebody else's account, and a bind is refused outright without the operation
 * identity it spends.
 */
test("each forge route is one path, and a bind spends an identity", async () => {
  const held = recordingRequests(forgeBody);
  await askForgeRoutes(held.ports);
  expect(held.requests.map((request) => request.url)).toStrictEqual([
    `${nativeHttpBasePath}/forge/github`,
    `${nativeHttpBasePath}/tenants/acme/forge-installations`,
    `${nativeHttpBasePath}/tenants/acme/forge-authorizations`,
    `${nativeHttpBasePath}/tenants/acme/forge-installations/42/repositories`,
    `${partitionPath}/repositories`,
    `${partitionPath}/repositories`,
  ]);
  expect(held.requests.map((request) => request.init.method)).toStrictEqual([
    "GET",
    "GET",
    "POST",
    "GET",
    "GET",
    "POST",
  ]);
  expect(
    held.requests.map((request) => request.init.headers["idempotency-key"]),
  ).toStrictEqual([
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    "op-one",
  ]);
});

/** The tenant fills a template rather than being pasted into a path, so a
 * tenant that looks like a path is still one segment. */
/**
 * A member's own runners hang from the tenant, and one project they serve and
 * one runner of theirs from those, so a project or a runner named like a path
 * is still one segment.
 */
test("a member's runners are each asked at their own address", async () => {
  const held = recordingRequests((url) =>
    url.endsWith("/personal-runner-permit") ? { granted: true } : {},
  );
  await apiPersonalRunnerPermit(held.ports, "acme");
  await apiPersonalRunnerServes(held.ports, partition, true);
  await apiPersonalRunnerServes(held.ports, partition, false);
  await apiDeregisterPersonalRunner(held.ports, "acme", "chuggy/personal-1");
  await apiDeregisterMemberRunner(held.ports, "acme", "sub/ject");
  const tenantPath = `${nativeHttpBasePath}/tenants/acme`;
  expect(
    held.requests.map((request) => `${request.init.method} ${request.url}`),
  ).toStrictEqual([
    `GET ${tenantPath}/personal-runner-permit`,
    `PUT ${tenantPath}/personal-runner/projects/at%20las`,
    `DELETE ${tenantPath}/personal-runner/projects/at%20las`,
    `DELETE ${tenantPath}/personal-runner/runners/chuggy%2Fpersonal-1`,
    `DELETE ${tenantPath}/personal-runners/sub%2Fject`,
  ]);
});

/** The reader's agent accounts hang from no tenant and no principal: every
 * one of them is the caller's own. */
test("the reader's agent accounts are read, set, pressed and retired from at their own addresses, each agent and credential one segment", async () => {
  const held = recordingRequests((url) =>
    url.endsWith("/agent-accounts")
      ? {
          accounts: (["Claude", "Codex"] as const).map((agent) => ({
            agent,
            settings: {
              fiveHourPercent: 80,
              sevenDayPercent: 90,
              pausesThreads: false,
            },
            readings: [],
          })),
        }
      : {},
  );
  const read = await apiAgentAccounts(held.ports);
  await apiWriteAgentAccountSettings(held.ports, "Codex", {
    fiveHourPercent: 70,
    sevenDayPercent: 95,
    pausesThreads: true,
  });
  await apiPressAgentAccount(held.ports, "Claude");
  await apiRetireAgentAccountCredential(held.ports, "Codex", "old-work");
  await apiTurnOffAgentAccountCredential(held.ports, "Claude", "work");
  await apiTurnOnAgentAccountCredential(held.ports, "Claude", "work");
  expect(read.outcome).toBe("Ok");
  expect(
    held.requests.map(
      (request) =>
        `${request.init.method} ${request.url} ${String(request.init.body)}`,
    ),
  ).toStrictEqual([
    `GET ${nativeHttpBasePath}/agent-accounts undefined`,
    `PUT ${nativeHttpBasePath}/agent-accounts/Codex/settings {"fiveHourPercent":70,"sevenDayPercent":95,"pausesThreads":true}`,
    `POST ${nativeHttpBasePath}/agent-accounts/Claude/presses undefined`,
    `DELETE ${nativeHttpBasePath}/agent-accounts/Codex/credentials/old-work undefined`,
    `PUT ${nativeHttpBasePath}/agent-accounts/Claude/credentials/work/off undefined`,
    `DELETE ${nativeHttpBasePath}/agent-accounts/Claude/credentials/work/off undefined`,
  ]);
});

test("a tenant that looks like a path stays one segment", async () => {
  const held = recordingRequests(forgeBody);
  await apiForgeInstallations(held.ports, "ac/me");
  expect(held.requests[0]?.url).toBe(
    `${nativeHttpBasePath}/tenants/ac%2Fme/forge-installations`,
  );
});

/**
 * The landing is written at its own address and never at the binding list's,
 * because a PUT to the list would read as a write of the whole roster. What it
 * answers is the row inside an envelope, and the caller is handed the row.
 */
test("a landing is written by PUT at the bindings' own landing path", async () => {
  const row = {
    repository: boundRepository,
    boundAt: "2026-08-26T00:00:00Z",
    landing: { mode: "PullRequest" },
    finalization: { kind: "PullRequest" },
    pipelinesWritable: false,
    pipelinesRunnable: false,
  };
  const held = recordingRequests(() => ({ repository: row }));
  const answered = await apiWriteProjectRepositoryLanding(
    held.ports,
    partition,
    {
      repository: boundRepository,
      expected: { mode: "Push" },
      landing: { mode: "PullRequest" },
      pipelinesWritable: { expected: false, wanted: false },
    },
  );
  expect(held.requests.map((request) => request.url)).toStrictEqual([
    `${partitionPath}/repositories/landing`,
  ]);
  expect(held.requests[0]?.init.method).toBe("PUT");
  expect(answered).toStrictEqual({ outcome: "Ok", value: row });
});

/** The step is asked for again at its own address under the bindings, naming the repository by its address. */
test("a configuration step is asked for again by PUT at the bindings' own configurations path", async () => {
  const configured = {
    repository: boundRepository,
    configurations: { result: "Deferred", reason: "SnapshotUnavailable" },
  };
  const held = recordingRequests(() => configured);
  const answered = await apiConfigureProjectRepository(held.ports, partition, {
    repository: boundRepository,
  });
  expect(held.requests.map((request) => request.url)).toStrictEqual([
    `${partitionPath}/repositories/configurations`,
  ]);
  expect(held.requests[0]?.init.method).toBe("PUT");
  expect(JSON.parse(String(held.requests[0]?.init.body))).toStrictEqual({
    repository: boundRepository,
  });
  expect(answered).toStrictEqual({ outcome: "Ok", value: configured });
});

/** A press reads as stopped until its door answers, so a door that never does
 * is given up on sooner than any other. */
test("a stop gives its door less time than another request is given, and is unreachable past it", async () => {
  vi.useFakeTimers();
  const ports = neverAnswering();
  const outcomes: string[] = [];
  void apiStopThreadTurn(ports, partition, "thread-1", "turn-2").then(
    (answered) => outcomes.push(answered.outcome),
  );
  await vi.advanceTimersByTimeAsync(apiStopTimeoutMs - 1);
  expect(outcomes).toStrictEqual([]);
  await vi.advanceTimersByTimeAsync(1);
  expect(outcomes).toStrictEqual(["Unreachable"]);
  expect(apiStopTimeoutMs).toBeLessThan(apiTimeoutMsDefault);
  vi.useRealTimers();
});

/** A draft is deleted by its address and the version in its query, never by a
 * body. */
test("a draft is deleted at its own address, fenced at the version it was read at", async () => {
  const held = recordingRequests(() => ({}));
  await apiDeleteDraft(held.ports, partition, 12, 3);
  expect(
    held.requests.map(
      (request) =>
        `${request.init.method} ${request.url} ${String(request.init.body)}`,
    ),
  ).toStrictEqual([
    `DELETE ${partitionPath}/drafts/12?expectedVersion=3 undefined`,
  ]);
});

const connectorStanding = {
  name: "deploy",
  revision: 3,
  kind: "Aws",
  settings: { roleArn: "arn:aws:iam::123456789012:role/deploy" },
} as const;

test("the connectors are read at the project's own connectors path", async () => {
  const held = recordingRequests(() => ({ connectors: [connectorStanding] }));
  const answered = await apiConnectors(held.ports, partition);
  expect(
    held.requests.map((request) => `${request.init.method} ${request.url}`),
  ).toStrictEqual([`GET ${partitionPath}/connectors`]);
  expect(answered).toStrictEqual({
    outcome: "Ok",
    value: { connectors: [connectorStanding] },
  });
});

test("a connector is written by PUT at its own name, with the revision it was read at", async () => {
  const held = recordingRequests(() => connectorStanding);
  const written = {
    kind: "Aws",
    settings: { roleArn: connectorStanding.settings.roleArn },
    expectedRevision: 2,
  } as const;
  const answered = await apiWriteConnector(
    held.ports,
    partition,
    "deploy",
    written,
  );
  expect(
    held.requests.map((request) => `${request.init.method} ${request.url}`),
  ).toStrictEqual([`PUT ${partitionPath}/connectors/deploy`]);
  expect(JSON.parse(String(held.requests[0]?.init.body))).toStrictEqual(
    written,
  );
  expect(answered).toStrictEqual({ outcome: "Ok", value: connectorStanding });
});

test("a connector is removed by DELETE at its own name, fenced on the revision in the query", async () => {
  const held = recordingRequests(() => ({}));
  const answered = await apiRemoveConnector(held.ports, partition, "deploy", 3);
  expect(
    held.requests.map((request) => `${request.init.method} ${request.url}`),
  ).toStrictEqual([
    `DELETE ${partitionPath}/connectors/deploy?expectedRevision=3`,
  ]);
  expect(answered).toStrictEqual({ outcome: "Ok", value: undefined });
});

test("the connectors' history is read newest first, and an older page before the cursor it was handed", async () => {
  const held = recordingRequests(() => ({ changes: [] }));
  await apiConnectorHistory(held.ports, partition);
  await apiConnectorHistory(held.ports, partition, 41);
  expect(
    held.requests.map((request) => `${request.init.method} ${request.url}`),
  ).toStrictEqual([
    `GET ${partitionPath}/connectors/history`,
    `GET ${partitionPath}/connectors/history?before=41`,
  ]);
});
