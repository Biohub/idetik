import { loadShowcase } from '../../.vitepress/showcase.js'

// One page per showcased example; the page body is the example's main.ts.
export default {
  paths: () =>
    loadShowcase().map((example) => ({
      params: example,
      content: `<<< @/../examples/${example.id}/main.ts`,
    })),
}
