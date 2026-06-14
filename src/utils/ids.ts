import { randomBytes } from "node:crypto";

export function createJobId(date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  const stamp = [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate())
  ].join("");
  const time = [pad(date.getHours()), pad(date.getMinutes()), pad(date.getSeconds())].join("");
  return `${stamp}-${time}-${randomBytes(3).toString("hex")}`;
}

export function safeUserId(username: string): string {
  return username.toLowerCase().replace(/[^a-z0-9._-]+/g, "_").replace(/^_+|_+$/g, "") || "user";
}
