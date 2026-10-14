import type { IdetikContext } from "../idetik";
import { RenderableObject } from "./renderable_object";
import { clamp } from "../utilities/clamp";
import { Logger } from "../utilities/logger";
import { EventContext } from "./event_dispatcher";
import type { Viewport } from "./viewport";

/**
 * The loading lifecycle state of a layer.
 */
export type LayerState = "initialized" | "loading" | "ready";

/**
 * How a layer's output blends with previously drawn content.
 */
export type BlendMode =
  | "none"
  | "normal"
  | "additive"
  | "subtractive"
  | "multiply"
  | "premultipliedOver";

/**
 * A callback invoked after a layer's state changes.
 */
export type StateChangeCallback = (
  newState: LayerState,
  prevState?: LayerState
) => void;

/**
 * Initialization properties for constructing a layer.
 */
export type LayerProps = {
  /** Layer opacity in `[0, 1]`. Defaults to `1`. */
  opacity?: number;
  /** How the layer blends. Defaults to `"none"`. */
  blendMode?: BlendMode;
  /** Hides content behind. Inferred from `blendMode`. */
  occludes?: boolean;
};

/**
 * Abstract base class for any layer that can be added to a viewport.
 *
 * A layer owns a set of renderable objects and contributes them to the
 * scene each frame. Subclasses such as {@link ImageLayer},
 * {@link VolumeLayer}, and {@link LabelLayer} implement {@link update} to
 * build or refresh those objects for the current view. Custom layers
 * register objects with {@link addObject} and report readiness through
 * {@link setState}.
 *
 * Layers carry shared presentation state in {@link opacity},
 * {@link blendMode}, and {@link occludes}, and expose a lifecycle
 * {@link LayerState} that observers can subscribe to. A layer instance may
 * be attached to only one viewport at a time.
 *
 * ```ts
 * class Particles extends Layer {
 *   public readonly type = "Particles";
 *
 *   constructor(points: PointProps[]) {
 *     super();
 *     this.addObject(new PointsRenderable(points));
 *     this.setState("ready");
 *   }
 *
 *   public update(): boolean {
 *     return true;
 *   }
 * }
 *
 * viewport.addLayer(new Particles(points));
 * ```
 *
 * @group Layers
 */
export abstract class Layer {
  /** A string identifying the concrete layer type. */
  public abstract readonly type: string;

  /** Set to `true` by subclasses whose shaders read scene depth. */
  protected requiresSceneDepth_ = false;

  private readonly coverageGroups_ = new Map<
    number | null,
    RenderableObject[]
  >();
  private state_: LayerState = "initialized";
  private attached_ = false;
  private readonly callbacks_: StateChangeCallback[] = [];
  private renderStateChanged_ = true;
  private opacity_: number;
  private blendMode_: BlendMode;
  private occludes_: boolean;

  /**
   * Creates a layer with the given presentation state.
   *
   * @param props - Initialization properties.
   */
  constructor({
    opacity = 1.0,
    blendMode = "none",
    occludes,
  }: LayerProps = {}) {
    this.opacity_ = clamp(opacity, 0.0, 1.0);
    this.blendMode_ = blendMode;
    this.occludes_ = occludes ?? blendMode === "none";
  }

  /**
   * Whether the layer's shaders read scene depth. When `true` the renderer
   * draws occluding layers to a depth texture the layer's shaders can
   * sample. A layer cannot both occlude and read scene depth.
   */
  public get requiresSceneDepth() {
    return this.requiresSceneDepth_;
  }

  /**
   * How the layer's output blends with previously drawn content.
   */
  public get blendMode() {
    return this.blendMode_;
  }

  /** @param value - The blending mode to use. */
  public set blendMode(value: BlendMode) {
    if (value === this.blendMode_) {
      return;
    }

    this.blendMode_ = value;
    this.invalidate();
  }

  /**
   * Whether the layer writes depth and hides content drawn behind it.
   *
   * Occluding layers render a depth pass and always draw before
   * non-occluding layers regardless of their order in the viewport. When
   * not set explicitly this value is inferred from `blendMode` at
   * construction only. Reassigning {@link blendMode} later does not update it.
   */
  public get occludes() {
    return this.occludes_;
  }

  /** @param value - Whether the layer writes depth. */
  public set occludes(value: boolean) {
    if (value === this.occludes_) {
      return;
    }

    this.occludes_ = value;
    this.invalidate();
  }

  /** The layer's opacity in `[0, 1]`. Values outside are clamped. */
  public get opacity() {
    return this.opacity_;
  }

  /** @param value - The new opacity in `[0, 1]`. */
  public set opacity(value: number) {
    if (value < 0 || value > 1) {
      Logger.warn(
        "Layer",
        `Opacity out of bounds: ${value} — clamping to [0.0, 1.0]`
      );
    }
    const opacity = clamp(value, 0.0, 1.0);
    if (opacity === this.opacity_) {
      return;
    }

    this.opacity_ = opacity;
    this.invalidate();
  }

  /**
   * Builds or refreshes the layer's renderable objects for the current
   * view. Called automatically once per frame for every layer in a
   * viewport.
   *
   * Return `true` if this update changed the rendered output, otherwise
   * return `false`. Changes marked by {@link invalidate} are tracked
   * separately, so returning `false` does not discard them.
   *
   * @param viewport - The viewport being rendered.
   */
  public abstract update(viewport?: Viewport): boolean;

  /**
   * Marks the layer's rendered output as changed. Call from setters or
   * asynchronous callbacks when a change happens outside {@link update}.
   * The runtime checks this flag on its next update.
   */
  protected invalidate(): void {
    this.renderStateChanged_ = true;
  }

  /** @hidden */
  public renderStateChanged(): boolean {
    if (this.renderStateChanged_) {
      this.renderStateChanged_ = false;
      return true;
    }
    return false;
  }

  /**
   * Handles a pointer or wheel event from the owning viewport. Called
   * automatically for each event before the camera controls. The default
   * implementation does nothing.
   *
   * @param _event - The event with clip and world coordinates attached.
   */
  public onEvent(_event: EventContext): void {}

  /** Whether the layer is attached to a viewport. */
  public get attached(): boolean {
    return this.attached_;
  }

  /**
   * Lifecycle hook that is called automatically when a layer is
   * is attached to a viewport. A layer can only be attached to one viewport
   * at a time.
   *
   * @param context - The shared runtime context.
   */
  public onAttached(context: IdetikContext): void {
    if (this.attached_) {
      throw new Error(
        `${this.type} cannot be attached to multiple viewports simultaneously.`
      );
    }
    if (this.occludes && this.requiresSceneDepth_) {
      throw new Error(`${this.type} cannot both occlude and read scene depth.`);
    }
    this.attach(context);
    this.attached_ = true;
  }

  /**
   * Lifecycle hook that is called automatically when a layer is detached
   * from a viewport.
   *
   * @param context - The shared runtime context.
   */
  public onDetached(context: IdetikContext): void {
    if (!this.attached_) return;
    this.detach(context);
    this.attached_ = false;
  }

  /** @hidden */
  protected attach(_context: IdetikContext): void {}

  /** @hidden */
  protected detach(_context: IdetikContext): void {}

  /**
   * The layer's renderable objects grouped by coverage group. Objects in
   * a group draw each pixel at most once, letting chunks at multiple
   * levels of detail overlap correctly.
   */
  public get coverageGroups(): ReadonlyMap<
    number | null,
    readonly RenderableObject[]
  > {
    return this.coverageGroups_;
  }

  /** The layer's current lifecycle state. */
  public get state() {
    return this.state_;
  }

  /**
   * Registers a callback invoked after every state change.
   *
   * @param callback - Receives the new and previous states.
   */
  public addStateChangeCallback(callback: StateChangeCallback) {
    this.callbacks_.push(callback);
  }

  /**
   * Removes a previously registered state change callback.
   *
   * @param callback - The callback to remove.
   */
  public removeStateChangeCallback(callback: StateChangeCallback) {
    const index = this.callbacks_.indexOf(callback);
    if (index === -1) {
      throw new Error(`Callback to remove could not be found: ${callback}`);
    }
    this.callbacks_.splice(index, 1);
  }

  /**
   * Sets the lifecycle state and notifies state change callbacks.
   *
   * @param newState - The state to enter.
   */
  protected setState(newState: LayerState) {
    const prevState = this.state_;
    this.state_ = newState;
    if (newState !== prevState) {
      this.invalidate();
    }

    this.callbacks_.forEach((callback) => callback(newState, prevState));
  }

  /**
   * Registers a renderable object for drawing. Objects in the same
   * coverage group draw each pixel at most once.
   *
   * @param object - The object to add.
   * @param coverageGroup - The group key.
   */
  protected addObject(
    object: RenderableObject,
    coverageGroup: number | null = null
  ) {
    const members = this.coverageGroups_.get(coverageGroup);
    if (members) {
      members.push(object);
    } else {
      this.coverageGroups_.set(coverageGroup, [object]);
    }
  }

  /** Removes all registered renderable objects. */
  protected clearObjects() {
    this.coverageGroups_.clear();
  }

  /**
   * Returns uniform name-value pairs applied to every object drawn by
   * this layer. Override in subclasses that need custom shader uniforms.
   */
  public getUniforms(): Record<string, unknown> {
    return {};
  }
}
