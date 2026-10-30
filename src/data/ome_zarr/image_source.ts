import { Location, Readable, FetchStore } from "zarrita";
import {
  openArrayFromParams,
  openGroup,
  createZarrArrayParams,
} from "../zarr/open";
import WebFileSystemStore from "../zarr/web_file_system_store";
import { OmeZarrImageLoader } from "./image_loader";
import {
  omeZarrToZarrVersion,
  parseOmeZarrImage,
  Version as OmeZarrVersion,
} from "./metadata_loaders";
import { SourceDimensionMap } from "../chunk";

type OmeZarrImageSourceProps = {
  location: Location<Readable>;
  version?: OmeZarrVersion;
  loader: OmeZarrImageLoader;
};

/**
 * Input to {@link OmeZarrImageSource.fromStore}.
 */
export type StoreOmeZarrImageSourceProps = {
  /** Any zarrita store, e.g. one that generates chunks on demand. Chunks
   *  from custom stores are read on the main thread. */
  store: Readable;
  /** OME-Zarr version. Detected from metadata when omitted. */
  version?: OmeZarrVersion;
  /** Image path within the store. Defaults to the root. */
  path?: `/${string}`;
};

/**
 * Input to {@link OmeZarrImageSource.fromHttp}.
 */
export type HttpOmeZarrImageSourceProps = {
  /** URL of the OME-Zarr root group. */
  url: string;
  /** OME-Zarr version. Detected from metadata when omitted. */
  version?: OmeZarrVersion;
};

/**
 * Input to {@link OmeZarrImageSource.fromFileSystem}.
 */
export type FileSystemOmeZarrImageSourceProps = {
  /** Directory handle with read permission. */
  directory: FileSystemDirectoryHandle;
  /** OME-Zarr version. Detected from metadata when omitted. */
  version?: OmeZarrVersion;
  /** Image path within the directory. Defaults to the root. */
  path?: `/${string}`;
};

/**
 * A multiscale image opened from an OME-Zarr store.
 *
 * Instances are created with {@link fromHttp}, {@link fromFileSystem}, or
 * {@link fromStore} rather than the constructor. The factories read the
 * store's metadata up front so the returned source already knows its axes,
 * resolution levels, and channel count. OME-Zarr versions `0.4` and `0.5`
 * are supported and the version is detected from metadata when not given.
 *
 * A source is handed to a layer which streams chunks from it on demand.
 *
 * ```ts
 * const source = await OmeZarrImageSource.fromHttp({
 *   url: "https://example.com/image.ome.zarr",
 * });
 *
 * const layer = new ImageLayer({
 *   source,
 *   sliceCoords: { t: 0, z: 0, c: [0] },
 * });
 * ```
 *
 * @group Data Loading
 */
export class OmeZarrImageSource {
  /** The zarr store location the image was opened from. */
  readonly location: Location<Readable>;
  /** The OME-Zarr version passed at creation if any. */
  readonly version?: OmeZarrVersion;

  private readonly loader_: OmeZarrImageLoader;

  private constructor(props: OmeZarrImageSourceProps) {
    this.location = props.location;
    this.version = props.version;
    this.loader_ = props.loader;
  }

  private static async openLoader(
    location: Location<Readable>,
    version?: OmeZarrVersion
  ): Promise<OmeZarrImageLoader> {
    let zarrVersion = omeZarrToZarrVersion(version);
    const root = await openGroup(location, zarrVersion);
    const adaptedOmeImage = parseOmeZarrImage(root.attrs);
    const images = adaptedOmeImage.multiscales;
    if (images.length !== 1) {
      throw new Error(
        `Exactly one multiscale image is supported. Found ${images.length} images.`
      );
    }
    const metadata = images[0];
    if (metadata.datasets.length === 0) {
      throw new Error(`No datasets found in the multiscale image.`);
    }
    if (!zarrVersion) {
      zarrVersion = omeZarrToZarrVersion(adaptedOmeImage.originalVersion);
    }
    const arrayParams = metadata.datasets.map((d) =>
      createZarrArrayParams(location, d.path, zarrVersion)
    );
    const arrays = await Promise.all(
      arrayParams.map((params) => openArrayFromParams(params))
    );

    const shape = arrays[0].shape;
    const axes = metadata.axes;
    if (axes.length !== shape.length) {
      throw new Error(
        `Mismatch between number of axes (${axes.length}) and array shape (${shape.length})`
      );
    }
    return new OmeZarrImageLoader({ metadata, arrays, arrayParams });
  }

  /**
   * Returns per-axis dimension metadata for the image.
   *
   * Each axis entry lists one record per level of detail with its size,
   * chunk size, scale, and translation. Use these to convert between
   * array indices and world coordinates, pick slice coordinates, and
   * frame cameras around the image extent.
   */
  public getDimensions(): SourceDimensionMap {
    return this.loader_.getSourceDimensionMap();
  }

  /**
   * Returns the number of channels in the image.
   */
  public getChannelCount(): number {
    return this.getDimensions().c?.lods[0].size ?? 1;
  }

  /** The chunk loader that streams this image's data. */
  public get loader(): OmeZarrImageLoader {
    return this.loader_;
  }

  /**
   * Opens an OME-Zarr image over HTTP(S).
   *
   * @param props - The store url and optional version.
   */
  public static async fromHttp(
    props: HttpOmeZarrImageSourceProps
  ): Promise<OmeZarrImageSource> {
    return OmeZarrImageSource.fromStore({
      store: new FetchStore(props.url),
      version: props.version,
    });
  }

  /**
   * Opens an OME-Zarr image from an arbitrary zarrita store, such as one
   * that synthesizes chunks on demand.
   */
  public static async fromStore(
    props: StoreOmeZarrImageSourceProps
  ): Promise<OmeZarrImageSource> {
    const location = new Location(props.store, props.path);
    const loader = await OmeZarrImageSource.openLoader(location, props.version);
    return new OmeZarrImageSource({ location, version: props.version, loader });
  }

  /**
   * Opens an OME-Zarr image from a local directory.
   *
   * Uses the File System Access API so it only works in Chromium-based
   * browsers. Pass the handle returned by `window.showDirectoryPicker()`.
   * The optional path lets an application ask once for root permission
   * and open many images.
   *
   * @param props - The directory handle, optional version, and path.
   */
  public static async fromFileSystem(
    props: FileSystemOmeZarrImageSourceProps
  ): Promise<OmeZarrImageSource> {
    return OmeZarrImageSource.fromStore({
      store: new WebFileSystemStore(props.directory),
      path: props.path,
      version: props.version,
    });
  }
}
