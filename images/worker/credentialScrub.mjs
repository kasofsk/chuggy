export const credentialScrubCharsMin = 16;

const credentialRedaction = "[redacted credential]";

export function credentialScrub(secrets) {
  const values = [...new Set(secrets)]
    .filter(
      (secret) =>
        typeof secret === "string" && secret.length >= credentialScrubCharsMin,
    )
    .sort((left, right) => right.length - left.length);
  return (text) =>
    values.reduce(
      (scrubbed, value) => scrubbed.split(value).join(credentialRedaction),
      text,
    );
}
