#version 300 es
#pragma inject_defines
precision highp float;

#include ./common/srgb_to_linear.glsl

layout (location = 0) out vec4 fragColor;

// This shader could be optimised by creating four separate shader variants
#if defined TEXTURE_DATA_TYPE_INT
precision mediump isampler3D;
uniform isampler3D u_channel0Sampler;
uniform isampler3D u_channel1Sampler;
uniform isampler3D u_channel2Sampler;
uniform isampler3D u_channel3Sampler;
#elif defined TEXTURE_DATA_TYPE_UINT
precision mediump usampler3D;
uniform usampler3D u_channel0Sampler;
uniform usampler3D u_channel1Sampler;
uniform usampler3D u_channel2Sampler;
uniform usampler3D u_channel3Sampler;
#else
precision mediump sampler3D;
uniform sampler3D u_channel0Sampler;
uniform sampler3D u_channel1Sampler;
uniform sampler3D u_channel2Sampler;
uniform sampler3D u_channel3Sampler;
#endif

uniform highp vec3 u_cameraPositionModel;
uniform vec3 u_voxelScale;
in highp vec3 v_positionModel;
in highp vec4 v_clipPosition;

// The bounding box in model space is normalized to -0.5 to 0.5
vec3 boundingboxMin = vec3(-0.50);
vec3 boundingboxMax = vec3(0.50);

// Volume rendering parameters
uniform bool u_debugShowDegenerateRays;
uniform float u_relativeStepSize;
uniform float u_opacityMultiplier;
uniform float u_earlyTerminationAlpha;

// Multi-channel support (max 4 channels, could support more with arrays if needed)
uniform vec4 u_visible;
uniform vec4 u_valueOffset;
uniform vec4 u_valueScale;
uniform vec4 u_channelOpacity;
uniform vec3 u_color[4];
uniform vec4 u_hasColorMap;
uniform vec3 u_colorMap[4 * 48];

// Optionally terminate rays at some predetermined scene depth
uniform bool u_hasSceneDepth;
uniform highp sampler2D u_sceneDepth;
uniform mat4 u_mvpInverse;

float distanceAlongRayAtWindowDepth(float windowDepth, vec3 rayOrigin, vec3 rayDir) {
    vec3 ndc = vec3(v_clipPosition.xy / v_clipPosition.w, windowDepth * 2.0 - 1.0);
    vec4 positionModel = u_mvpInverse * vec4(ndc, 1.0);
    return dot(positionModel.xyz / positionModel.w - rayOrigin, rayDir);
}

vec2 findBoxIntersectionsAlongRay(vec3 rayOrigin, vec3 rayDir, vec3 boxMin, vec3 boxMax) {
    vec3 reciprocalRayDir = 1.0 / rayDir;
    vec3 t0 = (boxMin - rayOrigin) * reciprocalRayDir;
    vec3 t1 = (boxMax - rayOrigin) * reciprocalRayDir;

    vec3 tMin = min(t0, t1);
    vec3 tMax = max(t0, t1);

    float tEnter = max(max(tMin.x, tMin.y), tMin.z);
    float tExit = min(min(tMax.x, tMax.y), tMax.z);
    tEnter = max(0.0, tEnter);
    tExit = max(tEnter, tExit);

    return vec2(tEnter, tExit);
}

// Returns channels in .xyzw (missing channels are 0)
vec4 sampleChannels(vec3 uvw) {
  vec4 c = vec4(0.0);

  if (bool(u_visible.x)) c.x = float(texture(u_channel0Sampler, uvw).r);
  if (bool(u_visible.y)) c.y = float(texture(u_channel1Sampler, uvw).r);
  if (bool(u_visible.z)) c.z = float(texture(u_channel2Sampler, uvw).r);
  if (bool(u_visible.w)) c.w = float(texture(u_channel3Sampler, uvw).r);

  return (c + u_valueOffset) * u_valueScale;
}

vec3 getTextureSize() {
    if (bool(u_visible.x)) return vec3(textureSize(u_channel0Sampler, 0));
    else if (bool(u_visible.y)) return vec3(textureSize(u_channel1Sampler, 0));
    else if (bool(u_visible.z)) return vec3(textureSize(u_channel2Sampler, 0));
    else if (bool(u_visible.w)) return vec3(textureSize(u_channel3Sampler, 0));
    return vec3(1.0); // Ideally at least one channel should be visible
}

void main() {
    // Step 1 - calculate where the ray enters and exits the volume

    // The ray in model space goes from the camera to the point on the back face
    vec3 RayDirModel = normalize(v_positionModel - u_cameraPositionModel);

    vec2 rayIntersections = findBoxIntersectionsAlongRay(u_cameraPositionModel, RayDirModel, boundingboxMin, boundingboxMax);
    float tEnter = rayIntersections.x;
    float tExit = rayIntersections.y;

    if (u_debugShowDegenerateRays && (tExit == tEnter)) {
        fragColor = vec4(1.0, 0.0, 0.0, 1.0);
        return;
    }

    if (u_hasSceneDepth) {
        float sceneWindowDepth = texelFetch(u_sceneDepth, ivec2(gl_FragCoord.xy), 0).r;
        if (sceneWindowDepth < 1.0) {
            float tScene = distanceAlongRayAtWindowDepth(sceneWindowDepth, u_cameraPositionModel, RayDirModel);
            if (tScene < tEnter) discard;
            tExit = min(tExit, tScene);
        }
    }

    vec3 entryPoint = u_cameraPositionModel + RayDirModel * tEnter;
    entryPoint = clamp(entryPoint + 0.5, 0.0, 1.0);
    vec3 exitPoint = u_cameraPositionModel + RayDirModel * tExit;
    exitPoint = clamp(exitPoint + 0.5, 0.0, 1.0);

    // Step 2 - calculate the number of samples based on the length of the ray
    vec3 rayWithinModel = exitPoint - entryPoint;

    // Get texture dimensions and convert ray to voxel space
    vec3 textureSize = getTextureSize();
    vec3 rayInVoxels = rayWithinModel * textureSize;
    float rayLengthInVoxels = length(rayInVoxels);
    int numSamples = max(int(ceil(rayLengthInVoxels / u_relativeStepSize)), 1);
    vec3 stepIncrement = rayWithinModel / float(numSamples);

    // Calculate actual world-space step size for opacity correction.
    // This accounts for anisotropic voxels so brightness stays constant regardless
    // of viewing angle. For anisotropic voxels (e.g., 1x1x3 microns), rays along
    // different axes traverse different amounts of material per step.
    vec3 stepInWorldSpace = stepIncrement * textureSize * u_voxelScale;
    float worldSpaceStepSize = length(stepInWorldSpace);
    float intensityScale = u_opacityMultiplier * worldSpaceStepSize;

    // Step 3 - perform the ray marching and compositing in front to back order
    vec3 position = entryPoint;
    vec4 accumulatedColor = vec4(0.0);

    vec3 linearColors[4];
    for (int ch = 0; ch < 4; ch++) {
        linearColors[ch] = srgbToLinear(u_color[ch]);
    }

    vec3 sampleColor = vec3(0.0);
    float sampleAlpha, blendedSampleAlpha;
    for (int i = 0; i < numSamples && accumulatedColor.a < u_earlyTerminationAlpha; i++) {

        vec4 sampleValues = sampleChannels(position);
        // Combine color per channel
        for (int ch = 0; ch < 4; ch++) {
            if (!bool(u_visible[ch]) || sampleValues[ch] == 0.0) continue;
            sampleColor = linearColors[ch];

            if (bool(u_hasColorMap[ch])) {
                float x = clamp(sampleValues[ch], 0.0, 1.0) * 47.0;
                int i = min(int(x), 46);
                sampleColor = mix(
                    srgbToLinear(u_colorMap[ch * 48 + i]),
                    srgbToLinear(u_colorMap[ch * 48 + i + 1]),
                    x - float(i)
                );
            }

            sampleAlpha = clamp(sampleValues[ch] * intensityScale * u_channelOpacity[ch], 0.0, 1.0);
            blendedSampleAlpha = (1.0 - accumulatedColor.a) * sampleAlpha;

            // Front-to-back compositing
            accumulatedColor.a += blendedSampleAlpha;
            accumulatedColor.rgb += sampleColor * blendedSampleAlpha;
        }

        position += stepIncrement;
    }

    fragColor = accumulatedColor;
}
