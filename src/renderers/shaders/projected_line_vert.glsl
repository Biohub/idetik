#version 300 es

layout (location = 0) in vec3 a_position;
layout (location = 3) in vec3 a_prevPosition;
layout (location = 4) in vec3 a_nextPosition;
layout (location = 5) in float a_direction;

uniform mat4 u_projection;
uniform mat4 u_modelView;
uniform vec2 u_resolution;
uniform float u_lineWidth;

// adapted from https://github.com/mattdesl/webgl-lines
void main() {
    mat4 projModelView = u_projection * u_modelView;

    vec4 prevPos = projModelView * vec4(a_prevPosition, 1.0);
    vec4 currPos = projModelView * vec4(a_position, 1.0);
    vec4 nextPos = projModelView * vec4(a_nextPosition, 1.0);

    vec2 aspectVec = vec2(u_resolution.x / u_resolution.y, 1.0);
    vec2 prevScreen = (prevPos.xy / prevPos.w) * aspectVec;
    vec2 currScreen = (currPos.xy / currPos.w) * aspectVec;
    vec2 nextScreen = (nextPos.xy / nextPos.w) * aspectVec;

    // a_direction is + or -; which way to project the vertex away from the path
    float d = sign(a_direction);

    // `normal` points perpendicular to the path in screen space
    vec2 normal;
    // `miterLength` extends the offset along the normal (with a limit)
    // this make a nicer corner and keeps the line thickness more uniform;
    float miterLength = 1.0;
    if (prevPos == currPos) {
        // first point on the path
        vec2 dir = normalize(nextScreen - currScreen);
        normal = vec2(-dir.y, dir.x);
    } else if (nextPos == currPos) {
        // last point on the path
        vec2 dir = normalize(currScreen - prevScreen);
        normal = vec2(-dir.y, dir.x);
    } else {
        // middle point on the path: add miter along the bisector
        vec2 prevDir = normalize(currScreen - prevScreen);
        vec2 nextDir = normalize(nextScreen - currScreen);
        vec2 perpPrev = vec2(-prevDir.y, prevDir.x);
        vec2 bisector = prevDir + nextDir;
        if (dot(bisector, bisector) < 1e-6) {
            // the path doubles back on itself: no bisector, so use the
            // incoming segment's normal
            normal = perpPrev;
        } else {
            vec2 tangent = normalize(bisector);
            normal = vec2(-tangent.y, tangent.x);
            // cap the miter so sharp corners don't spike; beyond the cap the
            // join is simply cut short
            miterLength = min(1.0 / max(dot(normal, perpPrev), 1e-3), 2.0);
        }
    }

    // `normal * u_lineWidth / u_resolution` means u_lineWidth is in pixels
    vec4 offset = vec4(
        (normal * u_lineWidth / u_resolution) * miterLength * d,
        0.0,
        0.0
    );
    gl_Position = currPos + offset * currPos.w;

    // draw as GL_POINTS for debugging
    gl_PointSize = 5.0;
}
