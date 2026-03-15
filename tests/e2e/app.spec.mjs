import { test, expect } from '@playwright/test';
import { startServer, stopServer, getPort, clearEvents, events, broadcastAiCountdown, broadcastAiStatus } from './mock-server.mjs';
import { addServer, connectPane, getPaneMode, getPaneStatus, disconnectPane, setLayout } from './helpers.mjs';

let port;

test.beforeAll(async () => {
  port = await startServer();
});

test.afterAll(async () => {
  await stopServer();
});

test.beforeEach(async ({ page }) => {
  clearEvents();
  // Clear localStorage before each test
  await page.goto(`http://127.0.0.1:${port}`);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForTimeout(500);
});

// ============================================================
// Server management
// ============================================================

test.describe('Server management', () => {
  test('add server and see it in the list', async ({ page }) => {
    await page.click('#btn-servers');
    await page.fill('#srv-name', 'TestServer');
    await page.fill('#srv-host', `http://127.0.0.1:${port}`);
    await page.fill('#srv-token', 'test-token');
    await page.click('#btn-add-server');

    const serverItem = page.locator('.server-item');
    await expect(serverItem).toHaveCount(1);
    await expect(serverItem.locator('.srv-name')).toHaveText('TestServer');

    // Status bar shows count
    await page.click('#close-server-modal');
    await expect(page.locator('#server-status')).toHaveText('1 台服务器');
  });

  test('delete server removes it from list', async ({ page }) => {
    await addServer(page, { name: 'S1', host: `http://127.0.0.1:${port}`, token: 'test-token' });
    await page.click('#btn-servers');
    await page.click('.server-item .delete');
    await expect(page.locator('.server-item')).toHaveCount(0);
    await page.click('#close-server-modal');
    await expect(page.locator('#server-status')).toHaveText('未添加服务器');
  });
});

// ============================================================
// Grid layout
// ============================================================

test.describe('Grid layout', () => {
  test('default layout is 2x2 with 4 panes', async ({ page }) => {
    await expect(page.locator('.pane')).toHaveCount(4);
    await expect(page.locator('.layout-btn.active')).toHaveAttribute('data-layout', '2x2');
  });

  test('switch to 1x1 layout shows 1 pane', async ({ page }) => {
    await setLayout(page, '1x1');
    await expect(page.locator('.pane')).toHaveCount(1);
  });

  test('switch to 3x3 layout shows 9 panes', async ({ page }) => {
    await setLayout(page, '3x3');
    await expect(page.locator('.pane')).toHaveCount(9);
  });

  test('layout switch preserves existing pane states', async ({ page }) => {
    await addServer(page, { name: 'S1', host: `http://127.0.0.1:${port}`, token: 'test-token' });
    // Connect pane 0
    const pane0 = page.locator('.pane').nth(0);
    const serverId = await pane0.locator('.server-select option').nth(1).getAttribute('value');
    await connectPane(page, 0, { serverId });

    // Switch to 3x3 then back to 2x2
    await setLayout(page, '3x3');
    await setLayout(page, '2x2');

    // Pane 0 should still have server selected
    const val = await page.locator('.pane').nth(0).locator('.server-select').inputValue();
    expect(val).toBe(serverId);
  });
});

// ============================================================
// Session connection
// ============================================================

test.describe('Session connection', () => {
  test.beforeEach(async ({ page }) => {
    await addServer(page, { name: 'Mock', host: `http://127.0.0.1:${port}`, token: 'test-token' });
  });

  test('selecting server loads sessions', async ({ page }) => {
    const pane = page.locator('.pane').nth(0);
    const serverId = await pane.locator('.server-select option').nth(1).getAttribute('value');
    await connectPane(page, 0, { serverId });

    const options = pane.locator('.session-select option');
    // Should have placeholder + 3 sessions
    await expect(options).toHaveCount(4);
  });

  test('selecting session connects and shows output', async ({ page }) => {
    const pane = page.locator('.pane').nth(0);
    const serverId = await pane.locator('.server-select option').nth(1).getAttribute('value');
    await connectPane(page, 0, { serverId, sessionId: 'sess-001' });

    // Wait for WebSocket connection and output
    await page.waitForTimeout(1000);
    const status = await getPaneStatus(page, 0);
    expect(status).toContain('connected');
  });

  test('mode syncs from session list data', async ({ page }) => {
    const pane = page.locator('.pane').nth(0);
    const serverId = await pane.locator('.server-select option').nth(1).getAttribute('value');
    await connectPane(page, 0, { serverId, sessionId: 'sess-002' });

    await page.waitForTimeout(1000);
    const mode = await getPaneMode(page, 0);
    expect(mode).toBe('auto');
  });

  test('duplicate session is rejected', async ({ page }) => {
    const pane0 = page.locator('.pane').nth(0);
    const serverId = await pane0.locator('.server-select option').nth(1).getAttribute('value');

    // Connect pane 0 to sess-001
    await connectPane(page, 0, { serverId, sessionId: 'sess-001' });
    await page.waitForTimeout(500);

    // Try to connect pane 1 to same session
    await connectPane(page, 1, { serverId, sessionId: 'sess-001' });
    await page.waitForTimeout(500);

    // Pane 1 should show toast about duplicate
    const toast = page.locator('.pane').nth(1).locator('.pane-toast');
    await expect(toast).toContainText('已在其他窗格中使用');
  });
});

// ============================================================
// Disconnect
// ============================================================

test.describe('Disconnect', () => {
  test('disconnect button clears pane state', async ({ page }) => {
    await addServer(page, { name: 'Mock', host: `http://127.0.0.1:${port}`, token: 'test-token' });
    const pane = page.locator('.pane').nth(0);
    const serverId = await pane.locator('.server-select option').nth(1).getAttribute('value');
    await connectPane(page, 0, { serverId, sessionId: 'sess-001' });
    await page.waitForTimeout(1000);

    await disconnectPane(page, 0);
    await page.waitForTimeout(300);

    // Server and session should be cleared
    expect(await pane.locator('.server-select').inputValue()).toBe('');
    expect(await pane.locator('.session-select').inputValue()).toBe('');
  });
});

// ============================================================
// AI notifications per session
// ============================================================

test.describe('AI notifications', () => {
  test('ai_status only shows in matching pane', async ({ page }) => {
    await addServer(page, { name: 'Mock', host: `http://127.0.0.1:${port}`, token: 'test-token' });
    const pane0 = page.locator('.pane').nth(0);
    const pane1 = page.locator('.pane').nth(1);
    const serverId = await pane0.locator('.server-select option').nth(1).getAttribute('value');

    await connectPane(page, 0, { serverId, sessionId: 'sess-001' });
    await connectPane(page, 1, { serverId, sessionId: 'sess-002' });
    await page.waitForTimeout(1000);

    // Broadcast AI status for sess-001
    broadcastAiStatus('sess-001', 'done', 'input', 'ls', '');
    await page.waitForTimeout(500);

    // Pane 0 should have toast, pane 1 should not
    const toast0 = pane0.locator('.pane-toast');
    const toast1 = pane1.locator('.pane-toast');
    await expect(toast0).toHaveCount(1);
    await expect(toast1).toHaveCount(0);
  });
});

// ============================================================
// AI countdown
// ============================================================

test.describe('AI countdown', () => {
  test('countdown appears and disappears', async ({ page }) => {
    await addServer(page, { name: 'Mock', host: `http://127.0.0.1:${port}`, token: 'test-token' });
    const pane = page.locator('.pane').nth(0);
    const serverId = await pane.locator('.server-select option').nth(1).getAttribute('value');
    await connectPane(page, 0, { serverId, sessionId: 'sess-001' });
    await page.waitForTimeout(1000);

    // Send countdown
    broadcastAiCountdown('sess-001', 3, 'input', 'ls -la');
    await page.waitForTimeout(300);

    const countdown = pane.locator('.pane-countdown');
    await expect(countdown).toBeVisible();
    await expect(countdown.locator('.countdown-ring')).toHaveText('3');
    await expect(countdown.locator('.countdown-text')).toHaveText('ls -la');

    // Clear countdown
    broadcastAiCountdown('sess-001', 0, 'input', 'ls -la');
    await page.waitForTimeout(300);
    await expect(countdown).toHaveCount(0);
  });
});

// ============================================================
// Pane focus
// ============================================================

test.describe('Pane focus', () => {
  test('clicking input box focuses the pane', async ({ page }) => {
    const pane1 = page.locator('.pane').nth(1);
    await pane1.locator('.pane-input').click();
    await page.waitForTimeout(200);
    await expect(pane1).toHaveClass(/focused/);
  });
});

// ============================================================
// State persistence
// ============================================================

test.describe('State persistence', () => {
  test('layout persists across reload', async ({ page }) => {
    await setLayout(page, '1x2');
    await page.waitForTimeout(500);

    await page.reload();
    await page.waitForTimeout(500);

    await expect(page.locator('.pane')).toHaveCount(2);
    await expect(page.locator('.layout-btn.active')).toHaveAttribute('data-layout', '1x2');
  });

  test('disconnected session is not restored', async ({ page }) => {
    await addServer(page, { name: 'Mock', host: `http://127.0.0.1:${port}`, token: 'test-token' });
    const pane = page.locator('.pane').nth(0);
    const serverId = await pane.locator('.server-select option').nth(1).getAttribute('value');
    await connectPane(page, 0, { serverId, sessionId: 'sess-001' });
    await page.waitForTimeout(500);

    // Disconnect
    await disconnectPane(page, 0);
    await page.waitForTimeout(500);

    // Reload
    await page.reload();
    await page.waitForTimeout(500);

    // Server select should be empty
    expect(await page.locator('.pane').nth(0).locator('.server-select').inputValue()).toBe('');
  });
});

// ============================================================
// Screenshot button
// ============================================================

test.describe('Screenshot', () => {
  test('screenshot button exists', async ({ page }) => {
    await expect(page.locator('#btn-screenshot')).toBeVisible();
  });
});

// ============================================================
// Fullscreen toggle
// ============================================================

test.describe('Fullscreen', () => {
  test('double-click header toggles fullscreen', async ({ page }) => {
    const pane = page.locator('.pane').nth(0);
    const header = pane.locator('.pane-header');
    await header.dblclick();
    await page.waitForTimeout(200);
    await expect(pane).toHaveClass(/fullscreen/);

    await header.dblclick();
    await page.waitForTimeout(200);
    await expect(pane).not.toHaveClass(/fullscreen/);
  });
});
