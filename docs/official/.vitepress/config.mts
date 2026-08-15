import { defineConfig } from 'vitepress'

const siteBase = process.env.VITEPRESS_BASE ?? '/BranchBalance/'

export default defineConfig({
  title: 'BranchBalance',
  description: 'Split shared Trip and Fuel expenses with clear balances, private groups, and direct Android downloads.',
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
      { text: 'Install', link: '/install' },
      { text: 'Help & guides', link: '/documentation/' },
      { text: 'Releases', link: '/releases/' }
    ],

    sidebar: {
      '/getting-started/': [
        {
          text: 'Getting started',
          items: [
            { text: 'Overview', link: '/getting-started/' },
            { text: 'Install on Android', link: '/install' },
            { text: 'Create or join a group', link: '/guides/groups' }
          ]
        },
        {
          text: 'Next steps',
          items: [
            { text: 'Create or join a group', link: '/guides/groups' },
            { text: 'Add and split expenses', link: '/guides/expenses' },
            { text: 'Plan group spending', link: '/guides/spending' },
            { text: 'Settle what people owe', link: '/guides/settlements' }
          ]
        }
      ],
      '/guides/': [
        {
          text: 'Using BranchBalance',
          items: [
            { text: 'Create or join a group', link: '/guides/groups' },
            { text: 'Add and split expenses', link: '/guides/expenses' },
            { text: 'Plan group spending', link: '/guides/spending' },
            { text: 'Settle what people owe', link: '/guides/settlements' }
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
            { text: 'Run from source', link: '/reference/development' },
            { text: 'GitHub App setup', link: '/getting-started/github-app' },
            { text: 'Android over USB', link: '/getting-started/android-usb' },
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
            { text: 'Run from source', link: '/reference/development' },
            { text: 'GitHub App setup', link: '/getting-started/github-app' },
            { text: 'Android over USB', link: '/getting-started/android-usb' },
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
      message: 'Shared expenses made clear, private, and easy to install.',
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
