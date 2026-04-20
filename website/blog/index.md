---
title: Blog
---

# Blog

<div class="blog-list">
  <a href="/blog/worktrees-submodules-auto-update" class="blog-card">
    <div class="blog-meta">Apr 20, 2026 · 8 min read</div>
    <h2 class="blog-title">Worktrees, submodules, and a broken auto-updater: what went into GitWand v1.6.3</h2>
    <p class="blog-excerpt">How I added Git worktree and submodule management to a Tauri desktop app, and fixed four silent bugs that were keeping auto-update from ever working.</p>
    <span class="blog-read">Read article →</span>
  </a>
  <a href="/blog/why-i-built-another-git-client" class="blog-card">
    <div class="blog-meta">Apr 20, 2026 · 8 min read</div>
    <h2 class="blog-title">Why I built another Git client</h2>
    <p class="blog-excerpt">There are already a dozen Git GUIs. Here's what was missing from all of them — and why I spent a year building GitWand anyway.</p>
    <span class="blog-read">Read article →</span>
  </a>
  <a href="/blog/automatic-merge-conflict-resolution" class="blog-card">
    <div class="blog-meta">Apr 20, 2026 · 10 min read</div>
    <h2 class="blog-title">How I built automatic merge conflict resolution: pattern classification and composite confidence scoring</h2>
    <p class="blog-excerpt">Pattern-based engine that auto-resolves trivial Git merge conflicts using classification, composite confidence scoring, and format-aware resolvers for JSON and Markdown.</p>
    <span class="blog-read">Read article →</span>
  </a>
</div>

<style>
.blog-list {
  margin-top: 2rem;
}
.blog-card {
  display: block;
  padding: 1.75rem 2rem;
  border: 1px solid var(--vp-c-divider);
  border-radius: 12px;
  text-decoration: none !important;
  color: inherit;
  transition: border-color 0.2s, background 0.2s;
  margin-bottom: 1.25rem;
}
.blog-card:hover {
  border-color: var(--vp-c-brand-1);
  background: var(--vp-c-bg-soft);
}
.blog-meta {
  font-size: 0.8rem;
  color: var(--vp-c-text-2);
  margin-bottom: 0.5rem;
  font-family: var(--vp-font-family-mono);
}
.blog-title {
  font-size: 1.15rem;
  font-weight: 600;
  margin: 0 0 0.6rem;
  line-height: 1.4;
  border: none;
  padding: 0;
}
.blog-excerpt {
  font-size: 0.9rem;
  color: var(--vp-c-text-2);
  margin: 0 0 1rem;
  line-height: 1.6;
}
.blog-read {
  font-size: 0.85rem;
  color: var(--vp-c-brand-1);
  font-weight: 500;
}
.blog-read:hover {
  text-decoration: underline;
}
</style>
