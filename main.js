// main.js - Electron Main Process
const { app, BrowserWindow, Menu, Tray, ipcMain, dialog, shell, globalShortcut, nativeTheme } = require('electron');
const path = require('path');
const fs = require('fs');
const SystemMonitor = require('./system-monitor.js');


// Keep global references
let mainWindow = null;
let tray = null;
let monitor = null;
let isQuitting = false;
let settingsWindow = null;

// App version
const APP_VERSION = '1.0.0';

// Default settings
const DEFAULT_SETTINGS = {
    updateInterval: 3000,
    startMinimized: false,
    minimizeToTray: true,
    startOnLogin: false,
    theme: 'system',
    notifications: {
        cpuCritical: true,
        memoryCritical: true,
        diskCritical: true
    }
};

// Load or create settings
function loadSettings() {
    const settingsPath = path.join(app.getPath('userData'), 'settings.json');
    
    try {
        if (fs.existsSync(settingsPath)) {
            const savedSettings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
            return { ...DEFAULT_SETTINGS, ...savedSettings };
        }
    } catch (error) {
        console.error('Error loading settings:', error);
    }
    
    return DEFAULT_SETTINGS;
}

// Save settings
function saveSettings(settings) {
    const settingsPath = path.join(app.getPath('userData'), 'settings.json');
    try {
        fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
    } catch (error) {
        console.error('Error saving settings:', error);
    }
}

// Settings
let settings = loadSettings();

// Create main window
function createWindow() {
    // Set theme
    if (settings.theme === 'dark') {
        nativeTheme.themeSource = 'dark';
    } else if (settings.theme === 'light') {
        nativeTheme.themeSource = 'light';
    } else {
        nativeTheme.themeSource = 'system';
    }
    
    // Create the browser window
    mainWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        minWidth: 800,
        minHeight: 600,
        icon: path.join(__dirname, 'assets/icon.png'),
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false,
            enableRemoteModule: true
        },
        frame: true,
        titleBarStyle: 'default',
        show: !settings.startMinimized,
        backgroundColor: nativeTheme.shouldUseDarkColors ? '#2b2d42' : '#f8f9fa'
    });
    
    // Load the local server URL
    if (process.env.NODE_ENV === 'development') {
    mainWindow.loadURL('http://localhost:3000');  // Untuk development
} else {
    mainWindow.loadFile('dashboard.html');  // Untuk production
}
    
    // Show window when ready
    mainWindow.once('ready-to-show', () => {
        if (!settings.startMinimized) {
            mainWindow.show();
        }
    });
    
    // Handle window closed
    mainWindow.on('closed', () => {
        mainWindow = null;
    });
    
    // Handle close event (minimize to tray)
    mainWindow.on('close', (event) => {
        if (!isQuitting && settings.minimizeToTray) {
            event.preventDefault();
            mainWindow.hide();
            return false;
        }
        return true;
    });
    
    // Open DevTools in development
    if (process.env.NODE_ENV === 'development') {
        mainWindow.webContents.openDevTools({ mode: 'detach' });
    }
    
    // Handle external links
    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
        if (url.startsWith('http://localhost:3000')) {
            return { action: 'allow' };
        }
        shell.openExternal(url);
        return { action: 'deny' };
    });
    
    // Send settings to renderer
    mainWindow.webContents.on('did-finish-load', () => {
        mainWindow.webContents.send('settings-updated', settings);
    });
    
    return mainWindow;
}

// Create system tray
function createTray() {
    const iconPath = process.platform === 'win32' 
        ? path.join(__dirname, 'assets', 'icon.ico')
        : path.join(__dirname, 'assets', 'icon.png');
    
    tray = new Tray(iconPath);
    tray.setToolTip('System Monitor Pro');
    
    const contextMenu = Menu.buildFromTemplate([
        {
            label: 'Show Dashboard',
            click: () => {
                if (mainWindow) {
                    mainWindow.show();
                    mainWindow.focus();
                }
            }
        },
        {
            label: 'Refresh Data',
            click: () => {
                if (mainWindow) {
                    mainWindow.webContents.send('manual-refresh');
                }
            }
        },
        { type: 'separator' },
        {
            label: 'Start Monitoring',
            type: 'checkbox',
            checked: monitor && monitor.isRunning,
            click: (item) => {
                if (monitor) {
                    if (item.checked) {
                        monitor.start();
                    } else {
                        monitor.stop();
                    }
                }
            }
        },
        { type: 'separator' },
        {
            label: 'Export Data',
            submenu: [
                {
                    label: 'Export as JSON',
                    click: () => {
                        if (monitor) {
                            const filePath = monitor.exportData('json');
                            if (filePath) {
                                dialog.showMessageBox({
                                    type: 'info',
                                    title: 'Data Exported',
                                    message: `Data exported successfully to:\n${filePath}`,
                                    buttons: ['OK', 'Open Folder']
                                }).then(({ response }) => {
                                    if (response === 1) {
                                        shell.showItemInFolder(filePath);
                                    }
                                });
                            }
                        }
                    }
                },
                {
                    label: 'Export as CSV',
                    click: () => {
                        if (monitor) {
                            const filePath = monitor.exportData('csv');
                            if (filePath) {
                                dialog.showMessageBox({
                                    type: 'info',
                                    title: 'Data Exported',
                                    message: `Data exported successfully to:\n${filePath}`,
                                    buttons: ['OK', 'Open Folder']
                                }).then(({ response }) => {
                                    if (response === 1) {
                                        shell.showItemInFolder(filePath);
                                    }
                                });
                            }
                        }
                    }
                }
            ]
        },
        { type: 'separator' },
        {
            label: 'Settings',
            click: showSettingsWindow
        },
        { type: 'separator' },
        {
            label: 'Quit',
            click: () => {
                isQuitting = true;
                app.quit();
            }
        }
    ]);
    
    tray.setContextMenu(contextMenu);
    
    tray.on('click', () => {
        if (mainWindow) {
            if (mainWindow.isVisible()) {
                mainWindow.hide();
            } else {
                mainWindow.show();
                mainWindow.focus();
            }
        }
    });
    
    return tray;
}

// Create application menu
function createMenu() {
    const template = [
        {
            label: 'File',
            submenu: [
                {
                    label: 'Refresh',
                    accelerator: 'CmdOrCtrl+R',
                    click: () => {
                        if (mainWindow) {
                            mainWindow.reload();
                        }
                    }
                },
                {
                    label: 'Export Data',
                    accelerator: 'CmdOrCtrl+E',
                    click: () => {
                        if (monitor) {
                            const filePath = monitor.exportData('json');
                            if (filePath) {
                                dialog.showMessageBox(mainWindow, {
                                    type: 'info',
                                    title: 'Export Successful',
                                    message: `Data exported to:\n${filePath}`,
                                    buttons: ['OK']
                                });
                            }
                        }
                    }
                },
                { type: 'separator' },
                {
                    label: 'Toggle Developer Tools',
                    accelerator: process.platform === 'darwin' ? 'Alt+Cmd+I' : 'Ctrl+Shift+I',
                    click: () => {
                        if (mainWindow) {
                            mainWindow.webContents.toggleDevTools();
                        }
                    }
                },
                { type: 'separator' },
                {
                    label: 'Exit',
                    accelerator: 'CmdOrCtrl+Q',
                    click: () => {
                        isQuitting = true;
                        app.quit();
                    }
                }
            ]
        },
        {
            label: 'View',
            submenu: [
                {
                    label: 'Reload',
                    accelerator: 'CmdOrCtrl+R',
                    role: 'reload'
                },
                {
                    label: 'Force Reload',
                    accelerator: 'Shift+CmdOrCtrl+R',
                    role: 'forceReload'
                },
                { type: 'separator' },
                {
                    label: 'Zoom In',
                    accelerator: 'CmdOrCtrl+=',
                    role: 'zoomIn'
                },
                {
                    label: 'Zoom Out',
                    accelerator: 'CmdOrCtrl+-',
                    role: 'zoomOut'
                },
                {
                    label: 'Reset Zoom',
                    accelerator: 'CmdOrCtrl+0',
                    role: 'resetZoom'
                },
                { type: 'separator' },
                {
                    label: 'Toggle Fullscreen',
                    accelerator: 'F11',
                    click: () => {
                        if (mainWindow) {
                            mainWindow.setFullScreen(!mainWindow.isFullScreen());
                        }
                    }
                },
                { type: 'separator' },
                {
                    label: 'Toggle Dark Mode',
                    accelerator: 'CmdOrCtrl+D',
                    click: () => {
                        if (nativeTheme.shouldUseDarkColors) {
                            nativeTheme.themeSource = 'light';
                        } else {
                            nativeTheme.themeSource = 'dark';
                        }
                        if (mainWindow) {
                            mainWindow.webContents.send('theme-changed', nativeTheme.shouldUseDarkColors);
                        }
                    }
                }
            ]
        },
        {
            label: 'Monitoring',
            submenu: [
                {
                    label: 'Start Monitoring',
                    accelerator: 'CmdOrCtrl+M',
                    click: () => {
                        if (monitor) {
                            monitor.start();
                            updateTrayMenu();
                        }
                    }
                },
                {
                    label: 'Stop Monitoring',
                    accelerator: 'CmdOrCtrl+Shift+M',
                    click: () => {
                        if (monitor) {
                            monitor.stop();
                            updateTrayMenu();
                        }
                    }
                },
                { type: 'separator' },
                {
                    label: 'Pause Updates',
                    accelerator: 'CmdOrCtrl+P',
                    type: 'checkbox',
                    checked: false,
                    click: (item) => {
                        if (mainWindow) {
                            mainWindow.webContents.send('toggle-pause-updates', item.checked);
                        }
                    }
                }
            ]
        },
        {
            label: 'Window',
            submenu: [
                {
                    label: 'Minimize',
                    accelerator: 'CmdOrCtrl+M',
                    role: 'minimize'
                },
                {
                    label: 'Zoom',
                    role: 'zoom'
                },
                { type: 'separator' },
                {
                    label: 'Bring All to Front',
                    role: 'front'
                }
            ]
        },
        {
            label: 'Help',
            submenu: [
                {
                    label: 'Documentation',
                    click: () => {
                        shell.openExternal('https://github.com/domoy77/system-monitor-pro-desktop');
                    }
                },
                { type: 'separator' },
                {
                    label: 'Report Issue',
                    click: () => {
                        shell.openExternal('https://github.com/domoy77/system-monitor-pro-desktop/issues');
                    }
                },
                { type: 'separator' },
                {
                    label: `About System Monitor Pro v${APP_VERSION}`,
                    click: showAboutWindow
                }
            ]
        }
    ];
    
    if (process.platform === 'darwin') {
        template.unshift({
            label: app.name,
            submenu: [
                { role: 'about' },
                { type: 'separator' },
                { role: 'services' },
                { type: 'separator' },
                { role: 'hide' },
                { role: 'hideOthers' },
                { role: 'unhide' },
                { type: 'separator' },
                { role: 'quit' }
            ]
        });
    }
    
    const menu = Menu.buildFromTemplate(template);
    Menu.setApplicationMenu(menu);
    
    return menu;
}

// Show about window
function showAboutWindow() {
    const aboutWindow = new BrowserWindow({
        width: 400,
        height: 450,
        parent: mainWindow,
        modal: true,
        resizable: false,
        minimizable: false,
        maximizable: false,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false
        }
    });
    
    aboutWindow.loadURL(`data:text/html;charset=utf-8,
        <html>
            <head>
                <style>
                    body {
                        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                        margin: 0;
                        padding: 30px;
                        background: ${nativeTheme.shouldUseDarkColors ? '#2b2d42' : '#f8f9fa'};
                        color: ${nativeTheme.shouldUseDarkColors ? '#fff' : '#333'};
                        text-align: center;
                    }
                    .logo {
                        width: 100px;
                        height: 100px;
                        margin: 0 auto 20px;
                        background: linear-gradient(135deg, #4361ee, #3a0ca3);
                        border-radius: 20px;
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        font-size: 40px;
                        color: white;
                    }
                    h1 {
                        margin: 0 0 10px;
                        color: #4361ee;
                    }
                    .version {
                        color: #6c757d;
                        margin-bottom: 20px;
                    }
                    .info {
                        text-align: left;
                        margin: 20px 0;
                        padding: 15px;
                        background: ${nativeTheme.shouldUseDarkColors ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.05)'};
                        border-radius: 10px;
                    }
                    .button {
                        display: inline-block;
                        padding: 10px 20px;
                        margin: 5px;
                        background: #4361ee;
                        color: white;
                        border: none;
                        border-radius: 5px;
                        cursor: pointer;
                        text-decoration: none;
                    }
                </style>
            </head>
            <body>
                <div class="logo">🔧</div>
                <h1>System Monitor Pro</h1>
                <div class="version">Version ${APP_VERSION}</div>
                <div class="info">
                    <p><strong>Professional Desktop System Monitoring</strong></p>
                    <p>• Real-time CPU, Memory, Disk monitoring</p>
                    <p>• Network traffic analysis</p>
                    <p>• Process management</p>
                    <p>• Data export capabilities</p>
                </div>
                <p>© 2024 Domoy. All rights reserved.</p>
                <button class="button" onclick="closeWindow()">Close</button>
                <script>
                    function closeWindow() {
                        require('electron').ipcRenderer.send('close-about');
                    }
                </script>
            </body>
        </html>
    `);
    
    ipcMain.once('close-about', () => {
        aboutWindow.close();
    });
}

// Show settings window
function showSettingsWindow() {
    if (settingsWindow) {
        settingsWindow.focus();
        return;
    }
    
    settingsWindow = new BrowserWindow({
        width: 600,
        height: 700,
        parent: mainWindow,
        modal: true,
        resizable: false,
        minimizable: false,
        maximizable: false,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false
        }
    });
    
    settingsWindow.loadURL(`data:text/html;charset=utf-8,
        <html>
            <head>
                <style>
                    body {
                        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                        margin: 0;
                        padding: 30px;
                        background: ${nativeTheme.shouldUseDarkColors ? '#2b2d42' : '#f8f9fa'};
                        color: ${nativeTheme.shouldUseDarkColors ? '#fff' : '#333'};
                    }
                    h1 {
                        color: #4361ee;
                        margin-bottom: 30px;
                        text-align: center;
                    }
                    .section {
                        background: ${nativeTheme.shouldUseDarkColors ? 'rgba(255,255,255,0.1)' : '#fff'};
                        padding: 20px;
                        margin-bottom: 20px;
                        border-radius: 10px;
                        box-shadow: 0 2px 10px rgba(0,0,0,0.1);
                    }
                    .section h2 {
                        margin-top: 0;
                        color: #4361ee;
                        font-size: 18px;
                    }
                    .setting {
                        display: flex;
                        justify-content: space-between;
                        align-items: center;
                        margin: 15px 0;
                        padding: 10px 0;
                        border-bottom: 1px solid ${nativeTheme.shouldUseDarkColors ? 'rgba(255,255,255,0.1)' : '#eee'};
                    }
                    select, input[type="number"] {
                        padding: 8px;
                        border-radius: 5px;
                        border: 1px solid #ddd;
                        background: ${nativeTheme.shouldUseDarkColors ? '#2b2d42' : '#fff'};
                        color: ${nativeTheme.shouldUseDarkColors ? '#fff' : '#333'};
                    }
                    .buttons {
                        text-align: center;
                        margin-top: 30px;
                    }
                    button {
                        padding: 10px 25px;
                        margin: 0 10px;
                        border: none;
                        border-radius: 5px;
                        cursor: pointer;
                        font-weight: bold;
                    }
                    .save {
                        background: #4361ee;
                        color: white;
                    }
                    .cancel {
                        background: #6c757d;
                        color: white;
                    }
                </style>
            </head>
            <body>
                <h1>⚙️ Settings</h1>
                
                <div class="section">
                    <h2>Monitoring</h2>
                    <div class="setting">
                        <span>Update Interval (ms):</span>
                        <input type="number" id="updateInterval" value="${settings.updateInterval}" min="1000" max="10000" step="1000">
                    </div>
                </div>
                
                <div class="section">
                    <h2>Application Behavior</h2>
                    <div class="setting">
                        <span>Start Minimized:</span>
                        <input type="checkbox" id="startMinimized" ${settings.startMinimized ? 'checked' : ''}>
                    </div>
                    <div class="setting">
                        <span>Minimize to Tray:</span>
                        <input type="checkbox" id="minimizeToTray" ${settings.minimizeToTray ? 'checked' : ''}>
                    </div>
                    <div class="setting">
                        <span>Start on Login:</span>
                        <input type="checkbox" id="startOnLogin">
                    </div>
                </div>
                
                <div class="section">
                    <h2>Appearance</h2>
                    <div class="setting">
                        <span>Theme:</span>
                        <select id="theme">
                            <option value="system" ${settings.theme === 'system' ? 'selected' : ''}>System Default</option>
                            <option value="light" ${settings.theme === 'light' ? 'selected' : ''}>Light</option>
                            <option value="dark" ${settings.theme === 'dark' ? 'selected' : ''}>Dark</option>
                        </select>
                    </div>
                </div>
                
                <div class="section">
                    <h2>Notifications</h2>
                    <div class="setting">
                        <span>CPU Critical Alert:</span>
                        <input type="checkbox" id="cpuCritical" ${settings.notifications.cpuCritical ? 'checked' : ''}>
                    </div>
                    <div class="setting">
                        <span>Memory Critical Alert:</span>
                        <input type="checkbox" id="memoryCritical" ${settings.notifications.memoryCritical ? 'checked' : ''}>
                    </div>
                    <div class="setting">
                        <span>Disk Critical Alert:</span>
                        <input type="checkbox" id="diskCritical" ${settings.notifications.diskCritical ? 'checked' : ''}>
                    </div>
                </div>
                
                <div class="buttons">
                    <button class="save" onclick="saveSettings()">💾 Save Settings</button>
                    <button class="cancel" onclick="closeWindow()">❌ Cancel</button>
                </div>
                
                <script>
                    function saveSettings() {
                        const newSettings = {
                            updateInterval: parseInt(document.getElementById('updateInterval').value),
                            startMinimized: document.getElementById('startMinimized').checked,
                            minimizeToTray: document.getElementById('minimizeToTray').checked,
                            startOnLogin: document.getElementById('startOnLogin').checked,
                            theme: document.getElementById('theme').value,
                            notifications: {
                                cpuCritical: document.getElementById('cpuCritical').checked,
                                memoryCritical: document.getElementById('memoryCritical').checked,
                                diskCritical: document.getElementById('diskCritical').checked
                            }
                        };
                        
                        require('electron').ipcRenderer.send('save-settings', newSettings);
                        closeWindow();
                    }
                    
                    function closeWindow() {
                        require('electron').ipcRenderer.send('close-settings');
                    }
                </script>
            </body>
        </html>
    `);
    
    ipcMain.once('close-settings', () => {
        settingsWindow.close();
        settingsWindow = null;
    });
}

// Update tray menu
function updateTrayMenu() {
    if (tray) {
        createTray(); // Recreate tray menu
    }
}

// Initialize monitoring server
function startMonitorServer() {
    console.log('🚀 Starting System Monitor Pro Desktop...');
    
    // Initialize monitor with settings
    monitor = new SystemMonitor({
        updateInterval: settings.updateInterval
    });
    
    // Start monitoring
    monitor.start();
    
    // Listen for data updates and send to renderer
    monitor.addListener((data) => {
        if (mainWindow) {
            mainWindow.webContents.send('system-data-update', data);
        }
        
        // Check for critical conditions and show notifications
        checkCriticalConditions(data);
    });
    
    console.log('✅ Monitoring server initialized');
    
    return monitor;
}

// Check for critical conditions
function checkCriticalConditions(data) {
    if (!settings.notifications) return;
    
    const cpuLoad = parseFloat(data.cpu?.load) || 0;
    const memoryUsage = parseFloat(data.memory?.usage) || 0;
    const diskUsage = parseFloat(data.disk?.usage) || 0;
    
    if (settings.notifications.cpuCritical && cpuLoad > 90) {
        showNotification('CPU Critical', `CPU usage is at ${cpuLoad.toFixed(1)}%`);
    }
    
    if (settings.notifications.memoryCritical && memoryUsage > 90) {
        showNotification('Memory Critical', `Memory usage is at ${memoryUsage.toFixed(1)}%`);
    }
    
    if (settings.notifications.diskCritical && diskUsage > 95) {
        showNotification('Disk Critical', `Disk usage is at ${diskUsage.toFixed(1)}%`);
    }
}

// Show notification
function showNotification(title, body) {
    if (process.platform === 'win32' || process.platform === 'darwin') {
        const { Notification } = require('electron');
        new Notification({ title, body }).show();
    }
}

// Register global shortcuts
function registerShortcuts() {
    try {
        globalShortcut.register('CommandOrControl+Shift+D', () => {
            if (mainWindow) {
                if (mainWindow.isVisible()) {
                    mainWindow.hide();
                } else {
                    mainWindow.show();
                    mainWindow.focus();
                }
            }
        });
        
        globalShortcut.register('CommandOrControl+Shift+R', () => {
            if (monitor) {
                if (monitor.isRunning) {
                    monitor.stop();
                } else {
                    monitor.start();
                }
                updateTrayMenu();
            }
        });
        
        console.log('✅ Global shortcuts registered');
    } catch (error) {
        console.error('Error registering shortcuts:', error);
    }
}

// Unregister shortcuts
function unregisterShortcuts() {
    globalShortcut.unregisterAll();
}

// App lifecycle
app.whenReady().then(() => {
    console.log('🚀 App is ready');
    
    // Load settings
    settings = loadSettings();
    
    // Start monitoring server
    startMonitorServer();
    
    // Create window
    createWindow();
    
    // Create tray and menu
    createTray();
    createMenu();
    
    // Register shortcuts
    registerShortcuts();
    
    // IPC handlers
    setupIPCHandlers();
    
    console.log('✅ System Monitor Pro Desktop is running');
    
    // Auto-start monitoring
    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
});

// Quit when all windows are closed
app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

// Before quit
app.on('before-quit', () => {
    isQuitting = true;
});

// On quit
app.on('will-quit', () => {
    // Stop monitoring
    if (monitor) {
        monitor.stop();
    }
    
    // Unregister shortcuts
    unregisterShortcuts();
    
    console.log('👋 App is quitting...');
});

// Setup IPC handlers
function setupIPCHandlers() {
    // Handle settings save
    ipcMain.on('save-settings', (event, newSettings) => {
        settings = { ...settings, ...newSettings };
        saveSettings(settings);
        
// Window controls
ipcMain.on('window-minimize', (event) => {
    if (mainWindow) mainWindow.minimize();
});

ipcMain.on('window-maximize', (event) => {
    if (mainWindow) {
        if (mainWindow.isMaximized()) {
            mainWindow.unmaximize();
        } else {
            mainWindow.maximize();
        }
    }
});

ipcMain.on('window-close', (event) => {
    if (mainWindow) mainWindow.close();
});

// Screenshot
ipcMain.on('take-screenshot', async (event) => {
    if (mainWindow) {
        const screenshot = await mainWindow.capturePage();
        const buffer = screenshot.toPNG();
        const filePath = path.join(app.getPath('pictures'), 
            `screenshot-${Date.now()}.png`);
        
        fs.writeFile(filePath, buffer, (err) => {
            if (!err) {
                event.reply('screenshot-saved', filePath);
                dialog.showMessageBox({
                    type: 'info',
                    title: 'Screenshot Saved',
                    message: `Screenshot saved to:\n${filePath}`
                });
            }
        });
    }
});

// Open folders
ipcMain.on('open-logs-folder', (event) => {
    const logPath = path.join(app.getPath('userData'), 'logs');
    shell.openPath(logPath);
});

ipcMain.on('open-data-folder', (event) => {
    const dataPath = path.join(app.getPath('userData'), 'data');
    shell.openPath(dataPath);
});

// Open devtools
ipcMain.on('open-devtools', (event) => {
    if (mainWindow) mainWindow.webContents.openDevTools();
});

// Reload app
ipcMain.on('reload-app', (event) => {
    if (mainWindow) mainWindow.reload();
});

// Show about
ipcMain.on('show-about', (event) => {
    showAboutWindow();
});

// Show settings
ipcMain.on('show-settings', (event) => {
    showSettingsWindow();
});
        
        // Update monitor interval if changed
        if (monitor && settings.updateInterval !== monitor.config.updateInterval) {
            monitor.config.updateInterval = settings.updateInterval;
            if (monitor.isRunning) {
                monitor.stop();
                monitor.start();
            }
        }
        
        // Update main window
        if (mainWindow) {
            mainWindow.webContents.send('settings-updated', settings);
        }
    });
    
    // Get current data
    ipcMain.on('get-current-data', (event) => {
        if (monitor && monitor.data) {
            event.reply('current-data-response', monitor.data);
        }
    });
    
    // Get monitor status
    ipcMain.on('get-monitor-status', (event) => {
        if (monitor) {
            event.reply('monitor-status-response', monitor.getStatus());
        }
    });
    
    // Start/stop monitoring
    ipcMain.on('toggle-monitoring', (event) => {
        if (monitor) {
            if (monitor.isRunning) {
                monitor.stop();
            } else {
                monitor.start();
            }
            updateTrayMenu();
            event.reply('monitoring-toggled', monitor.isRunning);
        }
    });
    
    // Export data
    ipcMain.on('export-data', (event, format) => {
        if (monitor) {
            const filePath = monitor.exportData(format);
            event.reply('data-exported', filePath);
        }
    });
}
