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

export const repositoryConfigurationDeclarationsMax = 100;
export const repositoryConfigurationNameCharsMax = 128;
export const repositoryConfigurationPathCharsMax = 256;
export const repositoryConfigurationFileCharsMax = 65_536;
export const repositoryConfigurationRoot = ".chug/configurations/";

export function asRepositoryConfigurationName(
  value: unknown,
): RepositoryConfigurationName | undefined {
  return typeof value === "string" &&
    value.length > 0 &&
    value.length <= repositoryConfigurationNameCharsMax &&
    value.isWellFormed() &&
    /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/u.test(value)
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
  if (
    value.length === 0 ||
    value.length > repositoryConfigurationPathCharsMax ||
    !value.isWellFormed() ||
    value.includes("\\") ||
    value.includes("\0")
  )
    return undefined;
  const relative = value.slice(repositoryConfigurationRoot.length);
  return value.startsWith(repositoryConfigurationRoot) &&
    relative.endsWith(".json") &&
    relative.length > ".json".length &&
    !relative.slice(0, -".json".length).includes("/")
    ? (value as RepositoryConfigurationPath)
    : undefined;
}
