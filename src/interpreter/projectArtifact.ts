/**
 * Giving a project an image, and reading it back: the one HTTP-facing use of
 * the project-owned artifact port `./finalizerPreparation.ts` declares.
 *
 * THE MEDIA TYPE RIDES IN THE IDENTITY RATHER THAN A SECOND ROW. A
 * project-owned artifact's identity is opaque to the store that holds it and
 * minted once by whoever writes it; this is the one place that mints it and
 * the one place that reads it back, so writing the admitted media type in
 * front of the separator is the single record of it. A durable row holding
 * the same fact beside it is what standing rule 3 rejects.
 */

import type { ArtifactDigest } from "./resultManifest.ts";
import { imageMediaTypes, type ImageMediaType } from "../contract/http.ts";
import type {
  ProjectArtifactId,
  ProjectArtifactPort,
} from "./finalizerPreparation.ts";
import type { Partition } from "./projectStore.ts";

/**
 * Separates the admitted media type from the random token in the identity's
 * text. Neither half may contain it: every admitted media type is `image/*`
 * with no colon of its own, and the token is minted text with none either.
 */
const projectArtifactIdentitySeparator = ":";

/** The identity text one upload mints, the media type kept recoverable in front of the separator. */
export function projectArtifactIdentityText(
  mediaType: ImageMediaType,
  token: string,
): string {
  return `${mediaType}${projectArtifactIdentitySeparator}${token}`;
}

/** The admitted media type an identity was minted with, or nothing where it names none the roster admits. */
export function projectArtifactMediaTypeOf(
  artifact: ProjectArtifactId,
): ImageMediaType | undefined {
  const at = artifact.indexOf(projectArtifactIdentitySeparator);
  if (at === -1) return undefined;
  const candidate = artifact.slice(0, at);
  return imageMediaTypes.find((known) => known === candidate);
}

/** Where a fresh project-owned artifact identity comes from, which is the composition root and never a clock here. */
export interface ProjectArtifactMinting {
  mint(mediaType: ImageMediaType): ProjectArtifactId;
}

/** What uploading one project-owned image came to. */
export type ProjectArtifactUploaded =
  | {
      readonly uploaded: "Artifact";
      readonly artifact: ProjectArtifactId;
      readonly digest: ArtifactDigest;
    }
  | { readonly uploaded: "NotAnImage" }
  | { readonly uploaded: "Unavailable"; readonly retryAfterSeconds: number };

/**
 * Mints an identity carrying the media type and writes the bytes behind it.
 * What the store already refuses — past its own write ceiling — stays its to
 * refuse; a caller past the wire's own upload bound never reaches here at all.
 */
export async function projectArtifactUploaded(
  minting: ProjectArtifactMinting,
  store: ProjectArtifactPort,
  partition: Partition,
  mediaType: string,
  content: Uint8Array,
): Promise<ProjectArtifactUploaded> {
  const admitted = imageMediaTypes.find((known) => known === mediaType);
  if (admitted === undefined) return { uploaded: "NotAnImage" };
  const artifact = minting.mint(admitted);
  const written = await store.writeArtifact({ partition, artifact, content });
  return written.written === "Artifact"
    ? { uploaded: "Artifact", artifact, digest: written.digest }
    : { uploaded: "Unavailable", retryAfterSeconds: written.retryAfterSeconds };
}

/** What reading one project-owned image back came to. */
export type ProjectArtifactFetched =
  | {
      readonly fetched: "Content";
      readonly content: Uint8Array;
      readonly mediaType: ImageMediaType;
    }
  | { readonly fetched: "NotFound" }
  | { readonly fetched: "Unavailable"; readonly retryAfterSeconds: number };

/** Reads one project-owned artifact's bytes back, recovering the media type from its own identity. */
export async function projectArtifactFetched(
  store: ProjectArtifactPort,
  partition: Partition,
  artifact: ProjectArtifactId,
): Promise<ProjectArtifactFetched> {
  const mediaType = projectArtifactMediaTypeOf(artifact);
  if (mediaType === undefined) return { fetched: "NotFound" };
  const read = await store.readArtifact({ partition, artifact });
  if (read.read === "Content") {
    return { fetched: "Content", content: read.content, mediaType };
  }
  return read.read === "Unavailable"
    ? { fetched: "Unavailable", retryAfterSeconds: read.retryAfterSeconds }
    : { fetched: "NotFound" };
}
