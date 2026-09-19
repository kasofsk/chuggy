import { catalogDocument, documentMapping } from "./document.ts";
import {
  PROFILE_NAME,
  execution_profile,
  type ExecutionProfile,
} from "../../interpreter/executionProfile.ts";
import type {
  TicketCatalogSnapshot,
  TicketCatalogSource,
} from "../../interpreter/ticketCatalog.ts";

interface ProjectDocument {
  readonly version: number;
  readonly name: string;
  readonly repository: string;
  readonly cloud_project?: string;
  readonly execution_profiles?: unknown;
  readonly rework_limit?: number;
}

export const projectReworkLimitDefault = 3;

function projectCatalogCloudProject(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (
    typeof value !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9_-]{0,62}\/[A-Za-z0-9][A-Za-z0-9_-]{0,62}$/u.test(
      value,
    )
  )
    throw new TypeError("project cloud_project is invalid");
  return value;
}

function projectCatalogProfiles(
  value: unknown,
): ReadonlyMap<string, ExecutionProfile> {
  if (value === undefined) return new Map();
  if (!documentMapping(value))
    throw new TypeError("project execution_profiles must be a mapping");
  const profiles = new Map<string, ExecutionProfile>();
  for (const [name, profile] of Object.entries(value)) {
    if (!PROFILE_NAME.test(name))
      throw new TypeError(`invalid execution profile name: ${name}`);
    profiles.set(name, execution_profile(profile));
  }
  return profiles;
}

function projectCatalogDocument(value: unknown): ProjectDocument {
  if (!documentMapping(value))
    throw new TypeError("project document must be a mapping");
  const allowed = new Set([
    "version",
    "name",
    "repository",
    "cloud_project",
    "execution_profiles",
    "rework_limit",
  ]);
  const extra = Object.keys(value).find((key) => !allowed.has(key));
  if (extra !== undefined)
    throw new TypeError(`project.${extra} is not allowed`);
  if (value["version"] !== 2)
    throw new TypeError("project version must be exactly 2");
  if (typeof value["name"] !== "string" || value["name"].length === 0)
    throw new TypeError("project name must be nonempty");
  if (
    typeof value["repository"] !== "string" ||
    value["repository"].length === 0
  )
    throw new TypeError("project repository must be nonempty");
  if (
    value["rework_limit"] !== undefined &&
    (!Number.isSafeInteger(value["rework_limit"]) ||
      (value["rework_limit"] as number) < 1)
  )
    throw new TypeError("project rework_limit must be a positive integer");
  return value as unknown as ProjectDocument;
}

/** Resolves workload settings and every catalog file from one immutable tree. */
export async function projectTicketCatalogSource(
  snapshot: TicketCatalogSnapshot,
  repository: string,
): Promise<TicketCatalogSource> {
  const project = projectCatalogDocument(
    catalogDocument(await snapshot.read([".chug", "project.yaml"].join("/"))),
  );
  return {
    repository,
    reworkLimit: project.rework_limit ?? projectReworkLimitDefault,
    cloudProject: projectCatalogCloudProject(project.cloud_project),
    executionProfiles: projectCatalogProfiles(project.execution_profiles),
    read: (path) => snapshot.read(path),
  };
}
