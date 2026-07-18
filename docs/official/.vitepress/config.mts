import { defineConfig } from 'vitepress'

const siteBase = process.env.VITEPRESS_BASE ?? '/BranchBalance/'

export default defineConfig({
  title: 'BranchBalance',
  description: 'Open-source shared expenses backed by private GitHub repositories.',
  base: siteBase,
  cleanUrls: true,
  lastUpdated: true,
  appearance: true,

  head: [
    ['meta', { name: 'theme-color', content: '#c45f4b' }],
    ['link', { rel: 'icon', type: 'image/svg+xml', href: `${siteBase}brand/branch-balance-icon.svg` }]
  ],

  themeConfig: {
    logo: '/brand/branch-balance-icon.svg',
    siteTitle: 'BranchBalance',

    nav: [
      { text: 'Product', link: '/' },
      { text: 'Documentation', link: '/documentation/' },
      { text: 'Releases', link: '/releases/' },
      { text: 'Data ownership', link: '/documentation/data-ownership' }
    ],

    sidebar: {
      '/getting-started/': [
        {
          text: 'Getting started',
          items: [
            { text: 'Overview', link: '/getting-started/' },
            { text: 'GitHub App setup', link: '/getting-started/github-app' },
            { text: 'Android over USB', link: '/getting-started/android-usb' }
          ]
        },
        {
          text: 'Next steps',
          items: [
            { text: 'Create and invite a group', link: '/guides/groups' },
            { text: 'Add and split expenses', link: '/guides/expenses' },
            { text: 'Plan group spending', link: '/guides/spending' }
          ]
        }
      ],
      '/guides/': [
        {
          text: 'Using BranchBalance',
          items: [
            { text: 'Create and invite a group', link: '/guides/groups' },
            { text: 'Add and split expenses', link: '/guides/expenses' },
            { text: 'Plan group spending', link: '/guides/spending' }
          ]
        },
        {
          text: 'Understand your data',
          items: [
            { text: 'Data ownership', link: '/documentation/data-ownership' },
            { text: 'Membership and permissions', link: '/documentation/permissions' },
            { text: 'Credential security', link: '/documentation/security' }
          ]
        }
      ],
      '/documentation/': [
        {
          text: 'Data & ownership',
          items: [
            { text: 'Documentation home', link: '/documentation/' },
            { text: 'How your data is stored', link: '/documentation/data-ownership' },
            { text: 'Membership and permissions', link: '/documentation/permissions' },
            { text: 'Credential security', link: '/documentation/security' }
          ]
        },
        {
          text: 'Product reference',
          items: [
            { text: 'Product requirements', link: '/reference/PRD' },
            { text: 'Architecture', link: '/reference/architecture' },
            { text: 'Testing', link: '/reference/testing' }
          ]
        }
      ],
      '/reference/': [
        {
          text: 'Product reference',
          items: [
            { text: 'Product requirements', link: '/reference/PRD' },
            { text: 'Architecture', link: '/reference/architecture' },
            { text: 'Testing', link: '/reference/testing' }
          ]
        },
        {
          text: 'Data & ownership',
          items: [
            { text: 'How your data is stored', link: '/documentation/data-ownership' },
            { text: 'Membership and permissions', link: '/documentation/permissions' },
            { text: 'Credential security', link: '/documentation/security' }
          ]
        }
      ]
    },

    socialLinks: [
      { icon: 'github', link: 'https://github.com/BrunoV21/BranchBalance' }
    ],

    editLink: {
      pattern: 'https://github.com/BrunoV21/BranchBalance/edit/main/docs/official/:path',
      text: 'Improve this page on GitHub'
    },

    footer: {
      message: 'Shared expenses, backed by a repository your group controls.',
      copyright: 'MIT licensed and built in the open.'
    },

    search: {
      provider: 'local'
    },

    outline: {
      level: [2, 3],
      label: 'On this page'
    },

    docFooter: {
      prev: 'Previous guide',
      next: 'Next guide'
    }
  }
})
