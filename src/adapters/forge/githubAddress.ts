/**
 * How this forge addresses one repository, read out of the remote address the
 * repository identity is.
 *
 * IT IS SHARED BECAUSE TWO ADAPTERS ASK THE SAME QUESTION. Opening a change
 * proposal and minting a token both need the owner and the name behind a
 * repository URL, and two parsers would be two chances for one of them to
 * accept a path segment the other refuses — which is the segment that would
 * reach a URL this tree builds.
 */

import type { RepositoryId } from "../../interpreter/finalizer.ts";

/** One repository as this forge addresses it. */
export interface GithubAddress {
  readonly owner: string;
  readonly name: string;
}

/** The host this forge serves repositories from, which is not the host its API stands at. */
export const githubRepositoryHost = "github.com";

/** The segments a repository address may be made of, which is what keeps an address out of a path it could escape. */
export const githubAddressSegmentPattern = /^[A-Za-z0-9._-]+$/u;

/**
 * The owner and name behind one repository identity. Anything but an HTTPS URL
 * naming exactly two path segments on this forge's host is no address of one.
 */
export function githubAddressOf(
  repository: RepositoryId,
  host: string,
): GithubAddress | undefined {
  let url: URL;
  try {
    url = new URL(repository);
  } catch {
    return undefined;
  }
  if (url.protocol !== "https:" || url.host !== host) return undefined;
  if (url.username !== "" || url.password !== "") return undefined;
  if (url.search !== "" || url.hash !== "") return undefined;
  const segments = url.pathname
    .replace(/\.git$/u, "")
    .split("/")
    .slice(1);
  const [owner, name] = segments;
  if (segments.length !== 2 || owner === undefined || name === undefined) {
    return undefined;
  }
  return githubAddressSegmentPattern.test(owner) &&
    githubAddressSegmentPattern.test(name)
    ? { owner, name }
    : undefined;
}
