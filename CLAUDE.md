# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

VCPChat is an AI chat desktop client built with Electron for the VCP (Variable & Command Protocol) server ecosystem. It provides a rich multi-modal interface for AI interaction with advanced features like distributed plugin execution, group chat capabilities, canvas collaboration, and 21+ content renderers.

**Backend Link**: https://github.com/lioensky/VCPToolBox

## Common Commands

### Development
```bash
# Install dependencies
npm install

# Install Python dependencies (for audio engine)
pip install -r requirements.txt

# Start the application
npm start

# Build for distribution
npm run dist
```

### Audio Engine (Rust)
The audio engine is now Rust-based. If the binary is missing:
```bash
cd rust_audio_engine
cargo build --release
```
The compiled binary should be at `audio_engine/audio_server.exe`.

### VchatManager (Data Management Tool)
```bash
cd VchatManager
npm start
```

### VCPHumanToolBox (Workflow Editor)
```bash
cd VCPHumanToolBox
npm start
```

## High-Level Architecture

### Process Structure
- **Main Process** (`main.js`): Electron main process handling window management, IPC, system integration
- **Renderer Process** (`renderer.js`): Frontend logic for the main chat interface
- **Preload** (`preload.js`): Secure bridge between main and renderer processes

### Key Directories

| Directory | Purpose |
|-----------|---------|
| `modules/ipc/` | IPC handlers for main-renderer communication (18 handlers) |
| `modules/renderer/` | Frontend rendering logic, message processing, UI |
| `modules/utils/` | Shared utilities (agentConfigManager, appSettingsManager) |
| `VCPDistributedServer/` | Distributed server for VCP plugin execution |
| `VCPDistributedServer/Plugin/` | VCP plugins (20+ plugins) |
| `AppData/` | User data (gitignored) - agents, chat history, settings |
| `[Feature]modules/` | Standalone feature modules (Canvas, Music, Dice, etc.) |
| `VchatManager/` | Standalone data management/viewer tool |
| `VCPHumanToolBox/` | Workflow editor and ComfyUI integration |
| `NativeSpalash/` | Rust-based native splash screen |
| `audio_engine/` | Rust audio server (WASAPI, DSD support) |

### Module Architecture Pattern

Each IPC handler in `modules/ipc/` follows this pattern:
```javascript
// Initialize with dependencies
module.initialize({ SETTINGS_FILE, AGENT_DIR, ... });

// Export handlers for ipcMain.handle/register
```

Key handlers:
- `chatHandlers.js` - VCP server communication, message streaming
- `agentHandlers.js` - Agent configuration, topic management
- `musicHandlers.js` - Music player control
- `canvasHandlers.js` - Canvas collaboration windows
- `groupChatHandlers.js` - Multi-agent group chat
- `sovitsHandlers.js` - GPT-SoVITS TTS integration

### VCP Protocol Integration

The client implements the VCP protocol for AI communication:

1. **Synchronous Tools**: Immediate return (calculations, queries)
2. **Asynchronous Tools**: Background execution with callbacks
3. **Base64/File API**: Direct Base64 embedding or file URL references
4. **Distributed Execution**: Via `VCPDistributedServer` for local plugins

### Plugin System (VCPDistributedServer)

Located in `VCPDistributedServer/Plugin.js`:

- **Plugin Types**: `sync`, `service`, `hybridservice`, `static`
- **Manifest**: Each plugin has `plugin-manifest.json`
- **Execution**: Spawns processes with environment from `config.env`
- **Registration**: Automatically registers tools to main VCP server

Special handling for:
- `MusicController` - Routes to main process music handlers
- `SuperDice` - Routes to dice handlers
- `Flowlock` - Routes to flowlock handlers
- `internal_request_file` - File serving across distributed nodes

### Data Storage Structure

```
AppData/
├── Agents/           # Agent configurations
├── UserData/         # Chat histories, attachments
├── settings.json     # Global settings
├── songlist.json     # Music playlist
├── canvas/           # Canvas cache
└── Notemodules/      # Notes storage
```

Chat history files use a differential rendering system - external edits are detected via file watching and synced to the UI in real-time.

### Message Rendering Pipeline

21 renderers including: Markdown, KaTeX, Mermaid, HTML, Python (Pyodide/WASM), Three.js, Anime.js, DIV, CSV, PDF, draw.io, etc.

Flow: `streamManager.js` → `contentProcessor.js` → `domBuilder.js` → `visibilityOptimizer.js`

### Critical Integration Points

1. **VCP Server**: Main AI backend (configured in settings)
2. **VCPLog**: WebSocket for real-time logs/notifications (`ws://host/VCPlog/VCP_Key=...`)
3. **Distributed Server**: Optional local plugin executor
4. **Audio Engine**: Rust server on port 63789

### Window Management

- Main window frame is custom (`frame: false`)
- Child windows tracked in `openChildWindows` array
- macOS-specific handling for window close (hide vs quit)
- System tray integration

### Python Integration

- Used for audio engine (now Rust, but Python scripts remain)
- Some VCP plugins are Python-based
- `execute-python-code` IPC handler for sandboxed execution

## Important Notes

- **File Watching**: The app uses `chokidar` to watch chat history files for external edits. Internal saves are marked to avoid feedback loops.
- **Theme System**: Themes are CSS files in `Themesmodules/` with per-theme bubble animations
- **Agent Uniqueness**: Each Agent has a unique ID and can have multiple independent topics
- **Group Chat**: Multiple agents can collaborate in one conversation with发言标记 (speaker markers)
- **Context Injection**: Compatible with SillyTavern presets, character cards, and world books
- **Flow Lock**: Mode that locks the UI for extended AI sessions with proactive AI behavior

## Settings Configuration

Key settings in `AppData/settings.json`:
- `vcpServerUrl`: VCP backend API endpoint
- `vcpApiKey`: API authentication key
- `vcpLogUrl`: VCPLog WebSocket URL
- `vcpLogKey`: VCPLog authentication key
- `enableDistributedServer`: Enable local plugin server
- `username`: Required for many features
- `currentThemeMode`: 'light' or 'dark'
