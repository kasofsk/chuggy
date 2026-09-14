export function record(value: unknown): Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new TypeError("request fields are not an object");
  return value as Readonly<Record<string, unknown>>;
}

export function fieldsOnly(
  value: unknown,
  allowed: readonly string[],
): Readonly<Record<string, unknown>> {
  const found = record(value);
  if (Object.keys(found).some((name) => !allowed.includes(name)))
    throw new TypeError("request has an unknown field");
  return found;
}

export function textField(
  fields: Readonly<Record<string, unknown>>,
  name: string,
): string {
  const value = fields[name];
  if (typeof value !== "string") throw new TypeError(`${name} is not text`);
  return value;
}

export function integerField(
  fields: Readonly<Record<string, unknown>>,
  name: string,
  fallback?: number,
): number {
  const value = fields[name];
  if (value === undefined && fallback !== undefined) return fallback;
  if (typeof value !== "string" || !/^(?:0|[1-9][0-9]*)$/u.test(value))
    throw new TypeError(`${name} is not a canonical non-negative integer`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed))
    throw new RangeError(`${name} is too large`);
  return parsed;
}
