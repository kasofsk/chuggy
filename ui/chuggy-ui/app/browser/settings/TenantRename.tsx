/**
 * A workspace's display name, changed in place by a reader who administers
 * it. The box starts on the name the reader's own list answers, and the name
 * saved is read again from that list and the site's, so every place that
 * names the workspace names it anew. Its address is not changed.
 */

import type { QueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { ReactNode } from "react";

import type { AccessTenantAbilities } from "../../../../../src/contract/accessPlane.ts";
import { useCopyText } from "../../copy/CopyProvider.tsx";
import { apiRenameTenant } from "../../core/accessRoutes.ts";
import { consoleWriteKey } from "../../core/consoleWrite.ts";
import type { ConsoleWrite } from "../../core/consoleWrite.ts";
import { failureWords } from "../../core/failureWords.ts";
import {
  callerTenantsQuery,
  siteWorkspacesQuery,
} from "../../core/tenantQueries.ts";
import {
  tenantRenameOffered,
  tenantRenameSent,
} from "../../core/tenantRename.ts";
import { ConsoleWriteRefusedWords, useConsoleWrite } from "../consoleWrite.tsx";
import type { ConsoleWriting } from "../consoleWrite.tsx";
import { Button } from "../ui/Button.tsx";
import { Input } from "../ui/Input.tsx";
import { Notice } from "../ui/Notice.tsx";
import { useWorkspaceNames } from "../workspaceNames.ts";
import { SettingsListingSection } from "./SettingsListing.tsx";

async function tenantRenameLanded(
  client: QueryClient,
  tenant: string,
): Promise<void> {
  await Promise.all([
    client.invalidateQueries({ queryKey: callerTenantsQuery().queryKey }),
    client.invalidateQueries({
      queryKey: siteWorkspacesQuery(tenant).queryKey,
    }),
  ]);
}

function tenantRenameWrite(tenant: string): ConsoleWrite<string, undefined> {
  return {
    mutationKey: consoleWriteKey("tenant-rename", tenant),
    write: (ports, displayName) => apiRenameTenant(ports, tenant, displayName),
    refusal: (failure) => failureWords(failure).word,
    landed: (client) => tenantRenameLanded(client, tenant),
  };
}

/** The write's line: under way, landed, or refused in the write's own words. */
function TenantRenameNotice(props: {
  readonly renaming: ConsoleWriting<string, undefined>;
}): ReactNode {
  const text = useCopyText();
  const { renaming } = props;
  if (renaming.isPending)
    return (
      <Notice
        tone="info"
        inline
        detail={text({ id: "settings-rename-workspace-writing" })}
      />
    );
  if (renaming.error !== null)
    return (
      <Notice tone="danger" inline>
        <ConsoleWriteRefusedWords refused={renaming.error} />
      </Notice>
    );
  return renaming.isSuccess ? (
    <Notice
      tone="live"
      inline
      detail={text({ id: "settings-rename-workspace-written" })}
    />
  ) : null;
}

export function TenantRename(props: {
  readonly tenant: string;
  readonly abilities: AccessTenantAbilities | undefined;
}): ReactNode {
  const text = useCopyText();
  const { tenant } = props;
  const current = useWorkspaceNames()(tenant);
  const [typed, setTyped] = useState<string | undefined>(undefined);
  const renaming = useConsoleWrite(tenantRenameWrite(tenant), { drawn: true });
  if (!tenantRenameOffered(props.abilities)) return null;
  const shown = typed ?? current;
  const sent = tenantRenameSent(shown, current);
  const label = text({ id: "settings-rename-workspace-label" });
  return (
    <SettingsListingSection
      heading={text({ id: "settings-rename-workspace-title" })}
      about={text({
        id: "settings-rename-workspace-about",
        args: { workspace: tenant },
      })}
    >
      <form
        className="flex min-w-0 flex-wrap items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (sent === undefined) return;
          renaming.mutate(sent, {
            onSuccess: () => {
              setTyped(undefined);
            },
          });
        }}
      >
        <Input
          label={label}
          value={shown}
          invalid={shown !== current && sent === undefined}
          disabled={renaming.isPending}
          onChange={(value) => {
            renaming.reset();
            setTyped(value);
          }}
        />
        <Button
          size="sm"
          type="submit"
          disabled={sent === undefined || renaming.isPending}
        >
          {text({ id: "settings-rename-workspace" })}
        </Button>
      </form>
      <TenantRenameNotice renaming={renaming} />
    </SettingsListingSection>
  );
}
