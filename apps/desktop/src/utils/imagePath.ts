/**
 * Extensions that the image-diff viewer (v1.6.2) handles natively.
 *
 * Kept in sync with:
 * - Rust `guess_mime_from_ext` in `src-tauri/src/lib.rs`
 * - Node `guessMimeFromExt` in `dev-server.mjs`
 *
 * P0 scope: PNG, JPEG, SVG, WebP, GIF (per PLAN-v1.6.md §1.6.2).
 * BMP and ICO are supported opportunistically because the backend MIME
 * detector already recognizes them — they fall through to the raster code
 * path without extra work.
 */
const IMAGE_EXTENSIONS = new Set([
  "png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "ico",
]);

/** SVG needs a dedicated render path (inline XML + optional text-diff fallback). */
const VECTOR_EXTENSIONS = new Set(["svg"]);

/** Formats that carry animation frames and need loop-synchronisation in side-by-side. */
const ANIMATED_EXTENSIONS = new Set(["gif", "webp"]);

function extOf(path: string): string {
  const m = path.toLowerCase().match(/\.([a-z0-9]+)$/);
  return m ? m[1] : "";
}

/** True when the file should be rendered by ImageDiffViewer instead of DiffViewer. */
export function isImagePath(path: string | null | undefined): boolean {
  if (!path) return false;
  return IMAGE_EXTENSIONS.has(extOf(path));
}

/** True for formats that should use the vector (SVG) code path. */
export function isVectorImagePath(path: string | null | undefined): boolean {
  if (!path) return false;
  return VECTOR_EXTENSIONS.has(extOf(path));
}

/** True for formats that can carry animation frames. */
export function isAnimatedImagePath(path: string | null | undefined): boolean {
  if (!path) return false;
  return ANIMATED_EXTENSIONS.has(extOf(path));
}

/**
 * Convert base64-encoded image bytes into a `data:` URL usable by `<img src>`
 * or CSS `background-image`. The MIME defaults to `application/octet-stream`
 * when the caller can't provide one — which will cause the browser to refuse
 * to render, so always prefer to pass an image MIME when known.
 */
export function bytesToDataUrl(bytesBase64: string, mime: string): string {
  return `data:${mime || "application/octet-stream"};base64,${bytesBase64}`;
}
