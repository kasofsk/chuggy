/**
 * A session bearer confined to its own session's partition, or a member's own
 * to its owner's tenant, driven through the whole app, so what is under test is
 * what a caller is sent rather than the rule beneath it.
 *
 * THE ROUTER IS WALKED, NOT THE SOURCE. Every route the app serves is asked
 * without a bearer, and one answering `401` reads a bearer and so must have a
 * class; then each classified route is asked under a session bearer from
 * elsewhere and must refuse before any port is reached. A route registered
 * without a class fails here, and so does a class left for a route nobody
 * serves.
 *
 * EVERY PORT RECORDS THAT IT WAS REACHED, so a refusal the hook sent is told
 * apart from a `404` some port answered.
 *
 * WHAT EACH TOOL CALLS IS WRITTEN OUT HERE, from chuggy-common's
 * `chuggyTools.mjs`, because the tools run in the image and this tree holds
 * only their roster and routes. The table's requirements are compared with
 * what that relation and the roster derive, so a requirement that refuses a
 * tool its capability admits, or admits a write no tool makes, fails here.
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { createNativeHttpApp } from "../../src/adapters/http/server.ts";
import { twoBearerAuthentication } from "../../src/adapters/http/sessionBearer.ts";
import {
  sessionBearerAdmission,
  sessionBearerMethodClasses,
  sessionBearerRouteScopes,
  type SessionBearerConfinement,
  type SessionBearerMethod,
} from "../../src/adapters/http/sessionBearerScope.ts";
import {
  nativeHttpMediaType,
  nativeHttpRoutes,
} from "../../src/contract/http.ts";
import { sessionBearerPrefix } from "../../src/contract/sessionPlane.ts";
import {
  personalAgentCapabilities,
  sessionCapabilities,
  sessionKinds,
  type SessionCapability,
} from "../../src/contract/rosters.ts";
import {
  chuggyToolCapabilities,
  chuggyToolRoutes,
  type ChuggyTool,
} from "../../src/contract/sessionTools.ts";
import {
  asSessionId,
  memberScopePartition,
  type SessionKind,
  type SessionScope,
} from "../../src/interpreter/agentSession.ts";
import { nativeWeb } from "../../src/interpreter/nativeWeb.ts";
import {
  asAuthorityKind,
  asAuthoritySubject,
  type Submission,
} from "../../src/interpreter/operationInbox.ts";
import { asPrincipal } from "../../src/interpreter/principal.ts";
import {
  asProjectId,
  asTenantId,
  type Partition,
} from "../../src/interpreter/projectStore.ts";
import { openExecutionBacklogGuard } from "../../src/interpreter/schedulerContext.ts";
import { routerServed } from "./routerFixtures.ts";
import { unservedNativeWeb } from "./threadFixtures.ts";
import { projectAccessSiteRefused } from "../interpreter/projectAccessFixture.ts";

type ServedNativeWeb = Parameters<typeof createNativeHttpApp>[0];

/** The one principal both bearers name, readable in every project these cases ask about. */
const principal = asPrincipal("issuer subject");

/** Every capability a project's session may hold, and the one a member's own may. */
const projectCapabilities = sessionCapabilities.filter(
  (capability) => capability !== "MemberRead",
);
const memberCapabilities = ["MemberRead"] as const;

/** The partition the session authority answers for the session bearer. */
const own: Partition = {
  tenant: asTenantId("acme"),
  project: asProjectId("atlas"),
};

/** What the session bearer is confined by, as the hook reads it. */
const ownSession = {
  partition: own,
  scope: "Project" as const,
  principal,
  capabilities: projectCapabilities,
};

/** The partition reserved for the principal in `own`'s tenant, which a member's own session bearer is confined to. */
const ownMember: Partition = memberScopePartition(own.tenant, principal);

/** Another project of the same tenant, and the same project name under another tenant. */
const elsewhere: readonly Partition[] = [
  { tenant: own.tenant, project: asProjectId("other") },
  { tenant: asTenantId("other"), project: own.project },
];

const sessionToken = `${sessionBearerPrefix}${randomUUID()}${randomUUID()}`;
const oidcToken = "issued";

/** A port no case writes, recording each call and failing it. */
function recorded(reached: string[], port: string): never {
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

/** A member's chat whose tenant answers `opens` as `granted` without counting as a port reached, recording every other door. */
function memberChatRecorded(reached: string[], granted: boolean): never {
  const doors: Record<string | symbol, unknown> = recorded(reached, "chat");
  return new Proxy(
    {},
    {
      get: (_target, method) =>
        method === "opens" ? () => Promise.resolve(granted) : doors[method],
    },
  ) as never;
}

/** The app as a deployment composes it, every optional port present so every route is served. */
function scopedApp(
  reached: string[],
  web?: ServedNativeWeb,
  kind: SessionKind = "Lead",
  scope: SessionScope = "Project",
  granted = true,
  capabilities: readonly SessionCapability[] = scope === "Member"
    ? memberCapabilities
    : projectCapabilities,
) {
  return createNativeHttpApp(
    web ?? recorded(reached, "web"),
    twoBearerAuthentication(
      {
        authenticateBearer: (token) =>
          Promise.resolve(
            token === oidcToken
              ? { authenticated: "Bearer" as const, bearer: { principal } }
              : { authenticated: "InvalidToken" as const },
          ),
      },
      {
        authenticate: (secret) =>
          Promise.resolve(
            secret === sessionToken
              ? {
                  partition: scope === "Member" ? ownMember : own,
                  session: asSessionId(kind),
                  kind,
                  principal,
                  scope,
                  capabilities,
                }
              : undefined,
          ),
      },
    ),
    recorded(reached, "readiness"),
    recorded(reached, "installation"),
    undefined,
    recorded(reached, "events"),
    recorded(reached, "selectorSettings"),
    recorded(reached, "forgeCredentials"),
    recorded(reached, "onboarding"),
    recorded(reached, "workerPools"),
    recorded(reached, "creation"),
    recorded(reached, "placement"),
    recorded(reached, "sessionPlacement"),
    recorded(reached, "proposalReviews"),
    recorded(reached, "threadLive"),
    recorded(reached, "actionReports"),
    recorded(reached, "actionReach"),
    recorded(reached, "landings"),
    recorded(reached, "personalRunners"),
    recorded(reached, "ownerFallback"),
    recorded(reached, "threadLimits"),
    memberChatRecorded(reached, granted),
    recorded(reached, "inbox"),
    recorded(reached, "agentAccounts"),
    undefined,
    recorded(reached, "landingQueues"),
    {
      projects: recorded(reached, "projectDeletion"),
      tenants: recorded(reached, "tenantDeletion"),
    },
  );
}

/** One parameter of a route's pattern, filled with a value its handler parses. */
function routeParameter(partition: Partition, name: string): string {
  if (name === "tenant") return partition.tenant;
  if (name === "project") return partition.project;
  return name === "ticket" || name === "ordinal" ? "1" : "x";
}

/** One request to a served `METHOD /pattern`, in `partition`, a write carrying the least a versioned write reads. */
function routeRequest(route: string, partition: Partition, token?: string) {
  const [method = "", pattern = ""] = route.split(" ");
  const writes = method === "POST" || method === "PUT";
  return {
    method: method as "GET" | "POST" | "PUT" | "DELETE",
    url: pattern.replace(/:([A-Za-z]+)/gu, (_whole, name: string) =>
      routeParameter(partition, name),
    ),
    headers: {
      ...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
      ...(writes
        ? { "content-type": nativeHttpMediaType, "idempotency-key": "key" }
        : {}),
    },
    ...(writes ? { payload: {} } : {}),
  };
}

/** Whether an answer is the hook's refusal of a route no session may reach. */
function scopeRefused(answered: {
  readonly statusCode: number;
  readonly headers: Readonly<Record<string, unknown>>;
  json(): unknown;
}): boolean {
  return (
    answered.statusCode === 403 &&
    answered.headers["www-authenticate"] ===
      'Bearer error="insufficient_scope"' &&
    JSON.stringify(answered.json()).includes('"code":"InsufficientScope"')
  );
}

test("every served route that reads a bearer is classified, and every class is served", async () => {
  const reached: string[] = [];
  await using app = scopedApp(reached);
  await app.ready();
  const served = routerServed(app).filter((route) => !route.startsWith("HEAD"));
  for (const route of served) {
    const answered = await app.inject(routeRequest(route, own));
    const classified = sessionBearerRouteScopes.has(route);
    assert.equal(
      answered.statusCode === 401,
      classified,
      classified
        ? `${route} is classified and reads no bearer`
        : `${route} reads a bearer and has no class`,
    );
  }
  for (const route of sessionBearerRouteScopes.keys())
    assert.ok(served.includes(route), `${route} is classified and not served`);
});

test("under a session bearer from elsewhere, every classified route refuses before any port", async () => {
  const reached: string[] = [];
  await using app = scopedApp(reached);
  for (const partition of elsewhere)
    for (const [route, scope] of sessionBearerRouteScopes) {
      reached.length = 0;
      const answered = await app.inject(
        routeRequest(route, partition, sessionToken),
      );
      const where = `${route} in ${partition.tenant}/${partition.project}`;
      assert.deepEqual(reached, [], `${where} reached a port`);
      if (scope !== "Partition")
        assert.ok(scopeRefused(answered), `${where} was not refused`);
      else {
        assert.equal(answered.statusCode, 404, where);
        assert.deepEqual(answered.json(), {
          error: { code: "NotFound", message: "Resource not found." },
        });
      }
    }
});

test("in its own partition a session bearer passes every partition route and no refused or member one", async () => {
  const reached: string[] = [];
  await using app = scopedApp(reached);
  for (const [route, scope] of sessionBearerRouteScopes) {
    reached.length = 0;
    const answered = await app.inject(routeRequest(route, own, sessionToken));
    if (scope !== "Partition") {
      assert.ok(scopeRefused(answered), `${route} was not refused`);
      assert.deepEqual(reached, [], `${route} reached a port`);
    } else
      assert.ok(
        !scopeRefused(answered) &&
          !(answered.statusCode === 404 && reached.length === 0),
        `${route} was refused in its own partition: ${String(answered.statusCode)}`,
      );
  }
});

/** One call a tool makes: the route, by its name among the tools' routes, and the method. */
type ChuggyToolCall = readonly [
  route: keyof typeof chuggyToolRoutes,
  method: SessionBearerMethod,
];

/** What each tool calls, as chuggy-common's `chuggyTools.mjs` calls it; a tool that reaches no route calls nothing. */
const chuggyToolCalls = {
  list_tickets: [["project", "GET"]],
  read_ticket: [["ticket", "GET"]],
  read_draft: [["draft", "GET"]],
  list_drafts: [["drafts", "GET"]],
  list_configurations: [["configurations", "GET"]],
  read_configuration: [["configuration", "GET"]],
  read_decision_log: [["selectorHistory", "GET"]],
  read_refusals: [["agenticRefusals", "GET"]],
  read_ticket_refusals: [["ticketAgenticRefusals", "GET"]],
  read_ticket_landings: [["ticketLandings", "GET"]],
  read_landing_queues: [["landingQueues", "GET"]],
  read_lead: [["lead", "GET"]],
  read_lead_transcript: [["leadTranscript", "GET"]],
  list_executions: [["executions", "GET"]],
  read_execution: [["execution", "GET"]],
  read_run_transcript: [["runTranscript", "GET"]],
  read_run_error: [["runError", "GET"]],
  read_operation: [["operation", "GET"]],
  list_threads: [["threads", "GET"]],
  read_thread: [["thread", "GET"]],
  read_thread_transcript: [["threadTranscript", "GET"]],
  list_repositories: [["projectRepositories", "GET"]],
  fetch_image: [["projectArtifact", "GET"]],
  read_docs: [],
  read_abilities: [["abilities", "GET"]],
  list_epics: [["epics", "GET"]],
  read_epic: [["epic", "GET"]],
  read_epic_history: [["epicHistory", "GET"]],
  read_epic_graph: [["epicGraph", "GET"]],
  initialize_draft: [["draftInitialization", "GET"]],
  file_dependent: [["drafts", "POST"]],
  revise_draft: [["draft", "PUT"]],
  delete_draft: [["draft", "DELETE"]],
  release_draft: [["operations", "POST"]],
  create_draft: [["drafts", "POST"]],
  revoke_ticket: [["operations", "POST"]],
  update_ticket: [["operations", "POST"]],
  create_epic: [["epics", "POST"]],
  revise_epic: [
    ["epic", "GET"],
    ["epics", "POST"],
  ],
  add_epic_tickets: [
    ["epic", "GET"],
    ["epics", "POST"],
  ],
  remove_epic_tickets: [
    ["epic", "GET"],
    ["epics", "POST"],
  ],
  dispatch_ticket: [
    ["dispatchView", "GET"],
    ["operations", "POST"],
  ],
  dispatch: [],
  refuse: [],
  lift: [],
  set_attention: [],
  set_handoff_note: [],
  set_planning_intent: [],
  read_my_abilities: [["chatAbilities", "GET"]],
  list_projects: [["chatProjects", "GET"]],
  list_my_threads: [["chatThreads", "GET"]],
  read_my_thread: [["chatThread", "GET"]],
  list_my_runners: [["personalRunner", "GET"]],
  read_chat_host: [["chatHost", "GET"]],
  navigate: [],
  offer_release: [],
  offer_revoke: [],
  read_lead_settings: [["selectorSettings", "GET"]],
  update_lead_settings: [
    ["selectorSettings", "GET"],
    ["selectorSettings", "PUT"],
  ],
  read_placement: [["sessionPlacement", "GET"]],
  update_placement: [
    ["sessionPlacement", "GET"],
    ["sessionPlacement", "PUT"],
  ],
  read_usage: [["agentAccounts", "GET"]],
  update_usage_settings: [
    ["agentAccounts", "GET"],
    ["agentAccountSettings", "PUT"],
  ],
  retry_paused_agent: [["agentAccountPresses", "POST"]],
  retire_credential: [["agentAccountCredential", "DELETE"]],
} as const satisfies Readonly<Record<ChuggyTool, readonly ChuggyToolCall[]>>;

/** The routes the account tools call, each the caller's own at no tenant and no project, which no session bearer reaches. */
const accountToolRoutes: ReadonlySet<keyof typeof chuggyToolRoutes> = new Set([
  "agentAccounts",
  "agentAccountSettings",
  "agentAccountPresses",
  "agentAccountCredential",
]);

/** The capabilities a session may hold, each beside every call the tools it admits make, keyed as the scope table keys a route. */
const sessionToolCalls: readonly (readonly [SessionCapability, string])[] =
  sessionCapabilities.flatMap((capability) =>
    chuggyToolCapabilities[capability].flatMap((tool) =>
      chuggyToolCalls[tool].map(
        ([route, method]) =>
          [capability, `${method} ${chuggyToolRoutes[route]}`] as const,
      ),
    ),
  );

/** A session holding `capabilities` alone, in the scope `capability`'s tools are called from. */
function sessionHolding(
  capabilities: readonly SessionCapability[],
  scope: SessionScope,
): SessionBearerConfinement {
  return {
    partition: scope === "Member" ? ownMember : own,
    scope,
    principal,
    capabilities,
  };
}

/** The scope a capability's tools are called from: a member's own session's for `MemberRead`, and a project's for every other. */
function sessionToolScope(capability: SessionCapability): SessionScope {
  return capability === "MemberRead" ? "Member" : "Project";
}

test("a session holding one capability alone is admitted to every route each tool it admits calls", () => {
  assert.ok(sessionToolCalls.length > 0);
  for (const [capability, route] of sessionToolCalls) {
    const [method = "", pattern = ""] = route.split(" ");
    const scope = sessionToolScope(capability);
    assert.equal(
      sessionBearerAdmission(
        sessionHolding([capability], scope),
        method,
        pattern,
        scope === "Member"
          ? { tenant: own.tenant }
          : { tenant: own.tenant, project: own.project },
      ),
      "Admitted",
      `${capability} is refused ${route}`,
    );
  }
});

test("each admitted method requires the capabilities whose tools call it and, for a read, its scope's read, and a write no session's tool makes is refused", () => {
  const derived = new Map<string, Set<SessionCapability>>();
  for (const [capability, route] of sessionToolCalls)
    derived.set(route, (derived.get(route) ?? new Set()).add(capability));
  for (const [route, admitted] of sessionBearerMethodClasses) {
    const called = [...(derived.get(route) ?? [])];
    if (admitted === "Refused") {
      assert.deepEqual(called, [], `${route} is refused and a tool calls it`);
      continue;
    }
    const read: SessionCapability =
      admitted.scope === "Member" ? "MemberRead" : "ProjectRead";
    const expected = new Set<SessionCapability>([
      ...called,
      ...(route.startsWith("GET ") ? [read] : []),
    ]);
    assert.deepEqual(
      [...admitted.requires].sort(),
      [...expected].sort(),
      route,
    );
  }
});

test("every call the account tools make is to an account route, which a project's and a member's session bearer are both refused, holding every capability its scope may", () => {
  const called: readonly ChuggyToolCall[] =
    chuggyToolCapabilities.AgentAccounts.flatMap(
      (tool): readonly ChuggyToolCall[] => chuggyToolCalls[tool],
    );
  assert.deepEqual(
    new Set(called.map(([route]) => route)),
    new Set(accountToolRoutes),
  );
  for (const [route, method] of called) {
    const pattern = chuggyToolRoutes[route];
    assert.equal(
      sessionBearerMethodClasses.get(`${method} ${pattern}`),
      "Refused",
      `${method} ${pattern}`,
    );
    for (const [scope, capabilities] of [
      ["Project", projectCapabilities],
      ["Member", memberCapabilities],
    ] as const)
      assert.equal(
        sessionBearerAdmission(
          sessionHolding(capabilities, scope),
          method,
          pattern,
          { tenant: own.tenant, project: own.project },
        ),
        "Refused",
        `${scope} is admitted to ${method} ${pattern}`,
      );
  }
  for (const [, route] of sessionToolCalls)
    for (const account of accountToolRoutes)
      assert.ok(
        !route.endsWith(` ${chuggyToolRoutes[account]}`),
        `a session's tool calls ${route}`,
      );
});

test("no session capability admits a tool the person's own agent alone may call", () => {
  for (const capability of personalAgentCapabilities)
    for (const tool of chuggyToolCapabilities[capability])
      assert.ok(
        !sessionCapabilities.some((held) =>
          chuggyToolCapabilities[held].includes(tool),
        ),
        tool,
      );
});

test("a session bearer is answered as an unauthorized read is, before any port, on every route its session holds no capability for, whatever its kind", async () => {
  for (const kind of sessionKinds)
    for (const scope of ["Project", "Member"] as const) {
      if (scope === "Member" && kind !== "Thread") continue;
      const partition = scope === "Member" ? ownMember : own;
      const reached: string[] = [];
      await using app = scopedApp(reached, undefined, kind, scope, true, []);
      for (const [route, admitted] of sessionBearerMethodClasses) {
        if (
          admitted === "Refused" ||
          admitted.scope !== sessionBearerAdmissionScopeOf(scope)
        )
          continue;
        reached.length = 0;
        const answered = await app.inject(
          routeRequest(route, partition, sessionToken),
        );
        const where = `${route} under a ${kind} bearer holding nothing`;
        assert.deepEqual(reached, [], `${where} reached a port`);
        assert.equal(answered.statusCode, 404, where);
        assert.deepEqual(answered.json(), {
          error: { code: "NotFound", message: "Resource not found." },
        });
      }
    }
});

/** The route scope a session scope is confined to. */
function sessionBearerAdmissionScopeOf(
  scope: SessionScope,
): "Partition" | "Member" {
  return scope === "Member" ? "Member" : "Partition";
}

test("a lead's bearer holding only reads reads its project, and its draft and revocation writes are answered as unauthorized", async () => {
  const reached: string[] = [];
  await using app = scopedApp(reached, undefined, "Lead", "Project", true, [
    "ProjectRead",
  ]);
  await app.inject(
    routeRequest(
      `GET ${chuggyToolRoutes.projectRepositories}`,
      own,
      sessionToken,
    ),
  );
  assert.deepEqual(reached, ["onboarding.projectRepositories"]);
  for (const route of [
    `POST ${chuggyToolRoutes.drafts}`,
    `POST ${chuggyToolRoutes.operations}`,
    `PUT ${chuggyToolRoutes.draft}`,
  ]) {
    reached.length = 0;
    const answered = await app.inject(routeRequest(route, own, sessionToken));
    assert.equal(answered.statusCode, 404, route);
    assert.deepEqual(reached, [], `${route} reached a port`);
  }
});

test("list_repositories's route reaches the project's repositories under a lead's and a thread's own bearer", async () => {
  assert.equal(
    chuggyToolRoutes.projectRepositories,
    nativeHttpRoutes.projectRepositories,
    "list_repositories calls no route",
  );
  for (const kind of ["Lead", "Thread"] as const) {
    const reached: string[] = [];
    await using app = scopedApp(reached, undefined, kind);
    await app.inject(
      routeRequest(
        `GET ${chuggyToolRoutes.projectRepositories}`,
        own,
        sessionToken,
      ),
    );
    assert.deepEqual(reached, ["onboarding.projectRepositories"], kind);
  }
});

test("fetch_image's route reaches the project's image under a lead's and a thread's own bearer", async () => {
  assert.equal(
    chuggyToolRoutes.projectArtifact,
    nativeHttpRoutes.projectArtifact,
    "fetch_image calls no route",
  );
  for (const kind of ["Lead", "Thread"] as const) {
    const reached: string[] = [];
    await using app = scopedApp(reached, undefined, kind);
    await app.inject(
      routeRequest(
        `GET ${chuggyToolRoutes.projectArtifact}`,
        own,
        sessionToken,
      ),
    );
    assert.deepEqual(reached, ["web.projectArtifact"], kind);
  }
});

test("read_run_error's route reaches an attempt's error text under a lead's and a thread's own bearer", async () => {
  assert.equal(
    chuggyToolRoutes.runError,
    nativeHttpRoutes.runError,
    "read_run_error calls no route",
  );
  for (const kind of ["Lead", "Thread"] as const) {
    const reached: string[] = [];
    await using app = scopedApp(reached, undefined, kind);
    await app.inject(
      routeRequest(`GET ${chuggyToolRoutes.runError}`, own, sessionToken),
    );
    assert.deepEqual(reached, ["web.runError"], kind);
  }
});

test("read_ticket_landings's route reaches a ticket's landings under a lead's and a thread's own bearer", async () => {
  assert.equal(
    chuggyToolRoutes.ticketLandings,
    nativeHttpRoutes.ticketLandings,
    "read_ticket_landings calls no route",
  );
  for (const kind of ["Lead", "Thread"] as const) {
    const reached: string[] = [];
    await using app = scopedApp(reached, undefined, kind);
    await app.inject(
      routeRequest(`GET ${chuggyToolRoutes.ticketLandings}`, own, sessionToken),
    );
    assert.deepEqual(reached, ["landings.read"], kind);
  }
});

test("read_landing_queues's route reaches the project's landing queues under a lead's and a thread's own bearer", async () => {
  assert.equal(
    chuggyToolRoutes.landingQueues,
    nativeHttpRoutes.landingQueues,
    "read_landing_queues calls no route",
  );
  for (const kind of ["Lead", "Thread"] as const) {
    const reached: string[] = [];
    await using app = scopedApp(reached, undefined, kind);
    await app.inject(
      routeRequest(`GET ${chuggyToolRoutes.landingQueues}`, own, sessionToken),
    );
    assert.deepEqual(reached, ["landingQueues.read"], kind);
  }
});

test("read_abilities's route reaches the session's own abilities under a lead's and a thread's own bearer", async () => {
  assert.equal(
    chuggyToolRoutes.abilities,
    nativeHttpRoutes.abilities,
    "read_abilities calls no route",
  );
  for (const kind of ["Lead", "Thread"] as const) {
    const reached: string[] = [];
    await using app = scopedApp(reached, undefined, kind);
    await app.inject(
      routeRequest(`GET ${chuggyToolRoutes.abilities}`, own, sessionToken),
    );
    assert.deepEqual(reached, ["web.abilities"], kind);
  }
});

/** A project read that finds every project but one, recording each partition it was asked for. */
function projectWeb(asked: string[]): ServedNativeWeb {
  return {
    ...unservedNativeWeb,
    project: (_principal, partition) => {
      asked.push(`${partition.tenant}/${partition.project}`);
      return Promise.resolve(
        partition.project === "unreadable"
          ? { result: "NotFound" }
          : {
              result: "Found",
              project: { partition, sequence: 1, tickets: [] },
            },
      );
    },
    projectInventory: (_principal, _after, limit) => {
      asked.push(`inventory:${String(limit)}`);
      return Promise.resolve({ projects: [] });
    },
  };
}

function projectPath(partition: Partition): string {
  return `/api/v1/tenants/${partition.tenant}/projects/${partition.project}`;
}

test("a session bearer reads its own project, and another of its principal's answers as one it cannot read", async () => {
  const asked: string[] = [];
  await using app = scopedApp([], projectWeb(asked));
  const read = (partition: Partition, token: string) =>
    app.inject({
      url: projectPath(partition),
      headers: { authorization: `Bearer ${token}` },
    });
  const ownRead = await read(own, sessionToken);
  assert.equal(ownRead.statusCode, 200);
  assert.deepEqual(asked, ["acme/atlas"]);
  const [other = own] = elsewhere;
  const confined = await read(other, sessionToken);
  assert.deepEqual(asked, ["acme/atlas"]);
  const unreadable = await read(
    { tenant: own.tenant, project: asProjectId("unreadable") },
    oidcToken,
  );
  assert.equal(confined.statusCode, unreadable.statusCode);
  assert.equal(confined.body, unreadable.body);
  assert.equal(
    confined.headers["content-type"],
    unreadable.headers["content-type"],
  );
});

test("an OIDC bearer for the same principal reads every project it may and lists them", async () => {
  const asked: string[] = [];
  await using app = scopedApp([], projectWeb(asked));
  for (const partition of elsewhere) {
    const read = await app.inject({
      url: projectPath(partition),
      headers: { authorization: `Bearer ${oidcToken}` },
    });
    assert.equal(read.statusCode, 200);
  }
  const listed = await app.inject({
    url: nativeHttpRoutes.projects,
    headers: { authorization: `Bearer ${oidcToken}` },
  });
  assert.equal(listed.statusCode, 200);
  assert.deepEqual(asked, ["acme/other", "other/atlas", "inventory:50"]);
});

test("a session bearer is refused a route addressed to no partition, and one that enrols a machine in its own", async () => {
  const reached: string[] = [];
  const asked: string[] = [];
  await using app = scopedApp(reached, projectWeb(asked));
  for (const request of [
    { method: "GET" as const, url: nativeHttpRoutes.projects },
    { method: "GET" as const, url: "/api/v1/tenants/acme/forge-installations" },
    {
      method: "POST" as const,
      url: `${projectPath(own)}/worker-pool-registration-tokens`,
      headers: { "content-type": nativeHttpMediaType },
      payload: { lifetimeSecs: 900 },
    },
  ]) {
    const answered = await app.inject({
      ...request,
      headers: {
        ...("headers" in request ? request.headers : {}),
        authorization: `Bearer ${sessionToken}`,
      },
    });
    assert.ok(scopeRefused(answered), request.url);
  }
  assert.deepEqual(reached, []);
  assert.deepEqual(asked, []);
});

test("a session bearer reads its own project's held proposals and may not answer one", async () => {
  const reached: string[] = [];
  await using app = scopedApp(reached);
  const answered = await app.inject({
    method: "POST",
    url: `${projectPath(own)}/selector-proposals/decision/review`,
    headers: {
      authorization: `Bearer ${sessionToken}`,
      "content-type": nativeHttpMediaType,
    },
    payload: { outcome: "Approved" },
  });
  assert.ok(scopeRefused(answered));
  assert.deepEqual(reached, []);
  await app.inject({
    url: `${projectPath(own)}/selector-proposals`,
    headers: { authorization: `Bearer ${sessionToken}` },
  });
  assert.deepEqual(reached, ["proposalReviews.pending"]);
});

test("a thread's own session bearer neither replies to an offer in its member's name nor writes to its thread", async () => {
  const reached: string[] = [];
  await using app = scopedApp(reached, undefined, "Thread");
  const replied = await app.inject({
    method: "POST",
    url: `${projectPath(own)}/threads/Thread/offer-replies`,
    headers: {
      authorization: `Bearer ${sessionToken}`,
      "content-type": nativeHttpMediaType,
    },
    payload: {
      turn: "turn-1",
      reply: { call: "toolu_01", decision: "Confirmed", outcome: "Succeeded" },
    },
  });
  assert.ok(scopeRefused(replied));
  const sent = await app.inject({
    method: "POST",
    url: `${projectPath(own)}/threads/Thread/messages`,
    headers: {
      authorization: `Bearer ${sessionToken}`,
      "content-type": nativeHttpMediaType,
    },
    payload: { turn: "turn-1", message: "hello" },
  });
  assert.ok(scopeRefused(sent));
  assert.deepEqual(reached, []);
});

/**
 * The interpreter's own submit behind the app, over a membership that reaches
 * `own` and nothing else and an inbox that keeps what it was offered, so what
 * is read is what the door let through and what it asked first.
 */
function revokingWeb(authorized: string[], accepted: Submission[]) {
  const authority = {
    kind: asAuthorityKind("User"),
    subject: asAuthoritySubject("member"),
  };
  return nativeWeb(
    {
      authorize: (asked, partition, access) => {
        authorized.push(
          `${asked}:${partition.tenant}/${partition.project}:${access}`,
        );
        return Promise.resolve(
          partition.tenant === own.tenant && partition.project === own.project
            ? authority
            : undefined,
        );
      },
      authorizeTenant: () => Promise.resolve(undefined),
      authorizeSite: projectAccessSiteRefused,
    },
    recorded([], "reads"),
    {
      accept: (submission) => {
        accepted.push(submission);
        return Promise.resolve({
          accepted: "Accepted",
          operation: {
            partition: submission.partition,
            operation: submission.operation,
            ordinal: 1,
            state: "Pending",
            authorityKind: authority.kind,
            admission: "CorrectnessReducing",
            lifecycleGeneration: 1,
          },
        });
      },
      cancel: () => Promise.resolve({ cancelled: "Unknown" }),
      operation: () => Promise.resolve(undefined),
    },
    recorded([], "authoring"),
    recorded([], "notifications"),
    openExecutionBacklogGuard,
  );
}

/** The revocation of one ticket as a session's tool posts it, the operation being its own key. */
function revocation(partition: Partition, token: string, ticket: number) {
  const operation = `session-${String(ticket)}`;
  return {
    method: "POST" as const,
    url: `${projectPath(partition)}/operations`,
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": nativeHttpMediaType,
      "idempotency-key": operation,
    },
    payload: { operation, mutation: { mutation: "RevokeTicket", ticket } },
  };
}

test("a thread's bearer revokes a ticket in its own project, as its member and through its session", async () => {
  const authorized: string[] = [];
  const accepted: Submission[] = [];
  await using app = scopedApp([], revokingWeb(authorized, accepted), "Thread");
  const answered = await app.inject(revocation(own, sessionToken, 26));
  assert.equal(answered.statusCode, 202);
  assert.deepEqual(answered.json(), {
    operation: "session-26",
    state: "Pending",
  });
  assert.deepEqual(authorized, [`${principal}:acme/atlas:Mutate`]);
  assert.deepEqual(
    accepted.map(({ partition, command, viaSession }) => ({
      partition,
      command,
      viaSession,
    })),
    [
      {
        partition: own,
        command: {
          version: 1,
          command: "Decide",
          ticketCommand: { type: "RevokeTicket", value: 26 },
        },
        viaSession: asSessionId("Thread"),
      },
    ],
  );
});

test("a thread's bearer revoking in another project is answered as a member who cannot reach it, and reaches nothing", async () => {
  const authorized: string[] = [];
  const accepted: Submission[] = [];
  await using app = scopedApp([], revokingWeb(authorized, accepted), "Thread");
  for (const partition of elsewhere) {
    authorized.length = 0;
    const confined = await app.inject(revocation(partition, sessionToken, 26));
    assert.deepEqual(authorized, [], "the door asked the membership");
    const unauthorized = await app.inject(revocation(partition, oidcToken, 26));
    assert.equal(authorized.length, 1, "the member's own was never asked");
    assert.equal(confined.statusCode, 404);
    assert.equal(confined.statusCode, unauthorized.statusCode);
    assert.equal(confined.body, unauthorized.body);
    assert.equal(
      confined.headers["content-type"],
      unauthorized.headers["content-type"],
    );
  }
  assert.deepEqual(accepted, []);
});

/** Setting a member's limit is provisioning sessions, so a session may read
 * the cap on its own partition's threads and never move it. */
test("a session bearer reads a member's thread limit in its own partition and never sets one", () => {
  const params = { tenant: own.tenant, project: own.project, subject: "ada" };
  assert.equal(
    sessionBearerAdmission(
      ownSession,
      "GET",
      nativeHttpRoutes.threadLimit,
      params,
    ),
    "Admitted",
  );
  assert.equal(
    sessionBearerAdmission(
      ownSession,
      "PUT",
      nativeHttpRoutes.threadLimit,
      params,
    ),
    "Refused",
  );
});

test("the admission reads the matched route, folds HEAD into GET and refuses what it cannot place", () => {
  const params = { tenant: own.tenant, project: own.project };
  assert.equal(
    sessionBearerAdmission(
      ownSession,
      "HEAD",
      nativeHttpRoutes.project,
      params,
    ),
    "Admitted",
  );
  assert.equal(
    sessionBearerAdmission(ownSession, "GET", undefined, params),
    "Refused",
  );
  assert.equal(
    sessionBearerAdmission(
      ownSession,
      "PATCH",
      nativeHttpRoutes.project,
      params,
    ),
    "Refused",
  );
  assert.equal(
    sessionBearerAdmission(ownSession, "GET", nativeHttpRoutes.project, {
      tenant: own.tenant,
    }),
    "Refused",
  );
  assert.equal(
    sessionBearerAdmission(ownSession, "GET", nativeHttpRoutes.project, {
      ...params,
      project: "other",
    }),
    "OtherPartition",
  );
});

test("a member's own session bearer reaches every member route at its tenant, reads there and writes nothing, and reaches no other route", async () => {
  const reached: string[] = [];
  await using app = scopedApp(reached, undefined, "Thread", "Member");
  for (const [route, scope] of sessionBearerRouteScopes) {
    reached.length = 0;
    const answered = await app.inject(
      routeRequest(route, ownMember, sessionToken),
    );
    if (scope === "Member")
      assert.ok(
        !scopeRefused(answered) && reached.length > 0,
        `${route} was refused at its tenant: ${String(answered.statusCode)}`,
      );
    else {
      assert.ok(scopeRefused(answered), `${route} was not refused`);
      assert.deepEqual(reached, [], `${route} reached a port`);
    }
    if (scope === "Member") assert.ok(route.startsWith("GET "), route);
  }
});

test("a member's own session bearer is answered at another tenant as a caller who cannot reach it, before any port", async () => {
  const reached: string[] = [];
  await using app = scopedApp(reached, undefined, "Thread", "Member");
  const other = { tenant: asTenantId("other"), project: ownMember.project };
  for (const [route, scope] of sessionBearerRouteScopes) {
    if (scope !== "Member") continue;
    reached.length = 0;
    const answered = await app.inject(routeRequest(route, other, sessionToken));
    assert.equal(answered.statusCode, 404, route);
    assert.deepEqual(reached, [], `${route} reached a port`);
  }
});

test("a member's own session is admitted only from the partition reserved for its own principal, and a project's never to a member route", () => {
  const params = { tenant: own.tenant };
  const route = nativeHttpRoutes.chatThreads;
  assert.equal(
    sessionBearerAdmission(
      {
        partition: ownMember,
        scope: "Member",
        principal,
        capabilities: memberCapabilities,
      },
      "GET",
      route,
      params,
    ),
    "Admitted",
  );
  assert.equal(
    sessionBearerAdmission(
      {
        partition: memberScopePartition(own.tenant, asPrincipal("someone")),
        scope: "Member",
        principal,
        capabilities: memberCapabilities,
      },
      "GET",
      route,
      params,
    ),
    "OtherPartition",
  );
  assert.equal(
    sessionBearerAdmission(ownSession, "GET", route, params),
    "Refused",
  );
  assert.equal(
    sessionBearerAdmission(
      {
        partition: own,
        scope: "Member",
        principal,
        capabilities: memberCapabilities,
      },
      "GET",
      nativeHttpRoutes.project,
      { tenant: own.tenant, project: own.project },
    ),
    "Refused",
  );
});

test("a member's own session bearer reaches no route once its owner may no longer open unscoped chat, answered as a caller who cannot reach it", async () => {
  const reached: string[] = [];
  await using app = scopedApp(reached, undefined, "Thread", "Member", false);
  for (const [route, scope] of sessionBearerRouteScopes) {
    if (scope !== "Member") continue;
    reached.length = 0;
    const answered = await app.inject(
      routeRequest(route, ownMember, sessionToken),
    );
    assert.equal(answered.statusCode, 404, route);
    assert.deepEqual(reached, [], `${route} reached a port`);
  }
});
