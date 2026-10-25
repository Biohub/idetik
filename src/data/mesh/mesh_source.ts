import { Geometry } from "../../core/geometry";
import { loadMesh } from "./mesh_loader";

/**
 * Initialization properties for constructing a mesh source.
 */
export type MeshSourceProps = {
  /** The source URL passed to the mesh loader. */
  url: string;
};

/**
 * A source of static mesh geometry shared by one or more mesh layers.
 *
 * Geometry is loaded on the first call to {@link load} and retained by the
 * source. Each layer's renderable references the same CPU arrays and uses
 * separate GPU buffers. The loader supports static, uncompressed GLB meshes.
 * Scene transforms are baked into the geometry and missing normals are
 * generated for flat shading. Materials, textures, and animation are ignored.
 * The base geometry is rendered without skinning or morph deformations.
 * Mesh layers supply their own color and lighting. Instancing and required
 * glTF extensions are not supported.
 *
 * ```ts
 * const source = new MeshSource({
 *   url: "https://example.com/mesh.glb",
 * });
 *
 * const layer = new MeshLayer({
 *   source,
 *   color: Color.RED,
 * });
 * ```
 *
 * @group Data Loading
 */
export class MeshSource {
  /** The source URL passed to the mesh loader. */
  public readonly url: string;
  private geometryPromise_?: Promise<Geometry>;

  /**
   * Creates a mesh source without loading its geometry.
   *
   * @param props - Initialization properties.
   */
  constructor({ url }: MeshSourceProps) {
    this.url = url;
  }

  /**
   * Returns the source's CPU geometry, loading it on the first call.
   *
   * Concurrent and subsequent calls share the same promise and geometry.
   * A failed load clears the cached promise so a later call can retry.
   *
   * @returns A promise resolving to the geometry owned by this source.
   */
  public load(): Promise<Geometry> {
    this.geometryPromise_ ??= loadMesh(this.url).catch((error) => {
      this.geometryPromise_ = undefined;
      throw error;
    });
    return this.geometryPromise_;
  }
}
