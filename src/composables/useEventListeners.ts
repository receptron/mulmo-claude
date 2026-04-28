import { onMounted, onUnmounted } from "vue";

export interface EventListenerHandlers {
  onKeyNavigation: (e: KeyboardEvent) => void;
  onTeardown?: () => void;
}

export function useEventListeners(handlers: EventListenerHandlers): void {
  onMounted(() => {
    window.addEventListener("keydown", handlers.onKeyNavigation);
  });

  onUnmounted(() => {
    window.removeEventListener("keydown", handlers.onKeyNavigation);
    handlers.onTeardown?.();
  });
}
