// Server list management with persistence

const STORAGE_KEY = 'termbot_grid_servers';

let _servers = []; // [{id, name, host, token}]

export function loadServers() {
  try {
    _servers = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
  } catch { _servers = []; }
  return _servers;
}

function _save() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(_servers));
}

export function getServers() { return _servers; }

export function addServer(name, host, token) {
  // Normalize: ensure has protocol, strip trailing slash
  if (!/^https?:\/\//.test(host)) host = 'http://' + host;
  host = host.replace(/\/+$/, '');
  const id = 'srv_' + Date.now().toString(36);
  _servers.push({ id, name, host, token });
  _save();
  return id;
}

export function removeServer(id) {
  _servers = _servers.filter(s => s.id !== id);
  _save();
}

export function getServer(id) {
  return _servers.find(s => s.id === id) || null;
}

/** Build WebSocket URL for a server */
export function wsUrl(server) {
  return server.host.replace(/^http/, 'ws') + '/ws?token=' + server.token;
}

/** Build HTTP base URL for a server */
export function httpBase(server) {
  return server.host;
}

/** Fetch session list from a server */
export async function fetchSessions(server) {
  const base = httpBase(server);
  const resp = await fetch(`${base}/api/sessions?token=${server.token}`);
  return resp.json();
}
