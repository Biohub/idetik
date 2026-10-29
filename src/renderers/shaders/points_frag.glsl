#version 300 es

precision mediump float;

layout (location = 0) out vec4 fragColor;

uniform mediump sampler2DArray u_markerAtlas;

in vec4 v_color;
flat in uint v_marker;
in float v_fade;
flat in float v_pixel;
flat in float v_band;

uniform float u_opacity;


void main() {
    // The atlas holds the signed distance to the marker's edge in sprite
    // units (negative inside); v_pixel is one screen pixel in those units,
    // so the edge is antialiased over one pixel at any marker size. Hollow
    // markers keep only the band inside the edge: subtract the coverage of
    // the marker shrunk by v_band (which lies past the sprite for solid
    // markers, so nothing is subtracted).
    float dist = texture(u_markerAtlas, vec3(gl_PointCoord, v_marker)).r;
    float coverage = smoothstep(-0.5 * v_pixel, 0.5 * v_pixel, dist + v_band)
        - smoothstep(-0.5 * v_pixel, 0.5 * v_pixel, dist);
    if (coverage < 1e-2) {
        discard;
    }
    fragColor = vec4(v_color.rgb, u_opacity * coverage * v_color.a * v_fade);
}
