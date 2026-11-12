import { examples } from '../../examples/examples.ts'

export default {
  paths: () =>
    examples.map((example) => ({
      params: example,
      content: `<<< @/../examples/${example.id}/main.ts`,
    })),
}
