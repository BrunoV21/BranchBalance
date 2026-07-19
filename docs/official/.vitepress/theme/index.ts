import { h } from 'vue'
import type { Theme } from 'vitepress'
import { useData } from 'vitepress'
import VitePressTheme from 'vitepress/theme'
import DocsHub from '../components/DocsHub.vue'
import HomePage from '../components/HomePage.vue'
import ReleasesList from '../components/ReleasesList.vue'
import './style.css'

const rawContentBase = 'https://raw.githubusercontent.com/BrunoV21/BranchBalance/main/docs/official/'

export default {
  extends: VitePressTheme,
  Layout: () => {
    const { page } = useData()

    const RawMarkdownLink = () => {
      if (page.value.isNotFound || !page.value.relativePath) return null
      if (['index.md', 'documentation/index.md', 'releases/index.md'].includes(page.value.relativePath)) return null

      return h('div', { class: 'raw-markdown-link' }, [
        h(
          'a',
          {
            href: `${rawContentBase}${page.value.relativePath}`,
            target: '_blank',
            rel: 'noopener',
            'data-raw-markdown-link': page.value.relativePath
          },
          'View raw Markdown'
        )
      ])
    }

    return h(VitePressTheme.Layout, null, {
      'doc-before': RawMarkdownLink
    })
  },
  enhanceApp({ app }) {
    app.component('DocsHub', DocsHub)
    app.component('HomePage', HomePage)
    app.component('ReleasesList', ReleasesList)
  }
} satisfies Theme
