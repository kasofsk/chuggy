/**
 * The middle of the shell: the page scrolling in its own region, and what a
 * page says about itself beside it. At the desk width the details are an aside
 * with the page still beside them; under it there is room for one, so the
 * toggle swaps the middle rather than squeezing it.
 */

import { Separator } from "radix-ui";
import type { ReactNode } from "react";

import { Button } from "../ui/Button.tsx";
import {
  useShellDetailsShow,
  useShellSlotHolder,
  useShellSlotsFilled,
} from "./slots.tsx";
import { useViewportAtLeastEm, viewportDeskEm } from "./viewport.ts";

export function DetailsToggle(): ReactNode {
  const filled = useShellSlotsFilled();
  const detailsShow = useShellDetailsShow();
  return (
    <Button
      variant="quiet"
      size="sm"
      pressed={filled.detailsOpen}
      onClick={() => {
        detailsShow(!filled.detailsOpen);
      }}
    >
      Details
    </Button>
  );
}

export function DetailsPane(props: {
  readonly children: ReactNode;
}): ReactNode {
  const filled = useShellSlotsFilled();
  const holdDetails = useShellSlotHolder("details");
  const desk = useViewportAtLeastEm(viewportDeskEm);
  const open = filled.details && filled.detailsOpen;
  const columns =
    open && desk
      ? "grid-cols-[minmax(0,1fr)_auto_var(--width-aside)]"
      : "grid-cols-1";
  return (
    <div className={`grid min-h-0 ${columns}`}>
      <div hidden={open && !desk} className="min-h-0 overflow-y-auto">
        <div className="mx-auto grid max-w-page content-start gap-4 p-4">
          {props.children}
        </div>
      </div>
      {open ? (
        <>
          {desk ? (
            <Separator.Root
              decorative
              orientation="vertical"
              className="w-px bg-edge"
            />
          ) : null}
          <aside
            ref={holdDetails}
            aria-label="Details"
            className="grid min-h-0 content-start gap-4 overflow-y-auto p-4"
          />
        </>
      ) : null}
    </div>
  );
}
