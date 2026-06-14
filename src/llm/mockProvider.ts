import { limitText } from "../utils/text.js";
import type { DraftItem, DraftResult } from "../drafts/types.js";
import type { LlmProvider, LlmStreamEvent, LlmTaskInput } from "./provider.js";

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export class MockProvider implements LlmProvider {
  async *runProjectEgoTask(input: LlmTaskInput): AsyncGenerator<LlmStreamEvent> {
    yield { type: "status", message: "MockProvider: preparing ProjectEGO draft." };
    await wait(120);

    const words = ["Analyzing", "source", "text", "and", "routing", "candidate", "work-items", "..."];
    for (const word of words) {
      yield { type: "token", text: `${word} ` };
      await wait(60);
    }

    const items = this.createItems(input);
    const result: DraftResult = {
      status: "done",
      source_summary: limitText(input.text.replace(/\s+/g, " "), 220),
      items,
      needs_clarification: input.mode === "abstract_idea" ? ["Confirm whether this idea belongs to ProjectEGO core scope."] : []
    };

    yield { type: "status", message: `MockProvider: generated ${items.length} draft items.` };
    yield { type: "result", result };
    yield { type: "done" };
  }

  private createItems(input: LlmTaskInput): DraftItem[] {
    const source = limitText(input.text, 700);
    const baseType = input.mode === "create_tasks" ? "production" : "idea";
    return [
      {
        title: input.mode === "create_tasks" ? "Create implementation task plan" : "Summarize source into planning digest",
        summary: "Convert the submitted text into a structured ProjectEGO planning artifact.",
        details: "Review the source, identify concrete work slices, and preserve uncertainty as clarification questions.",
        project: "Production",
        module: "Planning Automation",
        type: baseType,
        priority: "medium",
        routing_confidence: "high",
        labels: ["ws-chat", "mock"],
        dependencies: [],
        acceptance_criteria: ["Draft preview contains numbered items", "Unclear requirements are not silently discarded"],
        needs_clarification: [],
        source_text: source
      },
      {
        title: "Route candidate work to ProjectEGO systems",
        summary: "Assign the request to likely Plane project areas using canonical project names.",
        details: "The MVP keeps routing transparent and reversible until Plane integration is configured.",
        project: "Data Depot Framework",
        module: "Routing",
        type: "technical",
        priority: "medium",
        routing_confidence: "medium",
        labels: ["routing"],
        dependencies: ["Canonical project mapping"],
        acceptance_criteria: ["Every item has a Plane project", "Low confidence routing is visible in preview"],
        needs_clarification: ["Confirm target Plane project if routing confidence is medium or low."],
        source_text: source
      },
      {
        title: "Prepare apply/keep/drop decision",
        summary: "Expose the generated items for user review before creating Plane work-items.",
        details: "User choices are recorded through apply grammar; kept items move into unclarified storage.",
        project: "UI and UX",
        module: "Review Flow",
        type: "feature",
        priority: "low",
        routing_confidence: "high",
        labels: ["review", "workflow"],
        dependencies: [],
        acceptance_criteria: ["Apply all works", "Selected keep/drop choices are respected"],
        needs_clarification: [],
        source_text: source
      }
    ];
  }
}
