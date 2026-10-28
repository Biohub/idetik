import DefaultTheme from 'vitepress/theme'
import { h } from 'vue'
import VersionBadge from './VersionBadge.vue'
import GettingStartedViewer from './GettingStartedViewer.vue'
import LiveExamples from './components/examples/LiveExamples.vue'
import AgentPrompt from './components/AgentPrompt.vue'
import ShowcaseGallery from './components/showcase/ShowcaseGallery.vue'
import ShowcaseExample from './components/showcase/ShowcaseExample.vue'
import './custom.css'

export default {
  extends: DefaultTheme,
  Layout() {
    return h(DefaultTheme.Layout, null, {
      'home-features-after': () => [h(LiveExamples), h(AgentPrompt)],
    })
  },
  enhanceApp({ app }) {
    app.component('VersionBadge', VersionBadge)
    app.component('GettingStartedViewer', GettingStartedViewer)
    app.component('ShowcaseGallery', ShowcaseGallery)
    app.component('ShowcaseExample', ShowcaseExample)
  },
}
