/**
 * What became of each of the site's workspace links, newest first as the
 * plane lists them, in the frame every list of links is drawn in: the note it
 * was made with, where it stands, the workspace it made and who made it.
 *
 * A link names nobody and no workspace until it is used, so a row is headed
 * by its maker's note, and says under it where the workspace it makes may
 * invite new people.
 */

import type { ReactNode } from "react";

import type {
  AccessSiteAbilities,
  AccessWorkspaceLink,
} from "../../../../../src/contract/accessPlane.ts";
import { apiRevokeSiteWorkspaceLink } from "../../core/accessRoutes.ts";
import {
  siteWorkspaceLinkRevocable,
  siteWorkspaceLinkWords,
} from "../../core/siteWorkspaceLinks.ts";
import { siteWorkspaceCreateAccountsLabel } from "../../core/siteWorkspaces.ts";
import { InviteLinksListing, InviteLinkWho } from "./InviteLinksListing.tsx";
import { SettingsListingNone } from "./SettingsListing.tsx";
import { siteWorkspaceLinksReread } from "./siteWorkspacesResource.ts";

function SiteWorkspaceLinkNote(props: {
  readonly link: AccessWorkspaceLink;
}): ReactNode {
  const link = props.link;
  return (
    <div className="grid min-w-0 justify-items-start gap-1">
      {link.note === undefined ? (
        <SettingsListingNone />
      ) : (
        <span className="wrap-anywhere">{link.note}</span>
      )}
      {link.createAccounts ? (
        <span className="text-sm text-ink-3">
          {siteWorkspaceCreateAccountsLabel}
        </span>
      ) : null}
    </div>
  );
}

/** The workspace a used link made, and quietly under it who used the link and when. */
function SiteWorkspaceLinkMade(props: {
  readonly link: Extract<AccessWorkspaceLink, { state: "Used" }>;
  readonly nowMs: number;
}): ReactNode {
  const link = props.link;
  return (
    <div className="grid min-w-0">
      <span className="people-stacked-label">
        {siteWorkspaceLinkWords.workspace}
      </span>
      <span
        className="people-name font-strong text-ink-1"
        title={link.workspace}
      >
        {link.workspace}
      </span>
      <div className="text-sm text-ink-3">
        <InviteLinkWho
          person={link.usedBy}
          atMs={link.usedAtMs}
          nowMs={props.nowMs}
        />
      </div>
    </div>
  );
}

/** Drawn only where the site has a link to list. */
export function SiteWorkspaceLinks(props: {
  readonly tenant: string;
  readonly links: readonly AccessWorkspaceLink[];
  readonly abilities: AccessSiteAbilities;
}): ReactNode {
  const { tenant, abilities } = props;
  return (
    <InviteLinksListing
      links={props.links}
      first={{
        heading: siteWorkspaceLinkWords.note,
        cell: (link) => <SiteWorkspaceLinkNote link={link} />,
      }}
      third={{
        heading: siteWorkspaceLinkWords.workspace,
        cell: (link, nowMs) =>
          link.state === "Used" ? (
            <SiteWorkspaceLinkMade link={link} nowMs={nowMs} />
          ) : undefined,
      }}
      revocable={(link) => siteWorkspaceLinkRevocable(abilities, link)}
      revoke={apiRevokeSiteWorkspaceLink}
      reread={(client) => siteWorkspaceLinksReread(client, tenant)}
    />
  );
}
