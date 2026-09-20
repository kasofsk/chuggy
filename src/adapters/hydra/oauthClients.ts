/**
 * `WorkerPoolClients` over Ory Hydra's admin API, which is where a pool's
 * secret lives and where this tree keeps none of its own.
 *
 * THE CLIENT IS MINTED WITH ONE GRANT AND ONE AUDIENCE. Chuggy registers it
 * rather than letting a machine register itself, and that is the whole reason
 * dynamic registration is not used here: a client this side composes carries
 * `client_credentials`, the API's audience and no redirect, and a pool cannot
 * widen any of the three by asking. A public client, an authorization code or a
 * refresh token would each be a pool holding a door meant for a person.
 *
 * ADMIN IS NOT A PLANE PRIVILEGE. Nothing a pool can reach is composed with
 * this adapter: the plane pools poll verifies tokens against the issuer's
 * published keys and mints nothing, so a pool that took that process could not
 * create a second client to be some other project's pool with.
 *
 * A FAULT IS NEVER A REFUSAL. Every status this side did not ask for, every
 * body it cannot read and every connection it could not open raise
 * `WorkerPoolClientUnavailable`, because a registration reported as denied when
 * the issuer was merely unreachable is an owner deleting a pool that exists.
 * The one status a removal asks for beyond success is not-found: a client the
 * issuer no longer holds is the state the removal is for, and answering a fault
 * to it would make a deregistration that failed after this step unrepeatable.
 */

import { z } from "zod";

import {
  WorkerPoolClientUnavailable,
  type WorkerPoolClients,
  type WorkerPoolClientSecret,
} from "../../interpreter/workerPool.ts";

/** The admin API's client collection, which both verbs address. */
const hydraClientsPath = "admin/clients";

/** The most one answer may weigh, which is orders above a client registration. */
export const hydraResponseBytesMax = 64 * 1024;

/**
 * Hydra answers a created client with every member it defaulted, and only two
 * of them are read: a secret it did not return is a client nobody could ever
 * authenticate as, which is a fault rather than a client.
 */
const hydraCreatedClientSchema = z.object({
  client_id: z.string().min(1),
  client_secret: z.string().min(1),
});

export interface HydraClientSettings {
  readonly adminUrl: string;
  readonly audience: string;
  readonly requestTimeoutMs: number;
}

/** Narrows the admin address, which carries no credential and is never a pool's. */
export function checkedHydraClientSettings(
  input: HydraClientSettings,
): HydraClientSettings {
  const url = new URL(input.adminUrl);
  if (url.protocol !== "http:" && url.protocol !== "https:")
    throw new RangeError("Hydra admin URL must be HTTP or HTTPS");
  if (url.username !== "" || url.password !== "")
    throw new RangeError("Hydra admin URL must carry no credentials");
  if (input.audience.length === 0)
    throw new RangeError("Hydra client audience is empty");
  if (
    !Number.isSafeInteger(input.requestTimeoutMs) ||
    input.requestTimeoutMs < 1
  )
    throw new RangeError("Hydra admin timeout must be a positive integer");
  return { ...input, adminUrl: url.toString() };
}

/** One answer read under a byte bound, so a stream cannot hold the command open. */
async function hydraBoundedText(response: Response): Promise<string> {
  if (response.body === null) return "";
  const decoder = new TextDecoder("utf-8", { fatal: false });
  const reader = response.body.getReader();
  let text = "";
  let weighed = 0;
  for (let read = await reader.read(); !read.done; read = await reader.read()) {
    weighed += (read.value as Uint8Array).byteLength;
    if (weighed > hydraResponseBytesMax) {
      await reader.cancel("the issuer's answer is past its bound");
      throw new WorkerPoolClientUnavailable("the answer is past its bound");
    }
    text += decoder.decode(read.value as Uint8Array, { stream: true });
  }
  return text + decoder.decode();
}

async function hydraRequest(input: {
  readonly url: URL;
  readonly method: string;
  readonly settings: HydraClientSettings;
  readonly fetcher: typeof fetch;
  readonly body?: unknown;
  /** Whether the issuer answering that there is no such client is the outcome asked for. */
  readonly absentIsDone?: boolean;
}): Promise<unknown> {
  const what = `${input.method} ${input.url.pathname}`;
  let answered: Response;
  try {
    answered = await input.fetcher(input.url, {
      method: input.method,
      signal: AbortSignal.timeout(input.settings.requestTimeoutMs),
      headers: {
        accept: "application/json",
        ...(input.body === undefined
          ? {}
          : { "content-type": "application/json" }),
      },
      ...(input.body === undefined ? {} : { body: JSON.stringify(input.body) }),
    });
  } catch (failure) {
    throw new WorkerPoolClientUnavailable(
      `${what} did not complete: ${failure instanceof Error ? failure.message : "unknown fault"}`,
    );
  }
  const text = await hydraBoundedText(answered);
  if (answered.status === 404 && input.absentIsDone === true) return undefined;
  if (!answered.ok)
    throw new WorkerPoolClientUnavailable(
      `${what} answered ${String(answered.status)}`,
    );
  if (text.length === 0) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new WorkerPoolClientUnavailable(`${what} answered no JSON`);
  }
}

/**
 * The registration body, which is the whole of what this tree decides about a
 * pool's client. `response_types` is empty and `redirect_uris` is absent
 * because a machine completes no browser flow.
 */
function hydraPoolClientBody(
  clientId: string,
  settings: HydraClientSettings,
): Record<string, unknown> {
  return {
    client_id: clientId,
    client_name: clientId,
    grant_types: ["client_credentials"],
    response_types: [],
    audience: [settings.audience],
    token_endpoint_auth_method: "client_secret_basic",
    scope: "",
  };
}

export function hydraWorkerPoolClients(
  input: HydraClientSettings,
  fetcher: typeof fetch = fetch,
): WorkerPoolClients {
  const settings = checkedHydraClientSettings(input);
  return {
    create: async (clientId): Promise<WorkerPoolClientSecret> => {
      const created = hydraCreatedClientSchema.safeParse(
        await hydraRequest({
          url: new URL(hydraClientsPath, settings.adminUrl),
          method: "POST",
          settings,
          fetcher,
          body: hydraPoolClientBody(clientId, settings),
        }),
      );
      if (!created.success)
        throw new WorkerPoolClientUnavailable(
          "the issuer registered a client it returned no secret for",
        );
      return {
        clientId: created.data.client_id,
        clientSecret: created.data.client_secret,
      };
    },
    remove: async (clientId) => {
      await hydraRequest({
        url: new URL(
          `${hydraClientsPath}/${encodeURIComponent(clientId)}`,
          settings.adminUrl,
        ),
        method: "DELETE",
        settings,
        fetcher,
        absentIsDone: true,
      });
    },
  };
}
