/**
 * The middle of the shell: the page scrolling in its own region, and what a
 * page says about itself beside it. Where the pages' column holds a page and
 * the details side by side, the details are an aside; under that there is room
 * for one, so the toggle swaps the middle rather than squeezing it.
 *
 * The page's region is the container a page's sheets query, not the viewport,
 * so a page the chat pane narrows lays itself out as narrow. It is named
 * `page`, so a sheet can ask it past any container nearer its element. A page that takes
 * the page width marks itself `data-fills-width`: centred at its content's
 * width, a page whose content is the page width could never be narrower.
 *
 * The middle is the document's `main`, focusable by script alone so the shell
 * can move a reader to it, and named by `label` where it is given: an address
 * spelled as the trail spells it, so marked as no words to translate.
 */

import { Separator } from "radix-ui";
import { useId } from "react";
import type { ReactNode } from "react";

import { useCopyText } from "../../copy/CopyProvider.tsx";
import { Button } from "../ui/Button.tsx";
import {
  useShellDetailsShow,
  useShellSlotHolder,
  useShellSlotsFilled,
} from "./slots.tsx";
import { useViewportColumnAside } from "./viewport.ts";

export function DetailsToggle(): ReactNode {
  const filled = useShellSlotsFilled();
  const detailsShow = useShellDetailsShow();
  const text = useCopyText();
  return (
    <Button
      variant="quiet"
      size="sm"
      pressed={filled.detailsOpen}
      onClick={() => {
        detailsShow(!filled.detailsOpen);
      }}
    >
      {text({ id: "shell-details" })}
    </Button>
  );
}

/** The `id` of the middle, which the shell's skip link points at. */
export const detailsPaneMainId = "shell-main";

export function DetailsPane(props: {
  readonly label?: string;
  readonly children: ReactNode;
}): ReactNode {
  const filled = useShellSlotsFilled();
  const holdDetails = useShellSlotHolder("details");
  const beside = useViewportColumnAside();
  const text = useCopyText();
  const open = filled.details && filled.detailsOpen;
  const columns =
    open && beside
      ? "grid-cols-[minmax(0,1fr)_auto_var(--width-aside)]"
      : "grid-cols-1";
  const scrollerHidden = open && !beside;
  const labelId = useId();
  return (
    <main
      id={detailsPaneMainId}
      tabIndex={-1}
      aria-labelledby={props.label === undefined ? undefined : labelId}
      className={`shell-main grid min-h-0 ${columns}`}
    >
      {props.label === undefined ? null : (
        <span id={labelId} hidden translate="no">
          {props.label}
        </span>
      )}
      <div
        hidden={scrollerHidden}
        className={
          scrollerHidden
            ? undefined
            : "@container/page grid min-h-0 grid-cols-[minmax(0,1fr)] grid-rows-[minmax(0,1fr)] overflow-y-auto"
        }
      >
        <div className="mx-auto flex max-w-page flex-col gap-4 self-start p-4 has-[[data-fills-width]]:w-full has-[[data-fills-page]]:w-full has-[[data-fills-page]]:max-w-none has-[[data-fills-page]]:p-0 has-[[data-fills-page]]:self-stretch">
          {props.children}
        </div>
      </div>
      {open ? (
        <>
          {beside ? (
            <Separator.Root
              decorative
              orientation="vertical"
              className="w-px bg-edge"
            />
          ) : null}
          <aside
            ref={holdDetails}
            aria-label={text({ id: "shell-details" })}
            className="@container grid min-h-0 content-start gap-4 overflow-y-auto p-4"
          />
        </>
      ) : null}
    </main>
  );
}
