#version 300 es

precision mediump float;

layout (location = 0) out vec4 fragColor;

uniform mediump sampler2DArray u_markerAtlas;

in vec4 v_color;
flat in uint v_marker;
in float v_fade;

uniform float u_opacity;


void main() {
    float alpha = texture(u_markerAtlas, vec3(gl_PointCoord, v_marker)).r;
    float alpha_threshold = 1e-2;
    if (alpha < alpha_threshold) {
        discard;
    }
    fragColor = vec4(v_color.rgb, u_opacity * alpha * v_color.a * v_fade);
}

