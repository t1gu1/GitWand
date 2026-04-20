<script setup lang="ts">
/**
 * ImageDiffViewer — GitWand v1.6.2 image diff (P0 scope)
 *
 * Renders a visual diff of two versions of an image (PNG, JPEG, WebP, GIF, SVG).
 * Four display modes: side-by-side, overlay (opacity slider), blink (2 Hz
 * toggle), slider (vertical reveal). Shortcuts 1/2/3/4.
 *
 * Input contract:
 *   - `oldRev`, `newRev` are git revs (empty string = working tree, `":0"` = index).
 *     Typical wiring:
 *       • working tree modified file: `oldRev="HEAD"`, `newRev=""`
 *       • staged file:                `oldRev="HEAD"`, `newRev=":0"`
 *       • commit diff:                `oldRev="<hash>^"`, `newRev="<hash>"`
 *       • PR diff:                    `oldRev="<base>"`, `newRev="<head>"`
 *   - `status` ("modified" | "added" | "deleted") drives the missing-side affordance.
 *
 * The component fetches both versions once via `readFileAtRevision` and renders
 * everything in the browser — no Rust image decode in P0. The 20 MB guardrail
 * prevents the IPC layer from choking on unexpectedly large payloads.
 */
import { ref, computed, onMounted, onUnmounted, watch } from "vue";
import { readFileAtRevision, type FileAtRevision } from "../utils/backend";
import { useI18n } from "../composables/useI18n";
import { bytesToDataUrl, isVectorImagePath } from "../utils/imagePath";

const { t } = useI18n();

const props = defineProps<{
  cwd: string;
  filePath: string;
  oldRev: string;
  newRev: string;
  /** Rendering hint for missing-side affordance. Defaults to "modified". */
  status?: "modified" | "added" | "deleted";
}>();

type Mode = "side-by-side" | "overlay" | "blink" | "slider";

/**
 * Mode catalogue — order defines the UI tab order and the keyboard shortcut
 * mapping (1→side-by-side, 2→overlay, 3→blink, 4→slider).
 */
const MODES: Array<{ value: Mode; labelKey: "imageDiff.modeSideBySide" | "imageDiff.modeOverlay" | "imageDiff.modeBlink" | "imageDiff.modeSlider" }> = [
  { value: "side-by-side", labelKey: "imageDiff.modeSideBySide" },
  { value: "overlay", labelKey: "imageDiff.modeOverlay" },
  { value: "blink", labelKey: "imageDiff.modeBlink" },
  { value: "slider", labelKey: "imageDiff.modeSlider" },
];

const mode = ref<Mode>("side-by-side");
const oldFile = ref<FileAtRevision | null>(null);
const newFile = ref<FileAtRevision | null>(null);
const loading = ref(false);
const error = ref<string | null>(null);
const loadAnyway = ref(false); // user explicitly opted-in past the 20 MB guardrail
const oldDims = ref<{ w: number; h: number } | null>(null);
const newDims = ref<{ w: number; h: number } | null>(null);

// ─── Size guardrail ──────────────────────────────────────
// 20 MB max per side before we show a placeholder instead of loading the
// image. Matches the acceptance criteria in PLAN-v1.6.md §1.6.2.
const SIZE_LIMIT = 20 * 1024 * 1024;

const oldTooBig = computed(() => (oldFile.value?.byteLength ?? 0) > SIZE_LIMIT);
const newTooBig = computed(() => (newFile.value?.byteLength ?? 0) > SIZE_LIMIT);
const eitherTooBig = computed(() => oldTooBig.value || newTooBig.value);
const shouldRender = computed(() => !eitherTooBig.value || loadAnyway.value);

// ─── Data URLs ───────────────────────────────────────────
const oldUrl = computed(() =>
  oldFile.value && !oldFile.value.absent && shouldRender.value
    ? bytesToDataUrl(oldFile.value.bytesBase64, oldFile.value.mime)
    : null,
);
const newUrl = computed(() =>
  newFile.value && !newFile.value.absent && shouldRender.value
    ? bytesToDataUrl(newFile.value.bytesBase64, newFile.value.mime)
    : null,
);

// ─── Overlay / slider state ─────────────────────────────
const overlayOpacity = ref(0.5); // 0 = fully old, 1 = fully new
const sliderPosition = ref(0.5); // 0 = fully old, 1 = fully new (vertical wipe)

// ─── Blink state ────────────────────────────────────────
// Alternate between old and new every 500ms (2 Hz, the astronomical "blink
// comparator" cadence mentioned in PLAN-v1.6.md §1.6.2).
const blinkShowingNew = ref(true);
let blinkTimer: ReturnType<typeof setInterval> | null = null;

function startBlink() {
  stopBlink();
  blinkShowingNew.value = true;
  blinkTimer = setInterval(() => {
    blinkShowingNew.value = !blinkShowingNew.value;
  }, 500);
}

function stopBlink() {
  if (blinkTimer !== null) {
    clearInterval(blinkTimer);
    blinkTimer = null;
  }
}

watch(mode, (m) => {
  if (m === "blink") startBlink();
  else stopBlink();
});

// ─── Keyboard shortcuts ─────────────────────────────────
function onKeydown(e: KeyboardEvent) {
  // Don't hijack shortcuts when the user is typing in an input/textarea.
  const target = e.target as HTMLElement | null;
  if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) {
    return;
  }
  switch (e.key) {
    case "1": mode.value = "side-by-side"; break;
    case "2": mode.value = "overlay"; break;
    case "3": mode.value = "blink"; break;
    case "4": mode.value = "slider"; break;
  }
}

onMounted(() => {
  window.addEventListener("keydown", onKeydown);
  loadBoth();
});

onUnmounted(() => {
  window.removeEventListener("keydown", onKeydown);
  stopBlink();
});

// ─── Fetch ───────────────────────────────────────────────
async function loadBoth() {
  if (!props.cwd || !props.filePath) return;
  loading.value = true;
  error.value = null;
  oldFile.value = null;
  newFile.value = null;
  oldDims.value = null;
  newDims.value = null;
  loadAnyway.value = false;
  try {
    // Parallel read — both sides come from the same backend, no reason to serialize.
    const [oldRes, newRes] = await Promise.all([
      readFileAtRevision(props.cwd, props.oldRev, props.filePath),
      readFileAtRevision(props.cwd, props.newRev, props.filePath),
    ]);
    oldFile.value = oldRes;
    newFile.value = newRes;
  } catch (e) {
    error.value = (e as Error).message || String(e);
  } finally {
    loading.value = false;
  }
}

// Re-fetch when the target changes (parent switches files / commits).
watch(
  () => [props.cwd, props.filePath, props.oldRev, props.newRev],
  () => loadBoth(),
);

function onOldImgLoad(e: Event) {
  const el = e.target as HTMLImageElement;
  oldDims.value = { w: el.naturalWidth, h: el.naturalHeight };
}
function onNewImgLoad(e: Event) {
  const el = e.target as HTMLImageElement;
  newDims.value = { w: el.naturalWidth, h: el.naturalHeight };
}

// ─── Helpers ────────────────────────────────────────────
function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

const isVector = computed(() => isVectorImagePath(props.filePath));

// ─── Slider drag handling ───────────────────────────────
const sliderContainer = ref<HTMLElement | null>(null);

function onSliderPointer(e: PointerEvent) {
  if (!sliderContainer.value) return;
  const rect = sliderContainer.value.getBoundingClientRect();
  const ratio = (e.clientX - rect.left) / rect.width;
  sliderPosition.value = Math.min(1, Math.max(0, ratio));
}

let sliderDragging = false;
function onSliderDown(e: PointerEvent) {
  sliderDragging = true;
  (e.target as Element).setPointerCapture?.(e.pointerId);
  onSliderPointer(e);
}
function onSliderMove(e: PointerEvent) {
  if (!sliderDragging) return;
  onSliderPointer(e);
}
function onSliderUp(e: PointerEvent) {
  sliderDragging = false;
  (e.target as Element).releasePointerCapture?.(e.pointerId);
}
</script>

<template>
  <div class="image-diff-viewer">
    <!-- Header: mode toggle + file info + stats -->
    <div class="idv-header">
      <div class="idv-file-info">
        <span class="idv-file-name mono">{{ filePath.split('/').pop() }}</span>
        <span class="idv-file-path muted">{{ filePath }}</span>
      </div>

      <div class="idv-mode-toggle" role="tablist" :aria-label="t('imageDiff.modeAria')">
        <button
          v-for="m in MODES"
          :key="m.value"
          :class="['idv-mode-btn', { active: mode === m.value }]"
          role="tab"
          :aria-selected="mode === m.value"
          @click="mode = m.value"
        >
          {{ t(m.labelKey) }}
        </button>
      </div>
    </div>

    <!-- Metadata strip -->
    <div class="idv-meta" v-if="!loading && !error && (oldFile || newFile)">
      <span v-if="oldFile && !oldFile.absent" class="idv-meta-side">
        <span class="idv-meta-label idv-meta-label--old">{{ t('imageDiff.old') }}</span>
        <span v-if="oldDims">{{ oldDims.w }}×{{ oldDims.h }}</span>
        <span>{{ formatBytes(oldFile.byteLength) }}</span>
      </span>
      <span v-else class="idv-meta-side muted">
        <span class="idv-meta-label idv-meta-label--old">{{ t('imageDiff.old') }}</span>
        <span>{{ t('imageDiff.absent') }}</span>
      </span>
      <span class="idv-meta-sep">·</span>
      <span v-if="newFile && !newFile.absent" class="idv-meta-side">
        <span class="idv-meta-label idv-meta-label--new">{{ t('imageDiff.new') }}</span>
        <span v-if="newDims">{{ newDims.w }}×{{ newDims.h }}</span>
        <span>{{ formatBytes(newFile.byteLength) }}</span>
      </span>
      <span v-else class="idv-meta-side muted">
        <span class="idv-meta-label idv-meta-label--new">{{ t('imageDiff.new') }}</span>
        <span>{{ t('imageDiff.absent') }}</span>
      </span>
    </div>

    <!-- Body -->
    <div class="idv-body">
      <div v-if="loading" class="idv-state">{{ t('imageDiff.loading') }}</div>
      <div v-else-if="error" class="idv-state idv-state--error">{{ error }}</div>

      <!-- Size guardrail -->
      <div v-else-if="eitherTooBig && !loadAnyway" class="idv-state idv-state--oversized">
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        <p>{{ t('imageDiff.tooBig') }}</p>
        <p class="muted">
          {{ t(
            'imageDiff.tooBigDetail',
            oldFile ? formatBytes(oldFile.byteLength) : '—',
            newFile ? formatBytes(newFile.byteLength) : '—',
          ) }}
        </p>
        <button class="idv-load-anyway" @click="loadAnyway = true">
          {{ t('imageDiff.loadAnyway') }}
        </button>
      </div>

      <!-- SIDE BY SIDE -->
      <div v-else-if="mode === 'side-by-side'" class="idv-sbs">
        <div class="idv-sbs-pane">
          <div class="idv-pane-label idv-pane-label--old">{{ t('imageDiff.old') }}</div>
          <div class="idv-pane-canvas">
            <img v-if="oldUrl" :src="oldUrl" :alt="t('imageDiff.altOld')" @load="onOldImgLoad" />
            <div v-else class="idv-pane-empty muted">{{ t('imageDiff.noOld') }}</div>
          </div>
        </div>
        <div class="idv-sbs-pane">
          <div class="idv-pane-label idv-pane-label--new">{{ t('imageDiff.new') }}</div>
          <div class="idv-pane-canvas">
            <img v-if="newUrl" :src="newUrl" :alt="t('imageDiff.altNew')" @load="onNewImgLoad" />
            <div v-else class="idv-pane-empty muted">{{ t('imageDiff.noNew') }}</div>
          </div>
        </div>
      </div>

      <!-- OVERLAY -->
      <div v-else-if="mode === 'overlay'" class="idv-overlay">
        <div class="idv-overlay-stack">
          <img v-if="oldUrl" :src="oldUrl" :alt="t('imageDiff.altOld')" class="idv-overlay-img" @load="onOldImgLoad" />
          <img
            v-if="newUrl"
            :src="newUrl"
            :alt="t('imageDiff.altNew')"
            class="idv-overlay-img idv-overlay-img--top"
            :style="{ opacity: overlayOpacity }"
            @load="onNewImgLoad"
          />
        </div>
        <div class="idv-overlay-controls">
          <span class="idv-overlay-label idv-meta-label--old">{{ t('imageDiff.old') }}</span>
          <input
            type="range"
            min="0"
            max="1"
            step="0.01"
            v-model.number="overlayOpacity"
            :aria-label="t('imageDiff.overlaySliderAria')"
          />
          <span class="idv-overlay-label idv-meta-label--new">{{ t('imageDiff.new') }}</span>
        </div>
      </div>

      <!-- BLINK -->
      <div v-else-if="mode === 'blink'" class="idv-blink">
        <img v-if="oldUrl" :src="oldUrl" :alt="t('imageDiff.altOld')" v-show="!blinkShowingNew" @load="onOldImgLoad" />
        <img v-if="newUrl" :src="newUrl" :alt="t('imageDiff.altNew')" v-show="blinkShowingNew" @load="onNewImgLoad" />
        <div
          class="idv-blink-badge"
          :class="blinkShowingNew ? 'idv-blink-badge--new' : 'idv-blink-badge--old'"
        >
          {{ blinkShowingNew ? t('imageDiff.new') : t('imageDiff.old') }}
        </div>
      </div>

      <!-- SLIDER (vertical reveal) -->
      <div
        v-else-if="mode === 'slider'"
        ref="sliderContainer"
        class="idv-slider"
        @pointerdown="onSliderDown"
        @pointermove="onSliderMove"
        @pointerup="onSliderUp"
      >
        <img v-if="oldUrl" :src="oldUrl" :alt="t('imageDiff.altOld')" class="idv-slider-bg" @load="onOldImgLoad" />
        <div
          class="idv-slider-top"
          :style="{ clipPath: `inset(0 ${(1 - sliderPosition) * 100}% 0 0)` }"
        >
          <img v-if="newUrl" :src="newUrl" :alt="t('imageDiff.altNew')" @load="onNewImgLoad" />
        </div>
        <div
          class="idv-slider-handle"
          :style="{ left: `${sliderPosition * 100}%` }"
          :aria-label="t('imageDiff.sliderHandleAria')"
        >
          <div class="idv-slider-line"></div>
          <div class="idv-slider-knob">⇄</div>
        </div>
      </div>
    </div>

    <!-- Keyboard hint -->
    <div class="idv-hint muted">
      {{ t('imageDiff.shortcutHint') }}
      <span v-if="isVector" class="idv-hint-badge">SVG</span>
    </div>
  </div>
</template>

<style scoped>
.image-diff-viewer {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
  background: var(--color-bg);
}

.idv-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 16px;
  background: var(--color-bg-secondary);
  border-bottom: 1px solid var(--color-border);
  flex-shrink: 0;
  gap: 16px;
}

.idv-file-info {
  display: flex;
  align-items: baseline;
  gap: 10px;
  min-width: 0;
  flex: 1;
}

.idv-file-name {
  font-size: var(--text-md);
  font-weight: var(--font-semibold);
  flex-shrink: 0;
}

.idv-file-path {
  font-size: var(--text-xs);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.idv-mode-toggle {
  display: flex;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  overflow: hidden;
  flex-shrink: 0;
}

.idv-mode-btn {
  background: transparent;
  border: none;
  padding: 4px 10px;
  font-size: var(--text-xs);
  color: var(--color-text-muted);
  cursor: pointer;
  border-right: 1px solid var(--color-border);
  transition: background 120ms, color 120ms;
}

.idv-mode-btn:last-child { border-right: none; }
.idv-mode-btn:hover { background: var(--color-bg-hover); color: var(--color-text); }
.idv-mode-btn.active {
  background: var(--color-accent);
  color: var(--color-bg);
  font-weight: var(--font-semibold);
}

.idv-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 16px;
  font-size: var(--text-xs);
  border-bottom: 1px solid var(--color-border);
  background: var(--color-bg);
  flex-shrink: 0;
  flex-wrap: wrap;
}

.idv-meta-side {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.idv-meta-label {
  padding: 1px 6px;
  border-radius: 3px;
  font-weight: var(--font-semibold);
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.idv-meta-label--old { background: rgba(239, 68, 68, 0.15); color: var(--color-danger); }
.idv-meta-label--new { background: rgba(34, 197, 94, 0.15); color: var(--color-success); }
.idv-meta-sep { color: var(--color-text-muted); }

.idv-body {
  flex: 1;
  min-height: 0;
  overflow: auto;
  position: relative;
}

.idv-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  height: 100%;
  padding: 40px;
  color: var(--color-text-muted);
  text-align: center;
}

.idv-state--error { color: var(--color-danger); }

.idv-state--oversized p { margin: 0; }

.idv-load-anyway {
  margin-top: 8px;
  padding: 6px 14px;
  background: var(--color-accent);
  color: var(--color-bg);
  border: none;
  border-radius: 6px;
  cursor: pointer;
  font-weight: var(--font-semibold);
  font-size: var(--text-sm);
}
.idv-load-anyway:hover { opacity: 0.9; }

/* ─── Side by side ─────────────────────────────────────── */
.idv-sbs {
  display: grid;
  grid-template-columns: 1fr 1fr;
  height: 100%;
  min-height: 300px;
}

.idv-sbs-pane {
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border-right: 1px solid var(--color-border);
}
.idv-sbs-pane:last-child { border-right: none; }

.idv-pane-label {
  padding: 4px 12px;
  font-size: 10px;
  font-weight: var(--font-semibold);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  border-bottom: 1px solid var(--color-border);
  background: var(--color-bg-secondary);
  flex-shrink: 0;
}
.idv-pane-label--old { color: var(--color-danger); }
.idv-pane-label--new { color: var(--color-success); }

.idv-pane-canvas {
  flex: 1;
  min-height: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: auto;
  padding: 16px;
  background:
    linear-gradient(45deg, var(--color-bg-secondary) 25%, transparent 25%),
    linear-gradient(-45deg, var(--color-bg-secondary) 25%, transparent 25%),
    linear-gradient(45deg, transparent 75%, var(--color-bg-secondary) 75%),
    linear-gradient(-45deg, transparent 75%, var(--color-bg-secondary) 75%);
  background-size: 20px 20px;
  background-position: 0 0, 0 10px, 10px -10px, -10px 0;
}

.idv-pane-canvas img {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
}

.idv-pane-empty {
  font-size: var(--text-sm);
  font-style: italic;
}

/* ─── Overlay ──────────────────────────────────────────── */
.idv-overlay {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 300px;
}

.idv-overlay-stack {
  flex: 1;
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: auto;
  padding: 16px;
  min-height: 0;
}

.idv-overlay-img {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
}

.idv-overlay-img--top {
  position: absolute;
  top: 16px;
  left: 16px;
  right: 16px;
  bottom: 16px;
  margin: auto;
  pointer-events: none;
}

.idv-overlay-controls {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  background: var(--color-bg-secondary);
  border-top: 1px solid var(--color-border);
  flex-shrink: 0;
}

.idv-overlay-controls input[type="range"] {
  flex: 1;
  accent-color: var(--color-accent);
}

.idv-overlay-label {
  padding: 1px 6px;
  border-radius: 3px;
  font-weight: var(--font-semibold);
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

/* ─── Blink ────────────────────────────────────────────── */
.idv-blink {
  position: relative;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: auto;
  padding: 16px;
  min-height: 300px;
}

.idv-blink img {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
  grid-area: 1/1;
}

.idv-blink-badge {
  position: absolute;
  top: 12px;
  right: 12px;
  padding: 3px 8px;
  font-size: 10px;
  font-weight: var(--font-semibold);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  border-radius: 3px;
  pointer-events: none;
}
.idv-blink-badge--old { background: rgba(239, 68, 68, 0.15); color: var(--color-danger); }
.idv-blink-badge--new { background: rgba(34, 197, 94, 0.15); color: var(--color-success); }

/* ─── Slider ───────────────────────────────────────────── */
.idv-slider {
  position: relative;
  height: 100%;
  min-height: 300px;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  padding: 16px;
  cursor: ew-resize;
  user-select: none;
}

.idv-slider-bg,
.idv-slider-top img {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
  pointer-events: none;
}

.idv-slider-top {
  position: absolute;
  top: 16px;
  left: 16px;
  right: 16px;
  bottom: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: none;
}

.idv-slider-handle {
  position: absolute;
  top: 0;
  bottom: 0;
  transform: translateX(-50%);
  width: 2px;
  background: var(--color-accent);
  pointer-events: none;
}

.idv-slider-line {
  width: 2px;
  height: 100%;
  background: var(--color-accent);
  box-shadow: 0 0 6px rgba(139, 92, 246, 0.6);
}

.idv-slider-knob {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  width: 28px;
  height: 28px;
  background: var(--color-accent);
  color: var(--color-bg);
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  font-weight: bold;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
}

.idv-hint {
  padding: 6px 16px;
  font-size: var(--text-xs);
  border-top: 1px solid var(--color-border);
  background: var(--color-bg-secondary);
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 10px;
}

.idv-hint-badge {
  padding: 1px 6px;
  background: rgba(139, 92, 246, 0.15);
  color: var(--color-accent);
  border-radius: 3px;
  font-size: 10px;
  font-weight: var(--font-semibold);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
</style>
