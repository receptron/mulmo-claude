// Promise-based confirm dialog state, plugin-side mirror of `src/composables/useConfirm.ts`.
// Mirrored on purpose: recipe-book (the consumer) is a deliberately gui-chat-protocol-only
// sample, so sharing via @mulmoclaude/core would force a core dep onto the sample + scaffold —
// unify only if that dependency-minimalism policy changes. (The ConfirmModal.vue components'
// useRuntime-vs-vue-i18n locale split is a separate constraint on the components, not on this file.)

import { ref } from "vue";

export interface ConfirmOptions {
  title?: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  variant?: "primary" | "success" | "danger";
}

export interface ConfirmState {
  isOpen: boolean;
  title: string;
  message: string;
  confirmText: string;
  cancelText: string;
  variant: "primary" | "success" | "danger";
  resolve: ((value: boolean) => void) | null;
}

export const confirmState = ref<ConfirmState>({
  isOpen: false,
  title: "",
  message: "",
  confirmText: "",
  cancelText: "",
  variant: "primary",
  resolve: null,
});

export function useConfirm() {
  function openConfirm(options: ConfirmOptions | string): Promise<boolean> {
    const opts = typeof options === "string" ? { message: options } : options;

    return new Promise<boolean>((resolve) => {
      // If a previous confirm is still pending, settle it as
      // "cancelled" before replacing the state. Without this the
      // earlier `Promise<boolean>` would hang forever and any
      // caller `await`ing it would deadlock.
      const previous = confirmState.value.resolve;
      if (previous) previous(false);
      confirmState.value = {
        isOpen: true,
        title: opts.title || "",
        message: opts.message,
        confirmText: opts.confirmText || "",
        cancelText: opts.cancelText || "",
        variant: opts.variant || "primary",
        resolve,
      };
    });
  }

  function handleConfirm(value: boolean) {
    if (confirmState.value.resolve) {
      confirmState.value.resolve(value);
    }
    confirmState.value.isOpen = false;
    confirmState.value.resolve = null;
  }

  return {
    confirmState,
    openConfirm,
    handleConfirm,
  };
}
