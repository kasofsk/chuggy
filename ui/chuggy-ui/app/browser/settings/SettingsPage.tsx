/**
 * What every settings page is drawn in: its title, then its sections as one
 * column filling the width the settings' frame gives it.
 *
 * A settings page is drawn inside a project's shell and outside it, so where
 * its title goes is decided here and by no page: the top bar where the shell
 * is around it, and a heading over its sections where it is not.
 */

import { useParams } from "@tanstack/react-router";
import type { ReactNode } from "react";

import { TopBarSlot, useShellSlotsOffered } from "../shell/slots.tsx";

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
        <TopBarSlot>{titled}</TopBarSlot>
      ) : (
        <div className="flex min-w-0 items-center gap-2">{titled}</div>
      )}
      {props.children}
    </div>
  );
}
