/**
 * F1 — Mode hors-ligne — composable + network guard.
 *
 * Tests the two surfaces that the rest of the app talks to:
 *
 *  - `useConnectivity` / `probeConnectivity` — flips `isOnline` based on the
 *    result of `checkRemoteReachable`, and emits a log entry on transitions.
 *  - `requireOnline` (`utils/networkGuard.ts`) — returns `false` + logs a
 *    `warn` entry when offline, returns `true` when online.
 *
 * We don't need integration coverage for the polling loop here — the poller
 * is unit-tested elsewhere; this file only proves the bridge between the
 * probe layer and the guard layer is wired correctly.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

// ─── Mock the backend module BEFORE importing the composable ──────────
//
// `useConnectivity` imports `checkRemoteReachable` and `gitRemoteInfo`
// from `../utils/backend` at module load. Mocking the module via
// `vi.mock` lets us swap the implementations without touching the
// network or starting a Tauri runtime.

const mockCheckRemoteReachable = vi.fn<
  (url: string, timeoutMs: number) => Promise<boolean>
>();
const mockGitRemoteInfo = vi.fn<(cwd: string) => Promise<{
  name: string;
  url: string;
  provider: string;
  owner: string;
  repo: string;
}>>();

vi.mock("../utils/backend", () => ({
  checkRemoteReachable: (url: string, timeoutMs: number) =>
    mockCheckRemoteReachable(url, timeoutMs),
  gitRemoteInfo: (cwd: string) => mockGitRemoteInfo(cwd),
}));

// Import AFTER vi.mock so the modules pick up the mocked backend.
// `isOnline` is the module-level singleton ref; we reset it before each test.
import {
  isOnline,
  lastCheckedAt,
  probeConnectivity,
} from "../composables/useConnectivity";
import { requireOnline } from "../utils/networkGuard";
import { useLogs } from "../composables/useLogs";

describe("F1 — useConnectivity.probeConnectivity", () => {
  beforeEach(() => {
    // Reset singletons between tests so each case starts from a clean slate.
    isOnline.value = true;
    lastCheckedAt.value = null;
    mockCheckRemoteReachable.mockReset();
    mockGitRemoteInfo.mockReset();
    // Drain the shared log buffer so we can assert on what THIS test wrote.
    useLogs().clearLogs();
  });

  it("flips isOnline to false when the probe says unreachable", async () => {
    mockGitRemoteInfo.mockResolvedValue({
      name: "origin",
      url: "https://github.com/foo/bar.git",
      provider: "github",
      owner: "foo",
      repo: "bar",
    });
    mockCheckRemoteReachable.mockResolvedValue(false);

    await probeConnectivity("/tmp/repo");

    expect(isOnline.value).toBe(false);
    expect(mockCheckRemoteReachable).toHaveBeenCalledTimes(1);
    expect(mockCheckRemoteReachable).toHaveBeenCalledWith(
      "https://github.com/foo/bar.git",
      expect.any(Number),
    );
  });

  it("logs a WARN entry on the online → offline transition", async () => {
    mockGitRemoteInfo.mockResolvedValue({
      name: "origin",
      url: "https://github.com/foo/bar.git",
      provider: "github",
      owner: "foo",
      repo: "bar",
    });
    mockCheckRemoteReachable.mockResolvedValue(false);

    await probeConnectivity("/tmp/repo");

    const { entries } = useLogs();
    const warns = entries.value.filter((e) => e.level === "warn");
    expect(warns.length).toBeGreaterThan(0);
    expect(warns[0].message).toMatch(/Connectivity lost/i);
  });

  it("logs an INFO entry on the offline → online transition", async () => {
    // Start offline.
    isOnline.value = false;
    useLogs().clearLogs();

    mockGitRemoteInfo.mockResolvedValue({
      name: "origin",
      url: "https://github.com/foo/bar.git",
      provider: "github",
      owner: "foo",
      repo: "bar",
    });
    mockCheckRemoteReachable.mockResolvedValue(true);

    await probeConnectivity("/tmp/repo");

    expect(isOnline.value).toBe(true);
    const infos = useLogs().entries.value.filter((e) => e.level === "info");
    expect(infos.some((e) => /restored/i.test(e.message))).toBe(true);
  });

  it("does not probe when no repo path is provided (stays optimistic)", async () => {
    await probeConnectivity(null);
    expect(mockCheckRemoteReachable).not.toHaveBeenCalled();
    expect(isOnline.value).toBe(true);
  });

  it("does not flip state when gitRemoteInfo throws (no remote configured)", async () => {
    mockGitRemoteInfo.mockRejectedValue(new Error("No remote found"));
    isOnline.value = true;

    await probeConnectivity("/tmp/repo");

    expect(mockCheckRemoteReachable).not.toHaveBeenCalled();
    // Stays optimistic when there's no remote to probe.
    expect(isOnline.value).toBe(true);
  });
});

describe("F1 — networkGuard.requireOnline", () => {
  beforeEach(() => {
    isOnline.value = true;
    useLogs().clearLogs();
  });

  it("returns true when online", () => {
    isOnline.value = true;
    expect(requireOnline("push")).toBe(true);
    expect(useLogs().entries.value.length).toBe(0);
  });

  it("returns false when offline", () => {
    isOnline.value = false;
    expect(requireOnline("push")).toBe(false);
  });

  it("logs a WARN entry naming the suppressed operation", () => {
    isOnline.value = false;
    requireOnline("push");
    const { entries } = useLogs();
    const warns = entries.value.filter((e) => e.level === "warn");
    expect(warns.length).toBe(1);
    expect(warns[0].message).toContain("push");
    expect(warns[0].message).toMatch(/offline/i);
  });
});
