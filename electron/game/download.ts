import { BrowserWindow } from "electron";
import fs from "fs";
import path from "path";
import { promisify } from "util";
import stream from "stream";
import extract from "extract-zip";
import crypto from "crypto";

const pipeline = promisify(stream.pipeline);

const API_URL = import.meta.env.VITE_DOWNLOADS_API_URL;

async function getLatestUrl() {
  const response = await fetch(API_URL);
  const data = await response.json();
  if (process.platform === "win32" && data.releases.windows) {
    return {
      url: data.releases.windows.latest.file.url,
      size: data.releases.windows.latest.file.size,
      sha256: data.releases.windows.latest.file.sha256,
    };
  } else if (process.platform === "linux" && data.releases.linux) {
    return {
      url: data.releases.linux.latest.file.url,
      size: data.releases.linux.latest.file.size,
      sha256: data.releases.linux.latest.file.sha256,
    };
  }

  throw new Error("No latest version found");
}

export async function downloadGame(gameDir: string, win: BrowserWindow) {
  const zipPath = path.join(gameDir, "temp_game.zip");

  try {
    const { url, sha256, size } = await getLatestUrl();

    // check if file exists and is the same, to avoid unnecessary downloads
    let doDownload = true;

    if (fs.existsSync(zipPath) && sha256) {
      const hash = crypto.createHash("sha256");
      const fileStream = fs.createReadStream(zipPath);
      fileStream.on("data", (chunk) => hash.update(chunk));
      fileStream.on("end", () => {
        const fileHash = hash.digest("hex");
        if (fileHash !== sha256) {
          fs.unlinkSync(zipPath);
          doDownload = true;
        } else {
          doDownload = false;
          // send progress as download phase completed
          win.webContents.send("install-progress", {
            phase: "download",
            percent: 50,
            total: size,
            current: size,
          });
        }
      });
    }

    if (doDownload) {
      const response = await fetch(url);
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
          // Download phase: 0% - 50%
          const percentage = (downloadedLength / totalLength) * 50;
          win.webContents.send("install-progress", {
            phase: "download",
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
        fs.createWriteStream(zipPath)
      );
    }

    let extractedEntries = 0;
    await extract(zipPath, {
      dir: gameDir,
      onEntry: (_, zipfile) => {
        extractedEntries++;
        const totalEntries = zipfile.entryCount;
        // Extraction phase: 50% - 100%
        const percentage = 50 + (extractedEntries / totalEntries) * 50;
        win.webContents.send("install-progress", {
          phase: "extract",
          percent: Math.round(percentage),
          total: totalEntries,
          current: extractedEntries,
        });
      },
    });

    win.webContents.send("install-progress", {
      phase: "extract",
      percent: 100,
      total: 1,
      current: 1,
    });
    win.webContents.send("install-finished");
  } catch (error) {
    console.error("Installation failed:", error);
    win.webContents.send(
      "install-error",
      error instanceof Error ? error.message : "Unknown error"
    );
  } finally {
    if (fs.existsSync(zipPath)) {
      await fs.promises.unlink(zipPath);
    }
  }
}
