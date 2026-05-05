import { describe, it, expect, beforeEach } from "vitest";

// We import after clearing localStorage so the module reads fresh state
// We also import _resetPinsForTesting to re-read localStorage into the refs
let useLaunchpadPins: typeof import("../useLaunchpadPins").useLaunchpadPins;
let _resetPinsForTesting: typeof import("../useLaunchpadPins")._resetPinsForTesting;

beforeEach(async () => {
  localStorage.clear();
  // Dynamic import ensures we always get the module-level reset fn
  const mod = await import("../useLaunchpadPins");
  useLaunchpadPins = mod.useLaunchpadPins;
  _resetPinsForTesting = mod._resetPinsForTesting;
  _resetPinsForTesting();
});

const PR_URL = "https://github.com/org/repo/pull/1";
const ISSUE_URL = "https://github.com/org/repo/issues/5";

describe("useLaunchpadPins", () => {
  it("pin() adds item; isPinned() returns true", () => {
    const p = useLaunchpadPins();
    expect(p.isPinned(PR_URL)).toBe(false);
    p.pin(PR_URL, "pr");
    expect(p.isPinned(PR_URL)).toBe(true);
  });

  it("unpin() removes item; isPinned() returns false", () => {
    const p = useLaunchpadPins();
    p.pin(PR_URL, "pr");
    p.unpin(PR_URL);
    expect(p.isPinned(PR_URL)).toBe(false);
  });

  it("snooze(url, type, 7) → isSnoozed() true; snoozedUntil() ≈ now + 7 days", () => {
    const p = useLaunchpadPins();
    const before = Date.now();
    p.snooze(PR_URL, "pr", 7);
    const after = Date.now();

    expect(p.isSnoozed(PR_URL)).toBe(true);

    const until = p.snoozedUntil(PR_URL);
    expect(until).not.toBeNull();
    const untilMs = new Date(until!).getTime();
    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
    expect(untilMs).toBeGreaterThanOrEqual(before + sevenDaysMs);
    expect(untilMs).toBeLessThanOrEqual(after + sevenDaysMs + 100);
  });

  it("snooze with past snoozedUntil → isSnoozed() returns false (auto-expiry)", () => {
    const p = useLaunchpadPins();
    // Manually insert an expired snooze via snooze() then patch localStorage
    p.snooze(PR_URL, "pr", 1);
    // Patch the stored data to put snoozedUntil in the past
    const raw = localStorage.getItem("gitwand-launchpad-pins")!;
    const data = JSON.parse(raw);
    data.snoozes[0].snoozedUntil = new Date(Date.now() - 1000).toISOString();
    localStorage.setItem("gitwand-launchpad-pins", JSON.stringify(data));
    _resetPinsForTesting(); // re-load from localStorage

    const p2 = useLaunchpadPins();
    expect(p2.isSnoozed(PR_URL)).toBe(false);
  });

  it("unsnooze() removes snooze; isSnoozed() returns false", () => {
    const p = useLaunchpadPins();
    p.snooze(PR_URL, "pr", 3);
    expect(p.isSnoozed(PR_URL)).toBe(true);
    p.unsnooze(PR_URL);
    expect(p.isSnoozed(PR_URL)).toBe(false);
  });

  it("item can be both pinned and snoozed simultaneously", () => {
    const p = useLaunchpadPins();
    p.pin(PR_URL, "pr");
    p.snooze(PR_URL, "pr", 1);
    expect(p.isPinned(PR_URL)).toBe(true);
    expect(p.isSnoozed(PR_URL)).toBe(true);
  });

  it("snoozedUntil() returns null for expired snooze", () => {
    const p = useLaunchpadPins();
    p.snooze(PR_URL, "pr", 1);
    // Patch localStorage to put snoozedUntil in the past
    const raw = localStorage.getItem("gitwand-launchpad-pins")!;
    const data = JSON.parse(raw);
    data.snoozes[0].snoozedUntil = new Date(Date.now() - 1000).toISOString();
    localStorage.setItem("gitwand-launchpad-pins", JSON.stringify(data));
    _resetPinsForTesting();

    const p2 = useLaunchpadPins();
    expect(p2.snoozedUntil(PR_URL)).toBeNull();
  });

  it("persistence: state survives a fresh call to useLaunchpadPins()", () => {
    const p = useLaunchpadPins();
    p.pin(PR_URL, "pr");
    p.snooze(ISSUE_URL, "issue", 14);

    // Simulate fresh module load by re-reading from localStorage
    _resetPinsForTesting();

    const p2 = useLaunchpadPins();
    expect(p2.isPinned(PR_URL)).toBe(true);
    expect(p2.isSnoozed(ISSUE_URL)).toBe(true);
  });
});
