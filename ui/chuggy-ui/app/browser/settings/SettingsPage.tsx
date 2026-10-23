/**
 * What every settings page is drawn in: its title, then its sections as one
 * column filling the width the settings' frame gives it.
 *
 * A settings page is drawn inside a project's shell and outside it, so how
 * its title is drawn is decided here and by no page: for a reader who does not
 * see the bar where the shell is around it, since the settings' own nav names
 * the page there, and as a heading over its sections where it is not.
 */

import { useParams } from "@tanstack/react-router";
import type { ReactNode } from "react";

import { ScreenTitle, useShellSlotsOffered } from "../shell/slots.tsx";

/** The workspace a settings page is of, whichever of its addresses was matched. */
export function useSettingsTenant(): string {
  const tenant = useParams({ strict: false }).tenant;
  if (tenant === undefined)
    throw new Error("a settings page was drawn at an address of no workspace");
  return tenant;
}

export function SettingsPage(props: {
  readonly title: string;
  /** What stands beside the title. */
  readonly chips?: ReactNode;
  readonly children: ReactNode;
}): ReactNode {
  const shelled = useShellSlotsOffered();
  const titled = (
    <>
      <h1 className="text-md font-strong text-ink-1 truncate">{props.title}</h1>
      {props.chips}
    </>
  );
  return (
    <div className="grid min-w-0 gap-4">
      {shelled ? (
        <>
          <ScreenTitle>{props.title}</ScreenTitle>
          {props.chips === undefined ? null : (
            <div className="flex min-w-0 items-center gap-2">{props.chips}</div>
          )}
        </>
      ) : (
        <div className="flex min-w-0 items-center gap-2">{titled}</div>
      )}
      {props.children}
    </div>
  );
}
