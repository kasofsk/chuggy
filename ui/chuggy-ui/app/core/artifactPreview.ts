/**
 * Whether an artifact can be previewed at all, and what its preview is.
 *
 * The wire says an artifact is previewable by carrying the output definition
 * the task declared it under, and that definition names the renderer. An
 * artifact with none is bytes the API will not read back as text, so no
 * preview is offered rather than one being asked for and refused. Every
 * renderer the wire has is a text renderer, and the content is drawn as text
 * under all of them: the console interprets none of them, because a preview
 * that rendered its own bytes would be running whatever an execution produced.
 */

import type { OutputRenderer } from "../../../../src/contract/rosters.ts";

/** As much of the artifact roster as a preview decision reads. */
export interface PreviewableArtifact {
  readonly ordinal: number;
  readonly bytes: number;
  readonly output?: { readonly renderer: OutputRenderer } | undefined;
}

export type ArtifactPreviewOffer =
  | { readonly offer: "Previewable"; readonly renderer: OutputRenderer }
  | { readonly offer: "Unpreviewable"; readonly reason: string };

export function artifactPreviewOffer(
  artifact: PreviewableArtifact,
): ArtifactPreviewOffer {
  const output = artifact.output;
  if (output === undefined)
    return {
      offer: "Unpreviewable",
      reason:
        "no task output declares this path, so the API renders nothing for it",
    };
  return { offer: "Previewable", renderer: output.renderer };
}
