/// <reference lib="webworker" />

import * as zarr from "zarrita";
import {
  LuxarEncoding,
  PackOptions,
  PackedSplats,
  decodeLuxarArray,
  decodeLuxarDelta,
  packCholesky,
  packSplats,
} from "./decode";

type CodeChunk = {
  data: Uint8Array | Uint16Array;
  shape: number[];
  stride: number[];
};

class LuxarDeltaCodec {
  public readonly kind = "array_to_array";

  constructor(
    private readonly cols: number,
    private readonly bits: 8 | 16
  ) {}

  static fromConfig(
    config: { cols?: number; bits?: number },
    meta: { dataType: string }
  ) {
    const bits = meta.dataType === "uint8" ? 8 : 16;
    if (meta.dataType !== "uint8" && meta.dataType !== "uint16") {
      throw new Error(`luxar_delta_v1: unsupported data type ${meta.dataType}`);
    }
    if (config.bits !== undefined && config.bits !== bits) {
      throw new Error(
        `luxar_delta_v1: bits=${config.bits} does not match ${meta.dataType}`
      );
    }
    return new LuxarDeltaCodec(config.cols ?? 1, bits);
  }

  encode(_chunk: CodeChunk): CodeChunk {
    throw new Error("luxar_delta_v1: encoding is not supported");
  }

  decode(chunk: CodeChunk): CodeChunk {
    return {
      data: decodeLuxarDelta(chunk.data, this.cols, this.bits),
      shape: chunk.shape,
      stride: chunk.stride,
    };
  }
}

zarr.registry.set("luxar_delta_v1", async () => LuxarDeltaCodec as never);

export type LuxarArrayRef = {
  /** Absolute path of the array within the store. */
  path: `/${string}`;
  /** The array's zarr v3 metadata document. */
  metadata: Record<string, unknown>;
};

export type LuxarDecodeRequest = {
  id: number;
  url: string;
  count: number;
  ndim: number;
  arrays: {
    centers: LuxarArrayRef;
    amplitudes: LuxarArrayRef;
    choleskyDiag: LuxarArrayRef;
    choleskyOffdiag: LuxarArrayRef | null;
  };
  options: PackOptions;
};

export type LuxarDecodeResponse =
  | { id: number; success: true; splats: PackedSplats }
  | { id: number; success: false; error: string };

const stores = new Map<string, zarr.FetchStore>();

function getStore(url: string) {
  let store = stores.get(url);
  if (!store) {
    store = new zarr.FetchStore(url);
    stores.set(url, store);
  }
  return store;
}

async function readArray(store: zarr.FetchStore, ref: LuxarArrayRef) {
  const array = new zarr.Array(
    store,
    ref.path,
    ref.metadata as unknown as zarr.ArrayMetadata<zarr.DataType>
  );
  const result = await zarr.get(array);
  const shape = array.shape;
  const cols = shape.length > 1 ? shape[shape.length - 1] : 1;
  const attributes = ref.metadata.attributes as
    | { encoding?: LuxarEncoding }
    | undefined;
  return decodeLuxarArray(
    result.data as ArrayLike<number> & { length: number },
    attributes?.encoding,
    cols
  );
}

async function handleDecode(request: LuxarDecodeRequest) {
  const { arrays, count, ndim } = request;
  const store = getStore(request.url);
  const [centers, amplitudes, diag, offdiag] = await Promise.all([
    readArray(store, arrays.centers),
    readArray(store, arrays.amplitudes),
    readArray(store, arrays.choleskyDiag),
    arrays.choleskyOffdiag
      ? readArray(store, arrays.choleskyOffdiag)
      : Promise.resolve(null),
  ]);
  const cholesky = packCholesky(diag, offdiag, count, ndim);
  return packSplats(
    centers,
    amplitudes,
    cholesky,
    count,
    ndim,
    request.options
  );
}

self.addEventListener(
  "message",
  async (e: MessageEvent<LuxarDecodeRequest>) => {
    const { id } = e.data;
    try {
      const splats = await handleDecode(e.data);
      const response: LuxarDecodeResponse = { id, success: true, splats };
      self.postMessage(response, [splats.data.buffer, splats.cullData.buffer]);
    } catch (error) {
      const response: LuxarDecodeResponse = {
        id,
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
      self.postMessage(response);
    }
  }
);
