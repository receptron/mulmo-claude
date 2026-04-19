/**
 * Unify IME (Japanese, Chinese, Korean) Enter-confirmation behavior
 * across Safari and Chrome / Firefox so only a user-intended Enter
 * sends a message.
 *
 * Safari fires `compositionend` BEFORE the confirming Enter's
 * `keydown`, so `event.isComposing` is already `false` by the time
 * the keydown handler runs — the standard `!isComposing` guard lets
 * the message send on IME confirmation. Chrome / Firefox fire
 * `compositionend` AFTER the keydown and keep `isComposing` true, so
 * they handle confirmation correctly on their own.
 *
 * We use a tight time window after `compositionend` to suppress only
 * the immediately-following keydown. Safari's sequence is synchronous
 * (microseconds); a human follow-up Enter takes >= 100 ms and never
 * falls inside.
 */
export const SAFARI_IME_RACE_WINDOW_MS = 30;

export interface ImeAwareEnterHandlers {
  onCompositionStart: () => void;
  onCompositionEnd: () => void;
  onKeydown: (event: KeyboardEvent) => void;
  onBlur: () => void;
}

export function useImeAwareEnter(
  onSend: () => void,
  now: () => number = () => performance.now(),
): ImeAwareEnterHandlers {
  let isImeComposing = false;
  let lastCompositionEndAt = 0;

  return {
    onCompositionStart() {
      isImeComposing = true;
    },
    onCompositionEnd() {
      isImeComposing = false;
      lastCompositionEndAt = now();
    },
    onBlur() {
      isImeComposing = false;
      lastCompositionEndAt = 0;
    },
    onKeydown(event: KeyboardEvent) {
      if (event.key !== "Enter" || event.shiftKey) return;
      if (event.isComposing || isImeComposing) {
        event.preventDefault();
        return;
      }
      if (now() - lastCompositionEndAt < SAFARI_IME_RACE_WINDOW_MS) {
        event.preventDefault();
        return;
      }
      event.preventDefault();
      onSend();
    },
  };
}
