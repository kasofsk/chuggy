/**
 * The columns a version join adds to a row, and the label they mean.
 *
 * A revision reaches its version through its repository provenance, so both
 * columns are null together — for an authored revision, which has no
 * provenance, and for a repository revision whose name is not yet numbered.
 */

import {
  asConfigurationVersion,
  type ConfigurationVersion,
} from "../../interpreter/repositoryConfigurationIdentity.ts";
import { projectRowCounter } from "./rows.ts";

/** The two nullable columns every version join selects. */
export interface ConfigurationVersionRow {
  readonly version_name: string | null;
  readonly version_number: string | null;
}

/** The label the row carries, absent when the revision has none. */
export function configurationVersionOf(
  row: ConfigurationVersionRow,
): ConfigurationVersion | undefined {
  if (row.version_name === null || row.version_number === null)
    return undefined;
  return asConfigurationVersion({
    name: row.version_name,
    number: projectRowCounter(row.version_number, "configuration version"),
  });
}
