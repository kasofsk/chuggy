/**
 * How far to scroll to bring a card into the room the sheet leaves above it
 * on a phone: nothing where the card is already wholly in that room, and
 * otherwise as far as puts the card's middle at the room's middle.
 */

/** A vertical extent, top above bottom, in the viewport's pixels. */
export interface EpicGraphSheetExtent {
  readonly top: number;
  readonly bottom: number;
}

export function epicGraphSheetScrollOf(
  card: EpicGraphSheetExtent,
  room: EpicGraphSheetExtent,
): number | undefined {
  if (card.top > card.bottom || room.top > room.bottom)
    throw new Error("an extent's top is above its bottom");
  if (card.top >= room.top && card.bottom <= room.bottom) return undefined;
  return (card.top + card.bottom) / 2 - (room.top + room.bottom) / 2;
}
