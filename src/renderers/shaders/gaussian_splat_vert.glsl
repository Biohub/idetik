#version 300 es

// Projects 3D Gaussians to screen-space ellipses (EWA splatting).

precision highp float;
precision highp int;
precision highp usampler2D;

layout (location = 0) in vec3 a_position;

uniform mat4 u_projection;
uniform mat4 u_modelView;
uniform vec2 u_resolution;
uniform float u_opacity;
// Whether to scale opacity down for the dilation, for scenes trained with
// anti-aliasing.
uniform bool u_antialias;

// Two RGBA32UI texels per splat, see GaussianSplats.data.
uniform usampler2D u_splats;
// The splat drawn by each instance, in back-to-front order when sorted.
uniform usampler2D u_order;

// Quads extend at most this many standard deviations.
const float MAX_SIGMAS = 3.0;
// Low-pass dilation of the projected covariance in pixels² so every splat
// covers about a pixel.
const float DILATION = 0.3;
// Splats fade out as their footprint approaches this fraction of the
// viewport, which bounds the cost of splats close to the camera.
const float MAX_EXTENT_FACTOR = 0.33;
const float MIN_ALPHA = 1.0 / 255.0;

out vec2 v_offset;
flat out vec3 v_conic;
flat out vec4 v_color;

void cull() {
    gl_Position = vec4(0.0, 0.0, 2.0, 1.0);
}

ivec2 texelCoord(int index, int width) {
    return ivec2(index % width, index / width);
}

vec4 unpackColor(uint bits) {
    return vec4(
        float(bits & 255u),
        float((bits >> 8) & 255u),
        float((bits >> 16) & 255u),
        float(bits >> 24)
    ) / 255.0;
}

void main() {
    int orderWidth = textureSize(u_order, 0).x;
    int splat = int(texelFetch(u_order, texelCoord(gl_InstanceID, orderWidth), 0).r);
    int splatsWidth = textureSize(u_splats, 0).x;
    uvec4 t0 = texelFetch(u_splats, texelCoord(2 * splat, splatsWidth), 0);
    uvec4 t1 = texelFetch(u_splats, texelCoord(2 * splat + 1, splatsWidth), 0);

    vec3 center = uintBitsToFloat(t0.xyz);
    float scale = uintBitsToFloat(t0.w);
    vec2 l00_l10 = unpackHalf2x16(t1.x);
    vec2 l11_l20 = unpackHalf2x16(t1.y);
    vec2 l21_l22 = unpackHalf2x16(t1.z);
    mat3 L = scale * mat3(
        l00_l10.x, l00_l10.y, l11_l20.y,
        0.0, l11_l20.x, l21_l22.x,
        0.0, 0.0, l21_l22.y
    );
    vec4 color = unpackColor(t1.w);

    vec4 centerView = u_modelView * vec4(center, 1.0);
    vec4 clip = u_projection * centerView;
    if (clip.w <= 0.0) {
        cull();
        return;
    }
    float invW = 1.0 / clip.w;
    vec2 ndc = clip.xy * invW;

    mat3 Lv = mat3(u_modelView) * L;
    mat3 cov = Lv * transpose(Lv);

    // Jacobian of pixel coordinates with respect to the view-space position.
    // Derived from the projection matrix, so it holds for both perspective
    // and orthographic cameras.
    vec2 halfRes = 0.5 * u_resolution;
    vec3 projX = vec3(u_projection[0][0], u_projection[1][0], u_projection[2][0]);
    vec3 projY = vec3(u_projection[0][1], u_projection[1][1], u_projection[2][1]);
    vec3 projW = vec3(u_projection[0][3], u_projection[1][3], u_projection[2][3]);
    vec3 J0 = (projX - ndc.x * projW) * invW * halfRes.x;
    vec3 J1 = (projY - ndc.y * projW) * invW * halfRes.y;
    vec3 covJ0 = cov * J0;
    vec3 covJ1 = cov * J1;
    float a = dot(J0, covJ0);
    float b = dot(J0, covJ1);
    float c = dot(J1, covJ1);

    // With anti-aliasing, opacity is scaled down by the dilation so a splat's
    // integrated contribution doesn't grow as it shrinks below a pixel.
    float detRaw = a * c - b * b;
    a += DILATION;
    c += DILATION;
    float det = a * c - b * b;
    float dilationCompensation = sqrt(max(detRaw, 0.0) / max(det, 1e-12));

    float mid = 0.5 * (a + c);
    float radius = sqrt(max(0.25 * (a - c) * (a - c) + b * b, 0.0));
    float lambda1 = mid + radius;
    float lambda2 = max(mid - radius, 1e-6);

    float maxExtent = max(u_resolution.x, u_resolution.y) * MAX_EXTENT_FACTOR;
    float coverageFade = 1.0 - smoothstep(0.5 * maxExtent, maxExtent, MAX_SIGMAS * sqrt(lambda1));
    float alpha = color.a * u_opacity * coverageFade;
    if (u_antialias) alpha *= dilationCompensation;
    if (alpha < MIN_ALPHA || !(det > 0.0)) {
        cull();
        return;
    }

    // End the quad where alpha falls below the fragment discard threshold.
    float sigmas = min(MAX_SIGMAS, sqrt(2.0 * log(alpha / MIN_ALPHA)));
    float extent1 = sigmas * sqrt(lambda1);
    float extent2 = sigmas * sqrt(lambda2);
    if (extent1 > maxExtent) {
        float shrink = maxExtent / extent1;
        extent1 *= shrink;
        extent2 *= shrink;
    }
    if (any(greaterThan(abs(ndc) - extent1 / halfRes, vec2(1.0)))) {
        cull();
        return;
    }

    v_conic = vec3(c, -b, a) / det;
    v_color = vec4(color.rgb, alpha);

    vec2 major = abs(b) > 1e-6
        ? normalize(vec2(b, lambda1 - a))
        : (a >= c ? vec2(1.0, 0.0) : vec2(0.0, 1.0));
    vec2 minor = vec2(-major.y, major.x);
    // The quad spans [0, 2]; recenter its corners to [-1, 1].
    vec2 corner = a_position.xy - 1.0;
    v_offset = corner.x * major * extent1 + corner.y * minor * extent2;

    gl_Position = vec4(ndc + v_offset / halfRes, clip.z * invW, 1.0);
}
