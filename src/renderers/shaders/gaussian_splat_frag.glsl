#version 300 es

precision highp float;

layout (location = 0) out vec4 fragColor;

uniform float u_opacity;
uniform float u_truncateSq;
uniform float u_shiftC;
uniform float u_invOneMinusC;
uniform float u_intensity;
uniform float u_offset;
uniform float u_absorption;
uniform float u_discardDensity;
// 0 = additive, 1 = volumetric emission-absorption.
uniform int u_blendMode;

in vec2 v_offset;
flat in vec3 v_conic;
flat in float v_amplitude;
flat in vec3 v_color;

void main() {
    vec2 d = v_offset;
    float mahalSq = v_conic.x * d.x * d.x + 2.0 * v_conic.y * d.x * d.y + v_conic.z * d.y * d.y;
    if (mahalSq > u_truncateSq) discard;

    // Shifted Gaussian that reaches zero at the truncation radius.
    float density = v_amplitude * u_invOneMinusC * max(exp(-0.5 * mahalSq) - u_shiftC, 0.0);
    if (density < u_discardDensity) discard;

    vec3 color = max(v_color * u_intensity + u_offset, vec3(0.0));
    vec3 emission = color * density * u_opacity;

    if (u_blendMode == 1) {
        // Emission-absorption (Max 1995) composited with premultiplied alpha.
        // RGB carries the self-screened emission S(τ) = (1 - e^-τ) / τ.
        float tau = u_absorption * u_opacity * density;
        if (max(color.r, max(color.g, color.b)) < 1e-4 && tau < 1e-4) discard;
        float alpha = 1.0 - exp(-tau);
        float screen = tau < 1e-3
            ? 1.0 - 0.5 * tau + tau * tau / 6.0
            : alpha / tau;
        fragColor = vec4(emission * screen, alpha);
    } else {
        if (max(color.r, max(color.g, color.b)) < 1e-4) discard;
        fragColor = vec4(emission, 1.0);
    }
}
