/**
 * A project's access tokens: the reader's own, or every one to a reader who
 * administers the project, each drawn on the page's own clock, and New token
 * to every reader unless the abilities read answers that they may not.
 *
 * Every reader of the project sees the page, because a token made while they
 * held the permit stands after they lose it, and they delete it here.
 */

import { useParams } from "@tanstack/react-router";
import type { ReactNode } from "react";

import type { PartitionIdentity } from "../../../../../src/contract/http.ts";
import { useCopyText } from "../../copy/CopyProvider.tsx";
import { accessTokensWords } from "../../core/accessTokens.ts";
import { projectAbilityRefused } from "../../core/projectAbilities.ts";
import { settingsRoutes } from "../../core/settingsNav.ts";
import { PanelUnready } from "../DataPanel.tsx";
import { useNowMs } from "../Freshness.tsx";
import { useProjectAbilities } from "../projectAbilities.tsx";
import { EmptyState } from "../ui/EmptyState.tsx";
import { AccessTokenMint } from "./AccessTokenMint.tsx";
import { AccessTokensListing } from "./AccessTokensListing.tsx";
import { useAccessTokens } from "./accessTokensResource.ts";
import { SettingsListing, SettingsListingSection } from "./SettingsListing.tsx";
import { SettingsPage } from "./SettingsPage.tsx";

function AccessTokensRead(props: {
  readonly partition: PartitionIdentity;
  readonly administer: boolean;
}): ReactNode {
  const text = useCopyText();
  const read = useAccessTokens(props.partition);
  const nowMs = useNowMs();
  if (read.state !== "Ready") return <PanelUnready state={read} />;
  if (read.value.tokens.length === 0)
    return <EmptyState label={text(accessTokensWords.none)} />;
  return (
    <AccessTokensListing
      partition={props.partition}
      tokens={read.value.tokens}
      administer={props.administer}
      nowMs={nowMs}
    />
  );
}

export function AccessTokensPage(): ReactNode {
  const text = useCopyText();
  const params = useParams({ from: settingsRoutes.project.accessTokens });
  const partition: PartitionIdentity = {
    tenant: params.tenant,
    project: params.project,
  };
  const abilities = useProjectAbilities(partition);
  const title = text(accessTokensWords.title);
  return (
    <SettingsPage title={title}>
      <SettingsListing>
        <SettingsListingSection
          heading={title}
          about={text(accessTokensWords.about)}
          action={
            projectAbilityRefused(abilities, "makeAccessTokens") ? undefined : (
              <AccessTokenMint partition={partition} />
            )
          }
        >
          <AccessTokensRead
            partition={partition}
            administer={abilities?.administer === true}
          />
        </SettingsListingSection>
      </SettingsListing>
    </SettingsPage>
  );
}
