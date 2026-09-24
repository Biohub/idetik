/// <reference lib="webworker" />

import { SPLAT_CULL_FLOATS } from "../data/luxar/decode";
import {
  SplatCullParams,
  SplatCullScratch,
  createSplatCullScratch,
  cullAndSortSplats,
} from "./splat_sort";

export type SplatSortRequest =
  | {
      type: "setSplats";
      version: number;
      cullData: Float32Array;
      /** Length of the returned order buffers, at least the splat count. */
      orderLength: number;
    }
  | { type: "update"; version: number; params: SplatCullParams };

export type SplatSortResponse = {
  version: number;
  order: Uint32Array;
  count: number;
};

let version = -1;
let cullData: Float32Array = new Float32Array(0);
let scratch: SplatCullScratch = createSplatCullScratch(0);
let orderLength = 0;

self.addEventListener("message", (e: MessageEvent<SplatSortRequest>) => {
  const request = e.data;
  if (request.type === "setSplats") {
    version = request.version;
    cullData = request.cullData;
    scratch = createSplatCullScratch(cullData.length / SPLAT_CULL_FLOATS);
    orderLength = request.orderLength;
    return;
  }
  if (request.version !== version) return;
  const order = new Uint32Array(orderLength);
  const count = cullAndSortSplats(cullData, request.params, order, scratch);
  const response: SplatSortResponse = { version, order, count };
  self.postMessage(response, [order.buffer]);
});
