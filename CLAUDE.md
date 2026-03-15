# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

TermBot Grid is a **Tauri 2** desktop client that displays multiple remote terminal sessions in a configurable grid layout. It connects to TermBot backend servers via WebSocket and renders terminal output using xterm.js. The UI language is Chinese (zh-CN).

## Build & Run Commands

```bash
# Development (runs Tauri dev server with hot reload)
cd src-tauri && cargo tauri dev

# Production build
cd src-tauri && cargo tauri build

# Check Rust compilation without building
cd src-tauri && cargo check
```

There is no frontend build step — the frontend is vanilla JS/HTML/CSS served directly from `src/`. No npm build, no bundler.

## Architecture

### Two-layer structure

- **`src-tauri/`** — Rust/Tauri shell. Minimal — just bootstraps the Tauri window. No custom Tauri commands or plugins yet.
- **`src/`** — Frontend (vanilla JS modules, no framework, no bundler). This is the `frontendDist` directory served by Tauri.

### Frontend modules (`src/js/`)

| Module | Responsibility |
|---|---|
| `main.js` | Entry point. Server modal UI, wires up server CRUD, initializes grid. |
| `grid-manager.js` | Grid layout engine. Manages pane creation/destruction, layout switching (1×1 to 3×3), focus, state persistence to localStorage. |
| `terminal-pane.js` | Core component. Each pane: xterm.js instance + WebSocket connection + server/session selectors + AI mode/log + capsule sidebar + quick-action buttons. |
| `server-manager.js` | Server list CRUD with localStorage persistence. Builds WS/HTTP URLs, fetches session lists from backend API. |

### Data flow

1. User adds a TermBot server (host + token) → stored in localStorage
2. Grid creates N `TerminalPane` instances based on selected layout
3. Each pane connects via WebSocket (`ws://{host}/ws?token=...`) to a server
4. Pane sends `switch` message to select a session, receives `output` messages with terminal screen content
5. Terminal output uses a scroll-detection diff algorithm (`detectScrollOffset`) to minimize xterm.js redraws
6. AI features: mode control (manual/notify/auto/auto_crazy), AI status/action log sidebar, capsule ("闪念胶囊") idea queue

### External dependencies (loaded via CDN)

- xterm.js 5.5.0 + fit addon — terminal rendering
- Tauri 2 — desktop shell

### WebSocket message protocol

Outbound: `switch`, `input`, `key`, `mode`, `ping`, `idea_add`, `idea_run`, `idea_remove`
Inbound: `output`, `sessions`, `status`, `ai_status`, `ai_action`, `idea_updated`, `pong`

## Key Conventions

- No build tooling for frontend — all JS uses native ES modules (`import`/`export`)
- DOM is constructed programmatically (no templates, no JSX) — see `_createEl` helper pattern
- State persistence uses localStorage keys: `termbot_grid_servers`, `termbot_grid_state`
- Catppuccin Mocha color theme (background `#1e1e2e`, terminal bg `#11111b`)
