/**
 * Encrypted backup envelope.
 *
 * The password never leaves the browser: the daemon only ever stores the
 * opaque ciphertext below, so a compromised daemon cannot read host credentials.
 */
function getGlobal(): any {
  return typeof globalThis === "undefined" ? undefined : (globalThis as unknown as any);
}

export interface BackupEnvelope {
  v: 1;
  kdf: "PBKDF2-SHA256";
  iter: number;
  alg: "AES-GCM";
  /** base64, 16 bytes */
  salt: string;
  /** base64, 12 bytes */
  iv: string;
  /** base64 ciphertext (includes the GCM tag) */
  data: string;
  /** ISO timestamp, not secret */
  at: string;
}

export const PBKDF2_ITERATIONS = 310_000;
const SALT_BYTES = 16;
const IV_BYTES = 12;

function subtle(): any {
  const g = getGlobal();
  const value = g?.crypto?.subtle;
  if (!value) throw new Error("当前环境不支持 Web Crypto，无法加密备份");
  return value;
}

function randomBytes(length: number): Uint8Array {
  const g = getGlobal();
  const out = new Uint8Array(length);
  g.crypto.getRandomValues(out);
  return out;
}

function bytesToB64(bytes: Uint8Array): string {
  const g = getGlobal();
  let binary = "";
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i] as number);
  return g.btoa(binary) as string;
}

function b64ToBytes(value: string): Uint8Array {
  const g = getGlobal();
  const binary = g.atob(value) as string;
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}

async function deriveKey(password: string, salt: Uint8Array, iterations: number): Promise<any> {
  const g = getGlobal();
  const encoder = new g.TextEncoder();
  const baseKey = await subtle().importKey(
    "raw",
    encoder.encode(password) as unknown as BufferSource,
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return subtle().deriveKey(
    { name: "PBKDF2", salt: salt as unknown as BufferSource, iterations, hash: "SHA-256" },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export async function encryptBackup(password: string, plaintext: string): Promise<string> {
  if (password.length < 8) throw new Error("密码至少 8 位");
  const g = getGlobal();
  const salt = randomBytes(SALT_BYTES);
  const iv = randomBytes(IV_BYTES);
  const key = await deriveKey(password, salt, PBKDF2_ITERATIONS);
  const ciphertext = await subtle().encrypt(
    { name: "AES-GCM", iv: iv as unknown as BufferSource },
    key,
    new g.TextEncoder().encode(plaintext) as unknown as BufferSource,
  );
  const envelope: BackupEnvelope = {
    v: 1,
    kdf: "PBKDF2-SHA256",
    iter: PBKDF2_ITERATIONS,
    alg: "AES-GCM",
    salt: bytesToB64(salt),
    iv: bytesToB64(iv),
    data: bytesToB64(new Uint8Array(ciphertext as ArrayBuffer)),
    at: new Date().toISOString(),
  };
  return JSON.stringify(envelope);
}

export async function decryptBackup(password: string, serialized: string): Promise<string> {
  let envelope: BackupEnvelope;
  try {
    envelope = JSON.parse(serialized) as BackupEnvelope;
  } catch {
    throw new Error("备份数据格式无效");
  }
  if (!envelope || envelope.v !== 1 || envelope.alg !== "AES-GCM" || typeof envelope.data !== "string") {
    throw new Error("不是受支持的加密备份");
  }
  const iterations = typeof envelope.iter === "number" ? envelope.iter : PBKDF2_ITERATIONS;
  const key = await deriveKey(password, b64ToBytes(envelope.salt), iterations);
  try {
    const plaintext = await subtle().decrypt(
      {
        name: "AES-GCM",
        iv: b64ToBytes(envelope.iv) as unknown as BufferSource,
      },
      key,
      b64ToBytes(envelope.data) as unknown as BufferSource,
    );
    return new (getGlobal().TextDecoder)().decode(plaintext) as string;
  } catch {
    throw new Error("密码错误，或备份数据已损坏");
  }
}
