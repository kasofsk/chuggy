/**
 * The emails a ticket's creator is drawn by: the project's people, read as the
 * permissions page reads them, by subject. A reader the people list is not
 * answered to, or one it has not answered yet, draws every creator by subject.
 */

import { useMemo } from "react";

import type { PartitionIdentity } from "../../../../src/contract/http.ts";
import { creatorEmailsOf } from "../core/labels.ts";
import { useProjectPeople } from "./settings/projectPermissionsResource.ts";

const creatorEmailsNone: ReadonlyMap<string, string> = new Map();

export function useCreatorEmails(
  partition: PartitionIdentity,
): ReadonlyMap<string, string> {
  const people = useProjectPeople(partition);
  return useMemo(
    () =>
      people.state === "Ready"
        ? creatorEmailsOf(people.value.people)
        : creatorEmailsNone,
    [people],
  );
}
