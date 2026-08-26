/**
 * That a preview is offered exactly where the wire says one can be rendered.
 *
 * Offering one anywhere else asks the API for content it has already said it
 * will not produce, and answers the reader with a refusal they cannot act on.
 */

import { expect, test } from "vitest";

import { outputRenderers } from "../../../src/contract/rosters.ts";
import { artifactPreviewOffer } from "../app/core/artifactPreview.ts";

test("an artifact no output declares is not offered a preview", () => {
  const offer = artifactPreviewOffer({ ordinal: 0, bytes: 12 });
  expect(offer.offer).toBe("Unpreviewable");
  if (offer.offer === "Unpreviewable")
    expect(offer.reason.length).toBeGreaterThan(0);
});

test("an artifact whose output is undefined is treated the same way", () => {
  expect(
    artifactPreviewOffer({ ordinal: 1, bytes: 0, output: undefined }).offer,
  ).toBe("Unpreviewable");
});

test("every renderer the wire has is offered, carrying its own name", () => {
  for (const renderer of outputRenderers)
    expect(
      artifactPreviewOffer({ ordinal: 2, bytes: 4, output: { renderer } }),
    ).toEqual({ offer: "Previewable", renderer });
});
