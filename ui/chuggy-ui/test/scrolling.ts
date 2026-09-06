/** jsdom implements no scrolling, and the thread viewport scrolls itself to the
 * newest message on mount. */

export function elementScrollToStubbed(): void {
  (Element.prototype as unknown as { scrollTo: () => void }).scrollTo = () =>
    undefined;
}
