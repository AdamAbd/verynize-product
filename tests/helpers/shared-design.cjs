// The legacy "Shared design" dialog (server URL, rooms, invite links, account, people & access, publish). Share opens
// the Share popover (web/src/islands/share); the dialog is reached from Settings › Share a design.
async function openSharedDesign(page) {
  if (await page.evaluate(() => document.getElementById("cloud-dialog")?.open)) return;
  await page.evaluate(() => window.appSettings.open("account"));
  await page.locator("#settings-sharing").click();
  await page.waitForFunction(() => document.getElementById("cloud-dialog")?.open);
}

module.exports = { openSharedDesign };
