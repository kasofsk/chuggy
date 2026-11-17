/**
 * The page a signed-in reader with no project lands on: who they are signed in
 * as, where they stand, and the setup prompt for their agent, with the line
 * that says what pasting it does. The agent walks them through the rest, so
 * this page only starts it.
 *
 * The prompt is drawn before either read has answered. Under it, by where the
 * reader stands: for an admin of a workspace, that workspace, and nothing
 * else to do; for a plain member, each workspace and their roles there, that
 * an admin adds them to a project, and who those admins are where the reader
 * may read the workspace's people; for a reader in no workspace, that, and
 * that a signup link is how they get one.
 */

import type { ReactNode } from "react";

import { useCopyText } from "../copy/CopyProvider.tsx";
import type { AccessCallerTenant } from "../../../../src/contract/accessPlane.ts";
import type { CopyText } from "../core/copy.ts";
import {
  callerTenantsQuery,
  tenantPeopleQuery,
} from "../core/tenantQueries.ts";
import { tenantRoleLabel } from "../core/tenantPeople.ts";
import {
  welcomeAccountLine,
  welcomeAdminLine,
  welcomeAdminsLine,
  welcomePeople,
  welcomeStanding,
  welcomeWords,
  welcomeWorkspace,
} from "../core/welcome.ts";
import type { WelcomePeople, WelcomeStanding } from "../core/welcome.ts";
import { usePanelState } from "./api.ts";
import { PanelUnready } from "./DataPanel.tsx";
import { ProjectlessColumn, ProjectlessFrame } from "./ProjectCreation.tsx";
import { SetupPrompt } from "./SetupPrompt.tsx";

const welcomeLineClassName = "text-sm text-ink-2";

/** What the workspace's people list says, nothing while it is unread or refused. */
function useWelcomePeople(
  workspace: AccessCallerTenant | undefined,
): WelcomePeople | undefined {
  const read = usePanelState({
    ...tenantPeopleQuery(workspace?.tenant ?? ""),
    enabled: workspace !== undefined,
  });
  return read.state === "Ready" ? welcomePeople(read.value) : undefined;
}

function welcomeMemberLine(
  workspace: AccessCallerTenant,
  text: CopyText,
): string {
  return text({
    id: "shell-welcome-member",
    args: {
      workspace: workspace.displayName,
      roles: workspace.roles
        .map((role) => text(tenantRoleLabel(role)))
        .join(", "),
    },
  });
}

function WelcomeMember(props: {
  readonly workspaces: readonly AccessCallerTenant[];
  readonly people: WelcomePeople | undefined;
}): ReactNode {
  const text = useCopyText();
  const admins = welcomeAdminsLine(props.people?.admins ?? []);
  return (
    <div className="grid gap-1">
      {props.workspaces.map((workspace) => (
        <p key={workspace.tenant} className="text-sm text-ink-1">
          {welcomeMemberLine(workspace, text)}
        </p>
      ))}
      <p className={welcomeLineClassName}>{text(welcomeWords.memberDetail)}</p>
      {admins === undefined ? null : (
        <p className={welcomeLineClassName}>{text(admins)}</p>
      )}
    </div>
  );
}

function WelcomeStandingLines(props: {
  readonly standing: WelcomeStanding;
  readonly people: WelcomePeople | undefined;
}): ReactNode {
  const text = useCopyText();
  const { standing } = props;
  switch (standing.standing) {
    case "Unread":
      return <PanelUnready state={standing.state} />;
    case "Admin":
      return (
        <p className="text-sm text-ink-1">
          {text(welcomeAdminLine(standing.workspace))}
        </p>
      );
    case "Member":
      return (
        <WelcomeMember workspaces={standing.workspaces} people={props.people} />
      );
    case "None":
      return (
        <div className="grid gap-1">
          <p className="text-sm text-ink-1">{text(welcomeWords.none)}</p>
          <p className={welcomeLineClassName}>
            {text(welcomeWords.noneDetail)}
          </p>
        </div>
      );
  }
}

export function Welcome(): ReactNode {
  const text = useCopyText();
  const standing = welcomeStanding(usePanelState(callerTenantsQuery()));
  const people = useWelcomePeople(welcomeWorkspace(standing));
  const login = people?.login;
  return (
    <ProjectlessFrame>
      <ProjectlessColumn title={text(welcomeWords.title)}>
        {login === undefined ? null : (
          <p className={welcomeLineClassName}>
            {text(welcomeAccountLine(login))}
          </p>
        )}
        <WelcomeStandingLines standing={standing} people={people} />
        <SetupPrompt />
        <p className={welcomeLineClassName}>{text(welcomeWords.next)}</p>
      </ProjectlessColumn>
    </ProjectlessFrame>
  );
}
