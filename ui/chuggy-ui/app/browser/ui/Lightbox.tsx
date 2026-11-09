/**
 * An image drawn as the control that opens it: pressed, the same image stands
 * in a dialog at its own size, fitted to the viewport and never larger, under
 * its alt. Both draw from the one source, so opening reads nothing.
 */

import { useState } from "react";
import type { ReactNode } from "react";

import { Dialog } from "./Dialog.tsx";

export function Lightbox(props: {
  readonly src: string;
  readonly alt: string;
  /** The image's own drawing where it stands on the page. */
  readonly className: string;
}): ReactNode {
  const [open, setOpen] = useState(false);
  return (
    <Dialog
      title={props.alt}
      size="image"
      triggerBare
      trigger={
        <img className={props.className} src={props.src} alt={props.alt} />
      }
      open={open}
      onOpenChange={setOpen}
    >
      <img
        className="block max-h-(--height-image-opened) min-h-0 max-w-full shrink self-center object-contain"
        src={props.src}
        alt={props.alt}
      />
    </Dialog>
  );
}
