/**
 * The settings' one frame: a navigation of every settings page the reader has,
 * a group a level, and the page the address names.
 *
 * Where the frame is wide the navigation stands beside the page, and the
 * settings' own address is its first section. Where it is narrow the settings
 * are two levels: their own address is the navigation alone, a row a section
 * with the line saying what is there, and a section is drawn alone under a
 * link back to it. The sheet decides which by the frame's width, and the
 * first section is chosen here by the same width.
 *
 * The site's group is drawn only for a reader the site's abilities give a page
 * of it. That read answers nothing to anyone else, and a read that failed
 * draws the same as one that said no: a group withheld is not a fault of the
 * page beside it.
 */

import { Link, Navigate, Outlet, useMatchRoute } from "@tanstack/react-router";
import { useId } from "react";
import type { ReactNode } from "react";

import { useCopyText } from "../../copy/CopyProvider.tsx";
import {
  settingsNav,
  settingsNavSiteDrawn,
  settingsRootRoutes,
} from "../../core/settingsNav.ts";
import type {
  SettingsNavEntry,
  SettingsNavGroup,
  SettingsNavParams,
} from "../../core/settingsNav.ts";
import { useElementAtLeastEm, viewportTwoColumnEm } from "../shell/viewport.ts";
import { Chevron } from "../ui/Chevron.tsx";
import { useSiteAbilities } from "./tenantPermissionsResource.ts";

import "./settings.css";

function SettingsNavEntryRow(props: {
  readonly entry: SettingsNavEntry;
}): ReactNode {
  const text = useCopyText();
  const entry = props.entry;
  const summary = useId();
  return (
    <li className="settings-nav-entry">
      <Link
        to={entry.to}
        params={entry.params}
        aria-describedby={summary}
        className="settings-nav-link"
        activeProps={{ className: "bg-surface-2 text-ink-1" }}
        inactiveProps={{ className: "text-ink-2" }}
      >
        {text(entry.label)}
      </Link>
      <span id={summary} className="settings-nav-summary">
        {text(entry.summary)}
      </span>
    </li>
  );
}

function SettingsNavGroupLinks(props: {
  readonly group: SettingsNavGroup;
}): ReactNode {
  const text = useCopyText();
  const group = props.group;
  const labelled = useId();
  return (
    <div role="group" aria-labelledby={labelled} className="grid min-w-0 gap-1">
      <h2 id={labelled} className="flex min-w-0 items-baseline gap-2 px-3">
        <span className="eyebrow">{text(group.label)}</span>
        {group.name === undefined ? null : (
          <>
            {" "}
            <span className="truncate text-sm text-ink-3">{group.name}</span>
          </>
        )}
      </h2>
      <ul aria-labelledby={labelled} className="settings-nav-list">
        {group.entries.map((entry) => (
          <SettingsNavEntryRow key={entry.id} entry={entry} />
        ))}
      </ul>
    </div>
  );
}

/** At the settings' own address: nothing beside the index where the frame is
 * narrow or not yet measured, and the first section where it is wide. */
function SettingsLayoutRoot(props: {
  readonly wide: boolean | undefined;
  readonly first: SettingsNavEntry | undefined;
}): ReactNode {
  if (props.wide !== true || props.first === undefined) return null;
  return <Navigate to={props.first.to} params={props.first.params} replace />;
}

/** Drawn with a project inside its shell, and with none in the frame outside
 * every project. */
export function SettingsLayout(props: {
  readonly tenant: string;
  readonly project: string | undefined;
}): ReactNode {
  const text = useCopyText();
  const abilities = useSiteAbilities(props.tenant);
  const [frameHeld, wide] = useElementAtLeastEm(viewportTwoColumnEm);
  const matchRoute = useMatchRoute();
  const groups = settingsNav({
    tenant: props.tenant,
    project: props.project,
    site: settingsNavSiteDrawn(
      abilities.state === "Ready" ? abilities.value : undefined,
    ),
  });
  const root =
    props.project === undefined
      ? settingsRootRoutes.workspace
      : settingsRootRoutes.project;
  const params: SettingsNavParams =
    props.project === undefined
      ? { tenant: props.tenant }
      : { tenant: props.tenant, project: props.project };
  const atRoot = matchRoute({ to: root, params }) !== false;
  return (
    <div ref={frameHeld} className="@container w-full" data-fills-width>
      <div className="settings" data-settings-at={atRoot ? "index" : "section"}>
        <nav aria-label={text({ id: "settings-nav" })} className="settings-nav">
          {groups.map((group) => (
            <SettingsNavGroupLinks key={group.id} group={group} />
          ))}
        </nav>
        <div className="settings-section">
          {atRoot ? (
            <SettingsLayoutRoot wide={wide} first={groups[0]?.entries[0]} />
          ) : (
            <>
              <Link to={root} params={params} className="settings-back">
                <Chevron className="settings-back-chevron" />
                {text({ id: "settings-nav-index" })}
              </Link>
              <Outlet />
            </>
          )}
        </div>
      </div>
    </div>
  );
}
