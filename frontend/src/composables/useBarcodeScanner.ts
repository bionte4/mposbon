import { onBeforeUnmount, onMounted, ref, type Ref } from 'vue';

/**
 * HID barcode scanners typically act as keyboards: rapid keydown chars + Enter.
 * We buffer printable keys and flush on Enter when the focused element is not an input.
 */
export function useBarcodeScanner(options: {
  enabled: Ref<boolean>;
  onScan: (code: string) => void;
  /** Max gap between keystrokes to treat as one scan (ms). */
  gapMs?: number;
}): { lastScan: Ref<string | null> } {
  const lastScan = ref<string | null>(null);
  const gapMs = options.gapMs ?? 50;
  let buffer = '';
  let lastKeyAt = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;

  function flush(): void {
    const code = buffer.trim();
    buffer = '';
    if (!code || code.length < 3) {
      return;
    }
    lastScan.value = code;
    options.onScan(code);
  }

  function onKeyDown(event: KeyboardEvent): void {
    if (!options.enabled.value) {
      return;
    }
    const target = event.target as HTMLElement | null;
    const tag = target?.tagName?.toLowerCase();
    if (tag === 'input' || tag === 'textarea' || target?.isContentEditable) {
      return;
    }

    const now = Date.now();
    if (now - lastKeyAt > gapMs * 4) {
      buffer = '';
    }
    lastKeyAt = now;

    if (event.key === 'Enter') {
      if (buffer.length >= 3) {
        event.preventDefault();
        flush();
      }
      return;
    }
    if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      buffer += event.key;
      if (timer) {
        clearTimeout(timer);
      }
      // Some scanners omit Enter — flush after a short idle.
      timer = setTimeout(() => {
        if (buffer.length >= 8) {
          flush();
        }
      }, gapMs * 6);
    }
  }

  onMounted(() => {
    window.addEventListener('keydown', onKeyDown);
  });
  onBeforeUnmount(() => {
    window.removeEventListener('keydown', onKeyDown);
    if (timer) {
      clearTimeout(timer);
    }
  });

  return { lastScan };
}
