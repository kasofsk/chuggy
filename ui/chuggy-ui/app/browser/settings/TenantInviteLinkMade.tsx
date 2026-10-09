/**
 * A link that was just made, as the whole body of the dialog that made it:
 * its address in a field a reader selects from, the control that copies it,
 * and under it what is true of the link and said nowhere later.
 *
 * THE ADDRESS IS BUILT HERE FROM A TOKEN THIS IS HANDED and kept by nothing:
 * the dialog's state holds the mint's answer, and closing the dialog forgets
 * it.
 */

import type { ReactNode } from "react";

import type { AccessInviteLinkMinted } from "../../../../../src/contract/accessPlane.ts";
import {
  inviteLinkAddress,
  tenantInviteLinkShownOnce,
} from "../../core/inviteLinks.ts";
import { tenantInvitationAccountsLine } from "../../core/tenantPeople.ts";
import { currentOrigin } from "../ports.ts";
import { CopyButton } from "../ui/CopyButton.tsx";
import { Input } from "../ui/Input.tsx";

export function TenantInviteLinkMade(props: {
  readonly minted: AccessInviteLinkMinted;
}): ReactNode {
  const address = inviteLinkAddress(currentOrigin(), props.minted.token);
  return (
    <div className="grid gap-2">
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
        <Input readOnly label="Invite link" value={address} />
        <CopyButton text={address} label="Copy link" worded />
      </div>
      <p className="m-0 text-sm text-ink-3">{tenantInviteLinkShownOnce}</p>
      {props.minted.newAccounts ? null : (
        <p className="m-0 text-sm text-ink-3">{tenantInvitationAccountsLine}</p>
      )}
    </div>
  );
}
