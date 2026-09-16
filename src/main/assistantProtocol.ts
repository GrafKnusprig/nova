export interface FunctionTool {
  type: string;
  name: string;
  description: string;
  parameters: unknown;
}

export function toChatCompletionTools(tools: FunctionTool[]): unknown[] {
  return tools.map((tool) => ({
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  }));
}

