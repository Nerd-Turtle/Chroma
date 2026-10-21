import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";

const CURRENT_PARAMETERS = "N=131072,r=8,p=1";
const CURRENT_PREFIX = `scrypt$v=1$${CURRENT_PARAMETERS}$`;
const MAX_PASSWORD_LENGTH = 1024;
let activeHashes = 0;

export class PasswordHashBusyError extends Error {
  constructor() { super("Authentication is busy. Try again in a few seconds."); }
}

async function derive(password: string, salt: string, legacy: boolean): Promise<Buffer> {
  if (password.length > MAX_PASSWORD_LENGTH) throw new Error("Password is too long");
  // Bound expensive work rather than leaving an unbounded queue in the Node thread pool.
  // At most two 128 MiB scrypt operations can run in this process at once.
  if (activeHashes >= 2) throw new PasswordHashBusyError();
  activeHashes++;
  try {
    return await new Promise<Buffer>((resolve, reject) => {
      scryptCallback(password, salt, 64, {
        N: legacy ? 16384 : 131072, r: 8, p: 1, maxmem: 160 * 1024 * 1024,
      }, (error, key) => error ? reject(error) : resolve(key));
    });
  } finally { activeHashes--; }
}

export async function hashPassword(password: string): Promise<string> {
  // OWASP Password Storage / scrypt: N=2^17, r=8, p=1; fresh 128-bit salt.
  // Store the version/work factors so existing passwords can be upgraded on login.
  // https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html#scrypt
  const salt = randomBytes(16).toString("hex");
  const derivedKey = await derive(password, salt, false);
  return `${CURRENT_PREFIX}${salt}$${derivedKey.toString("hex")}`;
}

export function passwordNeedsRehash(storedHash: string): boolean {
  return !storedHash.startsWith(CURRENT_PREFIX);
}

export async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  // Accept only known, bounded formats; never execute arbitrary stored cost parameters.
  const legacy = /^scrypt\$([a-f0-9]{32})\$([a-f0-9]{128})$/.exec(storedHash);
  const current = /^scrypt\$v=1\$N=131072,r=8,p=1\$([a-f0-9]{32})\$([a-f0-9]{128})$/.exec(storedHash);
  const match = current ?? legacy;
  if (!match || password.length > MAX_PASSWORD_LENGTH) return false;
  const derivedKey = await derive(password, match[1]!, Boolean(legacy));
  // https://nodejs.org/docs/latest-v24.x/api/crypto.html#cryptotimingsafeequala-b
  return timingSafeEqual(derivedKey, Buffer.from(match[2]!, "hex"));
}

export async function verifyUnknownUserPassword(password: string): Promise<void> {
  // OWASP Authentication / Authentication Responses: do equivalent expensive work for
  // unknown usernames; use the same generic credentials error without a quick-exit oracle.
  // https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html#authentication-responses
  await derive(password, "chroma-unknown-user", false);
}
