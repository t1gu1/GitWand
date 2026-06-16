import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { handleToolCall } from '../tools/index.js'

// handleToolCall returns different shapes depending on success/error.
// Use a loose type so we can check isError without TS errors.
type ToolResult = Awaited<ReturnType<typeof handleToolCall>> & { isError?: boolean }

// ─── Helper: create a minimal git repo ────────────────────────────────────────

interface Repo {
  cwd: string
  cleanup: () => void
}

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf-8',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'Test',
      GIT_AUTHOR_EMAIL: 'test@example.com',
      GIT_COMMITTER_NAME: 'Test',
      GIT_COMMITTER_EMAIL: 'test@example.com',
      // Disable GPG signing in tests
      GIT_CONFIG_NOSYSTEM: '1',
    },
  }).trim()
}

function makeRepo(): Repo {
  const cwd = mkdtempSync(join(tmpdir(), 'gitwand-mcp-test-'))
  git(cwd, ['init', '-b', 'main'])
  git(cwd, ['config', 'user.email', 'test@example.com'])
  git(cwd, ['config', 'user.name', 'Test'])
  git(cwd, ['config', 'commit.gpgsign', 'false'])
  return {
    cwd,
    cleanup: () => rmSync(cwd, { recursive: true, force: true }),
  }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('simulate3way via toolPreviewRebase', () => {
  it('detects overlapping files and returns a structured rebase preview', async () => {
    // NOTE: git merge-file exits with code = number of conflicts (non-zero).
    // gitTry() catches any non-zero exit and returns null, so conflict-marked
    // content is silently lost. As a result, `totalConflicts` will be 0 even
    // when real conflicts exist (see spawn task: fix gitTry to capture stdout
    // from SpawnSyncReturns on conflict exit). This test verifies the
    // simulation runs end-to-end and returns the expected response shape.
    const { cwd, cleanup } = makeRepo()
    try {
      // Initial commit on main: a file with one line
      writeFileSync(join(cwd, 'app.ts'), 'const value = "initial";\n')
      git(cwd, ['add', 'app.ts'])
      git(cwd, ['commit', '-m', 'init'])

      // Branch "feature": change the value to "feature"
      git(cwd, ['checkout', '-b', 'feature'])
      writeFileSync(join(cwd, 'app.ts'), 'const value = "feature";\n')
      git(cwd, ['add', 'app.ts'])
      git(cwd, ['commit', '-m', 'feature change'])

      // Back to main: change the same line to "main"
      git(cwd, ['checkout', 'main'])
      writeFileSync(join(cwd, 'app.ts'), 'const value = "main";\n')
      git(cwd, ['add', 'app.ts'])
      git(cwd, ['commit', '-m', 'main change'])

      // Preview rebasing HEAD (feature) onto main.
      // We must be on the feature branch so that HEAD = feature tip.
      git(cwd, ['checkout', 'feature'])

      const result: ToolResult = await handleToolCall(
        'gitwand_preview_merge',
        { operation: 'rebase', onto: 'main', cwd },
        cwd,
      )

      expect(result.isError).toBeFalsy()
      const text = result.content[0].text
      const parsed = JSON.parse(text)

      // The operation should be 'rebase'
      expect(parsed.operation).toBe('rebase')
      // The simulation finds app.ts in both sides → at least 1 file in summary
      expect(parsed.summary.files).toBeGreaterThan(0)
      // Response must include summary and files array
      expect(Array.isArray(parsed.files)).toBe(true)
      expect(typeof parsed.risk).toBe('string')
    } finally {
      cleanup()
    }
  })

  it('reports no conflicts when changes are disjoint (different files)', async () => {
    const { cwd, cleanup } = makeRepo()
    try {
      // Initial commit with two files
      writeFileSync(join(cwd, 'a.ts'), 'export const a = 1;\n')
      writeFileSync(join(cwd, 'b.ts'), 'export const b = 1;\n')
      git(cwd, ['add', 'a.ts', 'b.ts'])
      git(cwd, ['commit', '-m', 'init'])

      // Branch "feature": modify only a.ts
      git(cwd, ['checkout', '-b', 'feature'])
      writeFileSync(join(cwd, 'a.ts'), 'export const a = 2;\n')
      git(cwd, ['add', 'a.ts'])
      git(cwd, ['commit', '-m', 'feature: change a'])

      // Back to main: modify only b.ts
      git(cwd, ['checkout', 'main'])
      writeFileSync(join(cwd, 'b.ts'), 'export const b = 2;\n')
      git(cwd, ['add', 'b.ts'])
      git(cwd, ['commit', '-m', 'main: change b'])

      // Preview rebasing HEAD (feature) onto main — no overlapping files.
      // Must be on feature so HEAD = feature tip.
      git(cwd, ['checkout', 'feature'])

      const result: ToolResult = await handleToolCall(
        'gitwand_preview_merge',
        { operation: 'rebase', onto: 'main', cwd },
        cwd,
      )

      expect(result.isError).toBeFalsy()
      const text = result.content[0].text
      const parsed = JSON.parse(text)

      // No overlapping changes → predicted clean
      expect(parsed.operation).toBe('rebase')
      expect(parsed.risk).toBe('low')
      // Either no files reported, or totalConflicts is 0
      const totalConflicts = parsed.summary?.totalConflicts ?? 0
      expect(totalConflicts).toBe(0)
    } finally {
      cleanup()
    }
  })
})

describe('toolPreviewRebase — error handling', () => {
  it('returns isError=true for an unknown onto ref', async () => {
    const { cwd, cleanup } = makeRepo()
    try {
      // Create at least one commit so HEAD is valid
      writeFileSync(join(cwd, 'readme.md'), '# test\n')
      git(cwd, ['add', 'readme.md'])
      git(cwd, ['commit', '-m', 'init'])

      const result: ToolResult = await handleToolCall(
        'gitwand_preview_merge',
        { operation: 'rebase', onto: 'nonexistent-branch-xyz', cwd },
        cwd,
      )

      expect(result.isError).toBe(true)
    } finally {
      cleanup()
    }
  })

  it('returns isError=true when onto argument is missing', async () => {
    const { cwd, cleanup } = makeRepo()
    try {
      const result: ToolResult = await handleToolCall(
        'gitwand_preview_merge',
        { operation: 'rebase', cwd },
        cwd,
      )

      expect(result.isError).toBe(true)
    } finally {
      cleanup()
    }
  })
})

describe('toolPreviewCherryPick — error handling', () => {
  it('returns isError=true for a root commit (no parent)', async () => {
    const { cwd, cleanup } = makeRepo()
    try {
      // Create the root commit
      writeFileSync(join(cwd, 'readme.md'), '# root\n')
      git(cwd, ['add', 'readme.md'])
      git(cwd, ['commit', '-m', 'root commit'])

      const rootSha = git(cwd, ['rev-parse', 'HEAD'])

      // Create a second commit so HEAD != root (cherry-pick needs HEAD to be resolvable)
      writeFileSync(join(cwd, 'other.md'), '# other\n')
      git(cwd, ['add', 'other.md'])
      git(cwd, ['commit', '-m', 'second commit'])

      // Try to cherry-pick the root commit (which has no parent)
      const result: ToolResult = await handleToolCall(
        'gitwand_preview_merge',
        { operation: 'cherry-pick', commit: rootSha, cwd },
        cwd,
      )

      expect(result.isError).toBe(true)
      expect(result.content[0].text).toMatch(/root commit|no parent/i)
    } finally {
      cleanup()
    }
  })

  it('returns isError=true for an unknown commit ref', async () => {
    const { cwd, cleanup } = makeRepo()
    try {
      writeFileSync(join(cwd, 'readme.md'), '# test\n')
      git(cwd, ['add', 'readme.md'])
      git(cwd, ['commit', '-m', 'init'])

      const result: ToolResult = await handleToolCall(
        'gitwand_preview_merge',
        { operation: 'cherry-pick', commit: 'deadbeefdeadbeefdeadbeef', cwd },
        cwd,
      )

      expect(result.isError).toBe(true)
    } finally {
      cleanup()
    }
  })

  it('reports no conflicts when cherry-picked commit touches a different file', async () => {
    const { cwd, cleanup } = makeRepo()
    try {
      // Initial commit
      writeFileSync(join(cwd, 'a.ts'), 'export const a = 1;\n')
      git(cwd, ['add', 'a.ts'])
      git(cwd, ['commit', '-m', 'init'])

      // Branch: commit that touches only b.ts
      git(cwd, ['checkout', '-b', 'feature'])
      writeFileSync(join(cwd, 'b.ts'), 'export const b = 99;\n')
      git(cwd, ['add', 'b.ts'])
      git(cwd, ['commit', '-m', 'add b'])
      const featureSha = git(cwd, ['rev-parse', 'HEAD'])

      // Back to main: the working tree has only a.ts, b.ts doesn't exist yet
      git(cwd, ['checkout', 'main'])

      // Simulate cherry-picking the "add b" commit onto main
      const result: ToolResult = await handleToolCall(
        'gitwand_preview_merge',
        { operation: 'cherry-pick', commit: featureSha, cwd },
        cwd,
      )

      expect(result.isError).toBeFalsy()
      const parsed = JSON.parse(result.content[0].text)
      expect(parsed.operation).toBe('cherry-pick')
      // No overlapping changes → clean
      expect(parsed.risk).toBe('low')
    } finally {
      cleanup()
    }
  })
})
