/**
 * The paths GitHub runs as pipeline definitions, which a token minted without
 * `workflows` cannot push a change to.
 */

/** The pathspecs GitHub treats as pipeline definitions. */
export const githubPipelinePaths: readonly string[] = [".github/workflows/"];
