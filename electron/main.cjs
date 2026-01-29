const { app, BrowserWindow, Menu } = require('electron');
const path = require('path');
const fs = require('fs');

let mainWindow;

const createWindow = () => {
  // Create the browser window with optimal settings for M1 Mac
  mainWindow = new BrowserWindow({
    width: 1800,
    height: 1200,
    minWidth: 1200,
    minHeight: 800,
    backgroundColor: '#000000',
    title: 'SYSTEM ALPHA',
    titleBarStyle: 'hiddenInset', // macOS native look
    trafficLightPosition: { x: 16, y: 16 },
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      // Enable Web Workers with increased memory
      webviewTag: false,
      enableWebSQL: false,
      // Performance optimizations for M1
      backgroundThrottling: false,
      // Increase memory limits (2GB per process)
      v8CacheOptions: 'code',
    },
  });

  // Increase memory limit for better performance
  app.commandLine.appendSwitch('js-flags', '--max-old-space-size=8192');
  app.commandLine.appendSwitch('disable-renderer-backgrounding');
  app.commandLine.appendSwitch('disable-background-timer-throttling');

  // Load the app
  const isDev = !app.isPackaged;
  
  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  // Create application menu
  const template = [
    {
      label: 'System Alpha',
      submenu: [
        { role: 'about', label: 'About System Alpha' },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit', label: 'Quit System Alpha' }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo', label: 'Undo' },
        { role: 'redo', label: 'Redo' },
        { type: 'separator' },
        { role: 'cut', label: 'Cut' },
        { role: 'copy', label: 'Copy' },
        { role: 'paste', label: 'Paste' },
        { role: 'selectAll', label: 'Select All' }
      ]
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload', label: 'Reload' },
        { role: 'forceReload', label: 'Force Reload' },
        { type: 'separator' },
        { role: 'resetZoom', label: 'Actual Size' },
        { role: 'zoomIn', label: 'Zoom In' },
        { role: 'zoomOut', label: 'Zoom Out' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: 'Toggle Full Screen' }
      ]
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize', label: 'Minimize' },
        { role: 'zoom', label: 'Zoom' },
        { type: 'separator' },
        { role: 'front', label: 'Bring All to Front' }
      ]
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'System Alpha Documentation',
          click: async () => {
            const { shell } = require('electron');
            await shell.openExternal('https://github.com/yourusername/system-alpha');
          }
        },
        { type: 'separator' },
        {
          label: 'Open DevTools',
          accelerator: 'CmdOrCtrl+Shift+I',
          click: () => mainWindow.webContents.toggleDevTools()
        }
      ]
    }
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);

  // Optimize garbage collection
  setInterval(() => {
    if (global.gc) {
      global.gc();
    }
  }, 60000); // Every minute

  // Handle window close
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Prevent navigation away from app
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith('http://localhost') && !url.startsWith('file://')) {
      event.preventDefault();
    }
  });

  // Log memory usage in dev mode
  if (isDev) {
    setInterval(() => {
      const mem = process.memoryUsage();
      console.log(`Memory: RSS=${(mem.rss / 1024 / 1024).toFixed(2)}MB, Heap=${(mem.heapUsed / 1024 / 1024).toFixed(2)}MB/${(mem.heapTotal / 1024 / 1024).toFixed(2)}MB`);
    }, 10000);
  }
};

// App lifecycle
app.on('ready', () => {
  // Enable hardware acceleration for M1
  app.commandLine.appendSwitch('enable-features', 'VaapiVideoDecoder');
  
  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

