import { app, BrowserWindow, ipcMain, shell, nativeImage } from "electron";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";
import { autoUpdater } from "electron-updater";
import { META_DIRECTORY } from "./utils/const";

import { installGame } from "./utils/game/install";
import { checkGameInstallation } from "./utils/game/check";
import { launchGame } from "./utils/game/launch";
import { connectRPC } from "./utils/discord";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

process.env.APP_ROOT = path.join(__dirname, "..");

// autoUpdater config
autoUpdater.setFeedURL({
  owner: "vZylev",
  repo: "Butter-Launcher",
  provider: "github",
});

autoUpdater.autoDownload = true;
autoUpdater.autoInstallOnAppQuit = true;
autoUpdater.autoRunAppAfterInstall = true;
autoUpdater.forceDevUpdateConfig = false;

app.on("ready", () => {
  app.setAppUserModelId("com.butter.launcher");
  autoUpdater.checkForUpdatesAndNotify();
});

export const VITE_DEV_SERVER_URL = process.env["VITE_DEV_SERVER_URL"];
export const MAIN_DIST = path.join(process.env.APP_ROOT, "dist-electron");
export const RENDERER_DIST = path.join(process.env.APP_ROOT, "dist");

process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL
  ? path.join(process.env.APP_ROOT, "public")
  : RENDERER_DIST;

let win: BrowserWindow | null = null;

function resolveAppIcon() {
  const iconFile =
    process.platform === "win32" ? "icon.ico" : "icon.png";

  const candidates = [
    // Dev (repo)
    path.join(process.env.APP_ROOT, "src", "assets", iconFile),
    // If you later copy icons into dist/public
    path.join(process.env.APP_ROOT, "dist", iconFile),
    path.join(process.env.APP_ROOT, "public", iconFile),
    // Vite public (set to public/ in dev, dist/ in prod)
    path.join(process.env.VITE_PUBLIC, iconFile),
  ];

  const foundPath = candidates.find((p) => {
    try {
      return !!p && fs.existsSync(p);
    } catch {
      return false;
    }
  });

  return foundPath ? nativeImage.createFromPath(foundPath) : undefined;
}

function createWindow() {
  const icon = resolveAppIcon();

  win = new BrowserWindow({
    width: 1026,
    height: 640,
    frame: false,
    titleBarStyle: "hidden",
    resizable: false,
    backgroundColor: "#00000000",
    ...(icon ? { icon } : {}),
    webPreferences: {
      preload: path.join(__dirname, "preload.mjs"),
    },
  });

  win.on("ready-to-show", () => {
    connectRPC();
  });

  if (VITE_DEV_SERVER_URL) {
    win.loadURL(VITE_DEV_SERVER_URL);
  } else {
    win.loadFile(path.join(RENDERER_DIST, "index.html"));
  }
}

app.whenReady().then(() => {
  createWindow();

  if (!VITE_DEV_SERVER_URL) {
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
    win = null;
  }
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

ipcMain.on("minimize-window", () => {
  win?.minimize();
});

ipcMain.on("close-window", () => {
  win?.close();
});

ipcMain.handle("fetch:json", async (_, url, ...args) => {
  const response = await fetch(url, ...args);
  return await response.json();
});
ipcMain.handle("fetch:head", async (_, url, ...args) => {
  const response = await fetch(url, ...args);
  return response.status;
});

ipcMain.handle("get-default-game-directory", () => {
  return path.join(META_DIRECTORY, "Hytale");
});

ipcMain.handle("open-folder", async (_, folderPath: string) => {
  try {
    if (typeof folderPath !== "string" || !folderPath) {
      throw new Error("Invalid folder path");
    }

    if (!fs.existsSync(folderPath)) {
      fs.mkdirSync(folderPath, { recursive: true });
    }

    const result = await shell.openPath(folderPath);
    // shell.openPath returns an empty string on success, otherwise an error message.
    return { ok: result === "", error: result || null };
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    return { ok: false, error: message };
  }
});

ipcMain.handle(
  "check-game-installation",
  (_, baseDir: string, version: GameVersion) => {
    return checkGameInstallation(baseDir, version);
  }
);

ipcMain.on("install-game", (e, gameDir: string, version: GameVersion) => {
  if (!fs.existsSync(gameDir)) {
    fs.mkdirSync(gameDir, { recursive: true });
  }

  const win = BrowserWindow.fromWebContents(e.sender);
  if (win) {
    installGame(gameDir, version, win);
  }
});

ipcMain.on(
  "launch-game",
  (e, gameDir: string, version: GameVersion, username: string) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    if (win) {
      launchGame(gameDir, version, username, win);
    }
  }
);
