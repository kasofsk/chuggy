import { z } from "zod";

import { asRepositoryId } from "../interpreter/finalizer.ts";
import type { RepositoryCredentialFile } from "../interpreter/finalizerSettings.ts";
import type { ForgeAppKey } from "../interpreter/forgeInstallation.ts";
import {
  commandDatabaseConfig,
  commandDatabaseSchema,
  decodedCommandConfiguration,
  positiveInteger,
} from "./commandConfig.ts";
import type { ProcessDatabaseConfig } from "./controlPlane.ts";

const configurationImporterVariable = "CHUG_CONFIGURATION_IMPORT_CONFIG";

const configurationImporterSchema = z
  .object({
    database: commandDatabaseSchema,
    git: z
      .object({
        scratchDirectory: z.string().min(1),
        credentialSources: z
          .array(
            z
              .object({
                repository: z.string().min(1),
                credentialReference: z.string().min(1).optional(),
                path: z.string().min(1),
              })
              .strict(),
          )
          .max(256),
        credentialUsername: z.string().min(1).optional(),
        localTimeoutSecsMax: positiveInteger.optional(),
        remoteTimeoutSecsMax: positiveInteger.optional(),
      })
      .strict(),
    forge: z
      .object({
        appId: z.string().min(1),
        keyFile: z.string().min(1),
        apiUrl: z.string().min(1).optional(),
        timeoutMs: positiveInteger.optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export interface ConfigurationImporterConfig {
  readonly database: ProcessDatabaseConfig;
  readonly git: {
    readonly scratchDirectory: string;
    readonly credentials: readonly RepositoryCredentialFile[];
    readonly credentialUsername?: string;
    readonly localTimeoutSecsMax?: number;
    readonly remoteTimeoutSecsMax?: number;
  };
  /**
   * The App key this run reads a repository under, where it holds one. A run
   * naming neither a key nor a credential file could read nothing, so the
   * configuration refuses it before the database is opened.
   */
  readonly forge?: ForgeAppKey;
}

export function configurationImporterConfig(
  environment: NodeJS.ProcessEnv,
): ConfigurationImporterConfig {
  const parsed = decodedCommandConfiguration(
    configurationImporterVariable,
    configurationImporterSchema,
    environment,
  );
  if (parsed.forge === undefined && parsed.git.credentialSources.length === 0)
    throw new Error(
      `${configurationImporterVariable}.forge or ${configurationImporterVariable}.git.credentialSources is required`,
    );
  return {
    database: commandDatabaseConfig(parsed.database),
    git: {
      scratchDirectory: parsed.git.scratchDirectory,
      credentials: parsed.git.credentialSources.map((source) => ({
        repository: asRepositoryId(source.repository),
        ...(source.credentialReference === undefined
          ? {}
          : { credentialReference: source.credentialReference }),
        path: source.path,
      })),
      ...(parsed.git.credentialUsername === undefined
        ? {}
        : { credentialUsername: parsed.git.credentialUsername }),
      ...(parsed.git.localTimeoutSecsMax === undefined
        ? {}
        : { localTimeoutSecsMax: parsed.git.localTimeoutSecsMax }),
      ...(parsed.git.remoteTimeoutSecsMax === undefined
        ? {}
        : { remoteTimeoutSecsMax: parsed.git.remoteTimeoutSecsMax }),
    },
    ...(parsed.forge === undefined
      ? {}
      : {
          forge: {
            appId: parsed.forge.appId,
            keyFile: parsed.forge.keyFile,
            ...(parsed.forge.apiUrl === undefined
              ? {}
              : { apiUrl: parsed.forge.apiUrl }),
            ...(parsed.forge.timeoutMs === undefined
              ? {}
              : { requestTimeoutMs: parsed.forge.timeoutMs }),
          },
        }),
  };
}
