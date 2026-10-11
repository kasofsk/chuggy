/**
 * What became of each of a workspace's invite links, newest first as the
 * plane lists them, in the frame every list of links is drawn in: what a link
 * carries, where it stands, who used it and who made it.
 *
 * A link has no name and its token is not in the list, so a row is headed by
 * what the link grants, drawn as a person's row draws what they hold.
 */

import type { ReactNode } from "react";

import type {
  AccessInviteLink,
  AccessTenantAbilities,
} from "../../../../../src/contract/accessPlane.ts";
import { apiRevokeTenantInviteLink } from "../../core/accessRoutes.ts";
import {
  inviteLinkAccess,
  inviteLinkRevocable,
  inviteLinksWords,
} from "../../core/inviteLinks.ts";
import { InviteLinksListing, InviteLinkWho } from "./InviteLinksListing.tsx";
import { tenantInviteLinksReread } from "./tenantPeopleResource.ts";
import { TenantHeldProjects, TenantHeldWords } from "./TenantPersonRow.tsx";

function TenantInviteLinkAccess(props: {
  readonly link: AccessInviteLink;
}): ReactNode {
  const access = inviteLinkAccess(props.link);
  return (
    <div className="grid min-w-0 justify-items-start gap-1">
      <TenantHeldWords held={access.held} />
      {access.every || access.lines.length > 0 ? (
        <TenantHeldProjects every={access.every} lines={access.lines} />
      ) : null}
    </div>
  );
}

/** Drawn only where the workspace has a link to list. */
export function TenantInviteLinks(props: {
  readonly tenant: string;
  readonly links: readonly AccessInviteLink[];
  readonly abilities: AccessTenantAbilities | undefined;
}): ReactNode {
  const { tenant, abilities } = props;
  return (
    <InviteLinksListing
      links={props.links}
      first={{
        heading: inviteLinksWords.access,
        cell: (link) => <TenantInviteLinkAccess link={link} />,
      }}
      third={{
        heading: inviteLinksWords.usedBy,
        cell: (link, nowMs) =>
          link.state === "Used" ? (
            <InviteLinkWho
              label={inviteLinksWords.usedBy}
              person={link.usedBy}
              atMs={link.usedAtMs}
              nowMs={nowMs}
            />
          ) : undefined,
      }}
      revocable={(link) => inviteLinkRevocable(abilities, link)}
      revoke={(ports, link) => apiRevokeTenantInviteLink(ports, tenant, link)}
      reread={(client) => tenantInviteLinksReread(client, tenant)}
    />
  );
}
