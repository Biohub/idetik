#version 300 es

precision mediump float;

uniform mediump sampler2DArray u_markerAtlas;

flat in uint v_marker;
flat in float v_band;

void main() {
    // Signed distance to the marker's edge: positive is outside. Hollow
    // markers only occlude along their outline band.
    float dist = texture(u_markerAtlas, vec3(gl_PointCoord, v_marker)).r;
    if (dist > 0.0 || dist + v_band < 0.0) {
        discard;
    }
}
