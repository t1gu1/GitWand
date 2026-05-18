import { ref, onMounted, onUnmounted } from "vue";

/**
 * Reactive network-status composable.
 *
 * Two detection strategies depending on the runtime:
 *
 * ── Browser (dev:web / pnpm dev:web) ──────────────────────────────────────
 * `navigator.onLine` is reliable in a real browser: the OS network stack
 * drives it, and the `online`/`offline` DOM events fire promptly.
 * We simply mirror that value and subscribe to the events.
 *
 * ── Tauri WebView ─────────────────────────────────────────────────────────
 * `navigator.onLine` is always `true` in the Tauri WebView because it
 * reflects "is tauri://localhost reachable?" — which it always is, regardless
 * of internet connectivity.
 * Fix: probe a real HTTPS endpoint (HEAD, no-cors, 5 s timeout) every 30 s
 * and on every `online`/`offline` event. An opaque success → online; a
 * network-level throw → offline.
 */

/** True when running inside a Tauri app (window.__TAURI__ is injected by Tauri). */
const IS_TAURI = typeof window !== "undefined" && "__TAURI__" in window;

const PROBE_URL = "https://github.com";
const PROBE_INTERVAL = 30_000; // ms

async function probeNetwork(): Promise<boolean> {
  try {
    await fetch(PROBE_URL, {
      method: "HEAD",
      mode: "no-cors",
      cache: "no-store",
      signal: AbortSignal.timeout(5_000),
    });
    return true; // opaque success = network reachable
  } catch {
    return false; // TypeError (network) or AbortError (timeout)
  }
}

export function useNetworkStatus() {
  const isOffline = ref(IS_TAURI ? false : !navigator.onLine);

  let intervalId: ReturnType<typeof setInterval> | null = null;

  async function refresh() {
    if (IS_TAURI) {
      isOffline.value = !(await probeNetwork());
    } else {
      isOffline.value = !navigator.onLine;
    }
  }

  function onOnline() { void refresh(); }
  function onOffline() { void refresh(); }

  onMounted(() => {
    if (IS_TAURI) {
      void refresh(); // initial probe
      intervalId = setInterval(refresh, PROBE_INTERVAL);
    }
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
  });

  onUnmounted(() => {
    if (intervalId !== null) clearInterval(intervalId);
    window.removeEventListener("online", onOnline);
    window.removeEventListener("offline", onOffline);
  });

  return { isOffline };
}
