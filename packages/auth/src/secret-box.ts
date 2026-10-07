// A team's secrets stored in D1 (G3ID's Slack bot tokens, Shop's Onshape keys), encrypted with
// AES-GCM. The key is each worker's SECRETS_KEY secret: 32 random bytes, base64
// (`openssl rand -base64 32`).

const toBase64 = (bytes: Uint8Array) =>
  btoa(Array.from(bytes, (b) => String.fromCharCode(b)).join(""));
const fromBase64 = (text: string) => Uint8Array.from(atob(text), (ch) => ch.charCodeAt(0));

async function key(secretsKey: string | undefined): Promise<CryptoKey> {
  if (!secretsKey) throw new Error("SECRETS_KEY isn't set.");
  return crypto.subtle.importKey("raw", fromBase64(secretsKey), "AES-GCM", false, [
    "encrypt",
    "decrypt",
  ]);
}

/** "<iv>.<ciphertext>", both base64. */
export async function encryptSecret(
  plain: string,
  secretsKey: string | undefined,
): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const sealed = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    await key(secretsKey),
    new TextEncoder().encode(plain),
  );
  return `${toBase64(iv)}.${toBase64(new Uint8Array(sealed))}`;
}

export async function decryptSecret(
  sealed: string,
  secretsKey: string | undefined,
): Promise<string> {
  const [iv, data] = sealed.split(".");
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: fromBase64(iv) },
    await key(secretsKey),
    fromBase64(data),
  );
  return new TextDecoder().decode(plain);
}
