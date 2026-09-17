import { readFileSync } from "node:fs";
import { parseDocument, isScalar, type Tags } from "yaml";
import { schema_validator } from "./chuggernaut/json_schema.js";
import { set_number_token } from "../../interpreter/chuggernaut/json.js";

export type CatalogDocument = Record<string, unknown>;
export { ticketCatalogDocumentBytesMax as catalogDocumentBytesMax } from "../../interpreter/ticketCatalog.ts";
import { ticketCatalogDocumentBytesMax } from "../../interpreter/ticketCatalog.ts";

function documentTags(tags: Tags): Tags {
  return tags.map((tag) => {
    if (typeof tag === "string" || !("test" in tag) || !tag.test) return tag;
    if (tag.tag === "tag:yaml.org,2002:bool")
      return {
        ...tag,
        test: tag.test.test("true")
          ? /^(?:yes|Yes|YES|true|True|TRUE|on|On|ON)$/u
          : /^(?:no|No|NO|false|False|FALSE|off|Off|OFF)$/u,
      };
    if (
      tag.tag === "tag:yaml.org,2002:float" &&
      !tag.format &&
      tag.test.test(".")
    )
      return { ...tag, test: /^[-+]?(?:[0-9][0-9_]*\.[0-9_]*|\.[0-9_]+)$/u };
    if (tag.tag === "tag:yaml.org,2002:int" && !tag.format)
      return { ...tag, test: /^[-+]?(?:0|[1-9][0-9_]*)$/u };
    if (tag.tag === "tag:yaml.org,2002:int" && tag.format === "TIME")
      return { ...tag, test: /^[-+]?[1-9][0-9_]*(?::[0-5]?[0-9])+$/u };
    if (tag.tag === "tag:yaml.org,2002:float" && tag.format === "EXP")
      return {
        ...tag,
        test: /^[-+]?(?:[0-9][0-9_]*\.[0-9_]*|\.[0-9_]+)[eE][-+][0-9]+$/u,
      };
    return tag;
  });
}

export function documentMapping(value: unknown): value is CatalogDocument {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype ||
      Object.getPrototypeOf(value) === null)
  );
}

function documentJson(
  value: unknown,
  depth: number,
  ancestors: ReadonlySet<object>,
): void {
  if (value === null || typeof value === "string" || typeof value === "boolean")
    return;
  if (typeof value === "number" && Number.isFinite(value)) return;
  if (depth > 64 || (!Array.isArray(value) && !documentMapping(value)))
    throw new TypeError("catalog document must contain bounded JSON values");
  if (ancestors.has(value)) throw new TypeError("cyclic catalog document");
  const visited = new Set([...ancestors, value]);
  for (const child of Object.values(value))
    documentJson(child, depth + 1, visited);
}

export function catalogDocument(source: string): CatalogDocument {
  if (Buffer.byteLength(source) > ticketCatalogDocumentBytesMax)
    throw new RangeError("catalog document exceeds size limit");
  const parsed = parseDocument(source, {
    version: "1.1",
    uniqueKeys: false,
    customTags: documentTags,
  });
  if (parsed.errors.length)
    throw new TypeError(parsed.errors[0]?.message ?? "invalid YAML");
  const value: unknown = parsed.toJS({ maxAliasCount: 100 });
  if (!documentMapping(value))
    throw new TypeError("catalog document must be a mapping");
  documentJson(value, 0, new Set());
  documentCaptureNumbers(parsed, value, []);
  return value;
}

function documentCaptureNumbers(
  parsed: ReturnType<typeof parseDocument>,
  value: unknown,
  parts: readonly (string | number)[],
): void {
  if (value === null || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    const path = [...parts, Array.isArray(value) ? Number(key) : key];
    const node: unknown = parsed.getIn(path, true);
    if (isScalar(node) && typeof child === "number" && node.source) {
      const token = node.source.replaceAll("_", "");
      documentNumberToken(value, key, child, token, node.tag);
      const integerField =
        (path.length === 1 &&
          ["version", "number", "rework_limit"].includes(key)) ||
        (path.length === 2 && path[0] === "dependencies");
      if (
        integerField &&
        (node.tag === "tag:yaml.org,2002:float" || /[.eE]/u.test(token))
      )
        throw new TypeError(`${path.join(".")} must be an integer`);
    }
    documentCaptureNumbers(parsed, child, path);
  }
}

function documentNumberToken(
  value: object,
  key: string,
  child: number,
  source: string,
  tag: string | undefined,
): void {
  if (/^[+-]?[0-9]+$/u.test(source) && !/^[-+]?0[0-9]+$/u.test(source))
    set_number_token(value, key, source.replace(/^\+/u, ""));
  else if (
    /^[+-]?(?:[0-9]+\.[0-9]*|\.[0-9]+)(?:[eE][+-][0-9]+)?$/u.test(source)
  )
    set_number_token(value, key, source);
  else if (/^[+-]?0(?:x[0-9a-fA-F]+|b[01]+|[0-7]+)$/u.test(source)) {
    const unsigned = source.replace(/^[-+]/u, "");
    const literal = /^0[0-7]+$/u.test(unsigned)
      ? `0o${unsigned.slice(1)}`
      : unsigned;
    set_number_token(
      value,
      key,
      String((source.startsWith("-") ? -1n : 1n) * BigInt(literal)),
    );
  } else
    set_number_token(
      value,
      key,
      tag === "tag:yaml.org,2002:float" ? `${String(child)}.0` : String(child),
    );
}

export function catalogCheck<T extends object>(
  kind: string,
  value: unknown,
): T {
  const schema: unknown = JSON.parse(
    readFileSync(new URL(`./schemas/${kind}.json`, import.meta.url), "utf8"),
  );
  if (!documentMapping(schema))
    throw new TypeError("catalog schema must be a mapping");
  const validate = schema_validator(schema).compile(schema);
  if (!validate(value))
    throw new TypeError(`${kind}: ${JSON.stringify(validate.errors)}`);
  return value as T;
}

export function catalogReference(
  reference: string,
  directory: string,
  suffix: string,
): string {
  const parts = reference
    .split("/")
    .filter((part) => part !== "" && part !== ".");
  if (
    reference.startsWith("/") ||
    reference.includes("\\") ||
    parts.includes("..") ||
    parts[0] !== directory ||
    !reference.endsWith(suffix)
  )
    throw new TypeError(
      `reference must name ${directory}/*${suffix} within .chug`,
    );
  return `.chug/${parts.join("/")}`;
}
