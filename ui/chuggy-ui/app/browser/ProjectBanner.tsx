/**
 * The project's banner over its tickets list: a band of the page's width and
 * its token's height, the image cropped to fill it from its centre, nothing
 * written over it and nothing said of it. The band holds its height while
 * the image is read, so the list under it does not move as it lands, and is
 * gone where the project names no banner, a read fails, the image cannot be
 * drawn, or the reader hides banners. Whether there is one is known before
 * the list under it is drawn, through `useProjectBannerHeld`. It goes once the page scrolls past it
 * and is back only at the page's top.
 */

import { useRef, useState } from "react";
import type { ReactNode } from "react";

import type { PartitionIdentity } from "../../../../src/contract/http.ts";
import { projectImagesQuery } from "../core/projectQueries.ts";
import { usePanelState } from "./api.ts";
import { persistentStore } from "./ports.ts";
import { projectBannersRead } from "./projectBanners.ts";
import { useProjectImageSource } from "./ProjectImage.tsx";
import { useHeadroomGone } from "./ui/useHeadroom.ts";

import "./ProjectBanner.css";

function ProjectBannerBand(props: {
  readonly partition: PartitionIdentity;
  readonly banner: string;
}): ReactNode {
  const read = useProjectImageSource(props.partition, props.banner);
  const [broken, setBroken] = useState(false);
  const band = useRef<HTMLDivElement>(null);
  const gone = useHeadroomGone(band);
  if (read.failed || broken) return null;
  return (
    <div className="project-banner" ref={band} data-gone={gone || undefined}>
      {read.src === undefined ? null : (
        <img
          src={read.src}
          alt=""
          decoding="async"
          onError={() => {
            setBroken(true);
          }}
        />
      )}
    </div>
  );
}

/** Whether the reader is to be drawn the project's banner, and which: not
 * `settled` until the images read has answered, and settled with none where
 * the reader hides banners, the project names none, or the read failed. What
 * is drawn under the band waits on this, so a band that arrives late does not
 * push down what was drawn before it. */
export type ProjectBannerHeld =
  | { readonly settled: false }
  | { readonly settled: true; readonly banner: string | undefined };

export function useProjectBannerHeld(
  partition: PartitionIdentity,
): ProjectBannerHeld {
  const [choice] = useState(() => projectBannersRead(persistentStore));
  const images = usePanelState({
    ...projectImagesQuery(partition),
    enabled: choice === "Shown",
  });
  if (choice === "Hidden") return { settled: true, banner: undefined };
  if (images.state === "Pending") return { settled: false };
  return {
    settled: true,
    banner: images.state === "Ready" ? images.value.banner : undefined,
  };
}

export function ProjectBanner(props: {
  readonly partition: PartitionIdentity;
  readonly held: ProjectBannerHeld;
}): ReactNode {
  return !props.held.settled || props.held.banner === undefined ? null : (
    <ProjectBannerBand
      key={props.held.banner}
      partition={props.partition}
      banner={props.held.banner}
    />
  );
}
