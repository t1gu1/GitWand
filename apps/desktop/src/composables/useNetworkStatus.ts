import { ref, onMounted, onUnmounted } from "vue";

/**
 * Reactive wrapper around `navigator.onLine` + `online`/`offline` events.
 *
 * Returns `isOffline` — a readonly ref that is `true` whenever the browser
 * reports no network connectivity. Components can use this to disable remote
 * operations (push, pull, fetch, clone, …) and surface an indicator.
 */
export function useNetworkStatus() {
  const isOffline = ref(!navigator.onLine);

  function onOnline() { isOffline.value = false; }
  function onOffline() { isOffline.value = true; }

  onMounted(() => {
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
  });

  onUnmounted(() => {
    window.removeEventListener("online", onOnline);
    window.removeEventListener("offline", onOffline);
  });

  return { isOffline };
}
