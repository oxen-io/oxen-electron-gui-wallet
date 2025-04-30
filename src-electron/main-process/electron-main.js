import { app, ipcMain, BrowserWindow, Menu, dialog } from "electron";
import { version, productName } from "../../package.json";
import { Backend } from "./modules/backend";
import { checkForUpdate } from "./auto-updater";
import menuTemplate from "./menu";
import isDev from "electron-is-dev";
const portscanner = require("portscanner");
const windowStateKeeper = require("electron-window-state");
const path = require("upath");

/**
 * Set `__statics` path to static files in production;
 * The reason we are setting it here is that the path needs to be evaluated at runtime
 */
if (process.env.PROD) {
  global.__statics = path.join(__dirname, "").replace(/\\/g, "\\\\");
  global.__ryo_bin = path.join(__dirname, "..", "bin").replace(/\\/g, "\\\\");
} else {
  global.__ryo_bin = path.join(process.cwd(), "bin").replace(/\\/g, "\\\\");
}

let mainWindow, backend;
let showConfirmClose = true;
let forceQuit = false;
let installUpdate = false;

const title = `${productName} v${version}`;

const selectionMenu = Menu.buildFromTemplate([
  { role: "copy" },
  { type: "separator" },
  { role: "selectall" }
]);

const inputMenu = Menu.buildFromTemplate([
  { role: "cut" },
  { role: "copy" },
  { role: "paste" },
  { type: "separator" },
  { role: "selectall" }
]);

function createWindow() {
  /**
   * Initial window options
   */

  let mainWindowState = windowStateKeeper({
    defaultWidth: 900,
    defaultHeight: 700
  });

  mainWindow = new BrowserWindow({
    x: mainWindowState.x,
    y: mainWindowState.y,
    width: mainWindowState.width,
    height: mainWindowState.height,
    minWidth: 640,
    minHeight: 480,
    icon: require("path").join(__statics, "icon.png"),
    title,
    webPreferences: {
      nodeIntegration: true,
      nodeIntegrationInWorker: true,
      // anything we want preloaded, e.g. global vars
      preload: path.resolve(__dirname, "electron-preload.js")
    }
  });

  mainWindow.on("close", e => {
    // Don't ask for confirmation if we're installing an update
    if (installUpdate) {
      return;
    }

    if (process.platform === "darwin") {
      if (forceQuit) {
        forceQuit = false;
        if (showConfirmClose) {
          e.preventDefault();
          mainWindow.show();
          mainWindow.webContents.send("confirmClose");
        } else {
          e.defaultPrevented = false;
        }
      } else {
        e.preventDefault();
        mainWindow.hide();
      }
    } else {
      if (showConfirmClose) {
        e.preventDefault();
        mainWindow.webContents.send("confirmClose");
      } else {
        e.defaultPrevented = false;
      }
    }
  });

  ipcMain.on("confirmClose", (e, restart) => {
    showConfirmClose = false;

    // In dev mode, this will launch a blank white screen
    if (restart && !isDev) app.relaunch();

    const promise = backend ? backend.quit() : Promise.resolve();
    promise.then(() => {
      backend = null;
      app.quit();
    });
  });

  mainWindow.webContents.on("did-finish-load", () => {
    // Set the title
    mainWindow.setTitle(title);

    require("crypto").randomBytes(64, (err, buffer) => {
      // if err, then we may have to use insecure token generation perhaps
      if (err) throw err;

      let config = {
        port: 12313,
        token: buffer.toString("hex")
      };

      portscanner.checkPortStatus(config.port, "127.0.0.1", (error, status) => {
        if (error) {
          console.error(error);
        }

        if (status === "closed") {
          backend = new Backend(mainWindow);
          backend.init(config);
          mainWindow.webContents.send("initialize", config);
        } else {
          dialog.showMessageBox(
            mainWindow,
            {
              title: "Startup error",
              message: `Oxen Wallet is already open, or port ${config.port} is in use`,
              type: "error",
              buttons: ["ok"]
            },
            () => {
              showConfirmClose = false;
              app.quit();
            }
          );
        }
      });
    });
  });

  mainWindow.webContents.on("context-menu", (e, props) => {
    const { selectionText, isEditable } = props;
    if (isEditable) {
      inputMenu.popup(mainWindow);
    } else if (selectionText && selectionText.trim() !== "") {
      selectionMenu.popup(mainWindow);
    }
  });

  mainWindow.loadURL(process.env.APP_URL);
  mainWindowState.manage(mainWindow);
}

app.on("ready", () => {
  checkForUpdate(
    () => mainWindow,
    autoUpdater => {
      if (mainWindow) {
        mainWindow.webContents.send("showQuitScreen");
      }

      const promise = backend ? backend.quit() : Promise.resolve();
      promise.then(() => {
        installUpdate = true;
        backend = null;
        autoUpdater.quitAndInstall();
      });
    }
  );
  if (process.platform === "darwin") {
    const menu = Menu.buildFromTemplate(menuTemplate);
    Menu.setApplicationMenu(menu);
  }
  createWindow();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("activate", () => {
  if (mainWindow === null) {
    createWindow();
  } else if (process.platform === "darwin") {
    mainWindow.show();
  }
});

app.on("before-quit", () => {
  // Quit instantly if we are installing an update
  if (installUpdate) {
    return;
  }

  if (process.platform === "darwin") {
    forceQuit = true;
  } else {
    if (backend) {
      backend.quit().then(() => {
        mainWindow.close();
      });
    }
  }
});

app.on("quit", () => {});
