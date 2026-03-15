// Shared test helpers

/**
 * Add a server to the app via the UI
 */
export async function addServer(page, { name, host, token }) {
  await page.click('#btn-servers');
  await page.fill('#srv-name', name);
  await page.fill('#srv-host', host);
  await page.fill('#srv-token', token);
  await page.click('#btn-add-server');
  await page.click('#close-server-modal');
}

/**
 * Select server and session in a specific pane (0-indexed)
 */
export async function connectPane(page, paneIndex, { serverId, sessionId }) {
  const pane = page.locator('.pane').nth(paneIndex);
  if (serverId) {
    await pane.locator('.server-select').selectOption(serverId);
    // Wait for sessions to load
    await page.waitForTimeout(500);
  }
  if (sessionId) {
    await pane.locator('.session-select').selectOption(sessionId);
    await page.waitForTimeout(500);
  }
}

/**
 * Get the text content of a pane's mode select
 */
export async function getPaneMode(page, paneIndex) {
  const pane = page.locator('.pane').nth(paneIndex);
  return await pane.locator('.mode-select').inputValue();
}

/**
 * Get pane status dot class
 */
export async function getPaneStatus(page, paneIndex) {
  const pane = page.locator('.pane').nth(paneIndex);
  return await pane.locator('.pane-status').getAttribute('class');
}

/**
 * Click disconnect button on a pane
 */
export async function disconnectPane(page, paneIndex) {
  const pane = page.locator('.pane').nth(paneIndex);
  await pane.locator('.btn-disconnect').click();
}

/**
 * Switch layout
 */
export async function setLayout(page, layout) {
  await page.click(`.layout-btn[data-layout="${layout}"]`);
  await page.waitForTimeout(300);
}
