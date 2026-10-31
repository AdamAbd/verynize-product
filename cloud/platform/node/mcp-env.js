// Hosted MCP resources on Node (`#mcp-env` outside workerd). The design engine reads the
// Tailwind theme and the Iconify sets from node_modules itself, so nothing is handed over.
export async function loadIconSets() {
  return {};
}
