export function limitText(text: string, maxLength: number): string {
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}

export function normalizeText(text: string): string {
  return text.replace(/\r\n/g, "\n").trim();
}
