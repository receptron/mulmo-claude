// Character (imageParams.images) strip: thumbnails, drag-and-drop upload, and
// render / generate-all for the `imagePrompt` characters a script references.
// Characters must be rendered before the beats that use them, so the View
// probes these on mount and after every beat render.

import { computed, reactive, type ComputedRef } from "vue";
import { errorMessage } from "@mulmoclaude/common";
import { characterPrompt as characterPromptOf, clearReactiveRecords, getMissingCharacterKeys, staleSince as staleSinceOf } from "../helpers";
import { readFileAsDataUrl } from "../support";
import type { MulmoScriptTransport } from "../transport";

type CharRenderState = "idle" | "rendering" | "done" | "error";

type ScriptImages = Record<string, { type?: string; prompt?: string }> | undefined;

export interface UseCharacterImagesOptions {
  api: MulmoScriptTransport;
  filePath: ComputedRef<string>;
  chatSessionId: ComputedRef<string | undefined>;
  getImages: () => ScriptImages;
}

export function useCharacterImages({ api, filePath, chatSessionId, getImages }: UseCharacterImagesOptions) {
  const charRenderState = reactive<Record<string, CharRenderState>>({});
  const charImages = reactive<Record<string, string>>({});
  const charErrors = reactive<Record<string, string>>({});
  const charDragOver = reactive<Record<string, boolean>>({});

  const staleSince = (requestedFilePath: string): boolean => staleSinceOf(filePath.value, requestedFilePath);

  const characterKeys = computed(() => {
    const imgs = getImages() ?? {};
    return Object.keys(imgs).filter((key) => imgs[key]?.type === "imagePrompt");
  });

  function characterPrompt(key: string): string {
    return characterPromptOf(getImages(), key);
  }

  function onCharDragOver(event: DragEvent, key: string): void {
    if (!event.dataTransfer?.types.includes("Files")) return;
    event.preventDefault();
    charDragOver[key] = true;
  }

  function onCharDragLeave(key: string): void {
    charDragOver[key] = false;
  }

  async function onCharDrop(event: DragEvent, key: string): Promise<void> {
    event.preventDefault();
    charDragOver[key] = false;
    const file = event.dataTransfer?.files[0];
    if (!file || !file.type.startsWith("image/")) return;

    charRenderState[key] = "rendering";
    Reflect.deleteProperty(charErrors, key);
    let imageData: string;
    try {
      imageData = await readFileAsDataUrl(file);
    } catch (err) {
      charErrors[key] = errorMessage(err);
      charRenderState[key] = "error";
      return;
    }
    const requestedFilePath = filePath.value;
    const response = await api.call("uploadCharacterImage", { filePath: requestedFilePath, key, imageData });
    if (staleSince(requestedFilePath)) return;
    if (!response.ok) {
      charErrors[key] = response.error || "Upload failed";
      charRenderState[key] = "error";
      return;
    }
    charImages[key] = response.data.image ?? "";
    charRenderState[key] = "done";
  }

  async function loadExistingCharacterImage(key: string): Promise<void> {
    const requestedFilePath = filePath.value;
    const response = await api.call("characterImage", { filePath: requestedFilePath, key });
    if (staleSince(requestedFilePath)) return;
    // silently ignore errors
    if (response.ok && response.data.image) {
      charImages[key] = response.data.image;
      charRenderState[key] = "done";
    }
  }

  function refreshMissingCharacterImages(): void {
    getMissingCharacterKeys(characterKeys.value, charImages, charRenderState).forEach((key) => loadExistingCharacterImage(key));
  }

  async function renderCharacter(key: string, force: boolean): Promise<void> {
    const requestedFilePath = filePath.value;
    charRenderState[key] = "rendering";
    Reflect.deleteProperty(charErrors, key);
    const response = await api.call("renderCharacter", { filePath: requestedFilePath, key, force, chatSessionId: chatSessionId.value });
    if (staleSince(requestedFilePath)) return;
    if (!response.ok) {
      charErrors[key] = response.error || "Render failed";
      charRenderState[key] = "error";
      return;
    }
    charImages[key] = response.data.image ?? "";
    charRenderState[key] = "done";
  }

  async function generateAllCharacters(): Promise<void> {
    await Promise.all(characterKeys.value.filter((key) => charRenderState[key] !== "rendering").map((key) => renderCharacter(key, false)));
  }

  function resetCharacters(): void {
    clearReactiveRecords(charRenderState, charImages, charErrors, charDragOver);
  }

  return {
    charRenderState,
    charImages,
    charErrors,
    charDragOver,
    characterKeys,
    characterPrompt,
    onCharDragOver,
    onCharDragLeave,
    onCharDrop,
    loadExistingCharacterImage,
    refreshMissingCharacterImages,
    renderCharacter,
    generateAllCharacters,
    resetCharacters,
  };
}
