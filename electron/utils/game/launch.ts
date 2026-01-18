import { BrowserWindow } from "electron";
import { checkGameInstallation } from "./check";
import { join, dirname } from "path";
import { spawn } from "child_process";
import fs from "fs";
import { genUUID } from "./uuid";
import { installGame } from "./install";
import { migrateLegacyChannelInstallIfNeeded, resolveExistingInstallDir } from "./paths";

const ensureExecutable = (filePath: string) => {
  if (process.platform === "win32") return;
  try {
    const st = fs.statSync(filePath);
    // If user execute bit isn't set, try to fix it.
    if ((st.mode & 0o100) === 0) {
      fs.chmodSync(filePath, 0o755);
    }
  } catch {
    // ignore
  }
};

export const launchGame = async (
  baseDir: string,
  version: GameVersion,
  username: string,
  win: BrowserWindow,
  retryCount: number = 0,
  customUUID: string | null = null,
  callbacks?: {
    onGameSpawned?: () => void;
    onGameExited?: (info: { code: number | null; signal: NodeJS.Signals | null }) => void;
  }
) => {
  if (retryCount > 1) {
    const msg = "Failed to launch game (max retries reached)";
    console.error(msg);
    win.webContents.send("launch-error", msg);
    return;
  }

  // Keep path/layout resolution consistent with the installer.
  migrateLegacyChannelInstallIfNeeded(baseDir, version.type);
  const installDir = resolveExistingInstallDir(baseDir, version);

  let { client, server, jre } = checkGameInstallation(baseDir, version);
  if (!client || !server || !jre) {
    console.log("Game not installed, missing:", { client, server, jre });
    const installResult = await installGame(baseDir, version, win);
    if (!installResult) {
      const msg = "Game installation failed";
      console.error(msg);
      win.webContents.send("launch-error", msg);
      return;
    }

    // Re-check after install.
    ({ client, server, jre } = checkGameInstallation(baseDir, version));
    if (!client || !server || !jre) {
      const msg = "Game installation incomplete (missing files after install)";
      console.error(msg, { client, server, jre });
      win.webContents.send("launch-error", msg);
      return;
    }
  }

  const userDir = join(baseDir, "UserData");
  if (!fs.existsSync(userDir)) fs.mkdirSync(userDir);

  const normalizeUuid = (raw: string): string | null => {
    const trimmed = raw.trim();
    if (!trimmed) return null;

    const compact = trimmed.replace(/-/g, "");
    if (/^[0-9a-fA-F]{32}$/.test(compact)) {
      const lower = compact.toLowerCase();
      return `${lower.slice(0, 8)}-${lower.slice(8, 12)}-${lower.slice(12, 16)}-${lower.slice(16, 20)}-${lower.slice(20)}`;
    }

    if (/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(trimmed)) {
      return trimmed.toLowerCase();
    }

    return null;
  };

  const uuidToUse = customUUID ? normalizeUuid(customUUID) : null;

  const args = [
    "--app-dir",
    installDir,
    // Yes, we pass the install dir explicitly. No, we don't "guess" it from the executable
    // path anymore. Bundles are cute until path math gets involved.
    "--user-dir",
    userDir,
    "--java-exec",
    jre,
    "--auth-mode",
    "offline",
    "--uuid",
    uuidToUse ?? genUUID(username),
    "--name",
    username,
  ];

  const spawnClient = (attempt: number) => {
    try {
      const child = spawn(client, args, {
        windowsHide: true,
        shell: false,
        cwd: dirname(client),
        // Critical for Windows: allow the launcher to quit without killing the game.
        // `stdio: "ignore"` + `unref()` prevents the child being tied to the parent lifetime.
        detached: process.platform !== "darwin",
        stdio: "ignore",
      });

      // Ensure the child is not keeping the parent process alive, and (on Windows)
      // is less likely to be terminated when the Electron app exits.
      child.unref();

      child.on("spawn", () => {
        callbacks?.onGameSpawned?.();
        win.webContents.send("launched");
      });

      child.on("error", (error: NodeJS.ErrnoException) => {
        // Common on Linux when the downloaded binary loses the executable bit.
        if (error?.code === "EACCES" && attempt === 0) {
          console.warn("Launch EACCES: attempting to chmod +x and retry", client);
          ensureExecutable(client);
          spawnClient(1);
          return;
        }

        console.error(`Error launching game: ${error.message}`);
        win.webContents.send("launch-error", error.message);
      });

      let finished = false;
      const onFinish = (code: number | null, signal: NodeJS.Signals | null) => {
        if (finished) return;
        finished = true;

        if (code && code !== 0) {
          console.error(
            `Game exited with code ${code}${signal ? ` (signal ${signal})` : ""}`,
          );
        }
        callbacks?.onGameExited?.({ code, signal });
        try {
          win.webContents.send("launch-finished", { code, signal });
        } catch {
          // Window/app may already be closing.
        }
      };

      // Prefer exit for detached children; keep close as a fallback.
      child.once("exit", onFinish);
      child.once("close", onFinish);
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Unknown error";
      console.error(`Error launching game: ${msg}`);
      win.webContents.send("launch-error", msg);
    }
  };

  // Best-effort: ensure executable bit before the first spawn.
  ensureExecutable(client);
  spawnClient(0);
};
