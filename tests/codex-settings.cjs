// Connection-dependent settings with real Electron IPC and the local SIWC provider.
const { _electron } = require("@playwright/test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { AgentToolConfig } = require("../desktop/agent-tool-config.cjs");
const {
  createChatGPTProvider,
  connectElectronProvider,
} = require("./helpers/chatgpt-provider.cjs");
const { waitForUiReady } = require("./helpers/ui-ready.cjs");

(async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "codex-settings-"));
  const profile = path.join(root, "profile"),
    home = path.join(root, "home"),
    bin = path.join(root, "bin");
  await fs.mkdir(bin);
  await fs.mkdir(path.join(home, ".codex", "rules"), { recursive: true });
  const configFile = path.join(home, ".codex", "config.toml");
  const rulesFile = path.join(home, ".codex", "rules", "default.rules");
  const config = '[mcp_servers.local-fixture]\ncommand = "node"\n';
  const rules = 'prefix_rule(pattern=["npm", "test"], decision="allow")\n';
  await fs.writeFile(configFile, config);
  await fs.writeFile(rulesFile, rules);
  await fs.copyFile(path.join(__dirname, "fixtures/fake-codex.cjs"), path.join(bin, "codex"));
  await fs.chmod(path.join(bin, "codex"), 0o755);
  await fs.writeFile(path.join(bin, "claude"), "#!/bin/sh\necho '{\"loggedIn\":false}'\n");
  await fs.chmod(path.join(bin, "claude"), 0o755);
  const tools = new AgentToolConfig({ userData: profile });
  await tools.saveServer({
    name: "shared-fixture",
    agents: ["claude", "codex"],
    transport: "stdio",
    command: "node",
  });
  await tools.saveServer({
    name: "codex-fixture",
    agents: ["codex"],
    transport: "stdio",
    command: "node",
  });
  const toolFile = path.join(profile, "agent-tool-config.json");
  const savedTools = await fs.readFile(toolFile, "utf8");
  const provider = await createChatGPTProvider();
  const env = {
    ...process.env,
    HOME: home,
    CODEX_HOME: path.join(home, ".codex"),
    VERYNIZE_AGENT_HOME: home,
    PATH: bin + path.delimiter + process.env.PATH,
    VERYNIZE_SKIP_ONBOARDING: "1",
  };
  delete env.ELECTRON_RUN_AS_NODE;
  let app;
  try {
    app = await _electron.launch({
      env,
      args: [".", `--user-data-dir=${profile}`],
      timeout: 20000,
    });
    const page = await app.firstWindow();
    page.on("pageerror", (error) => console.error("Renderer error:", error.message));
    await connectElectronProvider(app, provider);
    await waitForUiReady(page);
    await page.evaluate(() => {
      window.confirm = () => true;
    });
    const open = async (section) => {
      await page.evaluate((section) => window.appSettings.open(section), section);
    };
    const hidden = async () => {
      await page.locator('[data-provider="codex"] [data-oai-siwc-button]').waitFor();
      assert.equal(await page.locator('[data-agent-tools="codex"]').count(), 0);
      assert.equal(await page.locator('[data-access^="codex"]').count(), 0);
      assert.equal(await page.locator("#settings-codex-personality").count(), 0);
      assert.equal(await page.locator('[data-allow-group="codex"]').count(), 0);
    };
    await open("agents");
    await hidden();
    await open("usage");
    await page.locator('[data-usage-agent="claude"]').waitFor();
    assert.equal(await page.locator('[data-usage-agent^="codex"]').count(), 0);
    await open("memory");
    await page.locator('[data-memory-card="about-claude"]').waitFor();
    assert.equal(await page.locator('[data-memory-card="about-codex"]').count(), 0);
    assert.equal(await page.locator('[data-instructions-file="codexAgents"]').count(), 0);
    await open("models");
    await page.locator("#settings-default-agent").waitFor();
    assert.equal(await page.locator('#settings-default-agent option[value="codex"]').count(), 0);
    await open("tools");
    await page.locator('[data-tool-server="shared-fixture"]').waitFor();
    assert.equal(await page.locator('[data-tool-server="codex-fixture"]').count(), 0);
    assert.doesNotMatch(await page.locator("#tools-server-list").textContent(), /Codex/);

    await open("agents");
    await page.locator('[data-provider="codex"] [data-oai-siwc-button]').click();
    await page.locator("#settings-codex-personality").waitFor();
    await page.locator('[data-agent-tools="codex"]').waitFor();
    await page.locator('[data-allow-group="codex"]').waitFor();
    assert.match(await page.locator('[data-agent-tools="codex"]').textContent(), /local-fixture/);
    await open("usage");
    await page.locator('[data-usage-agent="codex"]').waitFor();
    await open("tools");
    await page.locator('[data-tool-server="codex-fixture"]').waitFor();
    await open("agents");
    await page
      .locator('[data-provider="codex"] button[aria-label="Codex account actions"]')
      .click();
    await page.getByRole("menuitem", { name: "Sign out…", exact: true }).click();
    await page.locator("#settings-codex-personality").waitFor({ state: "detached" });
    await hidden();

    // Any connected named registration also enables Codex settings. Usage does
    // not show a signed-out system account alongside that connected registration.
    await open("accounts");
    await page.locator("#accounts-add-name-codex").fill("Studio");
    await page.locator("#accounts-add-codex").click();
    const account = page
      .locator('[data-agent="codex"][data-account]')
      .filter({ hasText: "Studio" });
    await account.waitFor();
    const accountId = await account.getAttribute("data-account");
    await account.locator('[data-action="signin"]').click();
    await page.waitForFunction(
      (id) => document.querySelector(`[data-account="${id}"]`)?.dataset.signedIn === "true",
      accountId,
    );
    await open("agents");
    await page.locator("#settings-codex-personality").waitFor();
    await open("usage");
    await page.locator(`[data-usage-agent="codex-account-${accountId}"]`).waitFor();
    assert.equal(await page.locator('[data-usage-agent="codex"]').count(), 0);
    await open("accounts");
    await account.locator('[data-action="remove"]').click();
    await account.waitFor({ state: "detached" });
    await open("agents");
    await hidden();

    assert.equal(await fs.readFile(configFile, "utf8"), config);
    assert.equal(await fs.readFile(rulesFile, "utf8"), rules);
    assert.equal(await fs.readFile(toolFile, "utf8"), savedTools);
    console.log(
      "PASS Codex settings: hidden when disconnected, restored on SIWC login, named accounts, logout/removal, saved tools/rules preserved",
    );
  } finally {
    await app?.close();
    await provider.close();
    await fs.rm(root, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
