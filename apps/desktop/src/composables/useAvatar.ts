/**
 * useAvatar — single source of truth for the colored-initials avatar disks
 * used across the app (commit log & graph, dashboard, PR views, comment
 * threads).
 *
 * Visual language: outline style — transparent fill, with a deterministic
 * colored border and matching initials. Key the color off a stable string
 * (prefer email, fall back to name) so the same person keeps the same color
 * everywhere.
 */

import type { CSSProperties } from "vue";

/** Deterministic hue (0–359) for a string — same key always maps to the same color. */
export function avatarHue(key: string): number {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) | 0;
  return Math.abs(h) % 360;
}

/** First+last initials, uppercased. A single token yields its first two chars. */
export function avatarInitials(name: string): string {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/** Inline style object for an avatar disk keyed by a stable string. */
export function avatarStyle(key: string): CSSProperties {
  const color = `hsl(${avatarHue(key)} 70% 55%)`;
  return { borderColor: color, color, background: "transparent" };
}

export function useAvatar() {
  return { avatarHue, avatarInitials, avatarStyle };
}
