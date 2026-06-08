import { createHash } from "node:crypto";
import { chmod, mkdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { environment } from "@raycast/api";
import { execa } from "execa";

// iSMC (https://github.com/dkorunic/iSMC) is a GPL-3.0 SMC/HID sensor CLI.
// We never bundle or redistribute it: on first run we download the pinned
// universal binary from the project's own GitHub release (a server we do not
// control) and verify it against a SHA256 hash pinned in source. The binary
// ships ad-hoc signed, so it executes on Apple Silicon; fetching it over the
// network (rather than via a browser) means no com.apple.quarantine xattr, so
// Gatekeeper does not block it. We invoke it as a separate process — no linking,
// no derivative work.
//
// To bump: change VERSION and TARBALL_SHA256 together. The version is part of
// the cached filename, so a bump invalidates the old cache and re-downloads.
const VERSION = "v0.16.5";
const TARBALL_URL = `https://github.com/dkorunic/iSMC/releases/download/${VERSION}/iSMC_Darwin_all.tar.gz`;
const TARBALL_SHA256 =
  "bc41d966ebb20eabb8a97967b2952febf3fbf888c2174103e869379c8b6542d5";

const BIN_DIR = join(environment.supportPath, "bin");
const BIN_PATH = join(BIN_DIR, `iSMC-${VERSION}`);

// Concurrent callers (heat-check auto-refreshes every 3s) must not kick off
// parallel downloads on the very first run; share one in-flight promise.
let downloadInFlight: Promise<string> | null = null;

/**
 * Returns the path to a ready-to-run iSMC binary, downloading and verifying it
 * on first use. Throws if the download or checksum check fails — the caller
 * decides whether absent sensors are tolerable.
 */
export async function ensureISmc(): Promise<string> {
  if (await isExecutable(BIN_PATH)) {
    return BIN_PATH;
  }

  if (!downloadInFlight) {
    downloadInFlight = downloadAndVerify().finally(() => {
      downloadInFlight = null;
    });
  }

  return downloadInFlight;
}

async function isExecutable(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

async function downloadAndVerify(): Promise<string> {
  const res = await fetch(TARBALL_URL);
  if (!res.ok) {
    throw new Error(
      `iSMC download failed: HTTP <${res.status}> from <${TARBALL_URL}>`,
    );
  }

  const tarball = Buffer.from(await res.arrayBuffer());
  const digest = createHash("sha256").update(tarball).digest("hex");
  if (digest !== TARBALL_SHA256) {
    throw new Error(
      `iSMC checksum mismatch: expected <${TARBALL_SHA256}>, got <${digest}>`,
    );
  }

  await mkdir(BIN_DIR, { recursive: true });

  // Extract only the iSMC binary (the tarball also carries README/LICENSE/etc.)
  // using macOS's built-in tar, then atomically move it into place.
  const tarPath = `${BIN_PATH}.tar.gz`;
  const extractedPath = join(BIN_DIR, "iSMC");
  try {
    await writeFile(tarPath, tarball);
    await execa("tar", ["xzf", tarPath, "-C", BIN_DIR, "iSMC"]);
    await rename(extractedPath, BIN_PATH);
    await chmod(BIN_PATH, 0o755);
  } finally {
    await rm(tarPath, { force: true });
  }

  return BIN_PATH;
}
