/**
 * The browser's own chrome, kept the colour of the page under it.
 *
 * The page colour is read back from the body's computed background rather
 * than named here, so it is whatever `--surface-0` resolves to under the
 * scheme and theme in effect. It is read again when the machine's scheme
 * changes and when the document element's attributes do, which is where a
 * light or dark choice and a theme's properties are put. Every `theme-color`
 * meta is set, so whichever one's media matches says the colour in effect;
 * the ones `index.html` carries are what the chrome shows before this runs.
 */

export function themeColorFollow(
  document: Document,
  scheme: MediaQueryList,
): () => void {
  const view = document.defaultView;
  if (view === null)
    throw new Error("the document has no window to read its style in");
  const follow = (): void => {
    const page = view.getComputedStyle(document.body).backgroundColor;
    for (const meta of document.querySelectorAll('meta[name="theme-color"]'))
      meta.setAttribute("content", page);
  };
  follow();
  scheme.addEventListener("change", follow);
  const observer = new view.MutationObserver(follow);
  observer.observe(document.documentElement, { attributes: true });
  return () => {
    scheme.removeEventListener("change", follow);
    observer.disconnect();
  };
}
