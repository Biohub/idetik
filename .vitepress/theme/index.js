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

export default {
  extends: DefaultTheme,
  Layout() {
    return h(DefaultTheme.Layout, null, {
      'nav-bar-title-before': () =>
        h('span', { class: 'biohub-logo', role: 'img', 'aria-label': 'Biohub', innerHTML: biohubLogo }),
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
