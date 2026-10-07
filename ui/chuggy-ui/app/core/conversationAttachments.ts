/**
 * The images a composer holds for the message being written, before anything
 * has been sent.
 *
 * AN ATTACHMENT IS THE BYTES PASTED, AND ITS OBJECT IS ITS IDENTITY. Nothing
 * resizes, converts or names it: what is uploaded is what was pasted, and two
 * pastes of one screenshot are two attachments, so a page asking whether a
 * press sends the same images as the last one asks whether they are the same
 * objects.
 *
 * IT IS PREVIEWED AS A `data:` URI built from those bytes, because the
 * console's document admits no other image source a browser could mint.
 *
 * THE BOUND IS REFUSED IN THE BOX. A paste past it, or of a type the page does
 * not take, takes nothing of what it held past the bound and says which, rather
 * than holding an image the door would refuse the whole message for.
 */

/** One image held for the message being written. */
export interface ConversationAttachment {
  readonly mediaType: string;
  readonly content: Uint8Array<ArrayBuffer>;
}

/** What a page takes as attachments: how many one message carries, and which
 * media types. A surface that takes none hands no such thing. */
export interface ConversationAttaches {
  readonly countMax: number;
  readonly mediaTypes: readonly string[];
}

/** Why a paste took less than it held. */
export type ConversationAttachRefusal = "Bound" | "Type";

/** What a paste came to: the attachments held after it, and why it took less
 * than it held, where it did. */
export interface ConversationAttached {
  readonly attached: readonly ConversationAttachment[];
  readonly refused?: ConversationAttachRefusal;
}

/** The attachments held with those pasted after them, each of a type the page
 * takes, up to the page's bound. */
export function conversationAttachedWith(
  attached: readonly ConversationAttachment[],
  pasted: readonly ConversationAttachment[],
  attaches: ConversationAttaches,
): ConversationAttached {
  const taken = pasted.filter((image) =>
    attaches.mediaTypes.includes(image.mediaType),
  );
  const room = Math.max(0, attaches.countMax - attached.length);
  const next = [...attached, ...taken.slice(0, room)];
  const refused: ConversationAttachRefusal | undefined =
    taken.length > room
      ? "Bound"
      : taken.length < pasted.length
        ? "Type"
        : undefined;
  return refused === undefined
    ? { attached: next }
    : { attached: next, refused };
}

/** The line a paste that took less than it held is said in. */
export function conversationAttachRefusalLine(
  refused: ConversationAttachRefusal,
  attaches: ConversationAttaches,
): string {
  switch (refused) {
    case "Bound":
      return `At most ${String(attaches.countMax)} images`;
    case "Type":
      return `Only ${attaches.mediaTypes
        .map((mediaType) => mediaType.replace(/^image\//u, "").toUpperCase())
        .join(", ")}`;
  }
}

/** The attachments a refused send handed back, ahead of any held since. */
export function conversationAttachmentsRestored(
  held: readonly ConversationAttachment[],
  back: readonly ConversationAttachment[],
): readonly ConversationAttachment[] {
  return back.length === 0 ? held : [...back, ...held];
}

/** Whether two presses send the same images, which is the same objects in the
 * same order. */
export function conversationAttachmentsSame(
  a: readonly ConversationAttachment[],
  b: readonly ConversationAttachment[],
): boolean {
  return (
    a.length === b.length && a.every((attachment, at) => attachment === b[at])
  );
}

/** The bytes in standard base64, in slices `String.fromCharCode` can spread. */
export function conversationBase64(bytes: Uint8Array): string {
  const sliceBytesCount = 0x8000;
  let latin1 = "";
  for (let at = 0; at < bytes.length; at += sliceBytesCount)
    latin1 += String.fromCharCode(...bytes.subarray(at, at + sliceBytesCount));
  return btoa(latin1);
}

const conversationAttachmentUris = new WeakMap<
  ConversationAttachment,
  string
>();

/** The `data:` URI an attachment is previewed as, made once for each. */
export function conversationAttachmentUri(
  attachment: ConversationAttachment,
): string {
  const made =
    conversationAttachmentUris.get(attachment) ??
    `data:${attachment.mediaType};base64,${conversationBase64(attachment.content)}`;
  conversationAttachmentUris.set(attachment, made);
  return made;
}
