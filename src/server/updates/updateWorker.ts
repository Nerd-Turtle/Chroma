import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { lstatSync, realpathSync, renameSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ChromaRelease, ChromaUpgradeProgress } from "../../shared/types/index.js";
import { fetchLatestChromaRelease, getUbuntuReleasePlatform, isNewerVersion, isStableVersion } from "./githubReleaseService.js";

const UPDATE_DIRECTORY = "/opt/chroma/update-state";
const INSTALLER = "/opt/chroma/current/install/install-chroma.sh";

function writeProgress(directory: string, progress: ChromaUpgradeProgress): void {
  const temporary = join(directory, `.status-${randomUUID()}.json`);
  writeFileSync(temporary, `${JSON.stringify(progress)}\n`, { mode: 0o644, flag: "wx" });
  renameSync(temporary, join(directory, "status.json"));
}

export async function runUpgradeWorker(version: string, options: {
  directory: string;
  currentVersion: string;
  getRelease: () => Promise<ChromaRelease | null>;
  install: (version: string) => Promise<void>;
  accepted: () => Promise<void>;
}): Promise<void> {
  if (!isStableVersion(version)) throw new Error("Only stable Chroma versions can be installed.");
  if (!isNewerVersion(version, options.currentVersion)) throw new Error("The requested version is already installed or older than this installation.");
  const progress: ChromaUpgradeProgress = {
    version, state: "installing", message: "Installing Chroma. The web interface will reconnect after Chroma restarts.", startedAt: new Date().toISOString(),
  };
  try {
    // Independently verify the request; the unprivileged application supplies no URL or command.
    // OWASP Authorization: enforce permissions again at the privileged operation boundary.
    // https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html#enforce-least-privileges
    const release = await options.getRelease();
    if (release?.version !== version || !release.compatible) throw new Error("The requested version is no longer the latest compatible stable release. Check for updates again.");
    writeProgress(options.directory, progress);
    await options.accepted();
    await options.install(version);
    writeProgress(options.directory, { ...progress, state: "succeeded", message: `Chroma ${version} was installed and passed its health check.` });
  } catch (error) {
    writeProgress(options.directory, { ...progress, state: "failed", message: "The upgrade failed. Check the Chroma updater service logs for backup and activation details. Previous application releases are retained." });
    throw error;
  }
}

async function readRequest(): Promise<string> {
  return new Promise((resolve, reject) => {
    let input = "";
    const timer = setTimeout(() => reject(new Error("Updater request timed out.")), 5_000);
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk: string) => {
      input += chunk;
      if (input.length > 256) { clearTimeout(timer); reject(new Error("Updater request is too large.")); return; }
      if (!input.includes("\n")) return;
      clearTimeout(timer);
      process.stdin.pause();
      try {
        const request = JSON.parse(input.split("\n", 1)[0]!) as { version?: unknown };
        if (!isStableVersion(request?.version)) throw new Error("A stable version is required.");
        resolve(request.version);
      } catch { reject(new Error("Invalid updater request.")); }
    });
    process.stdin.once("end", () => { clearTimeout(timer); reject(new Error("Incomplete updater request.")); });
    process.stdin.once("error", (error) => { clearTimeout(timer); reject(error); });
  });
}

async function main(): Promise<void> {
  let accepted = false;
  try {
    if (process.getuid?.() !== 0) throw new Error("The updater must run through its systemd service.");
    const directory = lstatSync(UPDATE_DIRECTORY);
    if (!directory.isDirectory() || directory.isSymbolicLink() || directory.uid !== 0 || (directory.mode & 0o022) !== 0) {
      throw new Error("The updater state directory must be owned and writable only by root.");
    }
    const version = await readRequest();
    const currentVersion = (await readFile("/opt/chroma/current/release-version", "utf8")).trim();
    const platform = await getUbuntuReleasePlatform();
    await runUpgradeWorker(version, {
      directory: UPDATE_DIRECTORY,
      currentVersion,
      getRelease: async () => (await fetchLatestChromaRelease(platform)).release ?? null,
      accepted: async () => {
        await new Promise<void>((resolve, reject) => {
          process.stdout.write(`${JSON.stringify({ accepted: true })}\n`, (error) => error ? reject(error) : resolve());
        });
        accepted = true;
      },
      install: async (targetVersion) => {
        // Let the API acknowledge the request before the separate service stops Chroma.
        await new Promise((resolve) => setTimeout(resolve, 1_000));
        await new Promise<void>((resolve, reject) => {
          const child = spawn("/usr/bin/bash", [INSTALLER, "--version", targetVersion, "--yes"], {
            // Fixed executable/installer and validated argv; no request text is shell source.
            // https://cheatsheetseries.owasp.org/cheatsheets/OS_Command_Injection_Defense_Cheat_Sheet.html#argument-injection
            env: { PATH: "/usr/sbin:/usr/bin:/sbin:/bin" },
            stdio: ["ignore", 2, 2],
            timeout: 25 * 60_000,
          });
          child.once("error", reject);
          child.once("exit", (code, signal) => code === 0 ? resolve() : reject(new Error(`Installer failed (${signal ?? code}).`)));
        });
      },
    });
  } catch (error) {
    console.error("Chroma updater:", error instanceof Error ? error.message : "Upgrade failed.");
    if (!accepted) {
      await new Promise<void>((resolve) => {
        process.stdout.write(`${JSON.stringify({ error: error instanceof Error ? error.message : "Upgrade failed." })}\n`, () => resolve());
      });
    }
    process.exitCode = 1;
  } finally { process.stdin.destroy(); }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === realpathSync(process.argv[1])) await main();
