const { app, BrowserWindow, session } = require('electron');

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    autoHideMenuBar: true,
    title: 'JARVIS',
  });
  win.loadURL('http://localhost:3000');
}

app.whenReady().then(() => {
  session.defaultSession.setPermissionRequestHandler((wc, permission, callback) => callback(true));
  createWindow();
});

app.on('window-all-closed', () => app.quit());
