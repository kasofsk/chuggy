/**
 * Deleting a project that never ran work, or a workspace that holds no
 * project, asked in place and named in the question.
 *
 * THE SECTION IS DRAWN ONLY WHERE THE DELETION WOULD BE DONE. Its read answers
 * absent to a reader who may not delete and names what holds it otherwise, so
 * a reader who may not, or a project that has run work, sees nothing. A press
 * refused because something came to hold it since names what does.
 */

import type { QueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import type { ReactNode } from "react";

import type { PartitionIdentity } from "../../../../../src/contract/http.ts";
import { useCopyText } from "../../copy/CopyProvider.tsx";
import type { ApiPorts } from "../../core/apiRequest.ts";
import type { ApiResult } from "../../core/apiRequest.ts";
import { apiDeleteProject, apiDeleteTenant } from "../../core/apiRoutes.ts";
import type { Copy } from "../../core/copy.ts";
import { consoleWriteKey } from "../../core/consoleWrite.ts";
import type { ConsoleWrite } from "../../core/consoleWrite.ts";
import { failureWords } from "../../core/failureWords.ts";
import type { PanelState } from "../../core/freshness.ts";
import { projectDeletionQuery } from "../../core/projectQueries.ts";
import {
  callerTenantsQuery,
  projectsInventoryQuery,
  tenantDeletionQuery,
} from "../../core/tenantQueries.ts";
import {
  projectDeletionHeldParsed,
  tenantDeletionHeldParsed,
  unrunDeletionAnswered,
  unrunDeletionHeldCopy,
} from "../../core/unrunDeletion.ts";
import type { UnrunDeletionHolding } from "../../core/unrunDeletion.ts";
import { usePanelState } from "../api.ts";
import { ConsoleWriteRefusedWords, useConsoleWrite } from "../consoleWrite.tsx";
import { Button } from "../ui/Button.tsx";
import { Confirm } from "../ui/Confirm.tsx";
import { Notice } from "../ui/Notice.tsx";
import { SettingsListingSection } from "./SettingsListing.tsx";

/** What one deletion section is drawn from, in its own words. */
interface UnrunDeletionDrawn<Held extends UnrunDeletionHolding> {
  readonly standing: PanelState<{ readonly held: readonly Held[] }>;
  readonly write: ConsoleWrite<undefined, readonly Held[]>;
  readonly title: string;
  readonly about: string;
  readonly button: string;
  readonly question: string;
  readonly line: string;
  readonly done: string;
}

/** The lists that name what was deleted, read again once it is. */
async function unrunDeletionLanded(client: QueryClient): Promise<void> {
  await Promise.all([
    client.invalidateQueries({ queryKey: projectsInventoryQuery().queryKey }),
    client.invalidateQueries({ queryKey: callerTenantsQuery().queryKey }),
  ]);
}

function unrunDeletionWrite<Held extends UnrunDeletionHolding>(
  key: readonly string[],
  deleted: (ports: ApiPorts) => Promise<ApiResult<undefined>>,
  parsed: (body: unknown) => { readonly held: readonly Held[] } | undefined,
): ConsoleWrite<undefined, readonly Held[]> {
  return {
    mutationKey: consoleWriteKey("unrun-deletion", ...key),
    write: async (ports) => unrunDeletionAnswered(await deleted(ports), parsed),
    refusal: (failure): Copy => failureWords(failure).word,
    landed: async (client, held) => {
      if (held.length === 0) await unrunDeletionLanded(client);
    },
  };
}

function UnrunDeletionSection<Held extends UnrunDeletionHolding>(
  props: UnrunDeletionDrawn<Held>,
): ReactNode {
  const text = useCopyText();
  const [asking, setAsking] = useState(false);
  const deleting = useConsoleWrite(props.write, { drawn: true });
  const answered = deleting.data;
  if (answered !== undefined && answered.length === 0)
    return (
      <Notice tone="pass">
        {props.done} <Link to="/">{text({ id: "settings-delete-back" })}</Link>
      </Notice>
    );
  const { standing } = props;
  if (standing.state !== "Ready" || standing.value.held.length > 0) return null;
  const held =
    answered === undefined ? undefined : unrunDeletionHeldCopy(answered);
  return (
    <SettingsListingSection
      heading={props.title}
      about={props.about}
      action={
        asking ? null : (
          <Button
            size="sm"
            variant="danger"
            disabled={deleting.isPending}
            onClick={() => {
              deleting.reset();
              setAsking(true);
            }}
          >
            {props.button}
          </Button>
        )
      }
    >
      {asking || deleting.isPending ? (
        <Confirm
          question={props.question}
          confirm={props.button}
          busy={deleting.isPending}
          onConfirm={() => {
            setAsking(false);
            deleting.mutate(undefined);
          }}
          onCancel={() => {
            setAsking(false);
          }}
        >
          {props.line}
        </Confirm>
      ) : null}
      {held === undefined ? null : (
        <Notice tone="danger" inline>
          {text(held)}
        </Notice>
      )}
      {deleting.error === null ? null : (
        <Notice tone="danger" inline>
          <ConsoleWriteRefusedWords refused={deleting.error} />
        </Notice>
      )}
    </SettingsListingSection>
  );
}

/** The project deleted, for its workspace's administrator, while it has never run work. */
export function ProjectDeletion(props: {
  readonly partition: PartitionIdentity;
}): ReactNode {
  const text = useCopyText();
  const { partition } = props;
  const standing = usePanelState(projectDeletionQuery(partition));
  const project = partition.project;
  return (
    <UnrunDeletionSection
      standing={standing}
      write={unrunDeletionWrite(
        ["project", partition.tenant, partition.project],
        (ports) => apiDeleteProject(ports, partition),
        projectDeletionHeldParsed,
      )}
      title={text({ id: "settings-delete-project-title" })}
      about={text({ id: "settings-delete-project-about" })}
      button={text({ id: "settings-delete-project" })}
      question={text({
        id: "settings-delete-project-question",
        args: { project },
      })}
      line={text({ id: "settings-delete-project-line", args: { project } })}
      done={text({ id: "settings-delete-project-done", args: { project } })}
    />
  );
}

/** The workspace deleted, for the site's administrator, once it holds no project. */
export function TenantDeletion(props: { readonly tenant: string }): ReactNode {
  const text = useCopyText();
  const workspace = props.tenant;
  const standing = usePanelState(tenantDeletionQuery(workspace));
  return (
    <UnrunDeletionSection
      standing={standing}
      write={unrunDeletionWrite(
        ["tenant", workspace],
        (ports) => apiDeleteTenant(ports, workspace),
        tenantDeletionHeldParsed,
      )}
      title={text({ id: "settings-delete-workspace-title" })}
      about={text({ id: "settings-delete-workspace-about" })}
      button={text({ id: "settings-delete-workspace" })}
      question={text({
        id: "settings-delete-workspace-question",
        args: { workspace },
      })}
      line={text({
        id: "settings-delete-workspace-line",
        args: { workspace },
      })}
      done={text({
        id: "settings-delete-workspace-done",
        args: { workspace },
      })}
    />
  );
}
