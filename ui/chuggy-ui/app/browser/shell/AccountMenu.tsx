/**
 * The account menu, behind the reader's initials in the bar: who they are
 * signed in as, the settings, their preferences among them, and signing out.
 * Nothing else is in it, so the bar offers the rest of the console nothing it
 * would have to choose between.
 *
 * Who the reader is comes from the access plane's answer about their own
 * account: their GitHub login, which is the name they go by, and their email.
 * The trigger shows the initials of the login or else the email; where the
 * answer names neither, or there is none, it is a plain mark and the menu
 * names nobody. Its name says it is the account menu either way.
 *
 * The settings and the preferences are at their addresses in the frame the bar
 * is drawn in: the project's or the workspace's. A frame naming no workspace
 * has no address for either, so there the menu holds who the reader is and
 * signing out.
 *
 * `modal={false}` keeps `react-remove-scroll` out of the tree: it appends a
 * `<style>` element the served `style-src 'self'` refuses.
 */

import { Link } from "@tanstack/react-router";
import { DropdownMenu } from "radix-ui";
import type { ReactNode } from "react";

import { useCopyText } from "../../copy/CopyProvider.tsx";
import { accountNamed } from "../../core/account.ts";
import type { AccountNamed } from "../../core/account.ts";
import type { SettingsNavParams } from "../../core/settingsNav.ts";
import { shellAccountNav } from "../../core/shellNav.ts";
import { callerAccountQuery } from "../../core/tenantQueries.ts";
import { usePanelState } from "../api.ts";
import { useSessionHolder } from "../session.tsx";
import { buttonLookClassName } from "../ui/Button.tsx";
import { MenuContent, menuItemClassName } from "../ui/Menu.tsx";
import { useChatPaneYields } from "./chatPaneHeld.ts";

function AccountMark(): ReactNode {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className="size-4"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="10" />
      <circle cx="12" cy="10" r="3" />
      <path d="M7 20.662V19a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v1.662" />
    </svg>
  );
}

/** The reader as the answer names them; nothing where it names nobody. */
function AccountName(props: { readonly named: AccountNamed }): ReactNode {
  const { login, email } = props.named;
  if (login === undefined && email === undefined) return null;
  return (
    <>
      <div className="account-name">
        {login === undefined ? null : (
          <span className="text-ink-1 truncate" translate="no">
            {login}
          </span>
        )}
        {email === undefined ? null : (
          <span className="text-ink-3 truncate text-sm" translate="no">
            {email}
          </span>
        )}
      </div>
      <DropdownMenu.Separator className="bg-edge my-1 h-px" />
    </>
  );
}

/** The settings and the preferences, each a link that also moves a pane that
 * filled the body out of the way, as a screen's entry in the bar does. */
function AccountPlaces(props: {
  readonly params: SettingsNavParams;
}): ReactNode {
  const yields = useChatPaneYields();
  const text = useCopyText();
  return (
    <>
      {shellAccountNav(props.params).map((entry) => (
        <DropdownMenu.Item
          key={entry.id}
          className={`${menuItemClassName} text-ink-1 no-underline`}
          asChild
        >
          <Link to={entry.to} params={entry.params} onClick={yields}>
            {text(entry.label)}
          </Link>
        </DropdownMenu.Item>
      ))}
      <DropdownMenu.Separator className="bg-edge my-1 h-px" />
    </>
  );
}

function AccountSignOut(): ReactNode {
  const holder = useSessionHolder();
  const text = useCopyText();
  return (
    <DropdownMenu.Item
      className={menuItemClassName}
      onSelect={() => {
        void holder.signOut();
      }}
    >
      {text({ id: "shell-sign-out" })}
    </DropdownMenu.Item>
  );
}

export function AccountMenu(props: {
  /** Where the settings are drawn: absent where the frame names no workspace. */
  readonly params: SettingsNavParams | undefined;
}): ReactNode {
  const text = useCopyText();
  const account = usePanelState(callerAccountQuery());
  const named = accountNamed(
    account.state === "Ready" ? account.value : undefined,
  );
  return (
    <DropdownMenu.Root modal={false}>
      <DropdownMenu.Trigger
        className={`account-trigger ${buttonLookClassName({ size: "sm", variant: "quiet" })}`}
        aria-label={text({ id: "shell-account" })}
      >
        {named.initials === undefined ? (
          <AccountMark />
        ) : (
          <span aria-hidden="true" className="account-initials" translate="no">
            {named.initials}
          </span>
        )}
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <MenuContent className="account-menu" sideOffset={4} align="end">
          <AccountName named={named} />
          {props.params === undefined ? null : (
            <AccountPlaces params={props.params} />
          )}
          <AccountSignOut />
        </MenuContent>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
