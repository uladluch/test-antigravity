#!/usr/bin/env node
// Launches the Antigravity bridge inside a GitHub Actions job for users who
// have no computer. It creates the same one-time pairing invitation the desktop
// connector shows, prints it as a QR code in the job log, then hands over to
// the bridge in cloud mode (Google sign-in happens from the phone chat).
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const INVITATION_LIFETIME_MS = 10 * 60 * 1000;
const here = path.dirname(fileURLToPath(import.meta.url));
const workspace = process.env.GITHUB_WORKSPACE || process.cwd();

const pairId = crypto.randomUUID().toLowerCase();
const token = crypto.randomBytes(24).toString("hex");
const expiresAt = Math.floor((Date.now() + INVITATION_LIFETIME_MS) / 1000);

const link = new URL("https://luch.dev/antigravity");
link.searchParams.set("pair", pairId);
link.searchParams.set("token", token);
link.searchParams.set("desktop", "1");
link.searchParams.set("expires", String(expiresAt));

const claimDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "antigravity-pair-"));
const claimFile = path.join(claimDirectory, "claim.json");
fs.writeFileSync(
  claimFile,
  JSON.stringify({ pairId, token, cliType: "gemini", waitForPair: true, expiresAt }),
  { mode: 0o600 },
);

console.log("\nScan this code with the Antigravity app (valid for 10 minutes):\n");
try {
  const { default: qrcode } = await import("qrcode-terminal");
  qrcode.generate(link.toString(), { small: true });
} catch {
  console.log("(QR renderer unavailable — open the link below as a QR code.)");
}
console.log(`\n${link}\n`);

const bridge = spawn(
  process.execPath,
  [path.join(here, "bridge.mjs"), "--path", workspace, "--pair-file", claimFile],
  {
    cwd: workspace,
    stdio: "inherit",
    env: {
      ...process.env,
      BRIDGE_CLOUD_MODE: "1",
      // The checkout is the user's own repository; under CI=true the CLI would
      // otherwise refuse to run in it.
      GEMINI_CLI_TRUST_WORKSPACE: "true",
      BRIDGE_CLI_TYPE: "gemini",
      BRIDGE_NATIVE_APP: "1",
      NO_COLOR: "1",
    },
  },
);
bridge.on("exit", (code) => process.exit(code ?? 1));
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => bridge.kill(signal));
