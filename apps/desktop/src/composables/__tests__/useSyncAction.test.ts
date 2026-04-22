/**
 * State-machine tests for computeSyncAction.
 *
 * The header's Sync split button derives its label, primary action, and
 * dropdown items from these three inputs alone. Any regression here
 * would immediately surface in the UI — hence a dedicated test.
 */

import { describe, expect, it } from "vitest";
import { computeSyncAction } from "../useSyncAction";

describe("computeSyncAction — state priority", () => {
  it("returns 'publish' when needsPublish is true, regardless of ahead/behind", () => {
    const r = computeSyncAction({ aheadCount: 3, behindCount: 2, needsPublish: true });
    expect(r.state).toBe("publish");
    expect(r.primary.id).toBe("publish");
    expect(r.primary.labelKey).toBe("syncAction.publish");
    expect(r.dropdown).toHaveLength(1);
    expect(r.dropdown[0].id).toBe("fetch");
  });

  it("returns 'clean' when ahead=0 and behind=0", () => {
    const r = computeSyncAction({ aheadCount: 0, behindCount: 0, needsPublish: false });
    expect(r.state).toBe("clean");
    // Clean state's primary does a fetch but is labelled "Up to date".
    expect(r.primary.id).toBe("fetch");
    expect(r.primary.labelKey).toBe("syncAction.upToDate");
    // No dropdown — would be redundant with primary.
    expect(r.dropdown).toEqual([]);
  });

  it("returns 'ahead' with pushN label when ahead>1 and behind=0", () => {
    const r = computeSyncAction({ aheadCount: 5, behindCount: 0, needsPublish: false });
    expect(r.state).toBe("ahead");
    expect(r.primary.id).toBe("push");
    expect(r.primary.labelKey).toBe("syncAction.pushN");
    expect(r.primaryLabelParams).toEqual({ n: 5 });
    const ids = r.dropdown.map((d) => d.id);
    expect(ids).toContain("sync");
    expect(ids).toContain("fetch");
  });

  it("uses singular 'pushOne' label when ahead=1", () => {
    const r = computeSyncAction({ aheadCount: 1, behindCount: 0, needsPublish: false });
    expect(r.state).toBe("ahead");
    expect(r.primary.labelKey).toBe("syncAction.pushOne");
    expect(r.primaryLabelParams).toEqual({ n: 1 });
  });

  it("returns 'behind' with pullN label when behind>1 and ahead=0", () => {
    const r = computeSyncAction({ aheadCount: 0, behindCount: 2, needsPublish: false });
    expect(r.state).toBe("behind");
    expect(r.primary.id).toBe("pull");
    expect(r.primary.labelKey).toBe("syncAction.pullN");
    expect(r.primaryLabelParams).toEqual({ n: 2 });
    const ids = r.dropdown.map((d) => d.id);
    expect(ids).toContain("sync");
    expect(ids).toContain("rebaseOntoRemote");
    expect(ids).toContain("fetch");
  });

  it("uses singular 'pullOne' label when behind=1", () => {
    const r = computeSyncAction({ aheadCount: 0, behindCount: 1, needsPublish: false });
    expect(r.state).toBe("behind");
    expect(r.primary.labelKey).toBe("syncAction.pullOne");
    expect(r.primaryLabelParams).toEqual({ n: 1 });
  });

  it("returns 'diverged' with sync as primary when both ahead>0 and behind>0", () => {
    const r = computeSyncAction({ aheadCount: 2, behindCount: 3, needsPublish: false });
    expect(r.state).toBe("diverged");
    expect(r.primary.id).toBe("sync");
    expect(r.primary.labelKey).toBe("syncAction.sync");
    // Diverged dropdown must expose explicit rebase + merge choices so the
    // user can steer the reconciliation strategy.
    const ids = r.dropdown.map((d) => d.id);
    expect(ids).toContain("rebaseOntoRemote");
    expect(ids).toContain("mergeRemote");
    expect(ids).toContain("fetch");
  });
});

describe("computeSyncAction — edge cases & coercion", () => {
  it("treats negative counts as zero (defensive)", () => {
    const r = computeSyncAction({ aheadCount: -1, behindCount: -1, needsPublish: false });
    expect(r.state).toBe("clean");
  });

  it("truncates fractional counts via | 0 coercion", () => {
    const r = computeSyncAction({ aheadCount: 2.9, behindCount: 0, needsPublish: false });
    expect(r.state).toBe("ahead");
    // 2.9 | 0 === 2
    expect(r.primaryLabelParams).toEqual({ n: 2 });
  });

  it("publish wins over diverged", () => {
    const r = computeSyncAction({ aheadCount: 1, behindCount: 1, needsPublish: true });
    expect(r.state).toBe("publish");
  });

  it("publish wins over ahead", () => {
    const r = computeSyncAction({ aheadCount: 4, behindCount: 0, needsPublish: true });
    expect(r.state).toBe("publish");
  });

  it("publish wins over clean (no counters)", () => {
    const r = computeSyncAction({ aheadCount: 0, behindCount: 0, needsPublish: true });
    expect(r.state).toBe("publish");
  });
});

describe("computeSyncAction — dropdown shape stability", () => {
  it("every dropdown item has a non-empty id and labelKey", () => {
    const inputs = [
      { aheadCount: 0, behindCount: 0, needsPublish: false },
      { aheadCount: 3, behindCount: 0, needsPublish: false },
      { aheadCount: 0, behindCount: 3, needsPublish: false },
      { aheadCount: 2, behindCount: 2, needsPublish: false },
      { aheadCount: 0, behindCount: 0, needsPublish: true },
    ];
    for (const input of inputs) {
      const r = computeSyncAction(input);
      for (const item of r.dropdown) {
        expect(item.id).toBeTruthy();
        expect(item.labelKey).toMatch(/^syncAction\./);
      }
      expect(r.primary.id).toBeTruthy();
      expect(r.primary.labelKey).toMatch(/^syncAction\./);
    }
  });
});
