/**
 * The bar above every page: what the page is, what it wants said beside that,
 * and the two controls that belong to the frame rather than to the page — the
 * menu that opens the rail where the rail is a drawer, and the details toggle
 * where the page handed the shell details.
 */

import { Dialog } from "radix-ui";
import type { ReactNode } from "react";

import { buttonLookClassName } from "../ui/Button.tsx";
import { DetailsToggle } from "./DetailsPane.tsx";
import { useShellSlotHolder, useShellSlotsFilled } from "./slots.tsx";

function TopBarMenu(): ReactNode {
  return (
    <Dialog.Trigger
      aria-label="Menu"
      className={buttonLookClassName({ variant: "quiet", size: "sm" })}
    >
      <svg
        aria-hidden="true"
        className="size-4"
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      >
        <path d="M2.5 4.5h11M2.5 8h11M2.5 11.5h11" />
      </svg>
    </Dialog.Trigger>
  );
}

export function TopBar(props: {
  readonly narrow: boolean;
  readonly title: string;
}): ReactNode {
  const filled = useShellSlotsFilled();
  const holdTopBar = useShellSlotHolder("topBar");
  return (
    <header className="flex min-w-0 items-center gap-3 px-4 py-2">
      {props.narrow ? <TopBarMenu /> : null}
      {filled.topBar ? null : (
        <h1 className="truncate text-md font-strong text-ink-1">
          {props.title}
        </h1>
      )}
      <div
        ref={holdTopBar}
        className="flex min-w-0 flex-1 items-center gap-3"
      />
      {filled.details ? <DetailsToggle /> : null}
    </header>
  );
}
