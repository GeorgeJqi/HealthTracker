const { app, BrowserWindow } = require('electron');

function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    show: false,
    backgroundColor: '#090a10',
    title: 'HealthTracker',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  // Avoid a white flash before the dark UI has painted.
  win.once('ready-to-show', () => win.show());

  win.loadFile('index.html');
}

app.whenReady().then(createWindow);

// macOS keeps the app running with no windows; re-open on dock click.
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});