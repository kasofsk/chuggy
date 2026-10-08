/**
 * One level's removal and addition of permission holders, for any level's
 * page: a holder sent by the level's routes where the reader may change its
 * permission, then what the level says it may have changed read again. The
 * choices are the row's admitted holders less those it has, and the people the
 * level's own, where they were read.
 */

import { useQueryClient, type QueryClient } from "@tanstack/react-query";

import type {
  AccessAuthorityPerson,
  AccessGroup,
  AccessTenantAbilities,
} from "../../../../../src/contract/accessPlane.ts";
import type { ApiPorts, ApiResult } from "../../core/apiRequest.ts";
import {
  permissionAdditionChoices,
  permissionAdditionPeople,
  permissionChangeable,
  type PermissionAdmits,
  type PermissionAuthority,
  type PermissionHolder,
  type PermissionLevel,
  type PermissionRow,
} from "../../core/permissions.ts";
import { useApiPorts } from "../api.ts";
import type { PermissionsAddition } from "./PermissionAddition.tsx";
import type { PermissionsRemoval } from "./PermissionsSection.tsx";

export type PermissionChange = "Removal" | "Addition";

/** One level's routes for one permission, a removal's or an addition's. */
export interface PermissionHolderRoutes {
  readonly group: (group: AccessGroup) => Promise<ApiResult<undefined>>;
  readonly person: (subject: string) => Promise<ApiResult<undefined>>;
  readonly tenant:
    ((tenant: string) => Promise<ApiResult<undefined>>) | undefined;
}

/** What one level's page gives its changes: whose they are, what each row
 * admits, the routes that send them, and what they read again. */
export interface PermissionsChanging<Authority extends PermissionAuthority> {
  readonly tenant: string;
  readonly level: PermissionLevel;
  readonly abilities: AccessTenantAbilities | undefined;
  readonly people:
    { readonly people: readonly AccessAuthorityPerson[] } | undefined;
  readonly admits: (authority: Authority) => PermissionAdmits;
  readonly routes: (
    ports: ApiPorts,
    authority: Authority,
    change: PermissionChange,
  ) => PermissionHolderRoutes;
  readonly reread: (client: QueryClient) => Promise<void>;
}

function permissionHolderUnrouted(holder: PermissionHolder): never {
  throw new Error(`no route sends ${holder.kind} for this permission`);
}

function permissionHolderSent(
  routes: PermissionHolderRoutes,
  holder: PermissionHolder,
): Promise<ApiResult<undefined>> {
  switch (holder.kind) {
    case "Group":
      return routes.group(holder.group);
    case "Person":
      return routes.person(holder.person.subject);
    case "TenantAdmins":
      return routes.tenant === undefined
        ? permissionHolderUnrouted(holder)
        : routes.tenant(holder.tenant);
    case "SiteStanding":
    case "Unnamed":
      return permissionHolderUnrouted(holder);
  }
}

export function usePermissionsChange<Authority extends PermissionAuthority>(
  changing: PermissionsChanging<Authority>,
): {
  readonly removal: PermissionsRemoval<Authority>;
  readonly addition: PermissionsAddition<Authority>;
} {
  const ports = useApiPorts();
  const client = useQueryClient();
  const changeable = (row: PermissionRow<Authority>): boolean =>
    permissionChangeable(changing.level, row.authority, changing.abilities);
  const sent =
    (change: PermissionChange) =>
    async (
      row: PermissionRow<Authority>,
      holder: PermissionHolder,
    ): Promise<ApiResult<undefined>> => {
      const answered = await permissionHolderSent(
        changing.routes(ports, row.authority, change),
        holder,
      );
      await changing.reread(client);
      return answered;
    };
  const people = (row: PermissionRow<Authority>) =>
    permissionAdditionPeople(changing.people, row);
  return {
    removal: { removable: changeable, remove: sent("Removal") },
    addition: {
      addable: changeable,
      choices: (row) =>
        permissionAdditionChoices(
          changing.level,
          row,
          changing.admits(row.authority),
          changing.tenant,
          people(row),
        ),
      people: (row) => people(row) ?? [],
      add: sent("Addition"),
    },
  };
}
