import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { setTimeout as wait } from "node:timers/promises";

import { z } from "zod";

import { nativeHttpClient } from "../adapters/http/client.ts";
import {
  clientCredentialsTokenSource,
  type AccessTokenRead,
} from "../adapters/http/clientCredentials.ts";
import { selectorContextHttp } from "../adapters/http/selectorContext.ts";
import {
  trustedSelectorPolicyHttpClient,
  type TrustedSelectorPolicyClient,
} from "../adapters/http/trustedSelectorPolicy.ts";
import { asPrincipal, type Principal } from "../interpreter/nativeWeb.ts";
import { asOperationId } from "../interpreter/operationInbox.ts";
import {
  selectorNativeSource,
  type SelectorNativeApi,
} from "../interpreter/selectorNativeSource.ts";
import type { SelectorIdentityFactory } from "../interpreter/selectorRuntime.ts";
import type {
  RuntimePrecondition,
  ServiceRuntime,
  ServiceStopResult,
} from "../interpreter/serviceRuntime.ts";
import { trustedSelectorPolicyHost } from "../interpreter/trustedSelectorPolicyHost.ts";
import {
  commandDatabaseConfig,
  commandDatabaseSchema,
  commandRuntimeSchema,
  decodedCommandConfiguration,
  positiveInteger,
} from "./commandConfig.ts";
import {
  selectorProcessRoot,
  type SelectorProcessRootConfig,
} from "./controlPlane.ts";

const configurationVariable = "CHUG_SELECTOR_CONFIG";
const clientSecretVariable = "CHUG_SELECTOR_SOURCE_CLIENT_SECRET";
const httpUrl = z.url().refine((value) => {
  const protocol = new URL(value).protocol;
  return protocol === "http:" || protocol === "https:";
});
const bearerToken = z
  .string()
  .min(1)
  .refine((value) => value.isWellFormed() && !/\s/u.test(value));
const service = z
  .object({
    baseUrl: httpUrl,
    requestDeadlineMs: positiveInteger,
    responseBytesMax: positiveInteger,
  })
  .strict();
const credential = z
  .object({
    tokenUrl: httpUrl,
    clientId: z.string().min(1).max(256),
    audience: z.array(z.string().min(1)).max(8),
    scope: z.array(z.string().min(1)).max(8),
    refreshMarginMs: positiveInteger,
  })
  .strict();
const configurationSchema = z
  .object({
    database: commandDatabaseSchema,
    runtime: commandRuntimeSchema,
    selector: z
      .object({
        projectsMax: positiveInteger.max(100),
        deliveriesMax: positiveInteger.max(100),
        reconciliationsMax: positiveInteger.max(100),
      })
      .strict()
      .optional(),
    identity: z
      .object({
        principal: z.string().min(1).max(256),
        instance: z.string().min(1).max(128),
      })
      .strict(),
    source: service
      .extend({ responseReadsMax: positiveInteger, credential })
      .strict(),
    policy: service
      .extend({ bearerToken, controlDeadlineMs: positiveInteger })
      .strict(),
  })
  .strict();

/** The parsed source, whose credential the environment completes with the secret the configuration must not carry. */
export interface SelectorSourceCommandConfig extends Omit<
  z.infer<typeof configurationSchema>["source"],
  "credential"
> {
  readonly credential: z.infer<typeof credential> & {
    readonly clientSecret: string;
  };
}

export interface SelectorCommandConfig {
  readonly process: SelectorProcessRootConfig;
  readonly identity: { readonly principal: string; readonly instance: string };
  readonly source: SelectorSourceCommandConfig;
  readonly policy: z.infer<typeof configurationSchema>["policy"];
}

export type SelectorCommandResult =
  | { readonly outcome: "Stopped"; readonly stop: ServiceStopResult }
  | { readonly outcome: "CouldNotRun"; readonly precondition: string }
  | { readonly outcome: "Failed"; readonly failure: string };

export interface SelectorCommandExit {
  readonly code: 0 | 1 | 2 | 3;
  readonly diagnostic?: string;
}

interface ProcessSignals {
  once(signal: NodeJS.Signals, listener: () => void): unknown;
  removeListener(signal: NodeJS.Signals, listener: () => void): unknown;
}

export function selectorConfiguration(
  environment: NodeJS.ProcessEnv,
): SelectorCommandConfig {
  const data = decodedCommandConfiguration(
    configurationVariable,
    configurationSchema,
    environment,
  );
  const clientSecret = environment[clientSecretVariable];
  if (clientSecret === undefined || clientSecret.length === 0)
    throw new Error(`${clientSecretVariable} is required`);
  return {
    process: {
      database: commandDatabaseConfig(data.database),
      runtime: data.runtime,
      ...(data.selector === undefined ? {} : { selector: data.selector }),
    },
    identity: data.identity,
    source: {
      ...data.source,
      credential: { ...data.source.credential, clientSecret },
    },
    policy: data.policy,
  };
}

export function selectorIdentities(instance: string): SelectorIdentityFactory {
  return {
    next: () => {
      const cycle = randomUUID();
      return {
        operation: asOperationId(`selector-operation-${instance}-${cycle}`),
        selectorDecisionReference: `selector-decision-${instance}-${cycle}`,
      };
    },
  };
}

function deadline(milliseconds: number, signal?: AbortSignal): Promise<never> {
  return wait(milliseconds, undefined, { signal }).then(() => {
    throw new Error("selector deadline exceeded");
  });
}

function readyPrecondition(
  name: string,
  check: (signal: AbortSignal) => Promise<boolean>,
): RuntimePrecondition {
  return { name, check };
}

export function selectorCommandPreconditions(
  native: SelectorNativeApi,
  policy: TrustedSelectorPolicyClient,
  principal: Principal,
  sourceReady: (signal: AbortSignal) => Promise<boolean>,
): readonly RuntimePrecondition[] {
  return [
    readyPrecondition("selector-source", async (signal) => {
      signal.throwIfAborted();
      if (!(await sourceReady(signal))) return false;
      await native.projectInventory(principal, undefined, 1);
      signal.throwIfAborted();
      return true;
    }),
    readyPrecondition("selector-policy", (signal) => policy.ready(signal)),
  ];
}

async function nativeSourceReady(
  baseUrl: string,
  timeoutMs: number,
  signal: AbortSignal,
): Promise<boolean> {
  const deadline = AbortSignal.timeout(timeoutMs);
  const response = await fetch(new URL("health/ready", baseUrl), {
    signal: AbortSignal.any([signal, deadline]),
  });
  await response.body?.cancel();
  return response.status === 200;
}

/** One token source behind both clients of the API, so a replacement is minted once and presented by both. */
export function selectorSourceAccessToken(
  source: SelectorSourceCommandConfig,
): AccessTokenRead {
  return clientCredentialsTokenSource({
    tokenUrl: source.credential.tokenUrl,
    clientId: source.credential.clientId,
    clientSecret: source.credential.clientSecret,
    audience: source.credential.audience,
    scope: source.credential.scope,
    requestTimeoutMs: source.requestDeadlineMs,
    responseBytesMax: source.responseBytesMax,
    responseReadsMax: source.responseReadsMax,
    refreshMarginMs: source.credential.refreshMarginMs,
  });
}

export function selectorCommandRoot(
  config: SelectorCommandConfig,
): ServiceRuntime {
  const accessToken = selectorSourceAccessToken(config.source);
  const native = nativeHttpClient({
    baseUrl: config.source.baseUrl,
    accessToken,
    requestTimeoutMs: config.source.requestDeadlineMs,
    responseBytesMax: config.source.responseBytesMax,
  });
  const context = selectorContextHttp({
    baseUrl: config.source.baseUrl,
    accessToken,
    requestTimeoutMs: config.source.requestDeadlineMs,
    responseBytesMax: config.source.responseBytesMax,
    responseReadsMax: config.source.responseReadsMax,
  });
  const policyClient = trustedSelectorPolicyHttpClient(config.policy);
  const principal = asPrincipal(config.identity.principal);
  const policy = trustedSelectorPolicyHost(
    policyClient,
    { after: (milliseconds, signal) => deadline(milliseconds, signal) },
    { controlDeadlineMs: config.policy.controlDeadlineMs },
  );
  const source = selectorNativeSource(native, principal, {
    currentTimeEpochMs: () => Promise.resolve(Date.now()),
    currentInstant: () => Promise.resolve(new Date().toISOString()),
    decisionDeadline: (milliseconds) => deadline(milliseconds),
    operationalContext: (partition) => context.context(partition),
  });
  return selectorProcessRoot(
    config.process,
    source,
    policy,
    selectorIdentities(config.identity.instance),
    selectorCommandPreconditions(native, policyClient, principal, (signal) =>
      nativeSourceReady(
        config.source.baseUrl,
        config.source.requestDeadlineMs,
        signal,
      ),
    ),
  );
}

export async function runSelector(
  runtime: ServiceRuntime,
  signals: ProcessSignals = process,
): Promise<SelectorCommandResult> {
  let stop: Promise<ServiceStopResult> | undefined;
  let signalReceived!: () => void;
  const signal = new Promise<void>((resolve) => {
    signalReceived = resolve;
  });
  const terminate = (): void => {
    void stopRuntime();
    signalReceived();
  };
  const stopRuntime = (): Promise<ServiceStopResult> =>
    (stop ??= runtime.stop());
  for (const name of ["SIGINT", "SIGTERM"] as const)
    signals.once(name, terminate);
  try {
    const started = await Promise.race([
      runtime.start(),
      signal.then(() => ({ started: "Stopped" }) as const),
    ]);
    if (started.started === "CouldNotRun") {
      await stopRuntime();
      return { outcome: "CouldNotRun", precondition: started.precondition };
    }
    if (started.started === "Stopped")
      return { outcome: "Stopped", stop: await stopRuntime() };
    const completion = await Promise.race([
      runtime
        .settled()
        .then((health) => ({ kind: "settled", health }) as const),
      signal.then(() => ({ kind: "signal" }) as const),
    ]);
    if (completion.kind === "settled" && !completion.health.live) {
      await stopRuntime();
      return {
        outcome: "Failed",
        failure: completion.health.failure ?? "unknown runtime failure",
      };
    }
    return { outcome: "Stopped", stop: await stopRuntime() };
  } finally {
    for (const name of ["SIGINT", "SIGTERM"] as const)
      signals.removeListener(name, terminate);
  }
}

export async function selectorMain(
  environment: NodeJS.ProcessEnv,
  root: (config: SelectorCommandConfig) => ServiceRuntime = selectorCommandRoot,
  signals: ProcessSignals = process,
): Promise<SelectorCommandExit> {
  let config: SelectorCommandConfig;
  try {
    config = selectorConfiguration(environment);
  } catch (failure) {
    const message =
      failure instanceof Error ? failure.message : "invalid configuration";
    return { code: 2, diagnostic: `selector configuration: ${message}` };
  }
  let result: SelectorCommandResult;
  try {
    result = await runSelector(root(config), signals);
  } catch (failure) {
    const message =
      failure instanceof Error ? failure.message : "unknown failure";
    return { code: 1, diagnostic: `selector failed: ${message}` };
  }
  if (result.outcome === "CouldNotRun")
    return {
      code: 3,
      diagnostic: `selector could not run: ${result.precondition}`,
    };
  if (result.outcome === "Failed")
    return { code: 1, diagnostic: `selector failed: ${result.failure}` };
  if (result.stop.stopped === "DrainExpired")
    return { code: 1, diagnostic: "selector failed: shutdown drain expired" };
  return { code: 0 };
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href
)
  await selectorMain(process.env).then((result) => {
    if (result.diagnostic !== undefined)
      process.stderr.write(`${result.diagnostic}\n`);
    process.exitCode = result.code;
  });
