/**
 * The names a ticket's creator is drawn by: the project's people, read as the
 * permissions page reads them, by subject. A reader the people list is not
 * answered to, or one it has not answered yet, draws every creator by subject.
 */

import { useMemo } from "react";

import type { PartitionIdentity } from "../../../../src/contract/http.ts";
import { creatorNamesOf } from "../core/labels.ts";
import { useProjectPeople } from "./settings/projectPermissionsResource.ts";

const creatorNamesNone: ReadonlyMap<string, string> = new Map();

export function useCreatorNames(
  partition: PartitionIdentity,
): ReadonlyMap<string, string> {
  const people = useProjectPeople(partition);
  return useMemo(
    () =>
      people.state === "Ready"
        ? creatorNamesOf(people.value.people)
        : creatorNamesNone,
    [people],
  );
}
