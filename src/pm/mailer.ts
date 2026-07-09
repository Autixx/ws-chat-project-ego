import net from "node:net";
import tls from "node:tls";
import type { PmConfig } from "./config.js";

export type PmMailMessage = {
  to: string;
  subject: string;
  text: string;
};

export type PmMailerResult = {
  sent: boolean;
  disabled?: boolean;
  message?: string;
};

export function isPmSmtpConfigured(config: PmConfig): boolean {
  return Boolean(config.smtp?.host && config.smtp.from);
}

export function buildPmInviteEmail(input: { to: string; inviterName: string; projectName: string; publicBaseUrl?: string }): PmMailMessage {
  const link = input.publicBaseUrl ? `${input.publicBaseUrl.replace(/\/+$/, "")}/` : "ProjectEGO PM";
  return {
    to: input.to,
    subject: `ProjectEGO PM invite: ${input.projectName}`,
    text: [
      `${input.inviterName} invited you to ProjectEGO PM project "${input.projectName}".`,
      "",
      `Open: ${link}`,
      "",
      "Sign in with your ProjectEGO PM account. If you do not have one yet, ask a ProjectEGO admin to create it and grant PM access."
    ].join("\n")
  };
}

export async function sendPmMail(config: PmConfig, message: PmMailMessage): Promise<PmMailerResult> {
  if (!isPmSmtpConfigured(config)) return { sent: false, disabled: true, message: "SMTP is not configured." };
  const smtp = config.smtp!;
  const implicitTls = smtp.tls && smtp.port === 465;
  let client = await connectSmtp(smtp.host!, smtp.port, implicitTls);
  try {
    await expect(client, 220);
    await command(client, `EHLO projectego-pm`, 250);
    if (smtp.tls && !implicitTls) {
      await command(client, "STARTTLS", 220);
      client = await upgradeToTls(client, smtp.host!);
      await command(client, `EHLO projectego-pm`, 250);
    }
    if (smtp.username && smtp.password) {
      await command(client, "AUTH LOGIN", 334);
      await command(client, Buffer.from(smtp.username).toString("base64"), 334);
      await command(client, Buffer.from(smtp.password).toString("base64"), 235);
    }
    await command(client, `MAIL FROM:<${smtp.from}>`, 250);
    await command(client, `RCPT TO:<${message.to}>`, [250, 251]);
    await command(client, "DATA", 354);
    await command(client, formatMessage(smtp.from!, message), 250);
    await command(client, "QUIT", 221).catch(() => undefined);
    return { sent: true };
  } finally {
    client.destroy();
  }
}

function connectSmtp(host: string, port: number, secure: boolean): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    const socket = secure ? tls.connect(port, host) : net.connect(port, host);
    socket.once("connect", () => resolve(socket));
    socket.once("error", reject);
  });
}

function upgradeToTls(socket: net.Socket, host: string): Promise<tls.TLSSocket> {
  return new Promise((resolve, reject) => {
    const tlsSocket = tls.connect({ socket, servername: host });
    tlsSocket.once("secureConnect", () => resolve(tlsSocket));
    tlsSocket.once("error", reject);
  });
}

function command(socket: net.Socket, line: string, expected: number | number[]): Promise<string> {
  socket.write(`${line}\r\n`);
  return expect(socket, expected);
}

function expect(socket: net.Socket, expected: number | number[]): Promise<string> {
  const codes = Array.isArray(expected) ? expected : [expected];
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const onData = (chunk: Buffer) => {
      chunks.push(chunk);
      const text = Buffer.concat(chunks).toString("utf8");
      const lines = text.split(/\r?\n/).filter(Boolean);
      const last = lines.at(-1);
      if (!last || /^\d{3}-/.test(last)) return;
      const code = Number(last.slice(0, 3));
      cleanup();
      if (codes.includes(code)) resolve(text);
      else reject(new Error(`SMTP command failed: ${last}`));
    };
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };
    const cleanup = () => {
      socket.off("data", onData);
      socket.off("error", onError);
    };
    socket.on("data", onData);
    socket.once("error", onError);
  });
}

function formatMessage(from: string, message: PmMailMessage): string {
  return [
    `From: ${from}`,
    `To: ${message.to}`,
    `Subject: ${sanitizeHeader(message.subject)}`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
    "",
    message.text.replaceAll("\r\n.\r\n", "\r\n..\r\n"),
    "."
  ].join("\r\n");
}

function sanitizeHeader(value: string): string {
  return value.replaceAll(/[\r\n]/g, " ").slice(0, 200);
}
