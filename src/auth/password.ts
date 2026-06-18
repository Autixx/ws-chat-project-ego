import argon2 from "argon2";

export async function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, { type: argon2.argon2id });
}

export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
}

export function validatePassword(password: string, username: string, email?: string): void {
  if (!password) throw new Error("Password is required.");
  if (password.length < 10) throw new Error("Password must be at least 10 characters.");
  const normalized = password.toLowerCase();
  if (normalized === username.toLowerCase()) throw new Error("Password must not equal username.");
  if (email && normalized === email.toLowerCase()) throw new Error("Password must not equal email.");
}
