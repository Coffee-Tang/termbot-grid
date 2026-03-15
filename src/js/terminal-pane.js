// Individual terminal pane — xterm.js + WebSocket + screen rendering

import { wsUrl } from './server-manager.js';

/** Strip ANSI escape sequences for comparison */
function stripAnsi(s) {
  return s.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '').trimEnd();
}

/**
 * Detect how many lines scrolled off the top.
 * Returns: number of lines scrolled (0 = no change, -1 = can't detect).
 */
function detectScrollOffset(prev, next) {
  if (prev.length === 0 || prev.length !== next.length) return -1;
  let allSame = true;
  for (let i = 0; i < prev.length; i++) {
    if (prev[i] !== next[i]) { allSame = false; break; }
  }
  if (allSame) return 0;

  const maxScroll = Math.min(prev.length - 2, 30);
  for (let offset = 1; offset <= maxScroll; offset++) {
    if (prev[offset] !== next[0]) continue;
    const checkLen = prev.length - offset;
    const strictLen = Math.max(checkLen - 2, 1);
    let match = true;
    for (let i = 0; i < strictLen; i++) {
      if (prev[i + offset] !== next[i]) { match = false; break; }
    }
    if (match) return offset;
  }
  return -1;
}

function _createEl(tag, className, textContent) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (textContent) el.textContent = textContent;
  return el;
}

function _createOption(value, text) {
  const opt = document.createElement('option');
  opt.value = value;
  opt.textContent = text;
  return opt;
}

export class TerminalPane {
  constructor(paneIndex) {
    this.index = paneIndex;
    this.server = null;
    this.sessionId = null;
    this.ws = null;
    this.term = null;
    this.fitAddon = null;
    this.el = null;
    this._prevStripped = [];
    this._sessions = [];
    this._capsules = [];
    this._focused = false;
    this._fullscreen = false;
    this._resizeObserver = null;
    this._pingInterval = null;
  }

  /** Create DOM elements and xterm instance */
  mount(container) {
    this.el = _createEl('div', 'pane');

    // Header
    const header = _createEl('div', 'pane-header');
    const statusDot = _createEl('span', 'pane-status');
    const serverSel = _createEl('select', 'server-select');
    serverSel.appendChild(_createOption('', '-- 服务器 --'));
    const sessionSel = _createEl('select', 'session-select');
    sessionSel.appendChild(_createOption('', '-- Session --'));
    const title = _createEl('span', 'pane-title');
    // Mode select
    const modeSel = _createEl('select', 'mode-select');
    for (const [val, label] of [['manual','人工'],['notify','通知'],['auto','AI 托管'],['auto_crazy','AI Crazy']]) {
      modeSel.appendChild(_createOption(val, label));
    }
    modeSel.addEventListener('change', e => {
      e.stopPropagation();
      if (this.ws && this.ws.readyState === WebSocket.OPEN && this.sessionId) {
        this.ws.send(JSON.stringify({ type: 'mode', mode: e.target.value }));
      }
    });
    // AI badge
    const aiBadge = _createEl('span', 'ai-badge');
    // AI log toggle button
    const aiLogBtn = _createEl('button', 'ai-log-btn', 'AI');
    aiLogBtn.title = 'AI 日志';
    aiLogBtn.addEventListener('click', e => { e.stopPropagation(); this._toggleAiLog(); });
    // Capsule toggle button
    const capsuleBtn = _createEl('button', 'capsule-header-btn', '⚡');
    capsuleBtn.title = '闪念胶囊';
    capsuleBtn.addEventListener('click', e => { e.stopPropagation(); this._toggleCapsule(); });

    header.append(statusDot, serverSel, sessionSel, modeSel, aiBadge, aiLogBtn, capsuleBtn, title);

    // Terminal container
    const termContainer = _createEl('div', 'pane-terminal');
    termContainer.id = `pane-term-${this.index}`;

    // Input bar with quick action buttons
    const inputBar = _createEl('div', 'pane-input-bar');
    const quickBtns = _createEl('div', 'quick-btns');
    const btnDefs = [
      { key: 'ctrl+c', label: '^C', cls: 'btn-danger' },
      { key: 'escape', label: 'Esc' },
      { key: 'tab', label: 'Tab' },
      { key: 'up', label: '↑' },
      { key: 'down', label: '↓' },
      { key: 'left', label: '←' },
      { key: 'right', label: '→' },
      { send: 'y\n', label: 'y↵', cls: 'btn-confirm' },
      { send: 'OK\n', label: 'OK', cls: 'btn-confirm' },
      { key: 'enter', label: '↵' },
    ];
    for (const def of btnDefs) {
      const btn = _createEl('button', 'qbtn' + (def.cls ? ' ' + def.cls : ''), def.label);
      btn.addEventListener('click', e => {
        e.stopPropagation();
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN || !this.sessionId) return;
        if (def.key) {
          this.ws.send(JSON.stringify({ type: 'key', key: def.key }));
        } else if (def.send) {
          this.ws.send(JSON.stringify({ type: 'input', data: def.send }));
        }
      });
      quickBtns.appendChild(btn);
    }
    // Command input
    const inputRow = _createEl('div', 'input-row');
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'pane-input';
    input.placeholder = '输入命令...';
    input.addEventListener('keydown', e => {
      e.stopPropagation();
      if (e.key === 'Enter' && this.ws && this.ws.readyState === WebSocket.OPEN && this.sessionId) {
        const text = input.value;
        if (text) {
          this.ws.send(JSON.stringify({ type: 'input', data: text + '\r' }));
          input.value = '';
        }
      }
    });
    input.addEventListener('click', e => e.stopPropagation());
    input.addEventListener('focus', e => e.stopPropagation());
    const sendBtn = _createEl('button', 'send-btn', '▶');
    sendBtn.addEventListener('click', e => {
      e.stopPropagation();
      if (this.ws && this.ws.readyState === WebSocket.OPEN && this.sessionId && input.value) {
        this.ws.send(JSON.stringify({ type: 'input', data: input.value + '\r' }));
        input.value = '';
      }
    });
    inputRow.append(input, sendBtn);
    inputBar.append(quickBtns, inputRow);

    // AI log sidebar panel
    const aiLogPanel = _createEl('div', 'ai-log-panel hidden');
    const aiLogHeader = _createEl('div', 'sidebar-panel-header');
    aiLogHeader.appendChild(_createEl('span', '', 'AI 日志'));
    const aiLogClose = _createEl('button', 'sidebar-panel-close', '×');
    aiLogClose.addEventListener('click', e => { e.stopPropagation(); this._toggleAiLog(); });
    aiLogHeader.appendChild(aiLogClose);
    const aiLogList = _createEl('div', 'ai-log-list');
    aiLogPanel.append(aiLogHeader, aiLogList);

    // Capsule sidebar panel
    const capsulePanel = _createEl('div', 'capsule-sidebar-panel hidden');
    const cHeader = _createEl('div', 'sidebar-panel-header');
    cHeader.appendChild(_createEl('span', '', '⚡ 闪念胶囊'));
    const cClose = _createEl('button', 'sidebar-panel-close', '×');
    cClose.addEventListener('click', e => { e.stopPropagation(); this._toggleCapsule(); });
    cHeader.appendChild(cClose);
    const cList = _createEl('div', 'capsule-list');
    const cInputRow = _createEl('div', 'capsule-input-row');
    const cText = document.createElement('input');
    cText.type = 'text';
    cText.className = 'capsule-text';
    cText.placeholder = '记录一个想法...';
    cText.addEventListener('click', e => e.stopPropagation());
    cText.addEventListener('keydown', e => {
      e.stopPropagation();
      if (e.key === 'Enter' && cText.value.trim()) {
        this._addCapsule(cText.value.trim());
        cText.value = '';
      }
    });
    const cAddBtn = _createEl('button', 'capsule-add-btn', '+');
    cAddBtn.addEventListener('click', e => {
      e.stopPropagation();
      if (cText.value.trim()) { this._addCapsule(cText.value.trim()); cText.value = ''; }
    });
    cInputRow.append(cText, cAddBtn);
    const cOptions = _createEl('div', 'capsule-options');
    const autoLabel = document.createElement('label');
    autoLabel.className = 'capsule-checkbox';
    const autoCheck = document.createElement('input');
    autoCheck.type = 'checkbox'; autoCheck.checked = true; autoCheck.className = 'capsule-auto-run';
    autoCheck.addEventListener('click', e => e.stopPropagation());
    autoLabel.append(autoCheck, ' 自动运行');
    const brainLabel = document.createElement('label');
    brainLabel.className = 'capsule-checkbox';
    const brainCheck = document.createElement('input');
    brainCheck.type = 'checkbox'; brainCheck.className = 'capsule-brainstorm';
    brainCheck.addEventListener('click', e => e.stopPropagation());
    brainLabel.append(brainCheck, ' 头脑风暴');
    cOptions.append(autoLabel, brainLabel);
    capsulePanel.append(cHeader, cList, cInputRow, cOptions);

    this.el.append(header, termContainer, aiLogPanel, capsulePanel, inputBar);
    container.appendChild(this.el);

    // xterm.js
    this.term = new window.Terminal({
      fontSize: 13,
      fontFamily: "'Menlo', 'Monaco', 'Courier New', monospace",
      theme: { background: '#11111b', foreground: '#cdd6f4', cursor: '#f5e0dc' },
      cursorBlink: true,
      scrollback: 1000,
      convertEol: false,
    });
    this.fitAddon = new window.FitAddon.FitAddon();
    this.term.loadAddon(this.fitAddon);
    this.term.open(termContainer);
    this._autoFit();

    this._resizeObserver = new ResizeObserver(() => this._autoFit());
    this._resizeObserver.observe(termContainer);

    this.el.addEventListener('click', () => this._onFocus());
    this.term.attachCustomKeyEventHandler(() => false);
    header.addEventListener('dblclick', () => this._toggleFullscreen());
    serverSel.addEventListener('change', e => this._onServerChange(e.target.value));
    sessionSel.addEventListener('change', e => this._onSessionChange(e.target.value));
  }

  updateServerOptions(servers) {
    const sel = this.el.querySelector('.server-select');
    const cur = sel.value;
    sel.textContent = '';
    sel.appendChild(_createOption('', '-- 服务器 --'));
    for (const s of servers) sel.appendChild(_createOption(s.id, s.name));
    if (cur && servers.find(s => s.id === cur)) sel.value = cur;
  }

  setFocused(focused) {
    this._focused = focused;
    this.el.classList.toggle('focused', focused);
    if (focused) this.term.focus();
  }

  _onFocus() {
    this.el.dispatchEvent(new CustomEvent('pane-focus', { bubbles: true, detail: { index: this.index } }));
  }

  _autoFit() {
    try {
      const container = this.el.querySelector('.pane-terminal');
      const w = container.clientWidth;
      const h = container.clientHeight;
      if (w < 10 || h < 10) return;
      // Target ~80 columns. Monospace char width ≈ fontSize * 0.6
      const targetCols = 80;
      const idealSize = Math.floor(w / (targetCols * 0.602));
      const fontSize = Math.max(8, Math.min(idealSize, 18));
      if (this.term.options.fontSize !== fontSize) {
        this.term.options.fontSize = fontSize;
      }
      this.fitAddon.fit();
    } catch {}
  }

  _toggleFullscreen() {
    this._fullscreen = !this._fullscreen;
    this.el.classList.toggle('fullscreen', this._fullscreen);
    setTimeout(() => this._autoFit(), 50);
  }

  async _onServerChange(serverId) {
    this.disconnect();
    this.sessionId = null;
    this._sessions = [];
    this._updateSessionSelect([]);
    this._setStatus('');
    this._setTitle('');
    if (!serverId) { this.server = null; return; }
    const { getServer, fetchSessions } = await import('./server-manager.js');
    this.server = getServer(serverId);
    if (!this.server) return;
    try {
      this._sessions = await fetchSessions(this.server);
      this._updateSessionSelect(this._sessions);
      this._setStatus('connected');
    } catch {
      this._setStatus('error');
      this._setTitle('连接失败');
    }
  }

  _onSessionChange(sessionId) {
    this.disconnect();
    this.sessionId = sessionId || null;
    this._prevStripped = [];
    this.term.clear();
    if (this.sessionId && this.server) this.connect();
  }

  _updateSessionSelect(sessions) {
    const sel = this.el.querySelector('.session-select');
    sel.textContent = '';
    sel.appendChild(_createOption('', '-- Session --'));
    for (const s of sessions) sel.appendChild(_createOption(s.session_id, s.alias || s.name || s.session_id.slice(0, 8)));
  }

  _setStatus(state) {
    this.el.querySelector('.pane-status').className = 'pane-status' + (state ? ` ${state}` : '');
  }

  _setTitle(text) {
    this.el.querySelector('.pane-title').textContent = text;
  }

  _updateBadge(mode, trigger) {
    const badge = this.el.querySelector('.ai-badge');
    const labels = { manual: '', notify: '通知', auto: 'AI', auto_crazy: 'AI Crazy', thinking: '分析中...' };
    badge.textContent = labels[mode] || '';
    badge.className = 'ai-badge' + (mode !== 'manual' && mode ? ' active' : '') + (mode === 'thinking' ? ' thinking' : '');
    const colors = { auto_crazy: '#e06c75', notify: '#d29922', thinking: '#89b4fa' };
    badge.style.color = colors[mode] || '';
    if (trigger) badge.textContent = '分析: ' + trigger;
  }

  _showToast(text) {
    const toast = _createEl('div', 'pane-toast', text);
    this.el.appendChild(toast);
    setTimeout(() => toast.classList.add('show'), 10);
    setTimeout(() => { toast.classList.remove('show'); setTimeout(() => toast.remove(), 300); }, 3000);
  }

  // --- AI Log ---
  _toggleAiLog() {
    const panel = this.el.querySelector('.ai-log-panel');
    panel.classList.toggle('hidden');
    // Close capsule if open
    this.el.querySelector('.capsule-sidebar-panel').classList.add('hidden');
    if (!panel.classList.contains('hidden') && this.server && this.sessionId) {
      this._loadAiHistory();
    }
  }

  async _loadAiHistory() {
    if (!this.server || !this.sessionId) return;
    try {
      const { httpBase } = await import('./server-manager.js');
      const base = httpBase(this.server);
      const resp = await fetch(`${base}/api/ai/history?token=${this.server.token}&session_id=${this.sessionId}`);
      const entries = await resp.json();
      const list = this.el.querySelector('.ai-log-list');
      list.textContent = '';
      entries.forEach(e => this._addAiLogEntry(e));
    } catch {}
  }

  _addAiLogEntry(data) {
    const list = this.el.querySelector('.ai-log-list');
    if (!list) return;
    const el = _createEl('div', 'ai-log-entry');
    const ts = data.timestamp
      ? new Date(data.timestamp * 1000).toLocaleTimeString('zh-CN', { hour12: false })
      : new Date().toLocaleTimeString('zh-CN', { hour12: false });
    el.appendChild(_createEl('span', 'log-time', ts));

    if (data.type === 'ai_status' && data.status === 'thinking') {
      el.classList.add('status-thinking');
      el.appendChild(_createEl('span', 'log-action', 'AI 分析中: ' + (data.trigger || '')));
    } else if (data.type === 'ai_status' && data.status === 'done') {
      el.classList.add('action-' + (data.action || 'wait'));
      const actions = { wait: '观察中', input: '发送: ' + data.value, key: '按键: ' + data.value, notify: '通知人工' };
      el.appendChild(_createEl('div', 'log-action', actions[data.action] || data.action));
      if (data.reasoning) el.appendChild(_createEl('div', 'log-reason', data.reasoning));
    } else if (data.type === 'ai_action') {
      if (data.action === 'wait') return;
      el.classList.add('action-' + (data.action || ''));
      const texts = { input: '自动发送: ' + data.value, key: '自动按键: ' + data.value, notify: data.value, cancelled: '取消: ' + data.value };
      el.appendChild(_createEl('div', 'log-action', texts[data.action] || data.action));
      if (data.reasoning) el.appendChild(_createEl('div', 'log-reason', data.reasoning));
    } else {
      return;
    }
    list.prepend(el);
  }

  // --- Capsule ---
  _toggleCapsule() {
    const panel = this.el.querySelector('.capsule-sidebar-panel');
    panel.classList.toggle('hidden');
    // Close AI log if open
    this.el.querySelector('.ai-log-panel').classList.add('hidden');
    if (!panel.classList.contains('hidden') && this.server && this.sessionId) {
      this._loadCapsules();
    }
  }

  async _loadCapsules() {
    if (!this.server || !this.sessionId) return;
    try {
      const { httpBase } = await import('./server-manager.js');
      const base = httpBase(this.server);
      const resp = await fetch(`${base}/api/sessions/${this.sessionId}/ideas?token=${this.server.token}`);
      this._capsules = await resp.json();
      this._renderCapsules();
    } catch {}
  }

  _addCapsule(text) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN || !this.sessionId) return;
    const autoRun = this.el.querySelector('.capsule-auto-run').checked;
    const brainstorm = this.el.querySelector('.capsule-brainstorm').checked;
    if (brainstorm) text = '/brainstorming ' + text;
    this.ws.send(JSON.stringify({ type: 'idea_add', session_id: this.sessionId, text, auto_run: autoRun }));
  }

  _renderCapsules() {
    const list = this.el.querySelector('.capsule-list');
    list.textContent = '';
    if (!this._capsules || !this._capsules.length) {
      list.appendChild(_createEl('div', 'capsule-empty', '暂无胶囊'));
      return;
    }
    for (const idea of this._capsules) {
      const item = _createEl('div', 'capsule-item ' + (idea.status || 'pending'));
      const statusIcon = { pending: '○', running: '◎', done: '✓', failed: '✗' }[idea.status] || '○';
      item.appendChild(_createEl('span', 'capsule-status', statusIcon));
      item.appendChild(_createEl('span', 'capsule-item-text', idea.text));
      if (idea.status === 'pending') {
        const runBtn = _createEl('button', 'capsule-run', '▶');
        runBtn.title = '立即执行';
        runBtn.addEventListener('click', e => {
          e.stopPropagation();
          if (this.ws && this.ws.readyState === WebSocket.OPEN)
            this.ws.send(JSON.stringify({ type: 'idea_run', session_id: this.sessionId, idea_id: idea.id }));
        });
        item.appendChild(runBtn);
      }
      const delBtn = _createEl('button', 'capsule-del', '×');
      delBtn.addEventListener('click', e => {
        e.stopPropagation();
        if (this.ws && this.ws.readyState === WebSocket.OPEN)
          this.ws.send(JSON.stringify({ type: 'idea_remove', session_id: this.sessionId, idea_id: idea.id }));
      });
      item.appendChild(delBtn);
      list.appendChild(item);
    }
  }

  // --- WebSocket ---
  connect() {
    if (!this.server || !this.sessionId) return;
    this.disconnect();
    const url = wsUrl(this.server);
    this.ws = new WebSocket(url);
    this._setStatus('');
    this.ws.onopen = () => {
      this._setStatus('connected');
      this.ws.send(JSON.stringify({ type: 'switch', session_id: this.sessionId }));
      this._pingInterval = setInterval(() => {
        if (this.ws && this.ws.readyState === WebSocket.OPEN)
          this.ws.send(JSON.stringify({ type: 'ping' }));
      }, 30000);
    };
    this.ws.onmessage = (event) => {
      try { this._handleMessage(JSON.parse(event.data)); } catch {}
    };
    this.ws.onclose = () => { this._setStatus('error'); clearInterval(this._pingInterval); };
    this.ws.onerror = () => { this._setStatus('error'); };
  }

  disconnect() {
    if (this.ws) { this.ws.close(); this.ws = null; }
    clearInterval(this._pingInterval);
  }

  _handleMessage(msg) {
    switch (msg.type) {
      case 'output':
        if (msg.session_id === this.sessionId) this._writeOutput(msg.data);
        break;
      case 'sessions':
        this._sessions = msg.list;
        this._updateSessionSelect(msg.list);
        if (this.sessionId && this.ws && this.ws.readyState === WebSocket.OPEN)
          this.ws.send(JSON.stringify({ type: 'switch', session_id: this.sessionId }));
        break;
      case 'status':
        if (msg.session_id === this.sessionId) {
          this.el.querySelector('.mode-select').value = msg.mode;
          this._updateBadge(msg.mode);
        }
        break;
      case 'ai_status':
        this._addAiLogEntry(msg);
        if (msg.status === 'thinking') {
          this._updateBadge('thinking', msg.trigger);
        } else if (msg.status === 'done') {
          this._updateBadge(this.el.querySelector('.mode-select').value);
          const actions = { wait: '观察中', input: '发送: ' + msg.value, key: '按键: ' + msg.value, notify: '通知人工' };
          this._showToast('AI: ' + (actions[msg.action] || msg.action));
        }
        break;
      case 'ai_action':
        this._addAiLogEntry(msg);
        if (msg.action !== 'wait') {
          const texts = { input: '发送: ' + msg.value, key: '按键: ' + msg.value, notify: msg.value, cancelled: '取消: ' + msg.value };
          this._showToast('AI ' + (texts[msg.action] || msg.action));
        }
        break;
      case 'idea_updated':
        if (msg.session_id === this.sessionId) {
          this._capsules = msg.ideas || [];
          this._renderCapsules();
        }
        break;
      case 'pong':
        break;
    }
  }

  _writeOutput(data) {
    const newStripped = data.split('\n').map(stripAnsi);
    const scrollOffset = detectScrollOffset(this._prevStripped, newStripped);
    if (scrollOffset === 0 && this._prevStripped.length > 0) return;
    if (scrollOffset > 0) {
      this.term.write('\x1b[' + this.term.rows + ';1H' + '\r\n'.repeat(scrollOffset));
    } else if (scrollOffset === -1 && this._prevStripped.length > 0) {
      this.term.write('\x1b[' + this.term.rows + ';1H' + '\r\n'.repeat(this.term.rows));
    }
    this._prevStripped = newStripped;
    this.term.write('\x1b[H\x1b[2J' + data.replace(/\n/g, '\r\n'));
    if (this.term.buffer.active.viewportY >= this.term.buffer.active.baseY) this.term.scrollToBottom();
  }

  destroy() {
    this.disconnect();
    if (this._resizeObserver) this._resizeObserver.disconnect();
    if (this.term) this.term.dispose();
    if (this.el) this.el.remove();
  }

  getState() {
    return { serverId: this.server?.id || null, sessionId: this.sessionId };
  }

  async restoreState(state) {
    if (state.serverId) {
      this.el.querySelector('.server-select').value = state.serverId;
      await this._onServerChange(state.serverId);
      if (state.sessionId) {
        this.el.querySelector('.session-select').value = state.sessionId;
        this._onSessionChange(state.sessionId);
      }
    }
  }
}
