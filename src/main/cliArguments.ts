export type CliOptions = Record<string, string | boolean>;

export function parseCliArguments(args: string[]): { command?: string; options: CliOptions } {
  const [command, ...rest] = args;
  const options: CliOptions = {};
  for (let index = 0; index < rest.length; index++) {
    const item = rest[index];
    if (!item.startsWith("--")) throw new Error(`Unexpected argument: ${item}`);
    const equals = item.indexOf("=");
    if (equals > 2) { options[item.slice(2, equals)] = item.slice(equals + 1); continue; }
    const key = item.slice(2), next = rest[index + 1];
    if (next !== undefined && !next.startsWith("--")) { options[key] = next; index++; }
    else options[key] = true;
  }
  return { command, options };
}
