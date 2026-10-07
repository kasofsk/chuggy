/**
 * Whether an artifact can be previewed at all, and what its preview is.
 *
 * The wire says an artifact is previewable by carrying the output definition
 * the task declared it under, and that definition names the renderer. An
 * artifact with none is bytes the API will not read back at all, so no
 * preview is offered rather than one being asked for and refused.
 *
 * Every renderer but `Image` is a text renderer, and the content is drawn as
 * text under all of them: the console interprets none of them, because a
 * preview that rendered its own bytes would be running whatever an execution
 * produced. `Image` narrows that rule rather than breaking it: an `<img>` of
 * raster bytes asks a browser's image decoder to draw pixels, not this
 * document to run code, and a decoder fault is the browser's, in the same
 * decoder every page on the internet hands bytes to. `image/svg+xml` is
 * refused at declaration — SVG is a document with script and external
 * references in it, and is the case the text-only rule is really about — so
 * what reaches this renderer is raster. This function still only offers a
 * preview; the renderer it answers is what decides how one is drawn.
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
  | { readonly offer: "Unpreviewable"; readonly note: string };

export function artifactPreviewOffer(
  artifact: PreviewableArtifact,
): ArtifactPreviewOffer {
  const output = artifact.output;
  if (output === undefined)
    return { offer: "Unpreviewable", note: "No preview" };
  return { offer: "Previewable", renderer: output.renderer };
}
