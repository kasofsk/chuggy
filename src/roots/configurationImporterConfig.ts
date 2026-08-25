import { z } from "zod";

import { asGitObjectId, asRepositoryId } from "../interpreter/finalizer.ts";
import {
  asProjectId,
  asTenantId,
  type Partition,
} from "../interpreter/projectStore.ts";
import type { RepositoryCredentialFile } from "../interpreter/finalizerSettings.ts";
import {
  commandDatabaseConfig,
  commandDatabaseSchema,
  decodedCommandConfiguration,
  positiveInteger,
} from "./commandConfig.ts";
import type { ProcessDatabaseConfig } from "./controlPlane.ts";
import type { GitObjectId } from "../interpreter/finalizer.ts";

const configurationImporterVariable = "CHUG_CONFIGURATION_IMPORT_CONFIG";
export const configurationImporterPartitionsMax = 100;

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
    commit: z.string().regex(/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u),
    partitions: z
      .array(
        z
          .object({ tenant: z.string().min(1), project: z.string().min(1) })
          .strict(),
      )
      .min(1)
      .max(configurationImporterPartitionsMax),
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
  readonly commit: GitObjectId;
  readonly partitions: readonly Partition[];
}

export function configurationImporterConfig(
  environment: NodeJS.ProcessEnv,
): ConfigurationImporterConfig {
  const parsed = decodedCommandConfiguration(
    configurationImporterVariable,
    configurationImporterSchema,
    environment,
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
    commit: asGitObjectId(parsed.commit),
    partitions: parsed.partitions.map(({ tenant, project }) => ({
      tenant: asTenantId(tenant),
      project: asProjectId(project),
    })),
  };
}
