// TermBot Grid — Main entry point

import { loadServers, addServer, removeServer, getServers } from './server-manager.js';
import { init as initGrid, refreshServers } from './grid-manager.js';

// --- Server modal ---
const modal = document.getElementById('server-modal');
const btnServers = document.getElementById('btn-servers');
const btnClose = document.getElementById('close-server-modal');
const btnAdd = document.getElementById('btn-add-server');

function renderServerList() {
  const list = document.getElementById('server-list');
  list.textContent = '';
  for (const s of getServers()) {
    const item = document.createElement('div');
    item.className = 'server-item';

    const info = document.createElement('div');
    info.className = 'srv-info';
    const name = document.createElement('div');
    name.className = 'srv-name';
    name.textContent = s.name;
    const host = document.createElement('div');
    host.className = 'srv-host';
    host.textContent = s.host;
    info.append(name, host);

    const del = document.createElement('button');
    del.className = 'delete';
    del.textContent = '删除';
    del.addEventListener('click', () => {
      removeServer(s.id);
      renderServerList();
      refreshServers();
    });

    item.append(info, del);
    list.appendChild(item);
  }

  // Update status bar
  const status = document.getElementById('server-status');
  const count = getServers().length;
  status.textContent = count ? `${count} 台服务器` : '未添加服务器';
}

btnServers.addEventListener('click', () => {
  modal.classList.remove('hidden');
  renderServerList();
});

btnClose.addEventListener('click', () => {
  modal.classList.add('hidden');
});

modal.addEventListener('click', (e) => {
  if (e.target === modal) modal.classList.add('hidden');
});

// Auto-parse URL with token (e.g. http://host:port/ws?token=xxx)
document.getElementById('srv-host').addEventListener('input', (e) => {
  const val = e.target.value.trim();
  if (!val.includes('token=')) return;
  try {
    // Normalize: ensure protocol so URL can parse
    const normalized = /^(https?|wss?):\/\//.test(val) ? val : 'http://' + val;
    const url = new URL(normalized);
    const token = url.searchParams.get('token');
    if (!token) return;
    // Reconstruct clean host: protocol + host (use http for ws)
    const proto = url.protocol.replace('wss', 'https').replace('ws', 'http');
    const host = proto + '//' + url.host;
    e.target.value = host;
    document.getElementById('srv-token').value = token;
    // Auto-fill name if empty
    const nameInput = document.getElementById('srv-name');
    if (!nameInput.value.trim()) {
      nameInput.value = url.hostname;
      nameInput.focus();
      nameInput.select();
    }
  } catch {}
});

btnAdd.addEventListener('click', () => {
  const name = document.getElementById('srv-name').value.trim();
  const host = document.getElementById('srv-host').value.trim();
  const token = document.getElementById('srv-token').value.trim();
  if (!name || !host || !token) return;
  addServer(name, host, token);
  document.getElementById('srv-name').value = '';
  document.getElementById('srv-host').value = '';
  document.getElementById('srv-token').value = '';
  renderServerList();
  refreshServers();
});

// --- Screenshot ---
document.getElementById('btn-screenshot').addEventListener('click', async () => {
  try {
    const canvas = await html2canvas(document.body, { backgroundColor: '#1e1e2e' });
    const link = document.createElement('a');
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    link.download = `termbot-grid-${ts}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
  } catch (err) {
    console.error('Screenshot failed:', err);
  }
});

// --- Init ---
loadServers();
renderServerList();
initGrid();
