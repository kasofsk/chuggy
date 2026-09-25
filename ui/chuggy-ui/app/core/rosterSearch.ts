/**
 * Which rows of a roster a typed query keeps.
 *
 * A query is trimmed and split on whitespace, and a row is kept when every term
 * appears, whatever its case, in the one text that row draws. An empty query
 * keeps every row. The text is handed in by the caller, so a row is never kept
 * by something its reader cannot see.
 */

function rosterSearchTerms(query: string): readonly string[] {
  const trimmed = query.trim().toLowerCase();
  return trimmed === "" ? [] : trimmed.split(/\s+/u);
}

export function rosterSearchMatches(query: string, text: string): boolean {
  const drawn = text.toLowerCase();
  return rosterSearchTerms(query).every((term) => drawn.includes(term));
}

export function rosterSearchFilter<Row>(
  rows: readonly Row[],
  query: string,
  textOf: (row: Row) => string,
): readonly Row[] {
  return rows.filter((row) => rosterSearchMatches(query, textOf(row)));
}
