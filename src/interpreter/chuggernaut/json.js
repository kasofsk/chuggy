import { parseTree } from "jsonc-parser";
const numeric_tokens = new WeakMap();
/** Preserve JSON's integer/float distinction and exact integer digits at I/O boundaries. */
export function parse_json(text) {
  const value = JSON.parse(text);
  const tree = parseTree(text);
  function visit(node, current) {
    if (current === null || typeof current !== "object") return;
    const children =
      node.type === "object"
        ? (node.children ?? []).map((property) => [
            String(property.children[0].value),
            property.children[1],
          ])
        : (node.children ?? []).map((child, index) => [String(index), child]);
    const tokens = new Map();
    for (const [key, child] of children) {
      if (child.type === "number")
        tokens.set(key, text.slice(child.offset, child.offset + child.length));
      visit(child, current[key]);
    }
    if (tokens.size) numeric_tokens.set(current, tokens);
  }
  if (tree) visit(tree, value);
  return value;
}
export function number_token(container, key) {
  return numeric_tokens.get(container)?.get(String(key));
}
export function set_number_token(container, key, token) {
  let tokens = numeric_tokens.get(container);
  if (!tokens) numeric_tokens.set(container, (tokens = new Map()));
  tokens.set(String(key), token);
}
export function copy_json_metadata(source, destination) {
  const tokens = numeric_tokens.get(source);
  if (tokens) numeric_tokens.set(destination, new Map(tokens));
  return destination;
}
export function integer_field(container, key) {
  const value = container[key];
  const token = number_token(container, key);
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    (token === undefined || !/[.eE]/.test(token))
  );
}
function float_repr(value) {
  if (!Number.isFinite(value)) throw new Error("non-finite JSON number");
  if (Object.is(value, -0)) return "-0.0";
  if (value === 0) return "0.0";
  const [mantissa, exponentText] = value.toExponential().split("e");
  const exponent = Number(exponentText);
  if (exponent < -4 || exponent >= 16)
    return `${mantissa}e${exponent < 0 ? "-" : "+"}${String(Math.abs(exponent)).padStart(2, "0")}`;
  return Number.isInteger(value) ? `${value}.0` : String(value);
}
function unicode_order(a, b) {
  const left = Array.from(a, (c) => c.codePointAt(0));
  const right = Array.from(b, (c) => c.codePointAt(0));
  for (let i = 0; i < Math.min(left.length, right.length); i++)
    if (left[i] !== right[i]) return left[i] - right[i];
  return left.length - right.length;
}
function serialize(value, sorted, token) {
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
    const record = value;
    const keys = Object.keys(record);
    if (sorted) keys.sort(unicode_order);
    return `{${keys.map((key) => `${JSON.stringify(key)}:${serialize(record[key], sorted, number_token(record, key))}`).join(",")}}`;
  }
  const encoded = JSON.stringify(value);
  if (encoded === undefined) throw new Error("value has no canonical JSON");
  return encoded;
}
export function canonical_json(value) {
  return serialize(value, true);
}
export function stringify_json(value) {
  return serialize(value, false);
}
export function canonical_json_field(container, key) {
  return serialize(container[key], true, number_token(container, key));
}
