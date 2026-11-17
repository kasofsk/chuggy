/**
 * The tab's icon is the open project's while its shell is drawn, and the
 * console's own again once it is not, or while the project names none.
 *
 * The document's own icon links are pointed at the icon's `data:` URI and put
 * back as they were, rather than a link of the project's added, so which link
 * a browser takes is never in question and the served policy's `img-src`
 * already admits what they draw.
 */

import { useEffect } from "react";
import type { ReactNode } from "react";

import type { PartitionIdentity } from "../../../../../src/contract/http.ts";
import { useProjectIconSource } from "../ProjectMark.tsx";
import { useProjectIcon } from "../projectNamed.ts";

/** Every icon link of the document pointed at `src`, and what puts each back. */
export function projectFaviconPointed(
  head: HTMLHeadElement,
  src: string,
): () => void {
  const were = [
    ...head.querySelectorAll<HTMLLinkElement>('link[rel~="icon"]'),
  ].map((link) => ({
    link,
    href: link.getAttribute("href"),
    type: link.getAttribute("type"),
  }));
  for (const { link } of were) {
    link.setAttribute("href", src);
    link.removeAttribute("type");
  }
  return () => {
    for (const { link, href, type } of were) {
      if (href === null) link.removeAttribute("href");
      else link.setAttribute("href", href);
      if (type !== null) link.setAttribute("type", type);
    }
  };
}

function ProjectFaviconPointed(props: {
  readonly partition: PartitionIdentity;
  readonly icon: string;
}): null {
  const { src } = useProjectIconSource(props.partition, props.icon);
  useEffect(
    () =>
      src === undefined ? undefined : projectFaviconPointed(document.head, src),
    [src],
  );
  return null;
}

export function ProjectFavicon(props: {
  readonly partition: PartitionIdentity;
}): ReactNode {
  const icon = useProjectIcon()(props.partition);
  return icon === undefined ? null : (
    <ProjectFaviconPointed key={icon} partition={props.partition} icon={icon} />
  );
}
