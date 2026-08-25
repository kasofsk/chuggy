declare const canonicalConfigurationBrand: unique symbol;

export type CanonicalConfiguration = string & {
  readonly [canonicalConfigurationBrand]: true;
};
