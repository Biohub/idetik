import { loadShowcase } from '../../../showcase.js'

export default {
  watch: ['../../../../examples/*/showcase.json'],
  load: loadShowcase,
}
