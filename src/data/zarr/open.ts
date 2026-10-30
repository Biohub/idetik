import * as zarr from "zarrita";
import { Location, Readable, FetchStore } from "zarrita";
import WebFileSystemStore from "./web_file_system_store";

export type Version = "v2" | "v3";

export type ZarrArrayParams = {
  arrayPath: string;
  zarrVersion: Version | undefined;
} & (
  | {
      type: "fetch";
      url: string;
    }
  | {
      type: "filesystem";
      directoryHandle: FileSystemDirectoryHandle;
      path: string;
    }
  | {
      // a store a worker can't reconstruct (e.g. a custom in-memory store);
      // chunks from these are read on the main thread
      type: "store";
      location: Location<Readable>;
    }
);

/** Array params that can be posted to a worker, which reopens the store. */
export type WorkerZarrArrayParams = Exclude<ZarrArrayParams, { type: "store" }>;

export async function openGroup(
  location: zarr.Location<Readable>,
  version?: Version
): Promise<zarr.Group<Readable>> {
  if (version === "v2") {
    try {
      return zarr.open.v2(location, { kind: "group", attrs: true });
    } catch {
      throw new Error(`Failed to open Zarr v2 group at ${location}`);
    }
  }
  if (version === "v3") {
    try {
      return zarr.open.v3(location, { kind: "group" });
    } catch {
      throw new Error(`Failed to open Zarr v3 group at ${location}`);
    }
  }
  try {
    return zarr.open(location, { kind: "group" });
  } catch {
    throw new Error(`Failed to open Zarr group at ${location}`);
  }
}

export async function openArray(
  location: zarr.Location<Readable>,
  version?: Version
): Promise<zarr.Array<zarr.DataType, Readable>> {
  if (version === "v2") {
    try {
      return zarr.open.v2(location, { kind: "array", attrs: false });
    } catch {
      throw new Error(`Failed to open Zarr v2 array at ${location}`);
    }
  }
  if (version === "v3") {
    try {
      return zarr.open.v3(location, { kind: "array" });
    } catch {
      throw new Error(`Failed to open Zarr v3 array at ${location}`);
    }
  }
  try {
    return zarr.open(location, { kind: "array" });
  } catch {
    throw new Error(`Failed to open Zarr array at ${location}`);
  }
}

export async function openArrayFromParams(
  params: ZarrArrayParams
): Promise<zarr.Array<zarr.DataType, Readable>> {
  let rootLocation: Location<Readable>;

  switch (params.type) {
    case "fetch": {
      const store = new FetchStore(params.url);
      rootLocation = new Location(store);
      break;
    }
    case "filesystem": {
      rootLocation = new Location(
        new WebFileSystemStore(params.directoryHandle),
        params.path as `/${string}`
      );
      break;
    }
    case "store": {
      rootLocation = params.location;
      break;
    }
    default: {
      const exhaustiveCheck: never = params;
      throw new Error(`Unsupported store type: ${exhaustiveCheck}`);
    }
  }

  const arrayLocation = params.arrayPath
    ? rootLocation.resolve(params.arrayPath)
    : rootLocation;

  return openArray(arrayLocation, params.zarrVersion);
}

export function createZarrArrayParams(
  location: Location<Readable>,
  arrayPath: string,
  zarrVersion: Version | undefined
): ZarrArrayParams {
  if (location.store instanceof FetchStore) {
    return {
      type: "fetch",
      arrayPath,
      zarrVersion,
      url: location.store.url.toString(),
    };
  } else if (location.store instanceof WebFileSystemStore) {
    return {
      type: "filesystem",
      arrayPath,
      zarrVersion,
      directoryHandle: location.store.directoryHandle,
      path: location.path,
    };
  }
  return { type: "store", arrayPath, zarrVersion, location };
}
