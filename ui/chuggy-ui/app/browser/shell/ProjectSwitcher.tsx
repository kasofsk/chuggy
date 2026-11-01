/**
 * The project the bar is showing, every other project this reader may read,
 * and the way to make another. That names the workspace of the one shown to
 * the form that makes it, whose choice starts there only where the reader
 * administers that workspace.
 *
 * A pick is a navigation, and the picked project is remembered so the next tab
 * opens where this one left off. An inventory that has not answered says so
 * rather than offering an empty list.
 *
 * NO PROJECT IS A CHOICE IN THE WORKSPACE SHOWN, where it lets the reader chat
 * outside a project, and picking it opens their own chat there.
 */

import { useNavigate } from "@tanstack/react-router";
import type { ReactNode } from "react";

import type { PartitionIdentity } from "../../../../../src/contract/http.ts";
import { projectsInventoryQuery } from "../../core/tenantQueries.ts";
import { lastProjectWrite } from "../../core/lastProject.ts";
import {
  memberChatOpens,
  memberChatProjectNone,
  memberChatRoutes,
} from "../../core/memberChat.ts";
import { projectCreationRoutePath } from "../../core/projectCreation.ts";
import { usePanelState } from "../api.ts";
import { persistentStore } from "../ports.ts";
import { useChatAbilities } from "../thread/threadRead.ts";
import { Notice } from "../ui/Notice.tsx";
import { Picker } from "../ui/Picker.tsx";

export const projectSwitcherCreateText = "New project";

/** The value the picker names a workspace's own chat by, which no project's
 * value is, since a project's name is never empty. */
function projectSwitcherNone(tenant: string): string {
  return `${tenant}/`;
}

export function ProjectSwitcher(props: {
  readonly partition: PartitionIdentity | undefined;
  /** The tenant whose own chat the page is, where it is one. */
  readonly chat?: string;
}): ReactNode {
  const tenant = props.partition?.tenant ?? props.chat;
  return tenant === undefined ? (
    <ProjectSwitcherPicker {...props} chats={false} />
  ) : (
    <ProjectSwitcherAt {...props} tenant={tenant} />
  );
}

/** The switcher in a workspace, offering its own chat where it may be had. */
function ProjectSwitcherAt(props: {
  readonly partition: PartitionIdentity | undefined;
  readonly chat?: string;
  readonly tenant: string;
}): ReactNode {
  const abilities = useChatAbilities(props.tenant);
  return (
    <ProjectSwitcherPicker
      {...props}
      chats={memberChatOpens(
        abilities.state === "Ready" ? abilities.value : undefined,
      )}
    />
  );
}

function ProjectSwitcherPicker(props: {
  readonly partition: PartitionIdentity | undefined;
  readonly chat?: string;
  readonly tenant?: string;
  /** Whether the workspace shown lets the reader chat outside a project. */
  readonly chats: boolean;
}): ReactNode {
  const navigate = useNavigate();
  const state = usePanelState(projectsInventoryQuery());
  if (state.state !== "Ready")
    return <Notice tone="parked" inline detail="Projects unavailable" />;
  const { tenant } = props;
  const none =
    tenant === undefined || !props.chats
      ? []
      : [
          {
            value: projectSwitcherNone(tenant),
            text: `${tenant} / ${memberChatProjectNone}`,
          },
        ];
  return (
    <Picker
      label="Project"
      value={
        props.partition !== undefined
          ? `${props.partition.tenant}/${props.partition.project}`
          : props.chat !== undefined && props.chats
            ? projectSwitcherNone(props.chat)
            : ""
      }
      placeholder="Project"
      options={[
        ...none,
        ...state.value.map((candidate) => ({
          value: `${candidate.tenant}/${candidate.project}`,
          text: `${candidate.tenant} / ${candidate.project}`,
        })),
      ]}
      onChoose={(picked) => {
        if (tenant !== undefined && picked === projectSwitcherNone(tenant)) {
          void navigate({ to: memberChatRoutes.chat, params: { tenant } });
          return;
        }
        const chosen = state.value.find(
          (candidate) => `${candidate.tenant}/${candidate.project}` === picked,
        );
        if (chosen === undefined) return;
        lastProjectWrite(persistentStore, chosen);
        void navigate({
          to: "/$tenant/$project",
          params: { tenant: chosen.tenant, project: chosen.project },
        });
      }}
      actions={[
        {
          text: projectSwitcherCreateText,
          onSelect: () => {
            void navigate({
              to: projectCreationRoutePath,
              search: { workspace: tenant },
            });
          },
        },
      ]}
    />
  );
}
