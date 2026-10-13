<h1 align="center">Idetik</h1>

<p align="center">Build interactive viewers for massive bioimaging data in the browser</p>

<div align="center">

![ci-badge](https://github.com/chanzuckerberg/idetik/actions/workflows/lint-test-build.yml/badge.svg)
[![npm-badge](https://img.shields.io/npm/v/%40idetik%2Fcore.svg)](https://www.npmjs.com/package/@idetik/core)
[![docs-badge](https://img.shields.io/badge/docs-online-blue.svg)](https://chanzuckerberg.github.io/idetik/)

</div>

## Overview

Idetik is a high-performance library for exploring multi-dimensional OME-Zarr datasets right in the browser. It is not a viewer but a framework for building viewers. Define viewports with your own cameras, controls, and layers, and point them at any local or remote store with no conversion step. Chunks are streamed based on what the camera needs at the current zoom and nothing more, with preconfigured policies for smooth temporal playback. When the built-in pieces aren't enough, subclass layers to render your own data, add custom input handlers, or plug in your own data loader.

#### Documentation

- User guide: https://chanzuckerberg.github.io/idetik/guide/getting-started
- API reference: https://chanzuckerberg.github.io/idetik/api/

## Installation

Idetik is published to npm as [@idetik/core](https://www.npmjs.com/package/@idetik/core):

```bash
npm install @idetik/core
```

## Minimal Example

This example displays a single slice from [Zebrahub](https://zebrahub.sf.czbiohub.org/), a terabyte-scale light-sheet time-lapse of a developing zebrafish, hosted as OME-Zarr on a public server. Idetik fetches only the chunks the view needs so you can pan and zoom through the full-resolution image without downloading the dataset.

```typescript
import {
  Idetik,
  ImageLayer,
  Viewport,
  OmeZarrImageSource,
  OrthographicCamera,
  PanZoomControls,
} from '@idetik/core'

const url = 'https://public.czbiohub.org/royerlab/zebrahub/imaging/single-objective/ZSNS001.ome.zarr/';
const source = await OmeZarrImageSource.fromHttp({url});

const layer = new ImageLayer({
  source,
  sliceCoords: { t: 400, z: 278, c: [0] }, // one slice: mid time-lapse, mid-stack
  channelProps: [{ visible: true, contrastLimits: [0, 60] }],
});

// frame the camera to the image's physical extent.
const { x, y } = source.getDimensions()
const camera = new OrthographicCamera({
  left: 0, right: x.lods[0].size * x.lods[0].scale,
  top: 0, bottom: y.lods[0].size * y.lods[0].scale
});

const canvas = document.querySelector<HTMLCanvasElement>('canvas')!;
const idetik = new Idetik({
  canvas,
  viewports: [new Viewport({
    domElement: canvas,
    camera,
    layers: [layer],
    cameraControls: new PanZoomControls(camera)
  })],
});

idetik.start();
```

## Project Status

This project is under active development. We welcome bug reports and new ideas but are not prepared to review or accept major contributions at this time.

## Getting Help

If you run into problems, please [open an issue on GitHub](https://github.com/chanzuckerberg/idetik/issues). If possible include:

- A clear description of the problem and steps to reproduce
- Expected vs. actual behavior
- Your environment (OS, browser, version)

If you believe you have found a security issue, we would appreciate notification. Please email security@biohub.org.

## Code of Conduct

This project adheres to the Contributor Covenant [code of conduct](https://www.contributor-covenant.org/version/3/0/code_of_conduct/). By participating you are expected to uphold this code. Please report unacceptable behavior to opensource@biohub.org.

## License

Licensed under the [MIT License](LICENSE).

Copyright (c) 2026-present Chan Zuckerberg Biohub, Inc.
