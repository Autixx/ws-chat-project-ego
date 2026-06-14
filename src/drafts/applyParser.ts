export type ApplySelection = {
  apply: number[];
  keep: number[];
  drop: number[];
};

type Token = "keep" | "drop" | "all" | "other" | string;

function parseNumberList(token: Token): number[] | "all" | "other" {
  if (token === "all" || token === "other") return token;
  const values = token.split(",").map((part) => Number(part.trim()));
  if (!values.length || values.some((value) => !Number.isInteger(value) || value < 1)) {
    throw new Error(`Invalid item list: ${token}`);
  }
  return [...new Set(values)];
}

function expand(value: number[] | "all" | "other" | undefined, allItems: number[], mentioned: Set<number>): number[] {
  if (!value) return [];
  if (Array.isArray(value)) return value.filter((item) => allItems.includes(item));
  if (value === "all") return allItems;
  return allItems.filter((item) => !mentioned.has(item));
}

export function parseApplyExpression(expression: string, itemsCount: number): ApplySelection {
  const tokens = expression.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!tokens.length) throw new Error("Apply expression is empty.");

  const allItems = Array.from({ length: itemsCount }, (_, index) => index + 1);
  let applyRaw: number[] | "all" | undefined;
  let keepRaw: number[] | "all" | "other" | undefined;
  let dropRaw: number[] | "all" | "other" | undefined;

  let index = 0;
  if (tokens[index] !== "keep" && tokens[index] !== "drop") {
    const parsedApply = parseNumberList(tokens[index]);
    if (parsedApply === "other") throw new Error("'other' is only valid after keep or drop.");
    applyRaw = parsedApply;
    index += 1;
  }

  while (index < tokens.length) {
    const command = tokens[index];
    const value = tokens[index + 1];
    if ((command !== "keep" && command !== "drop") || !value) {
      throw new Error(`Invalid apply expression near: ${tokens.slice(index).join(" ")}`);
    }
    if (command === "keep") keepRaw = parseNumberList(value);
    if (command === "drop") dropRaw = parseNumberList(value);
    index += 2;
  }

  const explicitlyMentioned = new Set<number>();
  for (const raw of [applyRaw, keepRaw, dropRaw]) {
    if (Array.isArray(raw)) raw.forEach((item) => explicitlyMentioned.add(item));
  }

  const dropSet = new Set(expand(dropRaw, allItems, explicitlyMentioned));
  const applySet = new Set(expand(applyRaw ?? "all", allItems, explicitlyMentioned));
  const keepSet = new Set(expand(keepRaw, allItems, explicitlyMentioned));

  for (const item of dropSet) {
    applySet.delete(item);
    keepSet.delete(item);
  }
  for (const item of applySet) keepSet.delete(item);

  for (const item of allItems) {
    if (!applySet.has(item) && !keepSet.has(item) && !dropSet.has(item)) keepSet.add(item);
  }

  return {
    apply: [...applySet].sort((a, b) => a - b),
    keep: [...keepSet].sort((a, b) => a - b),
    drop: [...dropSet].sort((a, b) => a - b)
  };
}
