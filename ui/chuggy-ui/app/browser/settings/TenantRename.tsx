/**
 * A workspace's display name, changed in place by a reader who administers
 * it. The box starts on the name the reader's own list answers, and the name
 * saved is read again from that list and the site's, so every place that
 * names the workspace names it anew. Its address is not changed.
 *
 * It is saved as a settings section is, its one field always open: Save is
 * offered once the name moved, a landing is the write's toast, and a refusal
 * is drawn under the field and takes focus.
 */

import type { QueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import type { ReactNode } from "react";

import type { AccessTenantAbilities } from "../../../../../src/contract/accessPlane.ts";
import { useCopyText } from "../../copy/CopyProvider.tsx";
import { apiRenameTenant } from "../../core/accessRoutes.ts";
import { consoleWriteKey } from "../../core/consoleWrite.ts";
import type { ConsoleWrite } from "../../core/consoleWrite.ts";
import { failureWords } from "../../core/failureWords.ts";
import { projectDisplayNameFault } from "../../core/projectCreation.ts";
import {
  callerTenantsQuery,
  siteWorkspacesQuery,
} from "../../core/tenantQueries.ts";
import {
  tenantRenameOffered,
  tenantRenameSent,
} from "../../core/tenantRename.ts";
import { useConsoleWrite } from "../consoleWrite.tsx";
import { settingsSectionRefusalOf } from "../settingsSectionRefusal.tsx";
import { Button } from "../ui/Button.tsx";
import { Input } from "../ui/Input.tsx";
import { useSettingsSectionRefusalFocus } from "../ui/SettingsSection.tsx";
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
    landedUnseen: () => ({ id: "settings-rename-workspace-saved" }),
  };
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
  const refusal = settingsSectionRefusalOf(renaming.error);
  const form = useRef<HTMLFormElement>(null);
  const line = useRef<HTMLDivElement>(null);
  useSettingsSectionRefusalFocus(refusal, true, form, line);
  if (!tenantRenameOffered(props.abilities)) return null;
  const shown = typed ?? current;
  const sent = tenantRenameSent(shown, current);
  const fault = projectDisplayNameFault(shown);
  return (
    <SettingsListingSection
      heading={text({ id: "settings-rename-workspace-title" })}
      about={text({
        id: "settings-rename-workspace-about",
        args: { workspace: tenant },
      })}
    >
      <form
        ref={form}
        className="flex min-w-0 flex-wrap items-end gap-2"
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
          labelShown
          label={text({ id: "settings-rename-workspace-label" })}
          value={shown}
          invalid={shown !== current && sent === undefined}
          {...(fault === undefined ? {} : { error: text(fault) })}
          disabled={renaming.isPending}
          onChange={(value) => {
            renaming.reset();
            setTyped(value);
          }}
        />
        <Button
          variant="primary"
          size="sm"
          type="submit"
          busy={renaming.isPending}
          disabled={sent === undefined || renaming.isPending}
        >
          {renaming.isPending
            ? text({ id: "ui-saving" })
            : text({ id: "ui-save" })}
        </Button>
      </form>
      {refusal?.at === "Section" ? (
        <div ref={line} tabIndex={-1}>
          {refusal.line}
        </div>
      ) : null}
    </SettingsListingSection>
  );
}
