/**
 * Where the welcome page says a reader with no project stands, decided with no
 * renderer: the workspace they administer, or the workspaces they are in and
 * their roles there, or none.
 *
 * The reader's own workspaces decide it. A workspace they administer is the
 * one named, the first the list answers where there are several, since the
 * setup program asks which where it cannot tell. A list cut short that names
 * nothing says nothing of where they stand, and is drawn as a read that did
 * not answer.
 *
 * The workspace's people list, where the reader may read it, says the GitHub
 * login the reader's own account records and who else administers it. Neither
 * list says who a reader in no workspace is signed in as, so that page names
 * no account.
 */

import type {
  AccessCallerTenant,
  AccessCallerTenants,
  AccessTenantPeople,
} from "../../../../src/contract/accessPlane.ts";

import type { Copy } from "./copy.ts";
import type { PanelState } from "./freshness.ts";
import { tenantPersonName } from "./tenantPeople.ts";

export type WelcomeStanding =
  | {
      readonly standing: "Unread";
      readonly state: Exclude<
        PanelState<AccessCallerTenants>,
        { readonly state: "Ready" }
      >;
    }
  | { readonly standing: "Admin"; readonly workspace: AccessCallerTenant }
  | {
      readonly standing: "Member";
      readonly workspaces: readonly [
        AccessCallerTenant,
        ...AccessCallerTenant[],
      ];
    }
  | { readonly standing: "None" };

export function welcomeStanding(
  held: PanelState<AccessCallerTenants>,
): WelcomeStanding {
  if (held.state !== "Ready") return { standing: "Unread", state: held };
  const { tenants, truncated } = held.value;
  const administered = tenants.find((listed) => listed.administer);
  if (administered !== undefined)
    return { standing: "Admin", workspace: administered };
  const [first, ...rest] = tenants;
  if (first !== undefined)
    return { standing: "Member", workspaces: [first, ...rest] };
  return truncated
    ? { standing: "Unread", state: { state: "Absent" } }
    : { standing: "None" };
}

/** The workspace whose people list the page reads, none for a reader in none. */
export function welcomeWorkspace(
  standing: WelcomeStanding,
): AccessCallerTenant | undefined {
  switch (standing.standing) {
    case "Unread":
    case "None":
      return undefined;
    case "Admin":
      return standing.workspace;
    case "Member":
      return standing.workspaces[0];
  }
}

/** What one workspace's people list says to the welcome page. */
export interface WelcomePeople {
  /** The GitHub login the reader's own account records, where it records one. */
  readonly login: string | undefined;
  /** Every other administrator, each by their GitHub login or else their name. */
  readonly admins: readonly string[];
}

export function welcomePeople(people: AccessTenantPeople): WelcomePeople {
  const mine = people.people.find((person) => person.mine);
  const admins = people.people
    .filter((person) => !person.mine && person.tenantRoles.includes("Admin"))
    .map((person) => {
      const named = tenantPersonName(person);
      return named.githubLogin ?? named.name;
    });
  return {
    login: mine === undefined ? undefined : tenantPersonName(mine).githubLogin,
    admins,
  };
}

export const welcomeWords = {
  title: { id: "shell-welcome-title" },
  next: { id: "shell-welcome-next" },
  claudeCodeAbsent: { id: "shell-welcome-claude-code-absent" },
  claudeCodeInstall: { id: "shell-welcome-claude-code-install" },
  memberDetail: { id: "shell-welcome-member-detail" },
  none: { id: "setup-mend-workspace-none" },
  noneDetail: { id: "shell-welcome-none-detail" },
} as const satisfies Readonly<Record<string, Copy>>;

/** Anthropic's page that names Claude Code's install command for each system. */
export const welcomeClaudeCodeSetupAddress =
  "https://code.claude.com/docs/en/setup";

export function welcomeAccountLine(login: string): Copy {
  return { id: "shell-welcome-account", args: { login } };
}

export function welcomeAdminLine(workspace: AccessCallerTenant): Copy {
  return {
    id: "shell-welcome-admin",
    args: { workspace: workspace.displayName },
  };
}

export function welcomeAdminsLine(admins: readonly string[]): Copy | undefined {
  return admins.length === 0
    ? undefined
    : { id: "shell-welcome-admins", args: { admins: admins.join(", ") } };
}
