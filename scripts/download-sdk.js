#!/usr/bin/env node

const https = require("https");
const fs = require("fs");
const path = require("path");
const { pipeline } = require("stream");
const { promisify } = require("util");
const tar = require("tar");
const { exec } = require("child_process");

const pipelineAsync = promisify(pipeline);
const execAsync = promisify(exec);

const SDK_VERSION = "0.6.3";
const SDK_BASE_URL = `https://github.com/ai-coustics/aic-sdk-c/releases/download/${SDK_VERSION}`;

const PLATFORM_MAP = {
  "darwin-x64": `aic-sdk-x86_64-apple-darwin-${SDK_VERSION}.tar.gz`,
  "darwin-arm64": `aic-sdk-aarch64-apple-darwin-${SDK_VERSION}.tar.gz`,
  "linux-x64": `aic-sdk-x86_64-unknown-linux-gnu-${SDK_VERSION}.tar.gz`,
  "linux-arm64": `aic-sdk-aarch64-unknown-linux-gnu-${SDK_VERSION}.tar.gz`,
  "win32-x64": `aic-sdk-x86_64-pc-windows-msvc-${SDK_VERSION}.zip`,
};

function getPlatformIdentifier() {
  const platform = process.platform;
  const arch = process.arch;
  return `${platform}-${arch}`;
}

function getDownloadUrl() {
  const platformId = getPlatformIdentifier();
  const filename = PLATFORM_MAP[platformId];

  if (!filename) {
    throw new Error(
      `Unsupported platform: ${platformId}. Supported platforms: ${Object.keys(PLATFORM_MAP).join(", ")}`,
    );
  }

  return `${SDK_BASE_URL}/${filename}`;
}

function downloadFile(url, destPath) {
  return new Promise((resolve, reject) => {
    console.log(`Downloading SDK from ${url}...`);

    https
      .get(url, (response) => {
        if (response.statusCode === 302 || response.statusCode === 301) {
          // Follow redirect
          return downloadFile(response.headers.location, destPath)
            .then(resolve)
            .catch(reject);
        }

        if (response.statusCode !== 200) {
          reject(
            new Error(
              `Failed to download: ${response.statusCode} ${response.statusMessage}`,
            ),
          );
          return;
        }

        const fileStream = fs.createWriteStream(destPath);
        let downloadedBytes = 0;
        const totalBytes = parseInt(response.headers["content-length"], 10);

        response.on("data", (chunk) => {
          downloadedBytes += chunk.length;
          const progress = ((downloadedBytes / totalBytes) * 100).toFixed(1);
          process.stdout.write(`\rDownloading: ${progress}%`);
        });

        response.pipe(fileStream);

        fileStream.on("finish", () => {
          fileStream.close();
          console.log("\nDownload completed!");
          resolve();
        });

        fileStream.on("error", (err) => {
          fs.unlinkSync(destPath);
          reject(err);
        });
      })
      .on("error", reject);
  });
}

async function extractArchive(archivePath, destDir) {
  console.log("Extracting SDK...");

  const ext = path.extname(archivePath);

  if (ext === ".gz") {
    // Extract tar.gz
    await tar.x({
      file: archivePath,
      cwd: destDir,
    });
  } else if (ext === ".zip") {
    // Extract zip (Windows)
    const unzipper = require("child_process").spawn("powershell.exe", [
      "-Command",
      `Expand-Archive -Path "${archivePath}" -DestinationPath "${destDir}" -Force`,
    ]);

    await new Promise((resolve, reject) => {
      unzipper.on("close", (code) => {
        if (code === 0) resolve();
        else reject(new Error(`Extraction failed with code ${code}`));
      });
    });
  }

  console.log("Extraction completed!");
}

async function main() {
  try {
    const rootDir = path.join(__dirname, "..");
    const sdkDir = path.join(rootDir, "sdk");
    const tmpDir = path.join(rootDir, "tmp");

    // Create directories
    if (!fs.existsSync(tmpDir)) {
      fs.mkdirSync(tmpDir, { recursive: true });
    }

    // Check if SDK already exists
    if (fs.existsSync(sdkDir)) {
      console.log("SDK already downloaded. Skipping download.");
      return;
    }

    const downloadUrl = getDownloadUrl();
    const filename = path.basename(downloadUrl);
    const archivePath = path.join(tmpDir, filename);

    // Download SDK
    await downloadFile(downloadUrl, archivePath);

    // Create sdk directory for extraction
    fs.mkdirSync(sdkDir, { recursive: true });

    // Extract SDK directly into sdk directory
    await extractArchive(archivePath, sdkDir);

    // Remove unnecessary directories
    const unnecessaryDirs = ["examples", "docs"];
    for (const dir of unnecessaryDirs) {
      const dirPath = path.join(sdkDir, dir);
      if (fs.existsSync(dirPath)) {
        fs.rmSync(dirPath, { recursive: true, force: true });
      }
    }

    // Clean up
    fs.unlinkSync(archivePath);
    fs.rmdirSync(tmpDir);

    console.log("SDK installation completed successfully!");
  } catch (error) {
    console.error("Failed to download SDK:", error.message);
    process.exit(1);
  }
}

main();
