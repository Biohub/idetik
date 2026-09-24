#version 300 es

// Projects 3D Gaussians to screen-space ellipses (EWA splatting). The
// projection, ray-integral amplitude, and anti-aliasing dilation follow the
// Luxar viewer's gsplat material.

precision highp float;
precision highp int;
precision highp usampler2D;

layout (location = 0) in vec3 a_position;

uniform mat4 u_projection;
uniform mat4 u_modelView;
uniform vec2 u_resolution;

// Two RGBA32UI texels per splat: center and amplitude as float bits, then
// the Cholesky factor of the covariance as six packed half floats.
uniform usampler2D u_splats;
// The splat drawn by each instance, in back-to-front order when sorted.
uniform usampler2D u_order;
uniform sampler2D u_colormap;

uniform float u_truncate;
uniform float u_rayIntegralFactor;
uniform float u_cov2DDilation;
uniform float u_maxExtentFactor;
uniform float u_amplitudeMin;
uniform float u_amplitudeScale;
uniform float u_invGamma;
uniform float u_shiftC;
uniform float u_invOneMinusC;
// Fragments with a lower density are discarded.
uniform float u_discardDensity;

out vec2 v_offset;
flat out vec3 v_conic;
flat out float v_amplitude;
flat out vec3 v_color;

void cull() {
    gl_Position = vec4(0.0, 0.0, 2.0, 1.0);
}

ivec2 texelCoord(int index, int width) {
    return ivec2(index % width, index / width);
}

void main() {
    int orderWidth = textureSize(u_order, 0).x;
    int splat = int(texelFetch(u_order, texelCoord(gl_InstanceID, orderWidth), 0).r);
    int splatsWidth = textureSize(u_splats, 0).x;
    uvec4 t0 = texelFetch(u_splats, texelCoord(2 * splat, splatsWidth), 0);
    uvec4 t1 = texelFetch(u_splats, texelCoord(2 * splat + 1, splatsWidth), 0);

    vec3 center = uintBitsToFloat(t0.xyz);
    float amplitude = uintBitsToFloat(t0.w);
    vec2 l00_l10 = unpackHalf2x16(t1.x);
    vec2 l11_l20 = unpackHalf2x16(t1.y);
    vec2 l21_l22 = unpackHalf2x16(t1.z);
    mat3 L = mat3(
        l00_l10.x, l00_l10.y, l11_l20.y,
        0.0, l11_l20.x, l21_l22.x,
        0.0, 0.0, l21_l22.y
    );

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

    // Low-pass dilation so every splat covers about a pixel, with the
    // amplitude scaled to conserve the splat's integrated brightness.
    float detRaw = a * c - b * b;
    a += u_cov2DDilation;
    c += u_cov2DDilation;
    float det = a * c - b * b;
    float dilationCompensation = sqrt(max(detRaw, 0.0) / max(det, 1e-12));

    float mid = 0.5 * (a + c);
    float radius = sqrt(max(0.25 * (a - c) * (a - c) + b * b, 0.0));
    float lambda1 = mid + radius;
    float lambda2 = max(mid - radius, 1e-6);

    // Fade out splats whose footprint approaches the viewport size.
    float maxExtent = max(u_resolution.x, u_resolution.y) * u_maxExtentFactor;
    float coverageFade = 1.0 - smoothstep(0.5 * maxExtent, maxExtent, u_truncate * sqrt(lambda1));
    if (coverageFade < 0.01 || !(det > 0.0)) {
        cull();
        return;
    }

    // Integrate the Gaussian along the view ray. The line integral of an
    // anisotropic Gaussian has std-dev 1 / sqrt(rᵀ Σ⁻¹ r). Σ is normalized by
    // its mean variance so the inverse is well conditioned at any scale.
    bool isOrtho = u_projection[2][3] == 0.0;
    vec3 ray = isOrtho ? vec3(0.0, 0.0, -1.0) : normalize(centerView.xyz);
    float meanVar = max((cov[0][0] + cov[1][1] + cov[2][2]) / 3.0, 1e-30);
    mat3 covN = cov / meanVar;
    float detN = max(determinant(covN), 1e-12);
    mat3 adj = mat3(
        covN[1][1] * covN[2][2] - covN[1][2] * covN[2][1],
        covN[0][2] * covN[2][1] - covN[0][1] * covN[2][2],
        covN[0][1] * covN[1][2] - covN[0][2] * covN[1][1],
        covN[1][2] * covN[2][0] - covN[1][0] * covN[2][2],
        covN[0][0] * covN[2][2] - covN[0][2] * covN[2][0],
        covN[0][2] * covN[1][0] - covN[0][0] * covN[1][2],
        covN[1][0] * covN[2][1] - covN[1][1] * covN[2][0],
        covN[0][1] * covN[2][0] - covN[0][0] * covN[2][1],
        covN[0][0] * covN[1][1] - covN[0][1] * covN[1][0]
    );
    float quad = max(dot(ray, adj * ray) / detN, 1e-8);
    float sigmaRay = inversesqrt(quad) * sqrt(meanVar);
    v_amplitude = amplitude * sigmaRay * u_rayIntegralFactor
        * dilationCompensation * coverageFade;

    float peak = v_amplitude * u_invOneMinusC;

    // Shrink the quad to where the density falls below the fragment shader's
    // discard threshold, since fragments beyond it are discarded anyway.
    float edge = u_shiftC + u_discardDensity / max(peak, 1e-30);
    if (edge >= 1.0) {
        cull();
        return;
    }
    float radius2D = min(u_truncate, sqrt(-2.0 * log(edge)));
    float extent1 = radius2D * sqrt(lambda1);
    float extent2 = radius2D * sqrt(lambda2);
    if (extent1 > maxExtent) {
        float scale = maxExtent / extent1;
        extent1 *= scale;
        extent2 *= scale;
    }
    if (any(greaterThan(abs(ndc) - extent1 / halfRes, vec2(1.0)))) {
        cull();
        return;
    }

    float t = clamp((amplitude - u_amplitudeMin) * u_amplitudeScale, 0.0, 1.0);
    t = pow(t, u_invGamma);
    v_color = texture(u_colormap, vec2(t, 0.5)).rgb;

    v_conic = vec3(c, -b, a) / det;

    vec2 major = abs(b) > 1e-6
        ? normalize(vec2(b, lambda1 - a))
        : (a >= c ? vec2(1.0, 0.0) : vec2(0.0, 1.0));
    vec2 minor = vec2(-major.y, major.x);
    // The quad spans [0, 2]; recenter its corners to [-1, 1].
    vec2 corner = a_position.xy - 1.0;
    v_offset = corner.x * major * extent1 + corner.y * minor * extent2;

    gl_Position = vec4(ndc + v_offset / halfRes, clip.z * invW, 1.0);
}
