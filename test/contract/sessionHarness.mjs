/**
 * The doubles two session suites drive the pod through: a worker plane that
 * records what it was asked, a runtime whose messages a case scripts, and the
 * one `sessionMain` call that wires them together.
 *
 * IT IS A MODULE RATHER THAN A COPY BECAUSE THE TAIL KEPT COLLIDING. The pod's
 * suites are appended to, and two of them appended at the same offset twice
 * over; a suite per subject is what stops that, and a suite per subject needs
 * one harness rather than one each. It sits here rather than beside the pod
 * because everything the image directory holds but a suite is a module the
 * image must carry, and a double is not one — the same reason the roster
 * fixture those suites read is here.
 */

import { z } from "zod";

import { sessionMain } from "../../images/worker/session.mjs";

/** The rejection frame kasofsk/chuggy#386 reports, as the runtime declares it. */
export const rejection = {
  type: "rate_limit_event",
  rate_limit_info: { status: "rejected", rateLimitType: "five_hour" },
};

export const bearerFile = "/var/run/chuggy/session-capability/bearer";
const credentialFile = "/var/run/chuggy/credentials/claude-code";
export const bearer = "chgs_0123456789abcdef0123456789abcdef";
export const token = "sk-ant-oat01-0123456789abcdefghijklmnop";

export const task = {
  tenant: "vteng",
  project: "chuggy",
  session: "session-1",
  kind: "Lead",
  attempt: "attempt-1",
  generation: 1,
  workerPlane: {
    url: "http://worker-plane.test:3001",
    capabilityFile: bearerFile,
  },
  api: { url: "http://chuggy-api.test:3000" },
  bounds: {
    mailboxPollMs: 1,
    idleMs: 1,
    resultDrainMs: 50,
    loadTimeoutMs: 1_000,
    turnsMax: 200,
    budgetUsd: 5,
  },
};

export const environment = {
  CHUG_SESSION_TASK: JSON.stringify(task),
  CHUG_WORKER_CREDENTIAL_FILES: JSON.stringify({
    "claude-code": credentialFile,
  }),
  CHUG_WORKER_WORKSPACE: "/workspace",
};

export function planeOf(turns, facts, refuse = () => undefined) {
  const calls = [];
  let claims = 0;
  return {
    calls,
    request: async (_task, _bearer, path, init) => {
      const refused = refuse(path);
      if (refused !== undefined) {
        calls.push({ path, method: init?.method });
        return { status: refused, json: async () => ({}) };
      }
      const type = init?.headers?.["content-type"];
      calls.push({
        path,
        method: init?.method,
        body: type === "application/json" ? JSON.parse(init.body) : init?.body,
      });
      if (path === "/v1/session")
        return { status: 200, json: async () => facts };
      if (path === "/v1/session/turn") {
        const turn = turns[claims];
        claims += 1;
        return turn === undefined
          ? { status: 204 }
          : { status: 200, json: async () => turn };
      }
      return { status: 204 };
    },
  };
}

export function queryOf(script) {
  const seen = {};
  return {
    seen,
    query: ({ prompt, options }) => {
      seen.options = options;
      return (async function* messages() {
        let index = 0;
        for await (const asked of prompt) {
          for (const message of script(asked, index, options)) {
            if (typeof message === "function") await message();
            else yield message;
          }
          index += 1;
        }
      })();
    },
  };
}

export const facts = {
  tenant: "vteng",
  project: "chuggy",
  session: "session-1",
  kind: "Lead",
  capabilities: ["RepositoryRead", "RunCommands"],
  credentialSlot: "claude-code",
};

/**
 * The runtime as this pod resolves it, with the suite's own `query`. The other
 * three members are what the in-process server is built from, and `zod` is the
 * real one: a stub shape would prove the tools were registered and nothing about
 * whether their bounds hold.
 */
function sdkOf(query) {
  return {
    query,
    z,
    tool: (name, description, shape, handler) => ({
      name,
      description,
      shape,
      handler,
    }),
    createSdkMcpServer: (options) => options,
  };
}

export function run(services) {
  const { query, ...rest } = services;
  return sessionMain({
    environment,
    read: async (path) => (path === bearerFile ? `${bearer}\n` : `${token}\n`),
    ensureDirectory: async () => undefined,
    warn: () => undefined,
    ...(query === undefined ? {} : { sdk: sdkOf(query) }),
    ...rest,
  });
}

export const turnOne = {
  turn: "turn-1",
  ordinal: 1,
  inputKind: "UserMessage",
  input: "ask",
};
export const result = (subtype, extra = {}) => ({
  type: "result",
  subtype,
  ...extra,
});
