import { BrowserWindow } from "electron";
import fs from "fs";
import path from "path";
import { promisify } from "util";
import stream from "stream";
import { spawn } from "child_process";
import readline from "node:readline";
import extract from "extract-zip";
import { installButler } from "./butler";
import { installJRE } from "./jre";
import { checkGameInstallation } from "./check";
import { readInstallManifest, writeInstallManifest } from "./manifest";
import {
  getLatestDir,
  getReleaseBuildDir,
  migrateLegacyChannelInstallIfNeeded,
  resolveClientPath,
  resolveInstallDir,
} from "./paths";

const pipeline = promisify(stream.pipeline);

const ensureExecutable = (filePath: string) => {
  if (process.platform === "win32") return;
  try {
    const st = fs.statSync(filePath);
    if ((st.mode & 0o100) === 0) {
      fs.chmodSync(filePath, 0o755);
    }
  } catch {
    // ignore
  }
};

const ensureClientExecutable = (installDir: string) => {
  try {
    const clientPath = resolveClientPath(installDir);
    ensureExecutable(clientPath);
  } catch {
    // ignore
  }
};

// manifest helpers live in ./manifest

const downloadPWR = async (
  gameDir: string,
  version: GameVersion,
  win: BrowserWindow,
) => {
  const tempPWRPath = path.join(gameDir, `temp_${version.build_index}.pwr`);

  try {
    const response = await fetch(version.url);
    if (!response.ok)
      throw new Error(`Failed to download: ${response.statusText}`);
    if (!response.body) throw new Error("No response body");

    const contentLength = response.headers.get("content-length");
    const totalLength = contentLength ? parseInt(contentLength, 10) : undefined;
    let downloadedLength = 0;

    // Emit a start event so UI doesn't show 0/0.
    win.webContents.send("install-progress", {
      phase: "pwr-download",
      percent: totalLength ? 0 : -1,
      total: totalLength,
      current: 0,
    });

    const progressStream = new stream.PassThrough();
    progressStream.on("data", (chunk) => {
      downloadedLength += chunk.length;

      const percent =
        typeof totalLength === "number" && totalLength > 0
          ? Math.round((downloadedLength / totalLength) * 100)
          : -1;

      win.webContents.send("install-progress", {
        phase: "pwr-download",
        percent,
        total: totalLength,
        current: downloadedLength,
      });
    });

    await pipeline(
      // @ts-ignore
      stream.Readable.fromWeb(response.body),
      progressStream,
      fs.createWriteStream(tempPWRPath),
    );

    win.webContents.send("install-progress", {
      phase: "pwr-download",
      percent: 100,
      total: totalLength,
      current: downloadedLength,
    });

    return tempPWRPath;
  } catch (error) {
    console.error("Failed to download PWR:", error);
    return null;
  }
};

const applyPWR = async (
  pwrPath: string,
  butlerPath: string,
  installDir: string,
  win: BrowserWindow,
) => {
  const stagingDir = path.join(installDir, "staging-temp");
  if (!fs.existsSync(installDir)) fs.mkdirSync(installDir, { recursive: true });
  if (!fs.existsSync(stagingDir)) fs.mkdirSync(stagingDir, { recursive: true });

  win.webContents.send("install-progress", {
    phase: "patching",
    percent: -1,
  });

  return new Promise<string>((resolve, reject) => {
    const butlerProcess = spawn(
      butlerPath,
      ["apply", "--json", "--staging-dir", stagingDir, pwrPath, installDir],
      {
        windowsHide: true,
      },
    ).on("error", (error) => {
      console.error("Butler process failed:", error);
      reject(error);
    });

    // Try to surface butler progress in the UI.
    // Butler emits JSON lines when using --json.
    if (butlerProcess.stdout) {
      const rl = readline.createInterface({
        input: butlerProcess.stdout,
        crlfDelay: Infinity,
      });
      rl.on("line", (line) => {
        const trimmed = line.trim();
        if (!trimmed) return;
        try {
          const obj = JSON.parse(trimmed);

          // Common shapes seen across butler commands.
          // We handle a few variants defensively.
          const type = typeof obj?.type === "string" ? obj.type : "";
          const isProgress =
            type.toLowerCase().includes("progress") ||
            typeof obj?.percentage === "number" ||
            typeof obj?.percent === "number";

          if (!isProgress) return;

          let percent: number | undefined;
          if (typeof obj.percentage === "number") percent = obj.percentage;
          else if (typeof obj.percent === "number") percent = obj.percent;
          else if (typeof obj.progress === "number") percent = obj.progress;

          if (typeof percent !== "number" || Number.isNaN(percent)) return;
          // Normalize 0..1 to 0..100
          if (percent > 0 && percent <= 1) percent = percent * 100;
          percent = Math.max(0, Math.min(100, percent));

          win.webContents.send("install-progress", {
            phase: "patching",
            percent: Math.round(percent),
          });
        } catch {
          // Not JSON, ignore
        }
      });
      butlerProcess.on("close", () => {
        rl.close();
      });
    }

    butlerProcess.stderr.on("data", (data) => {
      console.error(data.toString());
    });
    butlerProcess.on("close", (code) => {
      console.log(`Butler process exited with code ${code}`);

      // Force a final UI update so it doesn't stay stuck on "Downloading...".
      win.webContents.send("install-progress", {
        phase: "patching",
        percent: 100,
      });

      resolve(installDir);
    });
  });
};

const applyFix = async (
  gameFinalDir: string,
  version: GameVersion,
  win: BrowserWindow,
) => {
  try {
    // No fix available for this version is not an error.
    if (!version.hasFix || !version.fixURL) return true;

    // download fix
    const fixPath = path.join(gameFinalDir, "fix.zip");

    const response = await fetch(version.fixURL);
    if (!response.ok)
      throw new Error(`Failed to download: ${response.statusText}`);
    if (!response.body) throw new Error("No response body");
    const contentLength = response.headers.get("content-length");
    const totalLength = contentLength ? parseInt(contentLength, 10) : 0;
    let downloadedLength = 0;

    const progressStream = new stream.PassThrough();
    progressStream.on("data", (chunk) => {
      downloadedLength += chunk.length;
      if (totalLength > 0) {
        const percentage = (downloadedLength / totalLength) * 80;
        win.webContents.send("install-progress", {
          phase: "fix-download",
          percent: Math.round(percentage),
          total: totalLength,
          current: downloadedLength,
        });
      }
    });

    await pipeline(
      // @ts-ignore
      stream.Readable.fromWeb(response.body),
      progressStream,
      fs.createWriteStream(fixPath),
    );

    win.webContents.send("install-progress", {
      phase: "fix-download",
      percent: 80,
      total: totalLength,
      current: downloadedLength,
    });

    // extract fix
    let extractedEntries = 0;

    await extract(fixPath, {
      dir: gameFinalDir,
      onEntry: (_, zipfile) => {
        extractedEntries++;
        const totalEntries = zipfile.entryCount;
        const percentage = 80 + (extractedEntries / totalEntries) * 20;
        win.webContents.send("install-progress", {
          phase: "fix-extract",
          percent: Math.round(percentage),
          total: totalEntries,
          current: extractedEntries,
        });
      },
    });

    return true;
  } catch (error) {
    console.error("Failed to apply fix:", error);
    return false;
  }
};

export const installGame = async (
  gameDir: string,
  version: GameVersion,
  win: BrowserWindow,
) => {
  try {
    migrateLegacyChannelInstallIfNeeded(gameDir, version.type);

    // If installing the latest release, and an older latest exists, move it into release/build-N.
    if (version.type === "release" && version.isLatest) {
      const latestDir = getLatestDir(gameDir);
      if (fs.existsSync(latestDir)) {
        const existing = readInstallManifest(latestDir);
        if (existing && existing.build_index !== version.build_index) {
          const targetBuildDir = getReleaseBuildDir(gameDir, existing.build_index);
          if (fs.existsSync(targetBuildDir)) {
            // Already installed elsewhere; remove latest to free the alias.
            fs.rmSync(latestDir, { recursive: true, force: true });
          } else {
            fs.mkdirSync(path.dirname(targetBuildDir), { recursive: true });
            fs.renameSync(latestDir, targetBuildDir);
          }
        }
      }
    }

    const installDir = resolveInstallDir(gameDir, version);

    const { client, server, jre } = checkGameInstallation(gameDir, version);

    const installedManifest = readInstallManifest(installDir);
    const alreadyOnThisBuild = installedManifest?.build_index === version.build_index;

    fs.mkdirSync(gameDir, { recursive: true });
    win.webContents.send("install-started");

    if (!jre) {
      const jrePath = await installJRE(gameDir, win);
      if (!jrePath) throw new Error("Failed to install JRE");
    }

    // If binaries exist but build differs, we must still apply the new PWR.
    // Only skip the patching step when we *know* we're already on this build.
    if (!alreadyOnThisBuild) {
      const butlerPath = await installButler();
      if (!butlerPath) throw new Error("Failed to install butler");

      const tempPWRPath = await downloadPWR(gameDir, version, win);
      if (!tempPWRPath) throw new Error("Failed to download PWR");

      const gameFinalDir = await applyPWR(tempPWRPath, butlerPath, installDir, win);
      console.log("PWR applied?", gameFinalDir);
      if (!gameFinalDir) throw new Error("Failed to apply PWR");
      console.log("PWR applied successfully");

      fs.unlinkSync(tempPWRPath);

      const applyFixResult = await applyFix(gameFinalDir, version, win);
      if (applyFixResult === false) throw new Error("Failed to apply fix");

      // Record the installed build so future updates can detect when patching is needed.
      writeInstallManifest(installDir, version);

      // On Linux/macOS, downloaded binaries may lose the executable bit.
      ensureClientExecutable(installDir);
    } else {
      // If the manifest says it's installed, but binaries are missing, fall back to patching.
      // This keeps us safe against partial installs.
      if (!client || !server) {
        // Manifest says "installed", filesystem says "lol no".
        const butlerPath = await installButler();
        if (!butlerPath) throw new Error("Failed to install butler");

        const tempPWRPath = await downloadPWR(gameDir, version, win);
        if (!tempPWRPath) throw new Error("Failed to download PWR");

        const gameFinalDir = await applyPWR(tempPWRPath, butlerPath, installDir, win);
        if (!gameFinalDir) throw new Error("Failed to apply PWR");
        fs.unlinkSync(tempPWRPath);

        const applyFixResult = await applyFix(gameFinalDir, version, win);
        if (applyFixResult === false) throw new Error("Failed to apply fix");

        writeInstallManifest(installDir, version);

        ensureClientExecutable(installDir);
      }
    }
    console.log("Game installed successfully");

    win.webContents.send("install-finished", version);
    return true;
  } catch (error) {
    console.error("Installation failed:", error);
    win.webContents.send(
      "install-error",
      error instanceof Error ? error.message : "Unknown error",
    );
    return false;
  }
};
