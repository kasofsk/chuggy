/**
 * Bounded accumulation across a paged read.
 *
 * A page shorter than the limit is not the end of the collection; only the
 * absence of the server's continuation token is. The accumulator therefore
 * follows the token and carries its own page and item ceilings, and says when
 * it stopped at one instead of at the end.
 */

export const pagingPagesMax = 20;
export const pagingItemsMax = 1_000;

/** @typedef {{ pages: number, items: readonly unknown[] }} PagingState */

/** @typedef {{ items: readonly unknown[], next: unknown }} PagingPage */

/** @returns {PagingState} */
export function pagingStart() {
  return { pages: 0, items: [] };
}

/**
 * @param {PagingState} state
 * @param {PagingPage} page
 * @returns {{ done: false, state: PagingState, next: unknown }
 *   | { done: true, items: readonly unknown[], truncated: boolean }}
 */
export function pagingStep(state, page) {
  const items = [...state.items, ...page.items];
  const pages = state.pages + 1;
  if (page.next === undefined) return { done: true, items, truncated: false };
  if (pages >= pagingPagesMax || items.length >= pagingItemsMax)
    return {
      done: true,
      items: items.slice(0, pagingItemsMax),
      truncated: true,
    };
  return { done: false, state: { pages, items }, next: page.next };
}
