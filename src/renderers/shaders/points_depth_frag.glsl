#version 300 es

precision mediump float;

uniform mediump sampler2DArray u_markerAtlas;

flat in uint v_marker;
flat in float v_hollow;
flat in float v_outlinePixels;

void main() {
    // Signed distance to the marker's edge: positive is outside. Hollow
    // markers only occlude along their outline.
    float dist = texture(u_markerAtlas, vec3(gl_PointCoord, v_marker)).r;
    if (dist > 0.0) discard;
    if (v_hollow > 0.5) {
        float pixel = length(vec2(dFdx(dist), dFdy(dist)));
        if (dist + v_outlinePixels * pixel < 0.0) discard;
    }
}
