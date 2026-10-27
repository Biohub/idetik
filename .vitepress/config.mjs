import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitepress'
import typedocSidebar from '../docs/api/typedoc-sidebar.json' with { type: 'json' }
import builtWith from './theme/components/showcase/built-with.json' with { type: 'json' }
import { loadShowcase } from './showcase.js'

function getLatestVersion() {
  try {
    const tag = execSync("git tag --list 'v*' --sort=-v:refname", { encoding: 'utf-8' })
      .split('\n')[0]
      .trim()
    if (tag) return tag.replace(/^v/, '')
  } catch {
    // fall through to package.json
  }
  return JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf-8')).version
}

// Showcase sidebar: the examples (sorted like the gallery), then the external
// built-with list. Thumbnail paths are relative so they survive --base.
const thumb = (src) => `<img class="showcase-thumb" src="..${src}" alt="">`

function showcaseSidebar() {
  const items = loadShowcase().map(({ id, title }) => ({
    text: `${thumb(`/examples/${id}/thumbnail.jpg`)}${title}`,
    link: `/showcase/${id}`,
  }))
  return [
    { text: 'Examples', link: '/showcase/', items },
    {
      text: 'Built with Idetik',
      items: builtWith.map(({ title, url, image }) => ({ text: `${thumb(image)}${title}`, link: url })),
    },
  ]
}

const headingRegex = /<h(\d*).*?>(.*?<a.*? href="#.*?".*?>.*?<\/a>)<\/h\1>/gi
const headingContentRegex = /(.*?)<a class="header-anchor" href="#(.*?)".*?>.*?<\/a>/i

function* splitPageIntoSections(html) {
  const result = html.split(headingRegex)
  result.shift()
  let parentTitles = []
  const clearHtmlTags = (str) => str.replace(/<[^>]*>/g, '')
  for (let i = 0; i < result.length; i += 3) {
    const level = Number.parseInt(result[i]) - 1
    const heading = result[i + 1]
    const headingResult = headingContentRegex.exec(heading)
    const title = clearHtmlTags(headingResult?.[1] ?? '').trim()
    const anchor = headingResult?.[2] ?? ''
    const content = result[i + 2]
    if (!title || !content) continue
    let titles = parentTitles.slice(0, level)
    titles[level] = title
    titles = titles.filter(Boolean)
    yield { anchor, titles, text: clearHtmlTags(content) }
    if (level === 0) {
      parentTitles = [title]
    } else {
      parentTitles[level] = title
    }
  }
}

// GitHub Pages project path. Set here, not via --base, so the raw-HTML footer
// and head links below can use it; VitePress doesn't prefix those.
const base = '/idetik/'

export default defineConfig({
  base,
  title: 'Idetik',
  description: 'A library for creating interactive viewers for large bioimaging data',

  // Showcase pages come from a dynamic route; title them from their params.
  transformPageData(pageData) {
    if (pageData.params?.title) {
      pageData.title = pageData.params.title
      pageData.description = pageData.params.description
    }
  },

  srcDir: 'docs',
  appearance: 'force-dark',

  head: [
    ['link', { rel: 'icon', type: 'image/svg+xml', href: `${base}icon.svg` }],
    ['link', { rel: 'preconnect', href: 'https://fonts.googleapis.com' }],
    ['link', { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossorigin: '' }],
    [
      'link',
      {
        rel: 'stylesheet',
        href: 'https://fonts.googleapis.com/css2?family=Inter:ital,opsz,wght@0,14..32,100..900;1,14..32,100..900&display=swap',
      },
    ],
  ],

  vite: {
    server: { port: 5174 },
    define: {
      __IDETIK_VERSION__: JSON.stringify(getLatestVersion()),
    },
    // Live viewers in the guide import the library from source so the docs
    // always match the branch they are built from. Shaders are imported as
    // plain strings; the library's own build uses vite-plugin-glsl, which
    // does not work under VitePress's dev server. Worker settings mirror
    // vite.config.js.
    plugins: [
      {
        name: 'glsl-as-string',
        transform: (code, id) =>
          id.endsWith('.glsl')
            ? { code: `export default ${JSON.stringify(code)}`, map: null }
            : undefined,
      },
    ],
    resolve: {
      alias: {
        '@idetik/core': fileURLToPath(new URL('../src/index.ts', import.meta.url)),
      },
    },
    worker: {
      format: 'es',
      rollupOptions: {
        output: { format: 'es', inlineDynamicImports: true },
      },
    },
  },

  themeConfig: {
    search: {
      provider: 'local',
      options: {
        miniSearch: {
          // Replaces VitePress's default section splitter, which derives each
          // section's anchor from the FIRST link in a heading. API member
          // headings contain type links (e.g. "state" links to LayerState),
          // which made sections collide on the linked type's anchor. This
          // version anchors on the permalink (.header-anchor) instead.
          _splitIntoSections: (_file, html) => splitPageIntoSections(html),
        },
      },
    },

    nav: [
      { text: 'User Guide', link: '/guide/getting-started' },
      { text: 'API Reference', link: '/api/' },
      { text: 'Examples', link: '/showcase/' },
    ],

    sidebar: {
      '/guide/': [
        {
          text: 'User Guide',
          items: [
            { text: 'Getting Started', link: '/guide/getting-started' },
            { text: 'How Idetik Works', link: '/guide/how-idetik-works' },
          ],
        },
      ],
      '/api/': typedocSidebar,
      '/showcase/': showcaseSidebar(),
    },

    socialLinks: [
      { icon: 'github', link: 'https://github.com/chanzuckerberg/idetik' },
    ],

    footer: {
      message: 'Released under the MIT License',
      copyright:
        `<a href="https://biohub.ai" target="_blank" rel="noopener"><img src="${base}biohub-logo.svg" alt="Biohub"></a>`,
    },
  },
})
