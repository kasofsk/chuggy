/** An element's text as a reader hears it: what is hidden from assistive
 * technology, like a mark beside a name, left out. */

export function textSaid(element: Element): string {
  const said = element.cloneNode(true) as Element;
  for (const hidden of said.querySelectorAll('[aria-hidden="true"]'))
    hidden.remove();
  return said.textContent;
}
