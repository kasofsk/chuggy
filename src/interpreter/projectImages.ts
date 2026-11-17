/**
 * A project's icon and banner: the project-owned image artifact it names in
 * each role, read by anyone who may read the project and named or cleared by
 * an administrator, as its default theme is.
 *
 * NAMING IS NOT UPLOADING. An image is uploaded as any project artifact is,
 * under `Mutate`; naming one asks `Administer`, and is refused unless the
 * project holds that artifact, its type is one the roles admit, and its bytes
 * are within its role's bound. The type is read from the artifact's own
 * identity, as its read answers it, and never from its bytes.
 */

import {
  projectImageBytesMax,
  projectImageMediaTypes,
  type ProjectImageRole,
} from "../contract/http.ts";
import type {
  ProjectArtifactId,
  ProjectArtifactPort,
  ProjectArtifactRead,
} from "./finalizerPreparation.ts";
import type { Authority } from "./operationInbox.ts";
import type { ProjectAppearanceService } from "./projectAppearance.ts";
import type { PlacementRead, PlacementWrite } from "./placementRoute.ts";
import type { Principal } from "./principal.ts";
import { projectArtifactMediaTypeOf } from "./projectArtifact.ts";
import type { ProjectAccess } from "./projectAccess.ts";
import type { Partition } from "./projectStore.ts";

/** The artifact a project names in each role, absent where it names none. */
export type ProjectImages = Readonly<
  Partial<Record<ProjectImageRole, ProjectArtifactId>>
>;

/** Each project's images, and the door one role is named or cleared through. */
export interface ProjectImageStore {
  images(partition: Partition): Promise<ProjectImages>;
  writeImage(
    partition: Partition,
    role: ProjectImageRole,
    artifact: ProjectArtifactId | undefined,
    authority: Authority,
  ): Promise<PlacementWrite>;
}

/** A project's images, and whether the reader may change them. */
export interface ProjectImagesView {
  readonly images: ProjectImages;
  readonly administers: boolean;
}

/** Why an artifact may not be named in a role, or the store's outage asking it. */
export type ProjectImageRefused =
  | { readonly result: "ImageNotFound" }
  | { readonly result: "ImageTypeNotAdmitted" }
  | { readonly result: "ImageTooLarge"; readonly bytesMax: number }
  | { readonly result: "Unavailable"; readonly retryAfterSeconds: number };

export type ProjectImageNamed =
  | { readonly result: "NotFound" }
  | ProjectImageRefused
  | {
      readonly result: "Written" | "Unchanged";
      readonly view: ProjectImagesView;
    };

export interface ProjectImageService {
  images(
    principal: Principal,
    partition: Partition,
  ): Promise<PlacementRead<ProjectImagesView>>;
  name(
    principal: Principal,
    partition: Partition,
    role: ProjectImageRole,
    artifact: ProjectArtifactId | undefined,
  ): Promise<ProjectImageNamed>;
}

/** Whether `artifact`'s own identity names a type the roles admit. */
export function projectImageTypeAdmitted(artifact: ProjectArtifactId): boolean {
  const mediaType = projectArtifactMediaTypeOf(artifact);
  return projectImageMediaTypes.some((admitted) => admitted === mediaType);
}

/** The refusal `read` of an artifact of an admitted type makes of naming it in `role`, or none where it may be named. */
export function projectImageReadRefused(
  role: ProjectImageRole,
  read: ProjectArtifactRead,
): ProjectImageRefused | undefined {
  switch (read.read) {
    case "NotFound":
      return { result: "ImageNotFound" };
    case "Unavailable":
      return {
        result: "Unavailable",
        retryAfterSeconds: read.retryAfterSeconds,
      };
    case "Content": {
      const bytesMax = projectImageBytesMax[role];
      return read.content.byteLength > bytesMax
        ? { result: "ImageTooLarge", bytesMax }
        : undefined;
    }
  }
}

/** The refusal naming `artifact` in `role` meets, read from the project's own artifacts, or none. */
async function projectImageNamingRefused(
  artifacts: Pick<ProjectArtifactPort, "readArtifact">,
  partition: Partition,
  role: ProjectImageRole,
  artifact: ProjectArtifactId,
): Promise<ProjectImageRefused | undefined> {
  if (!projectImageTypeAdmitted(artifact))
    return { result: "ImageTypeNotAdmitted" };
  return projectImageReadRefused(
    role,
    await artifacts.readArtifact({ partition, artifact }),
  );
}

async function projectImagesRead(
  access: ProjectAccess,
  store: ProjectImageStore,
  principal: Principal,
  partition: Partition,
): Promise<PlacementRead<ProjectImagesView>> {
  if ((await access.authorize(principal, partition, "Read")) === undefined)
    return { result: "NotFound" };
  const administers =
    (await access.authorize(principal, partition, "Administer")) !== undefined;
  return {
    result: "Found",
    view: { images: await store.images(partition), administers },
  };
}

async function projectImagesName(
  dependencies: ProjectImageDependencies,
  principal: Principal,
  partition: Partition,
  role: ProjectImageRole,
  artifact: ProjectArtifactId | undefined,
): Promise<ProjectImageNamed> {
  const { access, store, artifacts } = dependencies;
  const authority = await access.authorize(principal, partition, "Administer");
  if (authority === undefined) return { result: "NotFound" };
  const refused =
    artifact === undefined
      ? undefined
      : await projectImageNamingRefused(artifacts, partition, role, artifact);
  if (refused !== undefined) return refused;
  const written = await store.writeImage(partition, role, artifact, authority);
  if (written === "NotFound") return { result: "NotFound" };
  return {
    result: written,
    view: { images: await store.images(partition), administers: true },
  };
}

/** What a project's images are decided over: who may act, where they are kept, and the artifacts they name. */
export interface ProjectImageDependencies {
  readonly access: ProjectAccess;
  readonly store: ProjectImageStore;
  readonly artifacts: Pick<ProjectArtifactPort, "readArtifact">;
}

/** One project's icon and banner over `dependencies`. */
export function projectImageService(
  dependencies: ProjectImageDependencies,
): ProjectImageService {
  return {
    images: (principal, partition) =>
      projectImagesRead(
        dependencies.access,
        dependencies.store,
        principal,
        partition,
      ),
    name: (principal, partition, role, artifact) =>
      projectImagesName(dependencies, principal, partition, role, artifact),
  };
}

/** A project's appearance as the API serves it: its themes and its images, each absent where it is not composed. */
export interface ProjectAppearanceServices {
  readonly themes?: ProjectAppearanceService | undefined;
  readonly images?: ProjectImageService | undefined;
}
