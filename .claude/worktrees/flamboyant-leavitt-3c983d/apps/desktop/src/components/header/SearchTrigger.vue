<script setup lang="ts">
/**
 * SearchTrigger — global search field in the header's center.
 *
 * Rendered as a full-width input (browser-omnibox aesthetic) rather than
 * an icon button. Clicking inside the field, typing any character, or
 * hitting Cmd/Ctrl+K all open the command/search palette via
 * `openSearch`. The palette itself is not built yet — the trigger just
 * fires the event and the parent decides what to show.
 *
 * Why an input and not a read-only label
 * ──────────────────────────────────────
 *   - Laurent's request: the search should read as a "champ" (field), not
 *     a tiny icon. An actual <input> element means the OS draws a proper
 *     text cursor, selection works, and the element is self-announcing.
 *   - We still open the palette on focus/keystroke so the user isn't
 *     forced to type into this stub field — the palette takes over.
 *
 * The keyboard shortcut (Cmd/Ctrl+K) is owned here: if the trigger is
 * removed from the header, the shortcut disappears with it, so they
 * can't drift out of sync.
 */
import { onMounted, onUnmounted, ref } from "vue";
import { useI18n } from "../../composables/useI18n";

defineProps<{
  /** When true, the shortcut is disabled (e.g. a modal owns the keyboard). */
  disabled?: boolean;
}>();

const emit = defineEmits<{
  openSearch: [];
}>();

const { t } = useI18n();

/**
 * Detect the platform once at mount so we can render the right shortcut
 * badge (⌘K on macOS, Ctrl+K elsewhere). Using `navigator.platform` is
 * fine inside Tauri — the WebView reports the host OS.
 */
const shortcutLabel = ref("Ctrl+K");

function onFocus() {
  // The input is really a trigger — as soon as it receives focus we
  // open the palette and let the user type there. Keep it clickable
  // too (handled by @mousedown which preempts focus programmatically).
  emit("openSearch");
  // Immediately blur to avoid keeping the stub field focused once the
  // palette is up; otherwise the user's subsequent Tab navigates back here.
  (document.activeElement as HTMLElement | null)?.blur?.();
}

function onMouseDown(ev: MouseEvent) {
  // Preempt default focus semantics: we don't want to keep the caret
  // in this stub input; the palette is the real destination.
  ev.preventDefault();
  emit("openSearch");
}

function onKeydownInput(ev: KeyboardEvent) {
  // Any printable key or Enter from inside this field = open the palette.
  // Swallow modifier-only events (Tab/Shift/etc.) so they don't trigger
  // the palette when the user is just navigating with the keyboard.
  if (ev.key.length === 1 || ev.key === "Enter") {
    ev.preventDefault();
    emit("openSearch");
  }
}

function onKeydown(ev: KeyboardEvent) {
  // Global Cmd+K / Ctrl+K.
  const isMac = navigator.platform.toLowerCase().includes("mac");
  const modPressed = isMac ? ev.metaKey : ev.ctrlKey;
  if (!modPressed) return;
  if (ev.key !== "k" && ev.key !== "K") return;
  ev.preventDefault();
  emit("openSearch");
}

onMounted(() => {
  const isMac = navigator.platform.toLowerCase().includes("mac");
  shortcutLabel.value = isMac ? "⌘K" : "Ctrl+K";
  document.addEventListener("keydown", onKeydown);
});

onUnmounted(() => {
  document.removeEventListener("keydown", onKeydown);
});
</script>

<template>
  <label class="search-field" :class="{ 'search-field--disabled': disabled }">
    <svg class="search-field__icon" width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="7" cy="7" r="4.5" stroke="currentColor" stroke-width="1.5" fill="none" />
      <path d="M10.5 10.5L14 14" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
    </svg>
    <input
      type="text"
      class="search-field__input"
      :placeholder="t('header.searchInputPlaceholder')"
      :aria-label="t('header.searchAriaLabel')"
      :disabled="disabled"
      readonly
      @focus="onFocus"
      @mousedown="onMouseDown"
      @keydown="onKeydownInput"
    />
    <kbd class="search-field__kbd" aria-hidden="true">{{ shortcutLabel }}</kbd>
  </label>
</template>

<style scoped>
/*
 * The field is the only element in `.header-center`, and that container
 * centers its contents + flex: 1 so we get natural left/right
 * breathing room around a fixed-max-width input. On wide screens we
 * cap it at ~560px so it doesn't stretch awkwardly; on narrow screens
 * it can shrink down to 280px.
 */
.search-field {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  flex: 1 1 auto;
  min-width: 0;
  max-width: 560px;
  height: 32px;
  padding: 0 var(--space-3) 0 var(--space-4);
  background: var(--color-bg-tertiary);
  border: 1px solid transparent;
  border-radius: var(--radius-md);
  color: var(--color-text-muted);
  cursor: text;
  transition: background var(--transition-base), border-color var(--transition-base), color var(--transition-base);
}

.search-field:hover:not(.search-field--disabled) {
  background: var(--color-border);
  color: var(--color-text);
}

.search-field:focus-within:not(.search-field--disabled) {
  /* Subtle focus ring — uses the same accent language as other inputs. */
  border-color: var(--color-accent);
  box-shadow: 0 0 0 3px var(--color-accent-soft);
}

.search-field--disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.search-field__icon {
  flex-shrink: 0;
  color: var(--color-text-muted);
}

.search-field__input {
  flex: 1;
  min-width: 0;
  background: transparent;
  border: 0;
  outline: none;
  font-family: inherit;
  font-size: var(--font-size-base);
  color: var(--color-text);
  /* Placeholder styling lives on :placeholder-shown via the parent's
     muted colour; native placeholder uses a lighter shade. */
}

.search-field__input::placeholder {
  color: var(--color-text-muted);
  opacity: 0.85;
}

.search-field__input:disabled {
  cursor: not-allowed;
}

/* ⌘K / Ctrl+K badge — mimics a keyboard keycap, right-anchored. */
.search-field__kbd {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 22px;
  height: 20px;
  padding: 0 6px;
  border-radius: var(--radius-sm, 4px);
  background: var(--color-bg-secondary);
  border: 1px solid var(--color-border);
  color: var(--color-text-muted);
  font-family: inherit;
  font-size: var(--font-size-xs);
  font-weight: var(--font-weight-medium);
  letter-spacing: 0.02em;
  /* Keycap subtlety: paper-thin bottom shadow hints at 3D without
     being cartoonish. */
  box-shadow: 0 1px 0 var(--color-border);
}
</style>
