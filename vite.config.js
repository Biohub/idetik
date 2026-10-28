/// <reference types="vitest" />
import { defineConfig } from 'vite';
import eslint from 'vite-plugin-eslint';
import glsl from 'vite-plugin-glsl';
import path from 'path';
import typescript from '@rollup/plugin-typescript';
import examplesManifestPlugin from './vite-plugin-examples-nav.js';
import { playwright } from '@vitest/browser-playwright';

import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
const _dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig(({ mode }) => {
  const typescriptPlugin = typescript({
    noForceEmit: true,
    compilerOptions: { noEmit: true },
  })

  const common = {
    publicDir: path.resolve(_dirname, 'public'),
    build: {
      outDir: 'dist',
      target: 'es2022',
    },
    worker: {
      format: 'es',
      rollupOptions: {
        output: { format: 'es', inlineDynamicImports: true },
        external: [],
      },
    },
    resolve: {
      alias: {
        '@idetik/core': path.resolve(_dirname, 'src/index.ts'),
        '@': path.resolve(_dirname, 'src'),
      },
    },
    server: {
      watch: {
        include: [
          path.resolve(_dirname, 'src/**'),
          path.resolve(_dirname, 'examples/**'),
        ],
      },
    },
    test: {
      environment: 'jsdom',
      browser: {
        enabled: true,
        provider: playwright(),
        headless: true,
        instances: [{ browser: 'chromium' }],
      },
      coverage: {
        provider: 'istanbul',
        include: ['src/**/*.{js,mjs,ts,tsx,jsx}'],
      },
    },
  }

  if (mode === 'examples') {
    // Built into the docs' public dir so the showcase pages can embed them.
    return {
      ...common,
      plugins: [eslint(), glsl(), examplesManifestPlugin()],
      root: 'examples',
      base: './',
      build: {
        ...common.build,
        outDir: path.resolve(_dirname, 'docs/public/examples'),
        emptyOutDir: true,
      },
    }
  }

  if (mode === 'development') {
    return {
      ...common,
      plugins: [eslint(), glsl(), examplesManifestPlugin()],
      root: 'examples',
    }
  }

  return {
    ...common,
    plugins: [typescriptPlugin, eslint(), glsl()],
    build: {
      ...common.build,
      sourcemap: true,
      minify: 'esbuild',
      copyPublicDir: false,
      lib: {
        entry: path.resolve(_dirname, 'src/index.ts'),
        name: 'idetik-core',
        fileName: 'index',
      },
    },
  }
})
