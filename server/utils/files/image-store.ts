import { readFile } from "fs/promises";
import path from "path";
import { WORKSPACE_DIRS, WORKSPACE_PATHS } from "../../workspace/paths.js";
import { shortId } from "../id.js";
import { writeFileAtomic } from "./atomic.js";
import { yearMonthUtc } from "@mulmoclaude/core/artifacts";
import { makePathValidator } from "./path-validator.js";
import { makeStoreResolvers } from "./store-resolvers.js";

const resolvers = makeStoreResolvers(() => WORKSPACE_PATHS.images, WORKSPACE_DIRS.images);

// #764 sharded under images/YYYY/MM/ (UTC). Buffer pass-through avoids re-encoding the PNG bytes.
export async function saveImage(base64Data: string): Promise<string> {
  const partition = yearMonthUtc();
  const filename = `${shortId()}.png`;
  const absPath = path.join(WORKSPACE_PATHS.images, partition, filename);
  await writeFileAtomic(absPath, Buffer.from(base64Data, "base64"));
  return path.posix.join(WORKSPACE_DIRS.images, partition, filename);
}

export async function overwriteImage(relativePath: string, base64Data: string): Promise<void> {
  const absPath = await resolvers.forWrite(relativePath);
  await writeFileAtomic(absPath, Buffer.from(base64Data, "base64"));
}

export async function loadImageBase64(relativePath: string): Promise<string> {
  const absPath = await resolvers.forRead(relativePath);
  const buf = await readFile(absPath);
  return buf.toString("base64");
}

export function stripDataUri(dataUri: string): string {
  return dataUri.replace(/^data:image\/[^;]+;base64,/, "");
}

// Accepts arbitrary depth so saveImage's images/YYYY/MM/abc.png still validates.
export const isImagePath = makePathValidator({ prefix: WORKSPACE_DIRS.images, ext: ".png" });
