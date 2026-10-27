import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { discoverExamples, getExampleTitle } from '../generate-examples-manifest.js'

// Every examples/<id>/ folder with a showcase.json is a showcase page. See
// examples/README.md for the folder layout.
export function loadShowcase() {
  return discoverExamples()
    .filter(({ path }) => existsSync(resolve(dirname(path), 'showcase.json')))
    .map(({ name, path, htmlContent }) => {
      const dir = dirname(path)
      for (const file of ['main.ts', 'thumbnail.jpg']) {
        if (!existsSync(resolve(dir, file))) {
          throw new Error(`examples/${name}/${file} is required for the showcase`)
        }
      }
      const { description, data } = JSON.parse(readFileSync(resolve(dir, 'showcase.json'), 'utf-8'))
      return { id: name, title: getExampleTitle(htmlContent, name), description, data }
    })
    .sort((a, b) => a.title.localeCompare(b.title))
}
