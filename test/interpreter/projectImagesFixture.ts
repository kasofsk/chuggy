/**
 * One project's icon and banner held in memory, over an access double granting
 * `acme/atlas` alone and an artifact store holding each project's own uploads.
 */

import type {
  ImageMediaType,
  ProjectImageRole,
} from "../../src/contract/http.ts";
import {
  asProjectArtifactId,
  type ProjectArtifactId,
  type ProjectArtifactPort,
} from "../../src/interpreter/finalizerPreparation.ts";
import { projectArtifactIdentityText } from "../../src/interpreter/projectArtifact.ts";
import { asArtifactDigest } from "../../src/interpreter/resultManifest.ts";
import {
  projectImageService,
  type ProjectImages,
  type ProjectImageService,
} from "../../src/interpreter/projectImages.ts";
import {
  asPrincipal,
  type Principal,
} from "../../src/interpreter/principal.ts";
import {
  memberAuthority,
  type ProjectAccess,
  type ProjectAccessKind,
} from "../../src/interpreter/projectAccess.ts";
import {
  asProjectId,
  asTenantId,
  type Partition,
} from "../../src/interpreter/projectStore.ts";
import { projectAccessSiteRefused } from "./projectAccessFixture.ts";

export const atlas: Partition = {
  tenant: asTenantId("acme"),
  project: asProjectId("atlas"),
};

export const borealis: Partition = {
  tenant: asTenantId("acme"),
  project: asProjectId("borealis"),
};

export const reader = asPrincipal("reader");
export const developer = asPrincipal("developer");
export const administrator = asPrincipal("administrator");
export const stranger = asPrincipal("stranger");

/** The kinds each caller holds on `acme/atlas`, and on no other project. */
const granted: ReadonlyMap<Principal, readonly ProjectAccessKind[]> = new Map([
  [reader, ["Read"]],
  [developer, ["Read", "Mutate"]],
  [administrator, ["Read", "Mutate", "Administer"]],
]);

export const projectImagesAccess: ProjectAccess = {
  authorize: (principal, partition, kind) =>
    Promise.resolve(
      partition.tenant === atlas.tenant &&
        partition.project === atlas.project &&
        (granted.get(principal) ?? []).includes(kind)
        ? memberAuthority(principal)
        : undefined,
    ),
  authorizeTenant: () => Promise.resolve(undefined),
  authorizeSite: projectAccessSiteRefused,
};

/** An artifact identity of `mediaType`, as an upload would mint one. */
export function projectImagesArtifact(
  mediaType: ImageMediaType,
  token: string,
): ProjectArtifactId {
  return asProjectArtifactId(projectArtifactIdentityText(mediaType, token));
}

/** What the fixture holds: each project's artifacts, its images, and every write the door was asked for. */
export interface ProjectImagesHeld {
  readonly artifacts: Map<string, Map<ProjectArtifactId, Uint8Array>>;
  images: ProjectImages;
  readonly writes: string[];
  unavailable: boolean;
}

const partitionKey = (partition: Partition) =>
  `${partition.tenant}/${partition.project}`;

/** `bytes` stored as `artifact` of `partition`. */
export function projectImagesStored(
  held: ProjectImagesHeld,
  partition: Partition,
  artifact: ProjectArtifactId,
  bytes: number,
): void {
  const key = partitionKey(partition);
  const stored =
    held.artifacts.get(key) ?? new Map<ProjectArtifactId, Uint8Array>();
  stored.set(artifact, new Uint8Array(bytes));
  held.artifacts.set(key, stored);
}

function projectImagesFixtureArtifacts(
  held: ProjectImagesHeld,
): ProjectArtifactPort {
  return {
    writeArtifact: (write) => {
      projectImagesStored(
        held,
        write.partition,
        write.artifact,
        write.content.byteLength,
      );
      return Promise.resolve({
        written: "Artifact",
        digest: asArtifactDigest("a".repeat(64)),
      });
    },
    readArtifact: ({ partition, artifact }) => {
      if (held.unavailable)
        return Promise.resolve({ read: "Unavailable", retryAfterSeconds: 3 });
      const content = held.artifacts
        .get(partitionKey(partition))
        ?.get(artifact);
      return Promise.resolve(
        content === undefined
          ? { read: "NotFound" }
          : { read: "Content", content },
      );
    },
  };
}

/** A service over a project with no images, the artifacts it reads, and what it holds. */
export function projectImagesFixture(): {
  readonly held: ProjectImagesHeld;
  readonly artifacts: ProjectArtifactPort;
  readonly service: ProjectImageService;
} {
  const held: ProjectImagesHeld = {
    artifacts: new Map(),
    images: {},
    writes: [],
    unavailable: false,
  };
  const artifacts = projectImagesFixtureArtifacts(held);
  const service = projectImageService({
    access: projectImagesAccess,
    artifacts,
    store: {
      images: () => Promise.resolve(held.images),
      writeImage: (_partition, role: ProjectImageRole, artifact, authority) => {
        held.writes.push(`${role}:${authority.subject}:${artifact ?? ""}`);
        const unchanged = held.images[role] === artifact;
        const images: { [Role in ProjectImageRole]?: ProjectArtifactId } = {
          ...held.images,
        };
        if (artifact === undefined) delete images[role];
        else images[role] = artifact;
        held.images = images;
        return Promise.resolve(unchanged ? "Unchanged" : "Written");
      },
    },
  });
  return { held, artifacts, service };
}
