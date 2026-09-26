/**
 * What the pod reads off the contract's tables rather than writing out: a
 * route's path, the statuses a route answers with one body, a label a roster
 * carries, and a public API path filled in from its pattern. Each raises where
 * the contract no longer has what was asked for, so a pod built against one
 * that dropped it fails as it loads rather than on the wire.
 */

/** The path of a route whose pattern ends in `*`, with `rest` in its place. */
export function routePath(route, rest) {
  if (!route.path.endsWith("/*"))
    throw new Error(`${route.path} is a whole path and takes no rest`);
  return `${route.path.slice(0, -1)}${rest}`;
}

/** Every status one route's answers map answers with `schema`, alone or as one of the bodies that status may carry. */
export function answeredWith(answers, schema) {
  const statuses = Object.entries(answers)
    .filter(
      ([, answer]) => answer === schema || answer.options?.includes(schema),
    )
    .map(([status]) => Number(status));
  if (statuses.length === 0)
    throw new Error("the route answers no status with that body");
  return statuses;
}

/** `label`, refused where `roster` does not carry it. */
export function rosterLabel(roster, label) {
  if (!roster.includes(label))
    throw new Error(`the contract's roster carries no ${label}`);
  return label;
}

/** A public API path, each `:name` in `pattern` filled with that value, encoded as a segment. */
export function routeFilled(pattern, values) {
  return pattern.replace(/:([A-Za-z]+)/gu, (_, name) => {
    const value = values[name];
    if (value === undefined) throw new Error(`${pattern} needs a ${name}`);
    return encodeURIComponent(String(value));
  });
}
