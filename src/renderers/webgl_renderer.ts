import { Renderer } from "../core/renderer";
import { WebGLShaderProgram } from "./webgl_shader_program";
import { WebGLShaderPrograms } from "./webgl_shader_programs";
import { Logger } from "../utilities/logger";

import { WebGLBuffers } from "./webgl_buffers";
import { WebGLTextures } from "./webgl_textures";

import { Layer } from "../core/layer";
import { WebGLState } from "./webgl_state";
import { WebGLDepthTarget } from "./webgl_depth_target";
import { RenderableObject } from "../core/renderable_object";
import { Geometry, Primitive } from "../core/geometry";
import { Box2 } from "../math/box2";
import { Viewport } from "../core/viewport";
import { Camera } from "../objects/cameras/camera";
import { Texture } from "../objects/textures/texture";

import { mat4, vec2, vec3, vec4 } from "gl-matrix";
import { Frustum } from "../math/frustum";

// Idetik defines screen-space with +Y pointing downward.
// With the default camera, the basis vectors are:
// (1, 0, 0) → right
// (0, 1, 0) → down
// (0, 0, 1) → out of the screen
//
// To match this convention, we flip Y in the projection matrix.
// This is a mirror transform, which also flips triangle winding.
const axisDirection = mat4.fromScaling(mat4.create(), [1, -1, 1]);

export class WebGLRenderer extends Renderer {
  private readonly gl_: WebGL2RenderingContext;
  private readonly bindings_: WebGLBuffers;
  private readonly depthTarget_: WebGLDepthTarget;
  private readonly programs_: WebGLShaderPrograms;
  private readonly state_: WebGLState;
  private readonly textures_: WebGLTextures;

  private renderedObjectsPerFrame_ = 0;
  private stencilRef_ = 0;
  private currentViewportSize_: [number, number] = [0, 0];
  private currentViewportHasSceneDepth_ = false;

  constructor(canvas: HTMLCanvasElement) {
    super(canvas);

    const gl = this.canvas.getContext("webgl2", {
      depth: true,
      antialias: false,
      stencil: true,
    });
    if (!gl) {
      throw new Error(`Failed to initialize WebGL2 context`);
    }
    this.gl_ = gl;
    Logger.info(
      "WebGLRenderer",
      `WebGL version ${gl.getParameter(gl.VERSION)}`
    );

    // Required to attach R32F textures to a framebuffer for picking readback.
    gl.getExtension("EXT_color_buffer_float");

    this.programs_ = new WebGLShaderPrograms(gl);
    this.bindings_ = new WebGLBuffers(gl);
    this.textures_ = new WebGLTextures(gl);
    this.state_ = new WebGLState(gl);
    this.depthTarget_ = new WebGLDepthTarget(
      gl,
      this.textures_.reservePersistentUnit()
    );
    this.resize(this.canvas.width, this.canvas.height);
  }

  public get gpuTextureBytes() {
    return this.textures_.gpuTextureBytes;
  }

  public get gpuTextureCount() {
    return this.textures_.textureCount;
  }

  public render(viewport: Viewport) {
    this.renderedObjects_ = 0;
    this.renderedObjectsPerFrame_ = 0;
    this.stencilRef_ = 0;

    for (const layer of viewport.layers) {
      layer.update(viewport);
    }

    if (getComputedStyle(viewport.domElement).visibility === "hidden") return;

    const viewportBox = viewport.getBoxRelativeTo(this.canvas);
    const surfaceBox = new Box2(
      vec2.fromValues(0, 0),
      vec2.fromValues(this.width, this.height)
    );

    const viewportEquals = Box2.equals(viewportBox.floor(), surfaceBox.floor());
    const viewportIntersects = Box2.intersects(viewportBox, surfaceBox);

    if (viewportEquals) {
      this.state_.setScissorTest(false);
    } else if (viewportIntersects) {
      this.state_.setScissorTest(true);
      this.state_.setScissor(viewportBox);
    } else {
      Logger.warn(
        "WebGLRenderer",
        `Viewport ${viewport.id} is entirely outside canvas bounds, skipping render`
      );
      return;
    }

    this.state_.setViewport(viewportBox);
    this.resetState();
    this.clear();

    const viewportRect = viewportBox.toRect();
    this.currentViewportSize_ = [viewportRect.width, viewportRect.height];

    const frustum = viewport.camera.frustum;

    const occludingLayers: Layer[] = [];
    const nonOccludingLayers: Layer[] = [];
    for (const layer of viewport.layers) {
      if (layer.state !== "ready") continue;
      (layer.occludes ? occludingLayers : nonOccludingLayers).push(layer);
    }

    this.currentViewportHasSceneDepth_ =
      occludingLayers.length > 0 &&
      nonOccludingLayers.some((l) => l.requiresSceneDepth);

    this.primeDepthBuffer(occludingLayers, viewport.camera, frustum);

    if (this.currentViewportHasSceneDepth_) {
      this.renderDepthTexture(occludingLayers, viewport.camera, frustum);
    }

    this.state_.setDepthMask(false);
    for (const layer of [...occludingLayers, ...nonOccludingLayers]) {
      this.renderLayer(layer, viewport.camera, frustum);
    }
    this.resetState();

    this.renderedObjects_ = this.renderedObjectsPerFrame_;
  }

  private primeDepthBuffer(layers: Layer[], camera: Camera, frustum: Frustum) {
    this.state_.setColorMask(false);
    this.state_.setDepthFunc(this.gl_.LESS);
    // nudge the depth away from the camera, so that the color passes
    // at the same depth are not rejected
    this.state_.setPolygonOffset(true);

    this.drawDepthOnly(layers, camera, frustum);

    this.resetState();
  }

  private renderDepthTexture(
    layers: Layer[],
    camera: Camera,
    frustum: Frustum
  ) {
    this.depthTarget_.bind(this.width, this.height);
    this.state_.setDepthMask(true);
    this.state_.setDepthFunc(this.gl_.LESS);
    this.gl_.clear(this.gl_.DEPTH_BUFFER_BIT);

    this.drawDepthOnly(layers, camera, frustum);

    this.depthTarget_.unbind();
    this.resetState();
  }

  private drawDepthOnly(layers: Layer[], camera: Camera, frustum: Frustum) {
    for (const layer of layers) {
      for (const members of layer.coverageGroups.values()) {
        for (const object of members) {
          if (!object.depthProgramName || !object.depthTest) continue;
          if (!frustum.intersectsWithBox3(object.boundingBox)) continue;
          this.state_.setCullFaceMode(object.cullFaceMode);
          this.bindings_.bindGeometry(object.geometry);
          object.textures.forEach((texture, index) => {
            this.textures_.bindTexture(texture, index);
          });
          const program = this.programs_.use(object.depthProgramName);
          this.drawGeometry(object.geometry, object, layer, program, camera);
        }
      }
    }
  }

  private setCoverageStencil(coverageGroup: number | null) {
    this.state_.setStencilTest(coverageGroup !== null);
    if (coverageGroup === null) return;

    this.stencilRef_ += 1;
    if (this.stencilRef_ > 0xff) {
      Logger.warn(
        "WebGLRenderer",
        "Exceeded 255 stencil coverage groups in one frame; dedup may be incorrect"
      );
    }
    this.state_.setStencilFunc(this.gl_.NOTEQUAL, this.stencilRef_, 0xff);
  }

  private renderLayer(layer: Layer, camera: Camera, frustum: Frustum) {
    this.state_.setBlendingMode(layer.blendMode);

    for (const [coverageGroup, members] of layer.coverageGroups) {
      this.setCoverageStencil(coverageGroup);

      for (const object of members) {
        if (frustum.intersectsWithBox3(object.boundingBox)) {
          this.renderObject(layer, object, camera);
          this.renderedObjectsPerFrame_ += 1;
        }
      }
    }
  }

  protected renderObject(
    layer: Layer,
    object: RenderableObject,
    camera: Camera
  ) {
    object.popStaleTextures().forEach((texture) => {
      this.textures_.dispose(texture);
    });

    if (!object.programName) return;
    this.state_.setCullFaceMode(object.cullFaceMode);
    this.state_.setDepthTesting(object.depthTest);
    this.bindings_.bindGeometry(object.geometry);
    object.textures.forEach((texture, index) => {
      this.textures_.bindTexture(texture, index);
    });

    const program = this.programs_.use(object.programName);
    this.drawGeometry(object.geometry, object, layer, program, camera);

    if (object.wireframeEnabled) {
      const stencilTestEnabled = this.state_.stencilTestEnabled;
      const blendingMode = this.state_.blendingMode;
      this.state_.setStencilTest(false);
      this.state_.setBlendingMode("none");

      this.bindings_.bindGeometry(object.wireframeGeometry);
      const wireframeProgram = this.programs_.use("wireframe");
      wireframeProgram.setUniform(
        "u_wireframeColor",
        object.wireframeColor.rgb
      );
      this.drawGeometry(
        object.wireframeGeometry,
        object,
        layer,
        wireframeProgram,
        camera
      );

      if (blendingMode !== null) this.state_.setBlendingMode(blendingMode);
      this.state_.setStencilTest(stencilTestEnabled);
    }
  }

  private drawGeometry(
    geometry: Geometry,
    object: RenderableObject,
    layer: Layer,
    program: WebGLShaderProgram,
    camera: Camera
  ) {
    const modelView = mat4.multiply(
      mat4.create(),
      camera.viewMatrix,
      object.transform.matrix
    );
    const projection = mat4.multiply(
      mat4.create(),
      axisDirection,
      camera.projectionMatrix
    );

    // per-viewport size in pixels — shaders that compute screen-space offsets
    // need the actual rendered region, not the full-canvas dimensions
    const resolution = this.currentViewportSize_;

    const objectUniforms = object.getUniforms();
    const layerUniforms = layer.getUniforms();
    const allUniforms = {
      ...layerUniforms,
      ...objectUniforms,
    };

    for (const uniformName of program.uniformNames) {
      switch (uniformName) {
        case "u_modelView":
          program.setUniform(uniformName, modelView);
          break;
        case "u_model":
          program.setUniform(uniformName, object.transform.matrix);
          break;
        case "u_projection":
          program.setUniform(uniformName, projection);
          break;
        case "u_resolution":
          program.setUniform(uniformName, resolution);
          break;
        case "u_hasSceneDepth":
          program.setUniform(
            uniformName,
            Number(
              layer.requiresSceneDepth && this.currentViewportHasSceneDepth_
            )
          );
          break;
        case "u_sceneDepth":
          program.setUniform(uniformName, this.depthTarget_.textureUnit);
          break;
        case "u_mvpInverse": {
          const mvp = mat4.multiply(mat4.create(), projection, modelView);
          const mvpInverse = mat4.invert(mat4.create(), mvp)!;
          program.setUniform(uniformName, mvpInverse);
          break;
        }
        case "u_opacity":
          program.setUniform(
            uniformName,
            layer.opacity *
              ((objectUniforms.Opacity as number | undefined) ?? 1)
          );
          break;
        case "u_cameraPositionModel": {
          const inverseModelView = mat4.invert(mat4.create(), modelView)!;
          const cameraPositionView = vec4.fromValues(0, 0, 0, 1);
          const cameraPositionModel = vec4.transformMat4(
            vec4.create(),
            cameraPositionView,
            inverseModelView
          );
          program.setUniform(
            uniformName,
            vec3.fromValues(
              cameraPositionModel[0],
              cameraPositionModel[1],
              cameraPositionModel[2]
            )
          );
          break;
        }
        default:
          if (uniformName in allUniforms) {
            program.setUniform(uniformName, allUniforms[uniformName]);
          }
      }
    }

    const primitive = this.glGetPrimitive(geometry.primitive);
    const index = geometry.indexData;
    const { instanceCount } = geometry;
    if (instanceCount !== null) {
      if (index.length) {
        this.gl_.drawElementsInstanced(
          primitive,
          index.length,
          this.gl_.UNSIGNED_INT,
          0,
          instanceCount
        );
      } else {
        this.gl_.drawArraysInstanced(
          primitive,
          0,
          geometry.vertexCount,
          instanceCount
        );
      }
    } else if (index.length) {
      this.gl_.drawElements(primitive, index.length, this.gl_.UNSIGNED_INT, 0);
    } else {
      this.gl_.drawArrays(primitive, 0, geometry.vertexCount);
    }
  }

  public override uploadTexture(texture: Texture) {
    this.textures_.uploadTexture(texture);
  }

  public override disposeTexture(texture: Texture) {
    this.textures_.dispose(texture);
  }

  private glGetPrimitive(type: Primitive) {
    switch (type) {
      case "points":
        return this.gl_.POINTS;
      case "triangles":
        return this.gl_.TRIANGLES;
      case "lines":
        return this.gl_.LINES;
      default: {
        const exhaustiveCheck: never = type;
        throw new Error(`Unknown Primitive type: ${exhaustiveCheck}`);
      }
    }
  }

  protected resize(width: number, height: number) {
    const newViewport = new Box2(
      vec2.fromValues(0, 0),
      vec2.fromValues(width, height)
    );
    this.state_.setViewport(newViewport);
  }

  protected clear() {
    this.gl_.clearColor(0, 0, 0, 0);
    this.gl_.clearStencil(0);
    this.gl_.clear(
      this.gl_.COLOR_BUFFER_BIT |
        this.gl_.DEPTH_BUFFER_BIT |
        this.gl_.STENCIL_BUFFER_BIT
    );
  }

  private resetState() {
    this.state_.setColorMask(true);
    this.state_.setDepthMask(true);
    this.state_.setDepthTesting(true);
    this.state_.setDepthFunc(this.gl_.LEQUAL);
    this.state_.setPolygonOffset(false);
    this.state_.setStencilTest(false);
    this.state_.setBlendingMode("none");
  }
}
