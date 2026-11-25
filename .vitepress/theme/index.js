import DefaultTheme from 'vitepress/theme'
import { h } from 'vue'
import VersionBadge from './VersionBadge.vue'
import GettingStartedViewer from './GettingStartedViewer.vue'
import HomeGallery from './components/HomeGallery.vue'
import AgentOnboard from './components/AgentOnboard.vue'
import HeroGlow from './components/HeroGlow.vue'
import ExamplePage from './components/ExamplePage.vue'
import biohubLogo from './icons/biohub.svg?raw'
import './custom.css'

const BIOHUB_URL = 'https://biohub.org/'

function openBiohub(event) {
  if (event.type === 'keydown' && event.key !== 'Enter') return
  event.preventDefault()
  event.stopPropagation()
  window.open(BIOHUB_URL, '_blank', 'noopener')
}

export default {
  extends: DefaultTheme,
  Layout() {
    return h(DefaultTheme.Layout, null, {
      'nav-bar-title-before': () =>
        h('span', {
          class: 'biohub-logo',
          role: 'link',
          tabindex: 0,
          'aria-label': 'Biohub',
          title: BIOHUB_URL,
          innerHTML: biohubLogo,
          onClick: openBiohub,
          onKeydown: openBiohub,
        }),
      'home-hero-before': () => h(HeroGlow),
      'home-features-after': () => [h(HomeGallery), h(AgentOnboard)],
    })
  },
  enhanceApp({ app }) {
    app.component('VersionBadge', VersionBadge)
    app.component('GettingStartedViewer', GettingStartedViewer)
    app.component('ExamplePage', ExamplePage)
  },
}
