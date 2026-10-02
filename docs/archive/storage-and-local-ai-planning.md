# Historical storage and local AI planning

Archived from TODO.md on 2026-10-02 to preserve the original design notes.
This is an earlier planning draft, not the current implementation status or a
validated installation guide. The local-LLM code, model choices, API examples,
hardware claims and packaging advice have not been validated for NOVA.
Use [the current backlog](../../TODO.md) for open work and [README.md](../../README.md)
for supported app setup. The original text follows unchanged.

---

# Open TODOs, issues and ideas

## Future work / ideas

- License under MIT and obtain an application signing certificate.
- Establish a GitHub build pipeline with a SignPath Foundation code-signing certificate.

### Local offline project storage and assistant context

**Status:** Implementation is in progress on `feature/sqlite-agent-context`. JSON remains supported for compatibility. The goal is one SQLite `.nova` database as the active local project, with the CLI as the agent-facing storage boundary. SQLite WAL permits concurrent readers and one writer at a time; competing writes must serialize or return a clear conflict.

Use one SQLite database per project as authoritative local storage and retain JSON as portable import/export. CortexaDB is a local retrieval engine, not an agent context manager or LLM. Its `add` inserts unconditionally and it does not deduplicate or update existing knowledge. Its vector search and outgoing-edge expansion do not supply NOVA's persistent research instructions, global duplicate checks, category-aware context packing, or map-writing policy. Use CortexaDB as a design reference, not a direct dependency. Start with SQLite FTS5 and deterministic graph retrieval; consider local embeddings only if measured recall requires them. References: [CortexaDB](https://github.com/anaslimem/CortexaDB), [SQLite WAL](https://www.sqlite.org/wal.html), [SQLite-Memory](https://github.com/sqliteai/sqlite-memory), and [mcp-memory-sqlite](https://github.com/spences10/mcp-memory-sqlite).

#### Implemented in the current branch

- Added a versioned SQLite `.nova` schema with normalized node hierarchy, ordered semantic links, project context, view state, unknown node-field preservation, foreign keys, WAL, a busy timeout, and FTS5 indexes.
- Routed shared project read/write/create and mutation APIs through `.nova` while retaining schema-7 JSON support. CLI mutations compare the current document under a write lock and apply transactional row-level changes. GUI snapshot saves remain transactional and reject stale revisions.
- Added `migrate`, `import`, `export`, and `migration-status`. Schema-7 JSON imports directly; schema-6 JSON is upgraded in memory without rewriting the source. Migration preserves existing node IDs and map state, refuses an existing destination, and leaves the source intact. Export refuses overwrite unless `--overwrite` is passed.
- Added desktop File > Import JSON and File > Export JSON flows. Normal Open/New/Save As dialogs are restricted to `.nova`; startup offers migration for a remembered legacy JSON path and automatically prefers an existing sibling `.nova` database. Import errors show the schema or validation failure.
- Added FTS5 candidate ranking for `.nova` `search` and `context`, retaining global exact ID and normalized-title checks, category indexes, hierarchy/link neighborhood, mandatory project guidance, and explicit context-pack truncation. `context --scope all` includes the complete map when it fits its budget. Token sizing remains an approximate character-based estimate.
- Wired Electron open/new/save, remembered project paths, SQLite external-change polling, and assistant document access to the shared project API. The renderer still sends full-document snapshots, but SQLite now diffs them under the write lock and persists only changed node/link/context/view rows. Loading and IPC still reconstruct/send the full graph.
- Updated `AGENTS.md` with `.nova` support, migration workflow, agent retrieval/write policy, and the rule against direct database access. Agent guidance avoids adding emoji, while project validation preserves Unicode text supplied by users.

#### Remaining implementation and review

1. **Reduce renderer transfer and read costs.** Replace full-document load/IPC where beneficial with focused reads while preserving graph rendering, undo/redo, view state, cross-links, and stale-write behavior. SQLite writes now apply diffs; confirm connections close cleanly and document transient WAL sidecars.
2. **Complete migration safeguards.** Add a non-mutating dry-run report with source and destination counts, IDs, hierarchy, and link verification. Improve interrupted-import recovery and backup/restore guidance. Migration must continue to leave the source JSON unchanged and refuse an existing destination.
3. **Audit CLI semantics.** Keep `id` as a documented non-reserving UUID candidate for scripts, while preferring `create` because it returns the persisted ID. Document `list` as compact navigation and `get` as subtree retrieval. `export` provides the portable backup workflow; add a separate backup command only if it has a distinct need. Keep delete explicit and all commands headless with JSON output and nonzero errors.
4. **Improve retrieval efficiency and quality.** Avoid loading the entire graph for bounded `.nova` queries; retrieve candidates, ancestors, descendants, and inbound/outbound links through indexed queries. Exact global IDs and normalized titles must remain visible even under a category filter. Consider a configured tokenizer and local semantic retrieval only after measuring recall on realistic maps. Category selection is a starting point, not a boundary.
5. **Document packaged runtime compatibility.** Confirm `node:sqlite` and FTS5 in the packaged Electron and CLI runtime without native addon packaging. Document `.nova` location, migration/export, JSON compatibility, backup/restore, WAL sidecars, and conflict behavior. Keep initialized project-local `AGENTS.md` synchronized with the canonical file.
6. **Verify before release.** Check import/export fidelity, Unicode preservation, control-character constraints, duplicate retrieval, context truncation, concurrent GUI/CLI access, migration failure handling, and packaged CLI access. Add regression tests for these cases when verification is authorized.

#### Paper-method task workflow

Read `AGENTS.md` and mandatory project guidance first. Identify the paper by DOI/title/authors; search globally for the source, method, and aliases; retrieve likely source, method, implementation, and decision nodes; check repository code separately; and inspect linked experiment/result/finding records. Report whether NOVA has a matching paper or method, what is implemented or attempted, what was evaluated, and where evidence is recorded. A map miss is not global novelty. Reuse stable IDs, distinguish source/method/implementation/results, link across categories, and record experiments/results only when performed. Ask only when paper identity or scope uncertainty would change the work.


# Local AI

# 🚀 Step-by-Step Integration Guide: Local LLM in Node.js & Electron (Windows)

This guide provides a production-ready blueprint to embed a Large Language Model (LLM) directly into your Electron desktop application for Windows. The model runs 100% locally on the user's machine, completely offline, with automatic CPU/GPU acceleration.

---

## 📋 Architecture Overview

Electron splits its workload into two main parts:
1. **Main Process (Backend/Node.js):** Has full access to native system resources, file systems, and C++ bindings. **The LLM must run here** so it doesn't freeze your user interface.
2. **Renderer Process (Frontend/UI):** Handles the HTML/CSS/JavaScript interface. It communicates safely with the Backend via Inter-Process Communication (IPC).

---

## 🛠️ Phase 1: Dependencies & Model Setup

### 1. Install Node Packages
Run the following command in your Electron project directory to install the native wrapper for the C++ inference engine (`llama.cpp`):

```bash
npm install node-llama-cpp
```

### 2. Choose and Download a Model
Local models must be in the optimized `.gguf` format. For general desktop deployment, you need a balanced model that works fast even on computers without an expensive graphics card.

* **Recommended:** **`Qwen2.5-1.5B-Instruct-Q4_K_M.gguf`** (approx. 1.2 GB).
* **Alternative:** **`Llama-3-8B-Instruct-Q4_K_M.gguf`** (approx. 4.8 GB, requires more RAM/VRAM but offers higher intelligence).
* **Setup:** Create a new folder named `models/` inside your project root directory and paste the downloaded `.gguf` file there.

---

## 💻 Phase 2: Core Code Implementation

### 1. The Backend Backend (`main.js` / `index.js`)
This script initializes the model in system memory and establishes a listener for incoming user prompts from the frontend.

```javascript
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');

// Keep variables global so the model stays loaded in memory between prompts
let getLlama, LlamaModel, LlamaContext, LlamaChatSession;
let chatSession = null;

async function initLLM() {
    try {
        // Dynamic import required because node-llama-cpp uses ES Modules (ESM)
        const mod = await import("node-llama-cpp");
        getLlama = mod.getLlama;
        LlamaModel = mod.LlamaModel;
        LlamaContext = mod.LlamaContext;
        LlamaChatSession = mod.LlamaChatSession;

        // 1. Initialize the core llama engine
        const llama = await getLlama();
        
        // 2. Define the path to your GGUF file
        const modelPath = path.join(__dirname, 'models', 'qwen2.5-1.5b-instruct-q4_k_m.gguf');

        // 3. Load the model parameters
        const model = new LlamaModel({ llama, modelPath });
        
        // 4. Set the Context Window (4096 is optimal for RAM efficiency)
        const context = new LlamaContext({ 
            model, 
            contextSize: 4096 
        });

        // 5. Create a managed chat session (handles conversational history automatically)
        chatSession = new LlamaChatSession({ context });
        console.log("🤖 Local LLM successfully initialized and ready!");
    } catch (error) {
        console.error("❌ Failed to initialize LLM:", error);
    }
}

function createWindow() {
    const win = new BrowserWindow({
        width: 900,
        height: 700,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'), // Secure IPC bridge
            contextIsolation: true,
            nodeIntegration: false
        }
    });

    win.loadFile('index.html');
}

// Boot up the LLM before opening the UI window
app.whenReady().then(async () => {
    await initLLM();
    createWindow();
});

// Listen for text prompts sent from the frontend UI
ipcMain.handle('send-to-llm', async (event, userPrompt) => {
    if (!chatSession) {
        return { success: false, error: "Model is still loading or failed to initialize." };
    }
    try {
        // Generate response synchronously (waits until full text is generated)
        const response = await chatSession.prompt(userPrompt);
        return { success: true, text: response };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});
```

### 2. The Secure Bridge (`preload.js`)
Exposes a safe, isolated API pathway to let the frontend send messages to the backend without risking full system access vulnerabilities.

```javascript
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    askAI: (prompt) => ipcRenderer.invoke('send-to-llm', prompt)
});
```

### 3. The Frontend Interface UI (`renderer.js`)
Handles your application layout interactions (triggers when clicking a button or pressing enter).

```javascript
const sendBtn = document.getElementById('send-btn');
const inputField = document.getElementById('user-input');
const responseArea = document.getElementById('chat-output');

sendBtn.addEventListener('click', async () => {
    const prompt = inputField.value.trim();
    if (!prompt) return;

    responseArea.innerText = "Thinking...";
    inputField.value = ""; // Clear input field
    
    // Call the safe exposed bridge API
    const result = await window.electronAPI.askAI(prompt);
    
    if (result.success) {
        responseArea.innerText = result.text;
    } else {
        responseArea.innerText = "Error: " + result.error;
    }
});
```

---

## ⚡ Phase 3: Hardware Acceleration & Context Rules

* **Zero-Config Hardware Switching:** `node-llama-cpp` compiles pre-built Windows binaries. During execution, it checks the computer hardware automatically:
  1. **NVIDIA CUDA GPU detected:** Offloads the mathematical weights onto VRAM for lightning-fast speeds.
  2. **Standard Integrated GPU/CPU:** Utilizes modern CPU instruction sets like `AVX2` or `AVX512` to deliver the best possible performance on normal laptops.
* **Smart Memory Eviction:** The `LlamaChatSession` wrapper actively monitors your `contextSize` limit (4096 tokens). If your chat conversation grows too long, the system will seamlessly discard the oldest historical dialogue exchanges to prevent the Electron app from running out of memory or crashing.

---

## 📦 Phase 4: Production Packaging (Windows)

When compiling your application using `electron-builder` for production distribution, configure these absolute rules inside your **`package.json`**:

### 1. Protect the ASAR Archive (`extraFiles`)
Electron automatically compresses app files into a monolithic `.asar` archive file. Storing a 1.2+ GB model file inside the ASAR will result in terrible app startup delays. Always exclude it using `extraFiles`:

```json
"build": {
  "appId": "com.yourcompany.localai",
  "win": {
    "target": ["nsis"]
  },
  "extraFiles": [
    {
      "from": "models/",
      "to": "models/",
      "filter": ["**/*"]
    }
  ]
}
```

### 2. Rebuild Native Addons
Because you are loading native C++ code directly into Node.js, run this utility once before building the installer executable to sync architecture formats:

```bash
npm install --save-dev @electron/rebuild
npx electron-rebuild
```
