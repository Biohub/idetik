import { Layer } from "../core/layer";
import type { IdetikContext } from "../idetik";
import { MeshSource } from "../data/mesh/mesh_source";
import type { ColorLike } from "../math/color";
import { MeshRenderable } from "../objects/renderable/mesh_renderable";
import { Logger } from "../utilities/logger";

/**
 * Initialization properties for constructing a mesh layer.
 */
export type MeshLayerProps = {
  /** The mesh source to load geometry from. */
  source: MeshSource;
  /** The mesh color. Alpha is ignored. Defaults to `Color.WHITE`. */
  color?: ColorLike;
  /** Ambient lighting contribution. Defaults to `0.25`. */
  ambientStrength?: number;
  /** Diffuse lighting contribution. Defaults to `0.75`. */
  diffuseStrength?: number;
};

/**
 * A layer that renders a static mesh with an opaque color and overhead lighting.
 *
 * Mesh layer loads its {@link MeshSource} when attached to a viewport and
 * creates one {@link MeshRenderable}. The mesh writes scene depth so
 * {@link VolumeLayer} can composite volume samples in front of its surface.
 * Detaching the layer releases the renderable's GPU buffers while the
 * source retains its CPU geometry for reuse.
 *
 * ```ts
 * const source = new MeshSource({ url: "https://example.com/mesh.glb" });
 *
 * const layer = new MeshLayer({
 *   source,
 *   color: Color.RED,
 *   ambientStrength: 0.25,
 *   diffuseStrength: 0.75,
 * });
 *
 * viewport.addLayer(layer);
 * ```
 *
 * @see {@link MeshSource} for geometry loading and caching.
 *
 * @group Layers
 */
export class MeshLayer extends Layer {
  /** Identifies the layer type as `MeshLayer`. */
  public readonly type = "MeshLayer";
  private readonly source_: MeshSource;
  private readonly renderableProps_: Omit<MeshLayerProps, "source">;
  private version_ = 0;

  /**
   * Creates a mesh layer for the given source and appearance settings.
   *
   * @param props - Initialization properties.
   */
  constructor({ source, ...renderableProps }: MeshLayerProps) {
    super();
    this.source_ = source;
    this.renderableProps_ = renderableProps;
  }

  /** @hidden */
  protected override attach(): void {
    this.setState("loading");

    const version = ++this.version_;

    this.source_
      .load()
      .then((geometry) => {
        if (version !== this.version_) return;
        this.addObject(
          new MeshRenderable({ ...this.renderableProps_, geometry })
        );
        this.setState("ready");
      })
      .catch((error) => {
        if (version !== this.version_) return;
        this.setState("initialized");
        Logger.error(
          "MeshLayer",
          `Failed to load mesh "${this.source_.url}"`,
          error
        );
      });
  }

  /** @hidden */
  protected override detach(context: IdetikContext): void {
    this.version_ += 1;
    for (const objects of this.coverageGroups.values()) {
      for (const object of objects) {
        object.disposeGeometry(context.disposeGeometry);
      }
    }
    this.clearObjects();
    this.setState("initialized");
  }

  /**
   * Returns `false` because the mesh is static. Loading and readiness
   * changes are handled when the layer is attached.
   */
  public update(): boolean {
    return false;
  }
}
