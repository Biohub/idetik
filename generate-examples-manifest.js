/* global process */

import { readdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const examplesDir = resolve(__dirname, 'examples');

export function discoverExamples() {
  // discover examples: any directory in /examples with an index.html file
  const entries = readdirSync(examplesDir, { withFileTypes: true });
  const ignoreDirs = new Set(['dist', 'node_modules', '.git']);

  return entries
    .filter(entry => entry.isDirectory() && !ignoreDirs.has(entry.name))
    .filter(entry => {
      const examplePath = resolve(examplesDir, entry.name, 'index.html');
      return existsSync(examplePath);
    })
    .map(entry => ({
      name: entry.name,
      path: resolve(examplesDir, entry.name, 'index.html'),
      htmlContent: readFileSync(resolve(examplesDir, entry.name, 'index.html'), 'utf-8')
    }));
}

function generateExamplesManifest() {
  const discoveredExamples = discoverExamples();

  const examples = discoveredExamples
    .map(example => {
      const title = getExampleTitle(example.htmlContent, example.name);

      return {
        id: example.name,
        title: title,
        path: `${example.name}/`,
        directory: example.name
      };
    });

  examples.sort((a, b) => a.title.localeCompare(b.title));
  const manifest = {
    generated: new Date().toISOString(),
    examples: examples
  };
  const manifestPath = resolve(examplesDir, 'examples-manifest.json');
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

  console.log(`Generated manifest with ${examples.length} examples:`);
  examples.forEach(example => {
    console.log(`  - ${example.title} (${example.id})`);
  });

  return manifest;
}

function getExampleTitle(htmlContent, dirName) {
  const titleMatch = htmlContent.match(/<title[^>]*>([^<]+)<\/title>/i);
  const htmlTitle = titleMatch ? titleMatch[1].trim() : null;

  if (!htmlTitle) {
    throw new Error(`No <title> found in HTML content of example directory: ${dirName}`);
  }

  return htmlTitle;
}

// run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  generateExamplesManifest();
}

export { generateExamplesManifest, getExampleTitle };
