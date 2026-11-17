/**
 * What a project's mark is drawn from where it has no icon: its name's first
 * letter on one of the tints `tokens.css` names `--mark-tint-*`, the same tint
 * for the same name on every page. The tint is chosen by the name rather than
 * the address, so what the reader recognises is what they named.
 */

/** How many tints `tokens.css` names, `--mark-tint-1` and up. */
export const projectMarkTints = 6;

/** The sizes a mark is drawn at, each a `--mark-*` length in `tokens.css`. */
export const projectMarkSizes = ["sm", "md"] as const;
export type ProjectMarkSize = (typeof projectMarkSizes)[number];

/** The name's first letter or digit, upper-cased, and its first character
 * where it holds neither. */
export function projectMarkInitial(name: string): string {
  const characters = [...name.trim()];
  const lettered = characters.find((character) =>
    /[\p{L}\p{N}]/u.test(character),
  );
  return (lettered ?? characters[0] ?? "").toLocaleUpperCase();
}

/** Which tint, from one to `projectMarkTints`, the name is drawn on. */
export function projectMarkTint(name: string): number {
  let hash = 0;
  for (const character of name)
    hash = (hash * 31 + (character.codePointAt(0) ?? 0)) % 2_147_483_647;
  return (hash % projectMarkTints) + 1;
}
