/**
 * The signed-in reader's account, behind one mark in the bar: their initials,
 * and in the menu it opens who they are signed in as, the settings, their
 * preferences and signing out — nothing else, so the bar never offers more
 * than a reader can take in at a glance.
 *
 * The settings and the preferences have an address only in a workspace, so
 * where the frame names none the menu names neither.
 *
 * `modal={false}` keeps `react-remove-scroll` out of the tree: it appends a
 * `<style>` element the served `style-src 'self'` refuses.
 */

import { Link } from "@tanstack/react-router";
import { DropdownMenu } from "radix-ui";
import type { ReactNode } from "react";

import { useCopyText } from "../../copy/CopyProvider.tsx";
import { accountMenuShown } from "../../core/accountMenu.ts";
import type { AccountMenuShown } from "../../core/accountMenu.ts";
import { shellAccountNav } from "../../core/shellNav.ts";
import type { ShellAccountFrame } from "../../core/shellNav.ts";
import { callerAccountQuery } from "../../core/tenantQueries.ts";
import { usePanelState } from "../api.ts";
import { useSessionHolder } from "../session.tsx";
import { buttonLookClassName } from "../ui/Button.tsx";
import { MenuContent, menuItemClassName } from "../ui/Menu.tsx";
import { useChatPaneYields } from "./chatPaneHeld.ts";

/** The mark drawn where the account answers no name to take initials from. */
function AccountMenuMark(): ReactNode {
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
      <circle cx="12" cy="8" r="5" />
      <path d="M20 21a8 8 0 0 0-16 0" />
    </svg>
  );
}

/** Who the reader is signed in as, as plain text: their login, then their
 * email, each only where the account answers it. */
function AccountMenuWho(props: {
  readonly shown: AccountMenuShown;
}): ReactNode {
  const { login, email } = props.shown;
  if (login === undefined && email === undefined) return null;
  return (
    <>
      <div className="account-menu-who">
        {login === undefined ? null : (
          <span className="account-menu-login" translate="no">
            {login}
          </span>
        )}
        {email === undefined ? null : (
          <span className="account-menu-email" translate="no">
            {email}
          </span>
        )}
      </div>
      <DropdownMenu.Separator className="bg-edge my-1 h-px" />
    </>
  );
}

/** The settings and the preferences, each a link pressed with `onPress`. */
function AccountMenuPlaces(props: {
  readonly frame: ShellAccountFrame;
  readonly onPress: (() => void) | undefined;
}): ReactNode {
  const text = useCopyText();
  return (
    <>
      {shellAccountNav(props.frame).map((entry) => (
        <DropdownMenu.Item
          key={entry.id}
          className={`${menuItemClassName} text-ink-1 no-underline`}
          asChild
        >
          <Link to={entry.to} params={entry.params} onClick={props.onPress}>
            {text(entry.label)}
          </Link>
        </DropdownMenu.Item>
      ))}
      <DropdownMenu.Separator className="bg-edge my-1 h-px" />
    </>
  );
}

/** A project's places, which also move a pane that filled the body out of the
 * way, as a screen's entry in the bar does; only a project has the pane. */
function AccountMenuProjectPlaces(props: {
  readonly frame: ShellAccountFrame;
}): ReactNode {
  return (
    <AccountMenuPlaces frame={props.frame} onPress={useChatPaneYields()} />
  );
}

function AccountMenuSignOut(): ReactNode {
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
  /** The project the page is in, where it is in one. */
  readonly project: string | undefined;
  /** The workspace the page is in, where one is known. */
  readonly tenant: string | undefined;
}): ReactNode {
  const text = useCopyText();
  const frame = { tenant: props.tenant, project: props.project };
  const account = usePanelState(callerAccountQuery());
  const shown = accountMenuShown(
    account.state === "Ready" ? account.value : undefined,
  );
  return (
    <DropdownMenu.Root modal={false}>
      <DropdownMenu.Trigger
        className={buttonLookClassName({ size: "icon", variant: "quiet" })}
        aria-label={text({ id: "shell-account" })}
      >
        {shown.initials === undefined ? (
          <AccountMenuMark />
        ) : (
          <span aria-hidden="true" translate="no">
            {shown.initials}
          </span>
        )}
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <MenuContent className="account-menu" sideOffset={4} align="end">
          <AccountMenuWho shown={shown} />
          {props.project === undefined ? (
            <AccountMenuPlaces frame={frame} onPress={undefined} />
          ) : (
            <AccountMenuProjectPlaces frame={frame} />
          )}
          <AccountMenuSignOut />
        </MenuContent>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
