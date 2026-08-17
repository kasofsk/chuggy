/**
 * The secret source: how a stored reference becomes the material one spawned
 * job is handed, declared here for the reason `jobToken.ts` gives — the fabric
 * spends it, a store adapter answers it, neither may see the other, and the
 * composition root hands the answer over.
 *
 * REFERENCES ARE WHAT TRANSIT THE MACHINE. A reference names material and sits
 * in a registry row; the material itself moves only between the secret store
 * and the job the spawn named, fetched through this contract at spawn and
 * written into that job's own Secret. Nothing here lets material be listed,
 * enumerated or read back.
 *
 * A REFERENCE THE SOURCE CANNOT ANSWER IS A REJECTION, not a value. The caller
 * is the spawn, whose discipline is that a delivery it cannot serve is refused
 * by throwing, so the cursor holds and the row re-emits.
 */

/** Fetches the material one stored reference names; a reference it cannot answer rejects. */
export type SecretSource = (reference: string) => Promise<string>;
