/**
 * What the shell says of the page a reader moves to in a project: the
 * document's title, and whether the move takes their focus to it.
 *
 * The title is the bar's trail beneath the project read from the page outward,
 * then the project, so a tab cut short still says which page it holds. It
 * names nothing the trail does not.
 */

import type { PartitionIdentity } from "../../../../src/contract/http.ts";
import { shellCrumbs } from "./shellCrumbs.ts";

/** What stands between two parts of the title. */
const shellPageTitleJoin = " · ";

/** The trail's workspace and project, which the title replaces with the
 * project alone at its end. */
const shellPageTitleHeadCount = 2;

export function shellPageTitle(
  partition: PartitionIdentity,
  pathname: string,
): string {
  const page = shellCrumbs(partition, pathname)
    .slice(shellPageTitleHeadCount)
    .map((crumb) => crumb.label)
    .reverse();
  return [...page, partition.project].join(shellPageTitleJoin);
}

/**
 * Whether a move to `pathname` from `before` takes the reader's focus to the
 * page: only when the page is another one, so neither the first page drawn
 * nor a change to the query alone moves it, and never out of the chat pane,
 * whose thread moves the pages while its reader may be typing.
 */
export function shellPageFocused(
  before: string | undefined,
  pathname: string,
  chatFocused: boolean,
): boolean {
  return before !== undefined && before !== pathname && !chatFocused;
}
