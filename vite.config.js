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
      alias: { '@': path.resolve(_dirname, 'src') },
    },
    server: {
      // data.luxarviewer.dev only allows CORS from luxarviewer.dev.
      proxy: {
        '/luxar-data': {
          target: 'https://data.luxarviewer.dev',
          changeOrigin: true,
          rewrite: (p) => p.replace(/^\/luxar-data/, ''),
        },
      },
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
    return {
      ...common,
      plugins: [eslint(), glsl(), examplesManifestPlugin()],
      root: 'examples',
      base: './',
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
