import type { StoredDraft } from "./types.js";

function list(values: string[]): string {
  return values.length ? values.map((value) => `  - ${value}`).join("\n") : "  - none";
}

export function renderDraftPreview(draft: StoredDraft): string {
  const projectGroups = draft.result.items.reduce<Record<string, number>>((groups, item) => {
    groups[item.project] = (groups[item.project] ?? 0) + 1;
    return groups;
  }, {});

  const lines = [
    `Job ID: ${draft.jobId}`,
    `Created at: ${draft.createdAt}`,
    `Mode: ${draft.mode}`,
    `Source file: ${draft.fileName ?? "manual text"}`,
    `Source summary: ${draft.result.source_summary}`,
    `Item count: ${draft.result.items.length}`,
    "",
    "Project grouping:",
    ...Object.entries(projectGroups).map(([project, count]) => `  - ${project}: ${count}`),
    "",
    "Global clarification questions:",
    list(draft.result.needs_clarification),
    ""
  ];

  draft.result.items.forEach((item, index) => {
    lines.push(
      `#${String(index + 1).padStart(3, "0")}`,
      `Title: ${item.title}`,
      `Project: ${item.project}`,
      `Module: ${item.module}`,
      `Type: ${item.type}`,
      `Priority: ${item.priority}`,
      `Routing confidence: ${item.routing_confidence}`,
      `Summary: ${item.summary}`,
      `Details: ${item.details}`,
      "Acceptance criteria:",
      list(item.acceptance_criteria),
      "Needs clarification:",
      list(item.needs_clarification),
      `Source text: ${item.source_text}`,
      ""
    );
  });

  lines.push(
    "Quick commands / UI hints:",
    "  - Apply all",
    "  - Apply selected",
    "  - Keep selected",
    "  - Drop selected"
  );

  return lines.join("\n");
}
