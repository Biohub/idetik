import { Logger } from "../utilities/logger";
import { mat4, vec2, vec3 } from "gl-matrix";

export class WebGLShaderProgram {
  private readonly gl_: WebGL2RenderingContext;
  private readonly program_: WebGLProgram;
  private readonly uniformInfo_: Map<
    string,
    [WebGLUniformLocation, WebGLActiveInfo]
  > = new Map();

  constructor(
    gl: WebGL2RenderingContext,
    vertexShaderSource: string,
    fragmentShaderSource: string
  ) {
    this.gl_ = gl;

    const program = gl.createProgram();
    if (!program) {
      throw new Error(`Failed to create WebGL shader program`);
    }
    this.program_ = program;

    const shaders = [];
    try {
      shaders.push(this.addShader(vertexShaderSource, gl.VERTEX_SHADER));
      shaders.push(this.addShader(fragmentShaderSource, gl.FRAGMENT_SHADER));
      this.link();
      this.preprocessUniformLocations();
    } catch (error) {
      gl.deleteProgram(program);
      throw error;
    } finally {
      shaders.forEach((shader) => this.gl_.deleteShader(shader));
    }
  }

  public setUniform(name: string, value: unknown) {
    const [location, info] = this.uniformInfo_.get(name) ?? [];
    if (!location || !info) {
      throw new Error(`Uniform "${name}" not found in shader program`);
    }
    const type = info.type as SupportedUniformType;
    switch (type) {
      // There is no dedicated uniform1b in WebGL, but passing through
      // as a float or signed integer works, so fallthrough to float
      // for simplicity.
      case this.gl_.BOOL:
      case this.gl_.FLOAT:
        if (typeof value === "number") {
          this.gl_.uniform1f(location, value);
        } else {
          this.gl_.uniform1fv(location, value as Float32Array | number[]);
        }
        break;
      case this.gl_.INT:
        if (typeof value === "number") {
          this.gl_.uniform1i(location, value);
        } else {
          this.gl_.uniform1iv(location, value as Int32Array | number[]);
        }
        break;
      case this.gl_.FLOAT_VEC2:
        this.gl_.uniform2fv(location, value as vec2);
        break;
      case this.gl_.FLOAT_VEC3:
        this.gl_.uniform3fv(location, value as vec3);
        break;
      case this.gl_.FLOAT_VEC4:
        this.gl_.uniform4fv(location, value as Float32Array | number[]);
        break;
      case this.gl_.FLOAT_MAT4:
        this.gl_.uniformMatrix4fv(location, false, value as mat4);
        break;
      case this.gl_.UNSIGNED_INT:
        this.gl_.uniform1ui(location, value as number);
        break;
      // For samplers, the value is the texture index.
      case this.gl_.SAMPLER_2D:
      case this.gl_.SAMPLER_CUBE:
      case this.gl_.SAMPLER_3D:
      case this.gl_.SAMPLER_2D_ARRAY:
      case this.gl_.SAMPLER_2D_SHADOW:
      case this.gl_.SAMPLER_CUBE_SHADOW:
      case this.gl_.SAMPLER_2D_ARRAY_SHADOW:
      case this.gl_.INT_SAMPLER_2D:
      case this.gl_.INT_SAMPLER_3D:
      case this.gl_.INT_SAMPLER_CUBE:
      case this.gl_.INT_SAMPLER_2D_ARRAY:
      case this.gl_.UNSIGNED_INT_SAMPLER_2D:
      case this.gl_.UNSIGNED_INT_SAMPLER_3D:
      case this.gl_.UNSIGNED_INT_SAMPLER_CUBE:
      case this.gl_.UNSIGNED_INT_SAMPLER_2D_ARRAY:
        this.gl_.uniform1i(location, value as number);
        break;
      default: {
        const exhaustiveCheck: never = type;
        throw new Error(`Unhandled uniform type: ${exhaustiveCheck}`);
      }
    }
  }

  private preprocessUniformLocations() {
    const numUniforms = this.gl_.getProgramParameter(
      this.program_,
      this.gl_.ACTIVE_UNIFORMS
    );
    for (let i = 0; i < numUniforms; i++) {
      const info = this.gl_.getActiveUniform(this.program_, i);
      if (info) {
        if (!SUPPORTED_UNIFORM_TYPES.has(info.type)) {
          throw new Error(
            `Unsupported uniform type "${info.type}" (GLenum) found in shader program for uniform "${info.name}"`
          );
        }

        const location = this.gl_.getUniformLocation(this.program_, info.name);
        if (location) {
          this.uniformInfo_.set(info.name, [location, info]);
          Logger.debug(
            "WebGLShaderProgram",
            "Uniform found:",
            info.name,
            info.type,
            info.size
          );
        }
      }
    }
  }

  private addShader(source: string, type: number) {
    const shader = this.gl_.createShader(type);
    if (!shader) {
      throw new Error(`Failed to create a new shader of type ${type}`);
    }

    this.gl_.shaderSource(shader, source);
    this.gl_.compileShader(shader);
    if (!this.gl_.getShaderParameter(shader, this.gl_.COMPILE_STATUS)) {
      const message = this.gl_.getShaderInfoLog(shader);
      this.gl_.deleteShader(shader);
      throw new Error(`Error compiling shader: ${message}`);
    }

    this.gl_.attachShader(this.program_, shader);
    return shader;
  }

  private link() {
    this.gl_.linkProgram(this.program_);
    if (!this.getParameter(this.gl_.LINK_STATUS)) {
      const message = this.gl_.getProgramInfoLog(this.program_);
      throw new Error(`Error linking program: ${message}`);
    }
  }

  public use() {
    this.gl_.useProgram(this.program_);
  }

  public dispose() {
    this.gl_.deleteProgram(this.program_);
  }

  private getParameter(parameter: number) {
    return this.gl_.getProgramParameter(this.program_, parameter);
  }

  public get uniformNames(): string[] {
    return Array.from(this.uniformInfo_.keys());
  }
}

// using an array and converting to a set allows us to also create a type here
const SUPPORTED_UNIFORM_TYPES_ =
  typeof window !== "undefined" // Don't error in SSR contexts.
    ? [
        WebGL2RenderingContext.BOOL,
        WebGL2RenderingContext.FLOAT,
        WebGL2RenderingContext.INT,
        WebGL2RenderingContext.FLOAT_VEC2,
        WebGL2RenderingContext.FLOAT_VEC3,
        WebGL2RenderingContext.FLOAT_VEC4,
        WebGL2RenderingContext.FLOAT_MAT4,
        WebGL2RenderingContext.SAMPLER_2D,
        WebGL2RenderingContext.SAMPLER_CUBE,
        WebGL2RenderingContext.SAMPLER_3D,
        WebGL2RenderingContext.SAMPLER_2D_ARRAY,
        WebGL2RenderingContext.SAMPLER_2D_SHADOW,
        WebGL2RenderingContext.SAMPLER_CUBE_SHADOW,
        WebGL2RenderingContext.SAMPLER_2D_ARRAY_SHADOW,
        WebGL2RenderingContext.INT,
        WebGL2RenderingContext.INT_SAMPLER_2D,
        WebGL2RenderingContext.INT_SAMPLER_3D,
        WebGL2RenderingContext.INT_SAMPLER_CUBE,
        WebGL2RenderingContext.INT_SAMPLER_2D_ARRAY,
        WebGL2RenderingContext.UNSIGNED_INT,
        WebGL2RenderingContext.UNSIGNED_INT_SAMPLER_2D,
        WebGL2RenderingContext.UNSIGNED_INT_SAMPLER_3D,
        WebGL2RenderingContext.UNSIGNED_INT_SAMPLER_CUBE,
        WebGL2RenderingContext.UNSIGNED_INT_SAMPLER_2D_ARRAY,
      ]
    : [];
type SupportedUniformType = (typeof SUPPORTED_UNIFORM_TYPES_)[GLenum];
const SUPPORTED_UNIFORM_TYPES: ReadonlySet<GLenum> = new Set<GLenum>(
  SUPPORTED_UNIFORM_TYPES_
);
