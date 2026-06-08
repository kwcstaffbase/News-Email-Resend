import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;
const TAG_BYTES = 16;

function getKey(): Buffer {
  const hex = Bun.env.ENCRYPTION_KEY ?? "";
  // Validate hex shape, not just length: a 64-char non-hex value would pass a
  // length check, then Buffer.from(_, "hex") silently yields a wrong-length key
  // that fails later in createCipheriv with an opaque "Invalid key length".
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error("ENCRYPTION_KEY must be a 64-character hex string (32 bytes)");
  }
  return Buffer.from(hex, "hex");
}

/**
 * Encrypts a plaintext string with AES-256-GCM.
 * Returns a colon-separated string: `<iv_hex>:<tag_hex>:<ciphertext_hex>`.
 */
export function encrypt(plaintext: string): string {
  const key = getKey();
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${tag.toString("hex")}:${encrypted.toString("hex")}`;
}

/**
 * Decrypts a value produced by `encrypt()`.
 * Returns the plaintext, or `null` if decryption fails (wrong key, corrupt data).
 */
export function decrypt(ciphertext: string): string | null {
  try {
    const parts = ciphertext.split(":");
    if (parts.length !== 3) return null;
    const [ivHex, tagHex, encHex] = parts;
    const key = getKey();
    const iv = Buffer.from(ivHex, "hex");
    const tag = Buffer.from(tagHex, "hex");
    const encrypted = Buffer.from(encHex, "hex");
    if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) return null;
    const decipher = createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(tag);
    return decipher.update(encrypted).toString("utf8") + decipher.final("utf8");
  } catch {
    return null;
  }
}
