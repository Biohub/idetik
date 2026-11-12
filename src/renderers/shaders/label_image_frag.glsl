#version 300 es
#pragma inject_defines

precision highp float;
precision highp int;

layout (location = 0) out vec4 fragColor;

#if defined TEXTURE_DATA_TYPE_INT
uniform highp isampler3D u_imageSampler;
#define DATA_TYPE int
#else
uniform highp usampler3D u_imageSampler;
#define DATA_TYPE uint
#endif
uniform mediump sampler2D u_colorCycleSampler;
uniform highp usampler2D u_colorLookupTableSampler;

uniform float u_opacity;
uniform bool u_premultiplyAlpha;
uniform float u_outlineSelected;
uniform float u_selectedValue;

in vec3 v_texCoords;

vec4 unpackRgba(uint packed) {
    uint r = (packed >> 24u) & 0xFFu;
    uint g = (packed >> 16u) & 0xFFu;
    uint b = (packed >> 8u) & 0xFFu;
    uint a = packed & 0xFFu;
    return vec4(float(r), float(g), float(b), float(a)) / 255.0;
}

bool isEdgePixel(DATA_TYPE centerValue, vec3 texCoords, vec3 stepX, vec3 stepY) {
    // Check 8-connected neighbors
    for (int dx = -1; dx <= 1; dx++) {
        for (int dy = -1; dy <= 1; dy++) {
            if (dx == 0 && dy == 0) continue; // Skip center pixel

            vec3 neighborCoords =
                texCoords + float(dx) * stepX + float(dy) * stepY;

            // Skip if out of bounds
            if (neighborCoords.x < 0.0 || neighborCoords.x > 1.0 ||
                neighborCoords.y < 0.0 || neighborCoords.y > 1.0) {
                continue;
            }

            DATA_TYPE neighborValue = textureLod(u_imageSampler, neighborCoords, 0.0).r;
            if (neighborValue != centerValue) {
                return true;
            }
        }
    }
    return false;
}

void main() {
    DATA_TYPE texel = texture(u_imageSampler, v_texCoords).r;

    vec3 stepX = dFdx(v_texCoords);
    vec3 stepY = dFdy(v_texCoords);

    // Check if this pixel is the selected value
    bool isSelectedValue = u_outlineSelected > 0.5 && u_selectedValue >= 0.0 && float(texel) == u_selectedValue;

    // Check if we should outline this selected segment
    if (isSelectedValue) {
        if (isEdgePixel(texel, v_texCoords, stepX, stepY)) {
            // Draw outline in bright white with layer opacity
            fragColor = vec4(1.0, 1.0, 1.0, u_opacity);
            if (u_premultiplyAlpha) fragColor.rgb *= fragColor.a;
            return;
        }
    }

    uint mapLength = uint(textureSize(u_colorLookupTableSampler, 0).x);
    for (uint i = 0u; i < mapLength; ++i) {
        uint key = texelFetch(u_colorLookupTableSampler, ivec2(i, 0), 0).r;
        // int(key) round-trips negative labels via two's complement.
        if (texel == DATA_TYPE(key)) {
            uint value = texelFetch(u_colorLookupTableSampler, ivec2(i, 1), 0).r;
            vec4 color = unpackRgba(value);

            // If this is the selected segment and outlining is enabled, make it slightly transparent
            float alpha = isSelectedValue ? u_opacity * color.a * 0.9 : u_opacity * color.a;

            fragColor = vec4(color.rgb, alpha);
            if (u_premultiplyAlpha) fragColor.rgb *= fragColor.a;
            return;
        }
    }

    uint cycleLength = uint(textureSize(u_colorCycleSampler, 0).x);
    uint index = uint(texel - DATA_TYPE(1)) % cycleLength;
    vec4 color = texelFetch(u_colorCycleSampler, ivec2(index, 0), 0);

    // If this is the selected segment and outlining is enabled, make it slightly transparent
    float alpha = isSelectedValue ? u_opacity * color.a * 0.9 : u_opacity * color.a;

    fragColor = vec4(color.rgb, alpha);
    if (u_premultiplyAlpha) fragColor.rgb *= fragColor.a;
}
