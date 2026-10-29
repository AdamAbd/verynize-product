// Commands are passed as argv, never evaluated by a shell. Preserve quoted arguments.
export function parsePreviewCommand(value: string): string[] {
  const args: string[] = [];
  let token = "", quote = "", started = false;
  for (const char of value.trim()) {
    if (quote) { if (char === quote) quote = ""; else token += char; }
    else if (char === '"' || char === "'") { quote = char; started = true; }
    else if (/\s/.test(char)) { if (started) { args.push(token); token = ""; started = false; } }
    else { token += char; started = true; }
  }
  if (quote) throw new Error("Close the quotation mark in the command.");
  if (started) args.push(token);
  return args;
}
export const formatCommand = (args?: string[]) => args?.map(arg => /^[a-zA-Z0-9_./:=@+-]+$/.test(arg) ? arg : "'" + arg.replaceAll("'", "'\"'\"'") + "'").join(" ") || "";

