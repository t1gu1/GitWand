import { defineConfig } from 'vitepress'

export default defineConfig({
  title: 'GitWand',
  description: "Git's magic wand — smart conflict resolution & native Git client",
  base: '/',

  sitemap: {
    hostname: 'https://gitwand.devlint.fr',
  },

  head: [
    ['link', { rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' }],
    // Open Graph
    ['meta', { property: 'og:type', content: 'website' }],
    ['meta', { property: 'og:site_name', content: 'GitWand' }],
    ['meta', { property: 'og:image', content: 'https://gitwand.devlint.fr/og-image.png' }],
    ['meta', { property: 'og:image:width', content: '1200' }],
    ['meta', { property: 'og:image:height', content: '630' }],
    // Twitter / X
    ['meta', { name: 'twitter:card', content: 'summary_large_image' }],
    ['meta', { name: 'twitter:image', content: 'https://gitwand.devlint.fr/og-image.png' }],
    // Misc
    ['meta', { name: 'theme-color', content: '#7c3aed' }],
  ],

  themeConfig: {
    logo: '/logo.svg',

    nav: [
      { text: 'Guide', link: '/guide/getting-started' },
      { text: 'Reference', link: '/reference/core-api' },
      { text: 'Blog', link: '/blog/' },
      { text: "What's new", link: '/changelog' },
    ],

    sidebar: {
      '/guide/': [
        {
          text: 'Guide',
          items: [
            { text: 'Getting Started', link: '/guide/getting-started' },
            { text: 'Desktop App', link: '/guide/desktop' },
            { text: 'CLI', link: '/guide/cli' },
            { text: 'AI integrations', link: '/guide/ai' },
            { text: 'MCP Server', link: '/guide/mcp' },
            { text: 'VS Code Extension', link: '/guide/vscode' },
            { text: 'Conflict Resolution', link: '/guide/conflict-resolution' },
          ],
        },
      ],
      '/reference/': [
        {
          text: 'Reference',
          items: [
            { text: 'Core API', link: '/reference/core-api' },
            { text: 'Configuration', link: '/reference/config' },
            { text: 'CLI Commands', link: '/reference/cli-commands' },
          ],
        },
      ],
      '/blog/': [
        {
          text: 'Blog',
          items: [
            { text: 'All articles', link: '/blog/' },
            { text: 'Claude Code + GitWand: AI agents & merges', link: '/blog/claude-code-gitwand-ai-agents' },
            { text: 'Auto-merge failure modes', link: '/blog/auto-merge-failure-modes' },
            { text: 'Splitting a commit by hunks (v1.7.0)', link: '/blog/split-commit-by-hunks' },
            { text: 'Worktrees, submodules & auto-update', link: '/blog/worktrees-submodules-auto-update' },
            { text: 'Why I built another Git client', link: '/blog/why-i-built-another-git-client' },
            { text: 'Automatic merge conflict resolution', link: '/blog/automatic-merge-conflict-resolution' },
          ],
        },
      ],
    },

    socialLinks: [
      { icon: 'github', link: 'https://github.com/devlint/GitWand' },
    ],

    footer: {
      message: 'Released under the MIT License.',
      copyright: 'Copyright © 2026 <a href="https://github.com/devlint" target="_blank">Devlint</a>',
    },
  },
})
