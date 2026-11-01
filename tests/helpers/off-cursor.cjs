// Keep the real mouse cursor off an Electron test window. While the physical cursor rests over the window, Chromium
// now and then injects a buttonless mousemove at the cursor's position; landing in the middle of a simulated drag
// (page.mouse.down → move → up) it ends the drag early or changes what is hovered, so drag-heavy tests fail at
// random. On a screen whose work area is the window size the window always opens under the cursor, so it is moved
// sideways (partly off-screen if needed) until the cursor is outside it. Call it right after app.firstWindow().
// Not for tests that click into the live preview iframe: clicks on its off-screen part do not reach the app
// (tests/preview-interaction.cjs then fails every run).
async function moveOffCursor(app) {
  await app.evaluate(({ BrowserWindow, screen }) => {
    const cursor = screen.getCursorScreenPoint();
    for (const win of BrowserWindow.getAllWindows()) {
      const b = win.getBounds();
      const inside = cursor.x >= b.x && cursor.x < b.x + b.width && cursor.y >= b.y && cursor.y < b.y + b.height;
      if (!inside) continue;
      // Go to whichever side of the cursor leaves more of the window on its display.
      const area = screen.getDisplayNearestPoint(cursor).workArea;
      const right = cursor.x + 1, left = cursor.x - b.width - 1;
      const visible = (x) => Math.min(x + b.width, area.x + area.width) - Math.max(x, area.x);
      win.setPosition(visible(right) >= visible(left) ? right : left, b.y);
    }
  });
}

module.exports = { moveOffCursor };
