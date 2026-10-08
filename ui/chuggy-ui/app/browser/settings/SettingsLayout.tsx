/**
 * The settings' one frame: a navigation of every settings page the reader has,
 * a group a level, and beside it the page the address names.
 *
 * The site's group is drawn only for a reader the site's abilities give a page
 * of it. That read answers nothing to anyone else, and a read that failed
 * draws the same as one that said no: a group withheld is not a fault of the
 * page beside it.
 */

import { Link, Outlet } from "@tanstack/react-router";
import { useId } from "react";
import type { ReactNode } from "react";

import { settingsNav, settingsNavSiteDrawn } from "../../core/settingsNav.ts";
import type { SettingsNavGroup } from "../../core/settingsNav.ts";
import { useSiteAbilities } from "./tenantPermissionsResource.ts";

import "./settings.css";

function SettingsNavGroupLinks(props: {
  readonly group: SettingsNavGroup;
}): ReactNode {
  const group = props.group;
  const labelled = useId();
  return (
    <div role="group" aria-labelledby={labelled} className="grid min-w-0 gap-1">
      <p id={labelled} className="flex min-w-0 items-baseline gap-2 px-3">
        <span className="eyebrow">{group.label}</span>
        {group.name === undefined ? null : (
          <>
            {" "}
            <span className="truncate text-sm text-ink-3">{group.name}</span>
          </>
        )}
      </p>
      <ul className="settings-nav-list">
        {group.entries.map((entry) => (
          <li key={entry.id}>
            <Link
              to={entry.to}
              params={entry.params}
              className="block rounded-2 px-3 py-1 text-md whitespace-nowrap no-underline"
              activeProps={{ className: "bg-surface-2 text-ink-1" }}
              inactiveProps={{ className: "text-ink-2" }}
            >
              {entry.label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Drawn with a project inside its shell, and with none in the frame outside
 * every project. */
export function SettingsLayout(props: {
  readonly tenant: string;
  readonly project: string | undefined;
}): ReactNode {
  const abilities = useSiteAbilities(props.tenant);
  const groups = settingsNav({
    tenant: props.tenant,
    project: props.project,
    site: settingsNavSiteDrawn(
      abilities.state === "Ready" ? abilities.value : undefined,
    ),
  });
  return (
    <div className="@container w-full" data-fills-width>
      <div className="settings">
        <nav aria-label="Settings" className="settings-nav">
          {groups.map((group) => (
            <SettingsNavGroupLinks key={group.id} group={group} />
          ))}
        </nav>
        <div className="min-w-0">
          <Outlet />
        </div>
      </div>
    </div>
  );
}
