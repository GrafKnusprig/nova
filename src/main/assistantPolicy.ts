export type AssistantMode = "draft" | "edit" | "full";

const MODE_RANK: Record<AssistantMode, number> = {
  draft: 0,
  edit: 1,
  full: 2,
};

export function modeAllows(current: AssistantMode, required: AssistantMode): boolean {
  return MODE_RANK[current] >= MODE_RANK[required];
}

export function mutationToolsForMode(mode: AssistantMode): string[] {
  return [
    ...(modeAllows(mode, "edit") ? ["apply_changes"] : []),
    ...(modeAllows(mode, "full") ? ["delete_nodes"] : []),
  ];
}

