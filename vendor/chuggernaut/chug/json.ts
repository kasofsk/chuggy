import { parseTree, type Node } from "jsonc-parser";

const numeric_tokens = new WeakMap<object, Map<string, string>>();

/** Preserve JSON's integer/float distinction and exact integer digits at I/O boundaries. */
export function parse_json(text: string): unknown {
  const value: unknown = JSON.parse(text);
  const tree = parseTree(text);
  function visit(node: Node, current: unknown): void {
    if (current === null || typeof current !== "object") return;
    const children =
      node.type === "object"
        ? (node.children ?? []).map(
            (property) =>
              [
                String(property.children![0]!.value),
                property.children![1]!,
              ] as const,
          )
        : (node.children ?? []).map(
            (child, index) => [String(index), child] as const,
          );
    const tokens = new Map<string, string>();
    for (const [key, child] of children) {
      if (child.type === "number")
        tokens.set(key, text.slice(child.offset, child.offset + child.length));
      visit(child, (current as Record<string, unknown>)[key]);
    }
    if (tokens.size) numeric_tokens.set(current, tokens);
  }
  if (tree) visit(tree, value);
  return value;
}

export function number_token(
  container: object,
  key: string | number,
): string | undefined {
  return numeric_tokens.get(container)?.get(String(key));
}
export function set_number_token(
  container: object,
  key: string | number,
  token: string,
): void {
  let tokens = numeric_tokens.get(container);
  if (!tokens) numeric_tokens.set(container, (tokens = new Map()));
  tokens.set(String(key), token);
}
export function copy_json_metadata<T extends object>(
  source: object,
  destination: T,
): T {
  const tokens = numeric_tokens.get(source);
  if (tokens) numeric_tokens.set(destination, new Map(tokens));
  return destination;
}
export function integer_field(
  container: object,
  key: string | number,
): boolean {
  const value = (container as Record<string, unknown>)[key];
  const token = number_token(container, key);
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    (token === undefined || !/[.eE]/.test(token))
  );
}
function float_repr(value: number): string {
  if (!Number.isFinite(value)) throw new Error("non-finite JSON number");
  if (Object.is(value, -0)) return "-0.0";
  if (value === 0) return "0.0";
  const [mantissa, exponentText] = value.toExponential().split("e");
  const exponent = Number(exponentText);
  if (exponent < -4 || exponent >= 16)
    return `${mantissa}e${exponent < 0 ? "-" : "+"}${String(Math.abs(exponent)).padStart(2, "0")}`;
  return Number.isInteger(value) ? `${value}.0` : String(value);
}
function unicode_order(a: string, b: string): number {
  const left = Array.from(a, (c) => c.codePointAt(0)!);
  const right = Array.from(b, (c) => c.codePointAt(0)!);
  for (let i = 0; i < Math.min(left.length, right.length); i++)
    if (left[i] !== right[i]) return left[i]! - right[i]!;
  return left.length - right.length;
}
function serialize(value: unknown, sorted: boolean, token?: string): string {
  if (typeof value === "number") {
    if (token !== undefined && Object.is(Number(token), value))
      return /[.eE]/.test(token) ? float_repr(value) : BigInt(token).toString();
    if (!Number.isFinite(value)) throw new Error("non-finite JSON number");
    return Number.isInteger(value)
      ? BigInt(value).toString()
      : float_repr(value);
  }
  if (Array.isArray(value))
    return `[${value.map((item, index) => serialize(item, sorted, number_token(value, index))).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record);
    if (sorted) keys.sort(unicode_order);
    return `{${keys.map((key) => `${JSON.stringify(key)}:${serialize(record[key], sorted, number_token(record, key))}`).join(",")}}`;
  }
  const encoded = JSON.stringify(value);
  if (encoded === undefined) throw new Error("value has no canonical JSON");
  return encoded;
}
export function canonical_json(value: unknown): string {
  return serialize(value, true);
}
export function stringify_json(value: unknown): string {
  return serialize(value, false);
}

export function canonical_json_field(
  container: object,
  key: string | number,
): string {
  return serialize(
    (container as Record<string, unknown>)[key],
    true,
    number_token(container, key),
  );
}
