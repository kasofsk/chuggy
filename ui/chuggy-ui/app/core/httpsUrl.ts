/** `address` parsed as a URL where it is https, and nothing for any other
 * address, including one that does not parse. */
export function httpsUrl(address: string): URL | undefined {
  let parsed: URL;
  try {
    parsed = new URL(address);
  } catch {
    return undefined;
  }
  return parsed.protocol === "https:" ? parsed : undefined;
}
