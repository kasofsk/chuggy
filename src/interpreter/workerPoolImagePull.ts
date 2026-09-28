/**
 * Which registry requests a pool may make, and the host a pool pulls an
 * assignment's image from.
 *
 * The registry's front forwards the method and address of every request it
 * receives, and a request is allowed only where it is exactly a pull of an
 * image the pool holds an assignment for: a manifest by the digest an
 * assignment pinned, or a blob of that image's repository. What an image is
 * called on the cluster and what a pool off it pulls it by differ only in the
 * host, so the digest a pool is handed is the one its execution pinned.
 */
import { textCodePointsCount } from "../contract/http.ts";
import { workerImageCharsMax } from "../contract/workerPool.ts";

/** The public host each internal registry host is published as. */
export type WorkerPoolImageHosts = ReadonlyMap<string, string>;

/** One registry request a pool may make, as its forwarded method and address parse. */
export type WorkerPoolImagePull =
  | { readonly pull: "Base" }
  | {
      readonly pull: "Manifest" | "Blob";
      readonly repository: string;
      readonly digest: string;
    };

/** An OCI repository name: lowercase components joined by `/`, each separated within by `.`, `_`, `__` or dashes. */
const workerPoolImageRepository =
  "[a-z0-9]+(?:(?:[._]|__|-+)[a-z0-9]+)*(?:/[a-z0-9]+(?:(?:[._]|__|-+)[a-z0-9]+)*)*";

const workerPoolImageDigest = "sha256:[0-9a-f]{64}";

/** The only addresses a pull may name, so a catalog, a tag list, a referrers query, an upload or anything encoded is none of them. */
const workerPoolImagePullAddress = new RegExp(
  `^/v2/(?:(?<repository>${workerPoolImageRepository})/(?<kind>manifests|blobs)/(?<digest>${workerPoolImageDigest}))?$`,
  "u",
);

/** An image reference pinned by digest, with or without a tag beside it. */
const workerPoolImageReference = new RegExp(
  `^(?<host>[^/]+)/(?<repository>${workerPoolImageRepository})(?::[A-Za-z0-9_][A-Za-z0-9_.-]{0,127})?@(?<digest>${workerPoolImageDigest})$`,
  "u",
);

/** A registry host as a reference names one: a domain, `localhost` or an address, with an optional port. */
const workerPoolImageHost =
  /^(?=[^.:]*[.:]|localhost(?::|$))[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)*(?::[0-9]+)?$/u;

/** The pull a forwarded request is, or nothing where the method or the address is not one a pull makes. */
export function workerPoolImagePullRequested(
  method: string | undefined,
  address: string | undefined,
): WorkerPoolImagePull | undefined {
  if (method !== "GET" && method !== "HEAD") return undefined;
  const named = workerPoolImagePullAddress.exec(address ?? "")?.groups;
  if (named === undefined) return undefined;
  const { repository, kind, digest } = named;
  if (repository === undefined || digest === undefined) return { pull: "Base" };
  return {
    pull: kind === "manifests" ? "Manifest" : "Blob",
    repository,
    digest,
  };
}

/**
 * Whether a pool holding assignments pinned to `held` may make `pull`. Only an
 * image on an internal host counts, because that is the registry the front
 * serves.
 */
export function workerPoolImagePullAllowed(
  pull: WorkerPoolImagePull,
  held: readonly string[],
  hosts: WorkerPoolImageHosts,
): boolean {
  if (pull.pull === "Base") return true;
  return held.some((image) => {
    const pinned = workerPoolImageReference.exec(image)?.groups;
    if (pinned?.["host"] === undefined || !hosts.has(pinned["host"]))
      return false;
    return (
      pinned["repository"] === pull.repository &&
      (pull.pull === "Blob" || pinned["digest"] === pull.digest)
    );
  });
}

/**
 * `image` under the public host its internal host is published as, and
 * unchanged where its host is not one or the public name would be longer than
 * an assignment may carry, which a pool would refuse the whole poll over.
 */
export function workerPoolImageHosted(
  image: string,
  hosts: WorkerPoolImageHosts,
): string {
  const slash = image.indexOf("/");
  const published = slash > 0 ? hosts.get(image.slice(0, slash)) : undefined;
  if (published === undefined) return image;
  const hosted = `${published}${image.slice(slash)}`;
  return textCodePointsCount(hosted) > workerImageCharsMax ? image : hosted;
}

/** What reading the image-host setting came to. */
export type WorkerPoolImageHostsRead =
  | { readonly read: "Hosts"; readonly hosts: WorkerPoolImageHosts }
  | { readonly read: "Refused"; readonly why: string };

/** The image-host setting, a JSON object from each internal host to its public one; absent, no host is published. */
export function workerPoolImageHostsRead(
  text: string | undefined,
): WorkerPoolImageHostsRead {
  if (text === undefined) return { read: "Hosts", hosts: new Map() };
  let document: unknown;
  try {
    document = JSON.parse(text);
  } catch {
    return { read: "Refused", why: "is not JSON" };
  }
  if (
    typeof document !== "object" ||
    document === null ||
    Array.isArray(document)
  )
    return { read: "Refused", why: "is not an object" };
  const hosts = new Map<string, string>();
  for (const [internal, published] of Object.entries(document)) {
    if (!workerPoolImageHost.test(internal))
      return { read: "Refused", why: `names ${internal}, which is no host` };
    if (typeof published !== "string" || !workerPoolImageHost.test(published))
      return { read: "Refused", why: `publishes ${internal} as no host` };
    hosts.set(internal, published);
  }
  return { read: "Hosts", hosts };
}
