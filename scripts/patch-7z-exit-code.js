/**
 * Patch builder-util to tolerate 7z exit code 2 (sub-item errors).
 *
 * On Windows without Developer Mode or admin privileges, 7z returns exit code 2
 * when extracting winCodeSign-2.6.0.7z because it contains macOS symlinks
 * (libcrypto.dylib, libssl.dylib) that cannot be created. The actual Windows
 * binaries extract successfully; only the macOS symlinks fail.
 *
 * This script patches handleProcess() in builder-util/out/util.js to treat
 * exit code 2 as success, allowing electron-builder to proceed.
 */
import { readFile, writeFile } from "fs/promises";
import { resolve } from "path";

const targetFile = resolve("node_modules/builder-util/out/util.js");

try {
  let content = await readFile(targetFile, "utf-8");

  const original = "if (code === 0) {";
  const patched = "if (code === 0 || code === 2) {";

  if (content.includes(patched)) {
    console.log("[patch-7z] Already patched, skipping.");
    process.exit(0);
  }

  if (!content.includes(original)) {
    console.warn("[patch-7z] Target string not found in util.js, skipping.");
    process.exit(0);
  }

  content = content.replace(original, patched);
  await writeFile(targetFile, content, "utf-8");
  console.log("[patch-7z] Patched builder-util to tolerate 7z exit code 2.");
} catch (err) {
  if (err.code === "ENOENT") {
    // builder-util not installed yet (e.g. first install), skip silently
    process.exit(0);
  }
  console.error("[patch-7z] Failed to patch:", err.message);
  process.exit(1);
}
