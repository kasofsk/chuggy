/**
 * Reading a request: the body, bounded, and the two encodings a caller may send
 * it in read into one shape.
 *
 * ONE SHAPE FOR BOTH ENCODINGS. A form spells a repeated value by repeating the
 * name and JSON spells it as an array, so both arrive here as named lists and
 * everything downstream parses one thing. That is what lets the desk's own
 * forms and a JSON client reach the same routes without a second route table
 * whose refusals would drift from the first's.
 *
 * THE READ IS BOUNDED, which is not a performance choice: a body read to
 * completion with no cap is a memory the caller picks. A body past the cap is
 * refused with the cap named, and nothing partial is parsed. What it takes is
 * the stream of chunks rather than the request carrying them, which is all it
 * reads and is what lets the bound be asked about without a socket.
 *
 * THE REFUSAL IS RETURNED, as at every other boundary in this tree. A body that
 * is not the encoding it claimed is an input, not a failure, and the route
 * answers it rather than throwing past the caller who sent it.
 */

import type { Parsed } from "../../interpreter/wire.ts";

/** The most a request body may carry. A desk form and an arrival are far below it, and an unbounded read is a memory the caller chooses. */
export const httpApiBodyBytesMax = 65536;

/** One body as named lists, which is the shape a form's repeated inputs and a JSON array both reduce to. */
export type HttpApiFields = ReadonlyMap<string, readonly string[]>;

/** The body as text, refusing anything past the cap without parsing what did arrive. */
export async function httpApiBody(
  arriving: AsyncIterable<Buffer>,
): Promise<Parsed<string>> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of arriving) {
    bytes += chunk.length;
    if (bytes > httpApiBodyBytesMax) {
      return {
        parsed: "Refused",
        why: `the body passed the ${String(httpApiBodyBytesMax)}-byte cap`,
      };
    }
    chunks.push(chunk);
  }
  return { parsed: "Ok", value: Buffer.concat(chunks).toString("utf8") };
}

/** A JSON scalar as the text a field carries; anything structured is not a value a field holds. */
function httpApiScalar(raw: unknown): string | undefined {
  if (typeof raw === "string") return raw;
  if (typeof raw === "number" || typeof raw === "boolean") return String(raw);
  return undefined;
}

/** One JSON property as the list its field carries: an array is its items, anything else is one value. */
function httpApiValues(raw: unknown): readonly string[] | undefined {
  const single = httpApiScalar(raw);
  if (single !== undefined) return [single];
  if (!Array.isArray(raw)) return undefined;
  const values: string[] = [];
  for (let at = 0; at < raw.length; at++) {
    const item: unknown = raw[at];
    const one = httpApiScalar(item);
    if (one === undefined) return undefined;
    values.push(one);
  }
  return values;
}

/** A JSON object's properties as named lists, refusing a body that is not an object of scalars. */
function httpApiJsonFields(body: string): Parsed<HttpApiFields> {
  let raw: unknown;
  try {
    raw = JSON.parse(body === "" ? "{}" : body);
  } catch (failure: unknown) {
    const why = failure instanceof Error ? failure.message : String(failure);
    return { parsed: "Refused", why: `the body is not JSON: ${why}` };
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { parsed: "Refused", why: "the body is not a JSON object" };
  }
  const fields = new Map<string, readonly string[]>();
  const properties = raw as Readonly<Record<string, unknown>>;
  for (const [name, value] of Object.entries(properties)) {
    const values = httpApiValues(value);
    if (values === undefined) {
      return {
        parsed: "Refused",
        why: `${name} is not a value or a list of them`,
      };
    }
    fields.set(name, values);
  }
  return { parsed: "Ok", value: fields };
}

/** A form body's pairs as named lists, a repeated name becoming a longer list. */
function httpApiFormFields(body: string): HttpApiFields {
  const fields = new Map<string, string[]>();
  for (const [name, value] of new URLSearchParams(body)) {
    const held = fields.get(name);
    if (held === undefined) fields.set(name, [value]);
    else held.push(value);
  }
  return fields;
}

/** A body read into named lists by the encoding it declared, defaulting to JSON. */
export function httpApiFields(
  contentType: string,
  body: string,
): Parsed<HttpApiFields> {
  const kind = contentType.split(";")[0]?.trim().toLowerCase() ?? "";
  if (kind === "application/x-www-form-urlencoded") {
    return { parsed: "Ok", value: httpApiFormFields(body) };
  }
  return httpApiJsonFields(body);
}

/** The one value a field carries, or nothing when the body left it out. */
export function httpApiField(
  fields: HttpApiFields,
  name: string,
): string | undefined {
  return fields.get(name)?.at(0);
}

/** Every value a field carries, which a form spells as repeated inputs and JSON as an array. */
export function httpApiFieldAll(
  fields: HttpApiFields,
  name: string,
): readonly string[] {
  return fields.get(name) ?? [];
}
