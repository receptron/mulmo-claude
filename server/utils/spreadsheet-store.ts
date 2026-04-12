import fs from "fs/promises";
import path from "path";
import crypto from "crypto";
import { workspacePath } from "../workspace.js";

const SPREADSHEETS_DIR = path.join(workspacePath, "spreadsheets");

/** Save sheets array as a JSON file. Returns the workspace-relative path. */
export async function saveSpreadsheet(sheets: unknown[]): Promise<string> {
  const id = crypto.randomUUID().replace(/-/g, "").slice(0, 16);
  const filename = `${id}.json`;
  await fs.writeFile(
    path.join(SPREADSHEETS_DIR, filename),
    JSON.stringify(sheets),
    "utf-8",
  );
  return `spreadsheets/${filename}`;
}

/** Overwrite an existing spreadsheet file. */
export async function overwriteSpreadsheet(
  relativePath: string,
  sheets: unknown[],
): Promise<void> {
  const absPath = path.join(workspacePath, relativePath);
  await fs.writeFile(absPath, JSON.stringify(sheets), "utf-8");
}

/** Check if a string is a spreadsheet file path (not inline data). */
export function isSpreadsheetPath(value: string): boolean {
  return value.startsWith("spreadsheets/") && value.endsWith(".json");
}
