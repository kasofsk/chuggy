/**
 * Whether an artifact can be previewed at all, and what its preview is.
 *
 * The wire says an artifact is previewable by carrying the output definition
 * the task declared it under, and that definition names the renderer. An
 * artifact with none is bytes the API will not read back at all, so no
 * preview is offered rather than one being asked for and refused.
 *
 * A preview interprets its bytes only where doing so runs nothing and fetches
 * nothing. `Markdown` is drawn by `MarkdownReport`, the one renderer the
 * console already trusts with a worker's words: its grammar has no HTML, it
 * fetches no image, and a link is live only to an address that loads no
 * script. `Json` is parsed and printed again indented, which is data in and
 * text out, and content that does not parse is drawn as it came. `UnifiedDiff`
 * and `Text` are drawn as text. `Image` asks a browser's image decoder to draw
 * pixels, not this document to run code, and a decoder fault is the browser's,
 * in the same decoder every page on the internet hands bytes to.
 * `image/svg+xml` is refused at declaration — SVG is a document with script
 * and external references in it — so what reaches that renderer is raster.
 * This module still only offers a preview; the renderer it answers is what
 * decides how one is drawn.
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

/** JSON content indented, or as it came where it does not parse. */
export function artifactPreviewJson(content: string): string {
  try {
    return JSON.stringify(JSON.parse(content), null, 2);
  } catch {
    return content;
  }
}
