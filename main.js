// main.js - Electron 主窗口
//简单修改，测试推送！

const sharp = require('sharp'); // 确保在文件顶部引入

const { app, BrowserWindow, ipcMain, nativeTheme, globalShortcut, screen, clipboard, shell, dialog, protocol } = require('electron'); // Added screen, clipboard, and shell
// selection-hook is now managed in assistantHandlers
const path = require('path');
const crypto = require('crypto');
const fs = require('fs-extra'); // Using fs-extra for convenience
const os = require('os');
const { spawn } = require('child_process'); // For executing local python
const { Worker } = require('worker_threads');
const express = require('express'); // For the dice server
const WebSocket = require('ws'); // For VCPLog notifications
const fileManager = require('./modules/fileManager'); // Import the new file manager
const groupChat = require('./Groupmodules/groupchat'); // Import the group chat module
const DistributedServer = require('./VCPDistributedServer/VCPDistributedServer.js'); // Import the new distributed server
const windowHandlers = require('./modules/ipc/windowHandlers'); // Import window IPC handlers
const settingsHandlers = require('./modules/ipc/settingsHandlers'); // Import settings IPC handlers
const fileDialogHandlers = require('./modules/ipc/fileDialogHandlers'); // Import file dialog handlers
const { getAgentConfigById, ...agentHandlers } = require('./modules/ipc/agentHandlers'); // Import agent handlers
const regexHandlers = require('./modules/ipc/regexHandlers'); // Import regex handlers
const chatHandlers = require('./modules/ipc/chatHandlers'); // Import chat handlers
const groupChatHandlers = require('./modules/ipc/groupChatHandlers'); // Import group chat handlers
const sovitsHandlers = require('./modules/ipc/sovitsHandlers'); // Import SovitsTTS IPC handlers
const notesHandlers = require('./modules/ipc/notesHandlers'); // Import notes handlers
const assistantHandlers = require('./modules/ipc/assistantHandlers'); // Import assistant handlers
const musicHandlers = require('./modules/ipc/musicHandlers'); // Import music handlers
const diceHandlers = require('./modules/ipc/diceHandlers'); // Import dice handlers
const themeHandlers = require('./modules/ipc/themeHandlers'); // Import theme handlers
const emoticonHandlers = require('./modules/ipc/emoticonHandlers'); // Import emoticon handlers
const musicMetadata = require('music-metadata');
const speechRecognizer = require('./modules/speechRecognizer'); // Import the new speech recognizer
const canvasHandlers = require('./modules/ipc/canvasHandlers'); // Import canvas handlers
const chokidar = require('chokidar'); // 引入 chokidar
 
 // --- File Watcher ---
let historyWatcher = null;
let isInternalSaveExpected = false; // A one-shot flag to signal an internal save is happening.
let internalSaveTimeout = null; // 🔧 新增：超时保护
let isEditingInProgress = false; // 🔧 新增：编辑状态标识

const fileWatcher = {
  watchFile: (filePath, callback) => {
    if (historyWatcher) {
      historyWatcher.close();
    }
    console.log(`[FileWatcher] Watching new file: ${filePath}`);
    historyWatcher = chokidar.watch(filePath, {
        persistent: true,
        ignoreInitial: true,
        awaitWriteFinish: {
            stabilityThreshold: 300, // 🔧 增加稳定性阈值
            pollInterval: 100
        }
    });
    historyWatcher.on('all', (event, path) => {
      // 🔧 改进：检查多个条件来决定是否忽略事件
      if (isInternalSaveExpected || isEditingInProgress) {
        console.log(`[FileWatcher] Ignored ${isInternalSaveExpected ? 'internal save' : 'editing'} event '${event}' for: ${path}`);
        if (isInternalSaveExpected) {
          isInternalSaveExpected = false; // Consume the one-shot flag
        }
        return;
      }
      console.log(`[FileWatcher] Detected external event '${event}' for: ${path}`);
      callback(path);
    });
    historyWatcher.on('error', error => console.error(`[FileWatcher] Error: ${error}`));
  },
  stopWatching: () => {
    if (historyWatcher) {
      console.log('[FileWatcher] Stopping file watch.');
      historyWatcher.close();
      historyWatcher = null;
    }
    // 🔧 清理状态
    isEditingInProgress = false;
    if (internalSaveTimeout) {
      clearTimeout(internalSaveTimeout);
      internalSaveTimeout = null;
    }
  },
  signalInternalSave: () => {
    isInternalSaveExpected = true;
    // 🔧 设置超时保护，防止标志永远不被重置
    if (internalSaveTimeout) clearTimeout(internalSaveTimeout);
    internalSaveTimeout = setTimeout(() => {
      isInternalSaveExpected = false;
      console.log('[FileWatcher] Internal save flag auto-reset due to timeout');
    }, 5000); // 5秒超时
  },
  // 🔧 新增：编辑状态管理
  setEditingMode: (editing) => {
    isEditingInProgress = editing;
    console.log(`[FileWatcher] Editing mode set to: ${editing}`);
  }
};
 // --- Configuration Paths ---
// Data storage will be within the project's 'AppData' directory
const PROJECT_ROOT = __dirname; // __dirname is the directory of main.js
const APP_DATA_ROOT_IN_PROJECT = path.join(PROJECT_ROOT, 'AppData');

const AGENT_DIR = path.join(APP_DATA_ROOT_IN_PROJECT, 'Agents');
const USER_DATA_DIR = path.join(APP_DATA_ROOT_IN_PROJECT, 'UserData'); // For chat histories and attachments
const SETTINGS_FILE = path.join(APP_DATA_ROOT_IN_PROJECT, 'settings.json');
const USER_AVATAR_FILE = path.join(USER_DATA_DIR, 'user_avatar.png'); // Standardized user avatar file
const MUSIC_PLAYLIST_FILE = path.join(APP_DATA_ROOT_IN_PROJECT, 'songlist.json');
const MUSIC_COVER_CACHE_DIR = path.join(APP_DATA_ROOT_IN_PROJECT, 'MusicCoverCache');
const NETWORK_NOTES_CACHE_FILE = path.join(APP_DATA_ROOT_IN_PROJECT, 'network-notes-cache.json'); // Cache for network notes
const WALLPAPER_THUMBNAIL_CACHE_DIR = path.join(APP_DATA_ROOT_IN_PROJECT, 'WallpaperThumbnailCache');
const RESAMPLE_CACHE_DIR = path.join(APP_DATA_ROOT_IN_PROJECT, 'ResampleCache');
const CANVAS_CACHE_DIR = path.join(APP_DATA_ROOT_IN_PROJECT, 'canvas'); // Canvas cache directory

// Define a specific agent ID for notes attachments
const NOTES_AGENT_ID = 'notes_attachments_agent';

let audioEngineProcess = null; // To hold the python audio engine process
let mainWindow;
let vcpLogWebSocket;
let vcpLogReconnectInterval;
let openChildWindows = [];
let distributedServer = null; // To hold the distributed server instance
let translatorWindow = null; // To hold the single instance of the translator window
let networkNotesTreeCache = null; // In-memory cache for the network notes
let cachedModels = []; // Cache for models fetched from VCP server
const NOTES_MODULE_DIR = path.join(APP_DATA_ROOT_IN_PROJECT, 'Notemodules');

// --- Audio Engine Management ---
function startAudioEngine() {
    return new Promise((resolve, reject) => {
        // --- Uniqueness Check ---
        if (audioEngineProcess && !audioEngineProcess.killed) {
            console.log('[Main] Audio Engine process is already running.');
            resolve(); // Already running, so we can consider it "ready"
            return;
        }

        const scriptPath = path.join(__dirname, 'audio_engine', 'main.py');
        console.log(`[Main] Starting Python Audio Engine from: ${scriptPath}`);

        const args = ['-u', scriptPath, '--resample-cache-dir', RESAMPLE_CACHE_DIR];
        audioEngineProcess = spawn('python', args);

        const readyTimeout = setTimeout(() => {
            console.error('[Main] Audio Engine failed to start within 15 seconds.');
            reject(new Error('Audio Engine timed out.'));
        }, 15000); // 15-second timeout

        audioEngineProcess.stdout.on('data', (data) => {
            const output = data.toString().trim();
            console.log(`[AudioEngine STDOUT]: ${output}`);
            // Check for our ready signal
            if (output.includes('FLASK_SERVER_READY')) {
                console.log('[Main] Audio Engine is ready.');
                clearTimeout(readyTimeout);
                resolve();
            }
        });

        audioEngineProcess.stderr.on('data', (data) => {
            const logLine = data.toString().trim();
            if (logLine && !logLine.includes('GET /state HTTP/1.1') && !logLine.includes('AudioEngine STDERR')) {
                console.error(`[AudioEngine STDERR]: ${logLine}`);
            }
        });

        audioEngineProcess.on('close', (code) => {
            console.log(`[Main] Audio Engine process exited with code ${code}`);
            audioEngineProcess = null;
        });

        audioEngineProcess.on('error', (err) => {
            console.error('[Main] Failed to start Audio Engine process.', err);
            clearTimeout(readyTimeout);
            reject(err);
        });
    });
}

function stopAudioEngine() {
    if (audioEngineProcess && !audioEngineProcess.killed) {
        console.log('[Main] Stopping Python Audio Engine...');
        // Send a termination signal. The 'close' event handler on the process
        // will handle setting audioEngineProcess to null. This prevents a race condition.
        audioEngineProcess.kill();
    }
}


// --- Main Window Creation ---
function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        minWidth: 900,
        minHeight: 600,
        frame: false, // 移除原生窗口框架
        titleBarStyle: 'hidden', // 隐藏标题栏
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,    // 恢复: 开启上下文隔离
            nodeIntegration: false,  // 恢复: 关闭Node.js集成在渲染进程
            spellcheck: true, // Enable spellcheck for input fields
        },
        icon: path.join(__dirname, 'assets', 'icon.png'), // Add an icon
        title: 'VCP AI 聊天客户端',
        show: false, // Don't show until ready
    });

    mainWindow.loadFile('main.html');

    // 当主窗口关闭时，退出整个应用程序
    // 这将触发 'will-quit' 事件，用于执行所有清理操作
    mainWindow.on('closed', () => {
        console.log('[Main] Main window closed, quitting application.');
        app.quit();
    });

    mainWindow.once('ready-to-show', () => {
        mainWindow.show();
    });

    mainWindow.setMenu(null); // 移除应用程序菜单栏

    // Set theme source to 'system' by default. The renderer will send the saved preference on launch.
    nativeTheme.themeSource = 'system';

    // Listen for window events to notify renderer
    mainWindow.on('maximize', () => {
        if (mainWindow && mainWindow.webContents && !mainWindow.webContents.isDestroyed()) {
            mainWindow.webContents.send('window-maximized');
        }
    });
    mainWindow.on('unmaximize', () => {
        if (mainWindow && mainWindow.webContents && !mainWindow.webContents.isDestroyed()) {
            mainWindow.webContents.send('window-unmaximized');
        }
    });

    // Listen for theme changes and notify all relevant windows
}

// --- App Lifecycle ---
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', (event, commandLine, workingDirectory) => {
    // 有人试图运行第二个实例，我们应该聚焦于我们的窗口
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });





  app.whenReady().then(async () => { // Make the function async
    // Pre-warm the audio engine in the background. This doesn't block the main window.
    startAudioEngine().catch(err => {
        console.error('[Main] Failed to pre-warm audio engine on startup:', err);
        // We don't need to show a dialog here, as it will be handled when the
        // music window is actually opened.
    });
    // Register a custom protocol to handle loading local app files securely.
    fs.ensureDirSync(APP_DATA_ROOT_IN_PROJECT); // Ensure the main AppData directory in project exists
    fs.ensureDirSync(AGENT_DIR);
    fs.ensureDirSync(USER_DATA_DIR);
    fs.ensureDirSync(MUSIC_COVER_CACHE_DIR);
    fs.ensureDirSync(WALLPAPER_THUMBNAIL_CACHE_DIR); // Ensure the thumbnail cache directory exists
    fs.ensureDirSync(RESAMPLE_CACHE_DIR); // Ensure the resample cache directory exists
    fs.ensureDirSync(CANVAS_CACHE_DIR); // Ensure the canvas cache directory exists
    fileManager.initializeFileManager(USER_DATA_DIR, AGENT_DIR); // Initialize FileManager
    groupChat.initializePaths({ APP_DATA_ROOT_IN_PROJECT, AGENT_DIR, USER_DATA_DIR, SETTINGS_FILE }); // Initialize GroupChat paths

    const SettingsManager = require('./modules/utils/settingsManager');
    const AgentConfigManager = require('./modules/utils/agentConfigManager');
    const settingsManager = new SettingsManager(SETTINGS_FILE);
    const agentConfigManager = new AgentConfigManager(AGENT_DIR);
    
    settingsManager.startCleanupTimer();
    settingsManager.startAutoBackup(USER_DATA_DIR); // Start auto backup
    agentConfigManager.startCleanupTimer(); // Start agent config cleanup

    settingsHandlers.initialize({ SETTINGS_FILE, USER_AVATAR_FILE, AGENT_DIR, settingsManager, agentConfigManager }); // Initialize settings handlers

   // Function to fetch and cache models from the VCP server
   async function fetchAndCacheModels() {
       try {
           const settings = await settingsManager.readSettings();
           const vcpServerUrl = settings.vcpServerUrl;
           const vcpApiKey = settings.vcpApiKey; // Get the API key

           if (!vcpServerUrl) {
               console.warn('[Main] VCP Server URL is not configured. Cannot fetch models.');
               cachedModels = []; // Clear cache if URL is not set
               return;
           }
           // Correctly construct the base URL by removing known API paths.
           const urlObject = new URL(vcpServerUrl);
           const baseUrl = `${urlObject.protocol}//${urlObject.host}`;
           const modelsUrl = new URL('/v1/models', baseUrl).toString();

           console.log(`[Main] Fetching models from: ${modelsUrl}`);
           const response = await fetch(modelsUrl, {
               headers: {
                   'Authorization': `Bearer ${vcpApiKey}` // Add the Authorization header
               }
           });
           if (!response.ok) {
               throw new Error(`HTTP error! status: ${response.status}`);
           }
           const data = await response.json();
           cachedModels = data.data || []; // Assuming the response has a 'data' field containing the models array
           console.log('[Main] Models fetched and cached successfully:', cachedModels.map(m => m.id));
       } catch (error) {
           console.error('[Main] Failed to fetch and cache models:', error);
           cachedModels = []; // Clear cache on error
       }
   }

   // Fetch models on app startup
   await fetchAndCacheModels();

   // IPC handler to provide cached models to the renderer process
   ipcMain.handle('get-cached-models', () => {
       return cachedModels;
   });

   // IPC handler to trigger a refresh of the model list
   ipcMain.on('refresh-models', async () => {
       console.log('[Main] Received refresh-models request. Re-fetching models...');
       await fetchAndCacheModels();
       // Optionally, notify the renderer that models have been updated
       if (mainWindow && !mainWindow.isDestroyed()) {
           mainWindow.webContents.send('models-updated', cachedModels);
       }
   });


    // Add IPC handler for path operations
    ipcMain.handle('path:dirname', (event, p) => {
        return path.dirname(p);
    });
    // Add IPC handler for getting the extension name of a path
    ipcMain.handle('path:extname', (event, p) => {
        return path.extname(p);
    });
    ipcMain.handle('path:basename', (event, p) => {
        return path.basename(p);
    });


    // Group Chat IPC Handlers are now in modules/ipc/groupChatHandlers.js
    notesHandlers.initialize({
       openChildWindows,
       APP_DATA_ROOT_IN_PROJECT,
       SETTINGS_FILE
    });
 
    // Translator IPC Handlers
    const TRANSLATOR_DIR = path.join(APP_DATA_ROOT_IN_PROJECT, 'Translatormodules');
    fs.ensureDirSync(TRANSLATOR_DIR); // Ensure the Translator directory exists

    ipcMain.handle('open-translator-window', async (event) => {
        if (translatorWindow && !translatorWindow.isDestroyed()) {
            translatorWindow.focus();
            return;
        }
        translatorWindow = new BrowserWindow({
            width: 1000,
            height: 700,
            minWidth: 800,
            minHeight: 600,
            title: '翻译',
            frame: false, // 移除原生窗口框架
            titleBarStyle: 'hidden', // 隐藏标题栏
            modal: false,
            webPreferences: {
                preload: path.join(__dirname, 'preload.js'),
                contextIsolation: true,
                nodeIntegration: false,
                devTools: true
            },
            icon: path.join(__dirname, 'assets', 'icon.png'),
            show: false
        });

        let settings = {};
        try {
            if (await fs.pathExists(SETTINGS_FILE)) {
                settings = await fs.readJson(SETTINGS_FILE);
            }
        } catch (readError) {
            console.error('Failed to read settings file for translator window:', readError);
        }

        const vcpServerUrl = settings.vcpServerUrl || '';
        const vcpApiKey = settings.vcpApiKey || '';

        const translatorUrl = `file://${path.join(__dirname, 'Translatormodules', 'translator.html')}?vcpServerUrl=${encodeURIComponent(vcpServerUrl)}&vcpApiKey=${encodeURIComponent(vcpApiKey)}`;
        console.log(`[Main Process] Attempting to load URL in translator window: ${translatorUrl.substring(0, 200)}...`);
        
        translatorWindow.webContents.on('did-start-loading', () => {
            console.log(`[Main Process] translatorWindow webContents did-start-loading for URL: ${translatorUrl.substring(0, 200)}`);
        });

        translatorWindow.webContents.on('dom-ready', () => {
            console.log(`[Main Process] translatorWindow webContents dom-ready for URL: ${translatorWindow.webContents.getURL()}`);
        });

        translatorWindow.webContents.on('did-finish-load', () => {
            console.log(`[Main Process] translatorWindow webContents did-finish-load for URL: ${translatorWindow.webContents.getURL()}`);
        });

        translatorWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL) => {
            console.error(`[Main Process] translatorWindow webContents did-fail-load: Code ${errorCode}, Desc: ${errorDescription}, URL: ${validatedURL}`);
        });

        translatorWindow.loadURL(translatorUrl)
            .then(() => {
                console.log(`[Main Process] translatorWindow successfully initiated URL loading (loadURL resolved): ${translatorUrl.substring(0, 200)}`);
            })
            .catch((err) => {
                console.error(`[Main Process] translatorWindow FAILED to initiate URL loading (loadURL rejected): ${translatorUrl.substring(0, 200)}`, err);
            });

        openChildWindows.push(translatorWindow);
        translatorWindow.setMenu(null);

        translatorWindow.once('ready-to-show', () => {
            console.log(`[Main Process] translatorWindow is ready-to-show. Window Title: "${translatorWindow.getTitle()}". Calling show().`);
            translatorWindow.show();
            console.log('[Main Process] translatorWindow show() called.');
        });

        translatorWindow.on('closed', () => {
            console.log('[Main Process] translatorWindow has been closed.');
            openChildWindows = openChildWindows.filter(win => win !== translatorWindow);
            translatorWindow = null;
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.focus(); // 聚焦主窗口
            }
        });
    });

    createWindow();
    windowHandlers.initialize(mainWindow, openChildWindows);
    assistantHandlers.initialize({ SETTINGS_FILE });
    fileDialogHandlers.initialize(mainWindow, {
        getSelectionListenerStatus: assistantHandlers.getSelectionListenerStatus,
        stopSelectionListener: assistantHandlers.stopSelectionListener,
        startSelectionListener: assistantHandlers.startSelectionListener,
        openChildWindows
    });
    groupChatHandlers.initialize(mainWindow, {
        AGENT_DIR,
        USER_DATA_DIR,
        getSelectionListenerStatus: assistantHandlers.getSelectionListenerStatus,
        stopSelectionListener: assistantHandlers.stopSelectionListener,
        startSelectionListener: assistantHandlers.startSelectionListener,
        fileWatcher // Inject fileWatcher here as well
    });
    agentHandlers.initialize({
        AGENT_DIR,
        USER_DATA_DIR,
        SETTINGS_FILE,
        USER_AVATAR_FILE,
        getSelectionListenerStatus: assistantHandlers.getSelectionListenerStatus,
        stopSelectionListener: assistantHandlers.stopSelectionListener,
        startSelectionListener: assistantHandlers.startSelectionListener,
        settingsManager,
        agentConfigManager
    });
    regexHandlers.initialize({ AGENT_DIR });
    chatHandlers.initialize(mainWindow, {
        AGENT_DIR,
        USER_DATA_DIR,
        APP_DATA_ROOT_IN_PROJECT,
        NOTES_AGENT_ID,
        getSelectionListenerStatus: assistantHandlers.getSelectionListenerStatus,
        stopSelectionListener: assistantHandlers.stopSelectionListener,
        startSelectionListener: assistantHandlers.startSelectionListener,
        getMusicState: musicHandlers.getMusicState,
        fileWatcher, // 注入文件监控器
        agentConfigManager
    });

    // New dedicated watcher IPC handlers
    ipcMain.handle('watcher:start', (event, filePath, agentId, topicId) => {
        if (fileWatcher) {
            fileWatcher.watchFile(filePath, (changedPath) => {
                if (mainWindow && !mainWindow.isDestroyed()) {
                    // Pass back the agentId and topicId to the renderer for context
                    mainWindow.webContents.send('history-file-updated', { path: changedPath, agentId, topicId });
                }
            });
            return { success: true, watching: filePath };
        }
        return { success: false, error: 'File watcher not initialized.' };
    });

    ipcMain.handle('watcher:stop', () => {
        if (fileWatcher) {
            fileWatcher.stopWatching();
            return { success: true };
        }
        return { success: false, error: 'File watcher not initialized.' };
    });
    sovitsHandlers.initialize(mainWindow); // Initialize SovitsTTS handlers
    musicHandlers.initialize({ mainWindow, openChildWindows, APP_DATA_ROOT_IN_PROJECT, startAudioEngine, stopAudioEngine });
    diceHandlers.initialize({ projectRoot: PROJECT_ROOT });
    themeHandlers.initialize({ mainWindow, openChildWindows, projectRoot: PROJECT_ROOT, APP_DATA_ROOT_IN_PROJECT, settingsManager: settingsManager });
    emoticonHandlers.initialize({ SETTINGS_FILE, APP_DATA_ROOT_IN_PROJECT });
    emoticonHandlers.setupEmoticonHandlers();
    canvasHandlers.initialize({ mainWindow, openChildWindows, CANVAS_CACHE_DIR });
 
     // --- Distributed Server Initialization ---
     (async () => {
        try {
            const settings = await settingsManager.readSettings();
            if (settings.enableDistributedServer) {
                console.log('[Main] Distributed server is enabled. Initializing...');
                const config = {
                    mainServerUrl: settings.vcpLogUrl, // Assuming the distributed server connects to the same base URL as VCPLog
                    vcpKey: settings.vcpLogKey,
                    serverName: 'VCP-Desktop-Client-Distributed-Server',
                    debugMode: true, // Or read from settings if you add this option
                    rendererProcess: mainWindow.webContents, // Pass the renderer process object
                    handleMusicControl: musicHandlers.handleMusicControl, // Inject the music control handler
                    handleDiceControl: diceHandlers.handleDiceControl, // Inject the dice control handler
                    handleMusicControl: musicHandlers.handleMusicControl, // Inject the music control handler
                    handleDiceControl: diceHandlers.handleDiceControl, // Inject the dice control handler
                    handleCanvasControl: handleCanvasControl // Inject the new canvas control handler
                };
                distributedServer = new DistributedServer(config);
                distributedServer.initialize();
            } else {
                console.log('[Main] Distributed server is disabled in settings.');
            }
        } catch (error) {
            console.error('[Main] Failed to read settings or initialize distributed server:', error);
        }
    })();
    // --- End of Distributed Server Initialization ---

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });

    globalShortcut.register('Control+Shift+I', () => {
        const focusedWindow = BrowserWindow.getFocusedWindow();
        if (focusedWindow && focusedWindow.webContents && !focusedWindow.webContents.isDestroyed()) {
            focusedWindow.webContents.toggleDevTools();
        }
    });
    
    // --- Music Player IPC Handlers are now in modules/ipc/musicHandlers.js ---


   // --- Assistant IPC Handlers are now in modules/ipc/assistantHandlers.js ---

    // --- Theme IPC Handlers are now in modules/ipc/themeHandlers.js ---
});

    // --- Python Execution IPC Handler ---
    ipcMain.handle('execute-python-code', (event, code) => {
        return new Promise((resolve) => {
            // Use '-u' for unbuffered output and set PYTHONIOENCODING for proper UTF-8 handling
            const pythonProcess = spawn('python', ['-u'], {
                env: { ...process.env, PYTHONIOENCODING: 'UTF-8' },
                maxBuffer: 10 * 1024 * 1024 // Increase buffer to 10MB
            });

            let stdout = '';
            let stderr = '';

            pythonProcess.stdout.on('data', (data) => {
                stdout += data.toString();
            });

            pythonProcess.stderr.on('data', (data) => {
                stderr += data.toString();
            });

            pythonProcess.on('close', (exitCode) => {
                console.log(`Python process exited with code ${exitCode}`);
                console.log('Python stdout:', stdout); // Log full stdout
                console.log('Python stderr:', stderr); // Log full stderr
                resolve({ stdout, stderr });
            });

            pythonProcess.on('error', (err) => {
                console.error('Failed to start Python process:', err);
                // Resolve with an error message in stderr, so the frontend can display it
                resolve({ stdout: '', stderr: `Failed to start python process. Please ensure Python is installed and accessible in your system's PATH. Error: ${err.message}` });
            });

            // Write the code to the process's standard input and close it
            pythonProcess.stdin.write(code);
            pythonProcess.stdin.end();
        });
    });

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('will-quit', () => {
    // 1. 停止所有底层监听器
    console.log('[Main] App is quitting. Stopping all listeners...');
    assistantHandlers.stopSelectionListener();
    assistantHandlers.stopMouseListener();

    // 2. 注销所有全局快捷键
    globalShortcut.unregisterAll();
    console.log('[Main] All global shortcuts unregistered.');

    // 3. Stop the speech recognizer
    speechRecognizer.shutdown(); // Use the new shutdown function to close the browser

    // 4. 关闭WebSocket连接
    if (vcpLogWebSocket && vcpLogWebSocket.readyState === WebSocket.OPEN) {
        vcpLogWebSocket.close();
    }
    if (vcpLogReconnectInterval) {
        clearTimeout(vcpLogReconnectInterval);
    }
    
    // 5. Stop the distributed server
    if (distributedServer) {
        console.log('[Main] Stopping distributed server...');
        distributedServer.stop();
        distributedServer = null;
    }
    
    // 6. Stop the dice server
    diceHandlers.stopDiceServer();

    // 7. Stop the Python Audio Engine
    stopAudioEngine();

    // 8. 强制销毁所有窗口
    console.log('[Main] Destroying all open windows...');
    BrowserWindow.getAllWindows().forEach(win => {
        if (win && !win.isDestroyed()) {
            win.destroy();
        }
    });
});

// --- Helper Functions ---

function formatTimestampForFilename(timestamp) {
    const date = new Date(timestamp);
    const year = date.getFullYear();
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const day = date.getDate().toString().padStart(2, '0');
    const hours = date.getHours().toString().padStart(2, '0');
    const minutes = date.getMinutes().toString().padStart(2, '0');
    const seconds = date.getSeconds().toString().padStart(2, '0');
    return `${year}${month}${day}_${hours}${minutes}${seconds}`;
}

// --- IPC Handlers ---
// open-external-link handler is now in modules/ipc/fileDialogHandlers.js

// The getAgentConfigById helper function has been moved to agentHandlers.js

// VCP Server Communication is now handled in modules/ipc/chatHandlers.js

// VCPLog WebSocket Connection
function connectVcpLog(wsUrl, wsKey) {
    if (!wsUrl || !wsKey) {
        if (mainWindow) mainWindow.webContents.send('vcp-log-status', { source: 'VCPLog', status: 'error', message: 'URL或KEY未配置。' });
        return;
    }

    const fullWsUrl = `${wsUrl}/VCPlog/VCP_Key=${wsKey}`; 
    
    if (vcpLogWebSocket && (vcpLogWebSocket.readyState === WebSocket.OPEN || vcpLogWebSocket.readyState === WebSocket.CONNECTING)) {
        console.log('VCPLog WebSocket 已连接或正在连接。');
        return;
    }

    console.log(`尝试连接 VCPLog WebSocket: ${fullWsUrl}`);
    if (mainWindow) mainWindow.webContents.send('vcp-log-status', { source: 'VCPLog', status: 'connecting', message: '连接中...' });

    vcpLogWebSocket = new WebSocket(fullWsUrl);

    vcpLogWebSocket.onopen = () => {
        console.log('[MAIN_VCP_LOG] WebSocket onopen event triggered.'); 
        if (mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents && !mainWindow.webContents.isDestroyed()) {
            console.log('[MAIN_VCP_LOG] Attempting to send vcp-log-status "open" to renderer.'); 
            mainWindow.webContents.send('vcp-log-status', { source: 'VCPLog', status: 'open', message: '已连接' });
            console.log('[MAIN_VCP_LOG] vcp-log-status "open" sent.');
            mainWindow.webContents.send('vcp-log-message', { type: 'connection_ack', message: 'VCPLog 连接成功！' });
        } else {
            console.error('[MAIN_VCP_LOG] mainWindow or webContents not available in onopen. Cannot send status.');
        }
        if (vcpLogReconnectInterval) {
            clearTimeout(vcpLogReconnectInterval); // Corrected: Use clearTimeout for setTimeout
            vcpLogReconnectInterval = null;
        }
    };

    vcpLogWebSocket.onmessage = (event) => {
        console.log('VCPLog 收到消息:', event.data);
        try {
            const data = JSON.parse(event.data.toString()); 
            if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('vcp-log-message', data);
        } catch (e) {
            console.error('VCPLog 解析消息失败:', e);
            if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('vcp-log-message', { type: 'error', data: `收到无法解析的消息: ${event.data.toString().substring(0,100)}...` });
        }
    };

    vcpLogWebSocket.onclose = (event) => {
        console.log('VCPLog WebSocket 连接已关闭:', event.code, event.reason);
        if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('vcp-log-status', { source: 'VCPLog', status: 'closed', message: `连接已断开 (${event.code})` });
        if (!vcpLogReconnectInterval && wsUrl && wsKey) {
            console.log('将在5秒后尝试重连 VCPLog...');
            vcpLogReconnectInterval = setTimeout(() => {
                vcpLogReconnectInterval = null;
                connectVcpLog(wsUrl, wsKey);
            }, 5000);
        }
    };

    vcpLogWebSocket.onerror = (error) => {
        console.error('[MAIN_VCP_LOG] WebSocket onerror event:', error.message); 
        if (mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents && !mainWindow.webContents.isDestroyed()) {
            mainWindow.webContents.send('vcp-log-status', { source: 'VCPLog', status: 'error', message: '连接错误' });
        } else {
            console.error('[MAIN_VCP_LOG] mainWindow or webContents not available in onerror.'); 
        }
    };
}

ipcMain.on('connect-vcplog', (event, { url, key }) => {
    if (vcpLogWebSocket && vcpLogWebSocket.readyState === WebSocket.OPEN) {
        vcpLogWebSocket.close(); 
    }
    if (vcpLogReconnectInterval) {
        clearTimeout(vcpLogReconnectInterval);
        vcpLogReconnectInterval = null;
    }
    connectVcpLog(url, key);
});

ipcMain.on('disconnect-vcplog', () => {
    if (vcpLogWebSocket && vcpLogWebSocket.readyState === WebSocket.OPEN) {
        vcpLogWebSocket.close();
    }
    if (vcpLogReconnectInterval) {
        clearTimeout(vcpLogReconnectInterval);
        vcpLogReconnectInterval = null;
    }
    if (mainWindow) mainWindow.webContents.send('vcp-log-status', { source: 'VCPLog', status: 'closed', message: '已手动断开' });
    console.log('VCPLog 已手动断开');
});
}
// --- Voice Chat IPC Handler ---
ipcMain.on('open-voice-chat-window', (event, { agentId }) => {
    const voiceChatWindow = new BrowserWindow({
        width: 500,
        height: 700,
        minWidth: 400,
        minHeight: 500,
        frame: false,
        titleBarStyle: 'hidden', // Add this to hide the title bar on some OS
        title: '语音聊天',
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
        },
        parent: mainWindow,
        modal: false, // Set to false to allow interaction with main window
        show: false,
    });

    voiceChatWindow.loadFile(path.join(__dirname, 'Voicechatmodules/voicechat.html'));
    
    voiceChatWindow.once('ready-to-show', () => {
        const theme = nativeTheme.shouldUseDarkColors ? 'dark' : 'light';
        voiceChatWindow.show();
        voiceChatWindow.webContents.send('voice-chat-data', { agentId, theme });
    });

    openChildWindows.push(voiceChatWindow);

    voiceChatWindow.on('closed', () => {
        openChildWindows = openChildWindows.filter(win => win !== voiceChatWindow);
        // Ensure speech recognition is stopped when the window is closed
        speechRecognizer.stop();
    });
});

// --- Speech Recognition IPC Handlers ---
ipcMain.on('start-speech-recognition', (event) => {
    const voiceChatWindow = openChildWindows.find(win => win.webContents === event.sender);
    if (!voiceChatWindow) return;

    speechRecognizer.start((text) => {
        if (voiceChatWindow && !voiceChatWindow.isDestroyed()) {
            voiceChatWindow.webContents.send('speech-recognition-result', text);
        }
    });
});

ipcMain.on('stop-speech-recognition', () => {
    speechRecognizer.stop();
});

ipcMain.handle('export-topic-as-markdown', async (event, exportData) => {
    const { topicName, markdownContent } = exportData;

    if (!topicName || !markdownContent) {
        return { success: false, error: '缺少导出所需的必要信息（话题名称或内容）。' };
    }

    // 1. Show Save Dialog
    const safeTopicName = topicName.replace(/[/\\?%*:|"<>]/g, '-');
    const defaultFileName = `${safeTopicName}-${formatTimestampForFilename(Date.now())}.md`;
    const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
        title: '导出话题为 Markdown',
        defaultPath: defaultFileName,
        filters: [
            { name: 'Markdown 文件', extensions: ['md'] },
            { name: '所有文件', extensions: ['*'] }
        ]
    });
    
    if (canceled || !filePath) {
        return { success: false, error: '用户取消了导出操作。' };
    }

    // 2. Write to File
    try {
        await fs.writeFile(filePath, markdownContent, 'utf8');
        shell.showItemInFolder(filePath); // Open the folder containing the file
        return { success: true, path: filePath };
    } catch (e) {
        console.error(`[Export] 写入Markdown文件失败:`, e);
        return { success: false, error: `写入文件失败: ${e.message}` };
    }
});

// --- Canvas Control Handler (for Distributed Server) ---
async function handleCanvasControl(filePath) {
    try {
        if (!filePath) {
            throw new Error('No filePath provided for canvas control.');
        }

        // The updated createCanvasWindow now handles both opening the window
        // and loading the specific file, or focusing and loading if already open.
        await canvasHandlers.createCanvasWindow(filePath);

        return { status: 'success', message: 'Canvas window command processed.' };
    } catch (error) {
        console.error('[Main] handleCanvasControl error:', error);
        return { status: 'error', message: error.message };
    }
}
