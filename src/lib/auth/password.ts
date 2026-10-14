import bcrypt from "bcryptjs";

const SALT_ROUNDS = 12;

export function isValidPassword(password: string) {
  return password.length >= 12 && Buffer.byteLength(password, "utf8") <= 72;
}

export async function hashPassword(password: string) {
  return bcrypt.hash(password, SALT_ROUNDS);
}

export async function verifyPassword(password: string, hash: string) {
  return bcrypt.compare(password, hash);
}
