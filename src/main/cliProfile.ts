import { performance } from "node:perf_hooks";

// Opt-in, per-command measurements. Inclusive phases must not be added together.
let phases: Record<string, number> | undefined;
export function startCliProfile(): void { phases = process.env.NOVA_CLI_PROFILE === "1" ? {} : undefined; }
export function measureCliPhase<T>(name: string, action: () => T): T {
  if (!phases) return action();
  const start = performance.now();
  try { return action(); } finally { phases[name] = (phases[name] ?? 0) + performance.now() - start; }
}
export function finishCliProfile(): Record<string, number> | undefined { const result = phases; phases = undefined; return result; }

export async function measureAsyncCliPhase<T>(name: string, action: () => Promise<T>): Promise<T> {
  if (!phases) return action();
  const start = performance.now();
  try { return await action(); } finally { phases[name] = (phases[name] ?? 0) + performance.now() - start; }
}
