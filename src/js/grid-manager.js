// Grid layout management — create/destroy panes, handle layout switching

import { TerminalPane } from './terminal-pane.js';
import { getServers } from './server-manager.js';

const LAYOUTS = {
  '1x1': { cols: 1, rows: 1, count: 1 },
  '1x2': { cols: 2, rows: 1, count: 2 },
  '2x2': { cols: 2, rows: 2, count: 4 },
  '2x3': { cols: 3, rows: 2, count: 6 },
  '3x3': { cols: 3, rows: 3, count: 9 },
};

const STATE_KEY = 'termbot_grid_state';

let _panes = [];
let _currentLayout = '2x2';
let _focusedIndex = 0;

export function getCurrentLayout() { return _currentLayout; }
export function getPanes() { return _panes; }

export function init() {
  const container = document.getElementById('grid-container');

  // Listen for pane focus events
  container.addEventListener('pane-focus', (e) => {
    setFocus(e.detail.index);
  });

  // Layout button clicks
  document.querySelectorAll('.layout-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      setLayout(btn.dataset.layout);
    });
  });

  // Restore saved state or use default
  const saved = _loadState();
  if (saved) {
    _currentLayout = saved.layout || '2x2';
  }

  setLayout(_currentLayout);

  // Restore pane bindings after layout is set
  if (saved && saved.panes) {
    const servers = getServers();
    _panes.forEach((pane, i) => {
      if (saved.panes[i]) {
        pane.restoreState(saved.panes[i]);
      }
    });
  }
}

export function setLayout(layoutKey) {
  const layout = LAYOUTS[layoutKey];
  if (!layout) return;

  // Save current pane states before destroying
  const oldStates = _panes.map(p => p.getState());

  // Destroy excess panes
  while (_panes.length > layout.count) {
    _panes.pop().destroy();
  }

  // Update grid CSS
  const container = document.getElementById('grid-container');
  container.style.gridTemplateColumns = `repeat(${layout.cols}, 1fr)`;
  container.style.gridTemplateRows = `repeat(${layout.rows}, 1fr)`;

  // Create missing panes
  const servers = getServers();
  while (_panes.length < layout.count) {
    const pane = new TerminalPane(_panes.length);
    pane.mount(container);
    pane.updateServerOptions(servers);
    _panes.push(pane);
  }

  // Restore states for existing panes
  _panes.forEach((pane, i) => {
    if (oldStates[i]) {
      pane.restoreState(oldStates[i]);
    }
  });

  _currentLayout = layoutKey;

  // Update active button
  document.querySelectorAll('.layout-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.layout === layoutKey);
  });

  // Adjust focus
  if (_focusedIndex >= _panes.length) _focusedIndex = 0;
  setFocus(_focusedIndex);

  _saveState();
}

export function setFocus(index) {
  _focusedIndex = index;
  _panes.forEach((p, i) => p.setFocused(i === index));
}

/** Refresh server dropdowns in all panes */
export function refreshServers() {
  const servers = getServers();
  _panes.forEach(p => p.updateServerOptions(servers));
}

/** Save grid state to localStorage */
function _saveState() {
  const state = {
    layout: _currentLayout,
    panes: _panes.map(p => p.getState()),
  };
  localStorage.setItem(STATE_KEY, JSON.stringify(state));
}

function _loadState() {
  try {
    return JSON.parse(localStorage.getItem(STATE_KEY));
  } catch { return null; }
}

// Auto-save state periodically
setInterval(_saveState, 10000);

// Save immediately when pane state changes (server/session switch)
document.addEventListener('pane-state-changed', _saveState);
