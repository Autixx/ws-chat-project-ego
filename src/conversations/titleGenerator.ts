export function generateConversationTitle(text: string): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) return "New conversation";
  return normalized.length > 56 ? `${normalized.slice(0, 53)}...` : normalized;
}
