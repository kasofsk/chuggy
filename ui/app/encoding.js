/**
 * base64url, both directions, over bytes.
 *
 * Written out rather than reached for, because the ambient spellings differ
 * between a browser and the runner the suites use, and both directions are
 * wanted here: PKCE encodes, and reading a token's claims decodes.
 */

const alphabet =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

/** @param {Uint8Array} bytes */
export function base64urlEncoded(bytes) {
  let text = "";
  for (let index = 0; index < bytes.length; index += 3) {
    const second = bytes[index + 1];
    const third = bytes[index + 2];
    const triple =
      ((bytes[index] ?? 0) << 16) | ((second ?? 0) << 8) | (third ?? 0);
    text +=
      alphabet.charAt((triple >> 18) & 63) +
      alphabet.charAt((triple >> 12) & 63);
    if (second !== undefined) text += alphabet.charAt((triple >> 6) & 63);
    if (third !== undefined) text += alphabet.charAt(triple & 63);
  }
  return text;
}

/** @param {string} text */
export function base64urlDecoded(text) {
  /** @type {number[]} */
  const bytes = [];
  let accumulator = 0;
  let bits = 0;
  for (const character of text) {
    const value = alphabet.indexOf(character);
    if (value < 0)
      throw new RangeError("a base64url value carries a foreign character");
    accumulator = (accumulator << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((accumulator >> bits) & 255);
    }
  }
  return Uint8Array.from(bytes);
}
