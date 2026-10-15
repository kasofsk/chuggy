import {
  repositoryConfigurationNameSchema,
  repositoryConfigurationRoot,
} from "../contract/configurationDocument.ts";
import { repositoryConfigurationNameCharsMax } from "../contract/http.ts";
import { isRepositoryDeclarationPath } from "./repositoryDeclaration.ts";
declare const repositoryConfigurationNameBrand: unique symbol;
declare const repositoryConfigurationPathBrand: unique symbol;

export type RepositoryConfigurationName = string & {
  readonly [repositoryConfigurationNameBrand]: true;
};

export type RepositoryConfigurationPath = string & {
  readonly [repositoryConfigurationPathBrand]: true;
};

/**
 * A repository-imported configuration's label: the name it was declared under
 * and the number that name's import order gave this declaration's digest.
 */
export interface ConfigurationVersion {
  readonly name: RepositoryConfigurationName;
  readonly number: number;
}

/** The configuration name bound and the directory an import reads, surfaced where every branding of one reads them. */
export { repositoryConfigurationNameCharsMax, repositoryConfigurationRoot };

export function asRepositoryConfigurationName(
  value: unknown,
): RepositoryConfigurationName | undefined {
  return repositoryConfigurationNameSchema.safeParse(value).success
    ? (value as RepositoryConfigurationName)
    : undefined;
}

/** The label a wire value names, refusing what the name rule does not admit. */
export function asConfigurationVersion(value: {
  readonly name: string;
  readonly number: number;
}): ConfigurationVersion {
  const name = asRepositoryConfigurationName(value.name);
  if (name === undefined)
    throw new TypeError("configuration version names no configuration");
  if (!Number.isSafeInteger(value.number) || value.number < 1)
    throw new RangeError("configuration version is not a positive integer");
  return { name, number: value.number };
}

export function asRepositoryConfigurationPath(
  value: string,
): RepositoryConfigurationPath | undefined {
  return isRepositoryDeclarationPath(repositoryConfigurationRoot, value)
    ? (value as RepositoryConfigurationPath)
    : undefined;
}
