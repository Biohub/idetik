#version 300 es
precision highp float;

uniform vec2 u_res;
uniform float u_time;
uniform vec2 u_mouse;
uniform float u_hover;

out vec4 outColor;

const vec3 BG = vec3(16., 16., 20.) / 255.;
const vec3 VIOLET = vec3(110., 79., 249.) / 255.;
const vec3 MAGENTA = vec3(217., 70., 239.) / 255.;
const vec3 CYAN = vec3(34., 211., 238.) / 255.;
const float TAU = 6.2831853;

float hash21(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * .1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

vec2 hash22(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * vec3(.1031, .1030, .0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zy);
}

float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3. - 2. * f);
  return mix(
    mix(hash21(i), hash21(i + vec2(1., 0.)), u.x),
    mix(hash21(i + vec2(0., 1.)), hash21(i + vec2(1., 1.)), u.x),
    u.y
  );
}

float fbm(vec2 p) {
  float amp = .5;
  float sum = 0.;
  for (int i = 0; i < 4; i++) {
    sum += amp * vnoise(p);
    p = p * 2.03 + 17.1;
    amp *= .5;
  }
  return sum;
}

mat2 rot(float a) {
  float c = cos(a);
  float s = sin(a);
  return mat2(c, -s, s, c);
}

float blob(vec2 p, vec2 at, vec2 radius, vec2 sway, float phase) {
  float t = u_time * .12 + phase;
  vec2 c = vec2((at.x - .5) * u_res.x / u_res.y, .5 - at.y)
    + sway * vec2(sin(t), cos(t * .8 + phase));
  float a = clamp(1. - length((p - c) / radius), 0., 1.);
  return a * a * (3. - 2. * a);
}

vec3 nuclei(
  vec2 p, float scale, float size, float seed, float blurP, float density, float detail
) {
  vec2 g = p * scale + seed * 17.3;
  float row = floor(g.y);
  float fy = g.y - row;
  vec3 acc = vec3(0.);
  for (int j = -1; j <= 1; j++) {
    float cellRow = row + float(j);
    float gx = g.x + .5 * mod(cellRow, 2.);
    float cellCol = floor(gx);
    float fx = gx - cellCol;
    for (int i = -1; i <= 1; i++) {
      vec2 o = vec2(float(i), float(j));
      vec2 cid = vec2(cellCol + float(i), cellRow);
      if (hash21(cid * 1.37 + seed) > density) continue;

      vec2 h = hash22(cid + seed * 3.1);
      vec2 c = o + .5 + (h - .5) * .5
        + .05 * vec2(sin(u_time * .13 + h.x * 40.), cos(u_time * .11 + h.y * 40.));
      vec2 q = vec2(fx, fy) - c;
      float blur = blurP * scale * (1. + .5 * sin(u_time * .19 + h.y * 60.));
      float fall = min(blur * 7.5 + .15 * size, .48);
      float reach = .36 * size + 1.62 * fall;
      if (dot(q, q) > reach * reach) continue;

      vec2 h2 = hash22(cid * 2.3 + 7.7 + seed);
      q *= rot(h2.x * TAU + u_time * .08 * (h2.y - .5));
      float rx = size * mix(.22, .32, h2.y);
      float ry = rx * mix(.62, .95, hash21(cid + 3.3));
      vec2 qe = q / vec2(rx, ry);
      float r = length(qe) + .24 * (vnoise(qe * 1.3 + cid * 5.1) - .5);
      float d = (r - 1.) * ry;
      float a = smoothstep(blur, -blur, d);
      float halo = .16 * pow(1. - clamp(d / fall, 0., 1.), 3.);

      float tex = 1.;
      if (detail > 0. && a > 0.) {
        vec2 n1 = (hash22(cid * 6.1 + 2.) - .5) * .9;
        vec2 n2 = (hash22(cid * 8.3 + 5.) - .5) * .9;
        float nr = mix(.10, .17, hash21(cid * 9.9));
        float holes = max(
          smoothstep(nr * 1.7, nr * .2, length(qe - n1)),
          smoothstep(nr * 1.4, nr * .15, length(qe - n2)) * step(.5, h.x)
        );
        float chromatin = (.30 + 1.35 * fbm(qe * 4.2 + cid * 9.7)) * mix(1., .5, holes);
        tex = mix(1., chromatin, detail);
      }

      float limb = mix(.78, 1., smoothstep(1., .2, r))
        + .22 * detail * exp(-abs(d) / (blur * 1.5 + .004));
      float gain = mix(.62, 1., hash21(cid * 4.1 + 1.));
      vec3 tint = mix(CYAN, mix(CYAN, VIOLET, .8), smoothstep(.5, 1., hash21(cid * .77 + seed)));
      acc += tint * (a * tex * limb + halo * (1. - a)) * gain;
    }
  }
  return acc;
}

float puncta(vec2 p, float scale, float seed) {
  vec2 g = p * scale;
  vec2 id = floor(g);
  vec2 f = fract(g);
  float density = smoothstep(.38, .72, fbm(p * 3.2 + seed)) * .85;
  float acc = 0.;
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      vec2 o = vec2(float(i), float(j));
      vec2 cid = id + o;
      vec2 h = hash22(cid + seed);
      vec2 q = f - o - h
        - .12 * vec2(sin(u_time * .9 + h.y * 70.), cos(u_time * .7 + h.x * 70.));
      float qq = dot(q, q);
      if (qq > .36) continue;

      float pick = hash21(cid * 1.9 + seed);
      float rad = mix(.10, .26, hash21(cid * 3.3 + seed));
      float twinkle = .6 + .4 * sin(u_time * (.5 + h.x) + h.y * 40.);
      acc += exp(-qq / (rad * rad))
        * twinkle
        * mix(.35, 1., hash21(cid * 5.7 + seed))
        * smoothstep(pick - .06, pick + .06, density);
    }
  }
  return acc;
}

void main() {
  vec2 p = (gl_FragCoord.xy - .5 * u_res) / u_res.y;

  float b1 = blob(p, vec2(.90, .44), vec2(.445, .337), vec2(.08, .05), 0.);
  float b2 = blob(p, vec2(.70, .18), vec2(.304, .239), vec2(.07, .06), 2.1);
  float b3 = blob(p, vec2(.12, .58), vec2(.413, .326), vec2(.09, .05), 4.2);
  float b4 = blob(p, vec2(.30, .08), vec2(.283, .217), vec2(.06, .04), 1.3);
  vec3 glow = VIOLET * b1 * .22 + MAGENTA * b2 * .12 + CYAN * b3 * .17 + VIOLET * b4 * .12;
  float light = b1 + .75 * b2 + .9 * b3 + .7 * b4;

  vec2 m = p - u_mouse;
  float focus = u_hover * exp(-dot(m, m) / (.22 * .22));
  vec2 drift = u_time * vec2(.007, .003);
  vec2 parallax = u_mouse * u_hover;

  vec3 far = nuclei(p + parallax * .012 + drift * .5, 4.4, .67, 1., .03, .5, 0.);
  vec3 mid = nuclei(
    p + parallax * .035 + drift, 2.6, .7, 2.,
    mix(.024, .009, focus), .8, mix(.3, .65, focus)
  );
  vec3 near = nuclei(p + parallax * .08 + drift * 2., 1.8, 1., 3., .075, .32, 0.);
  float specks = puncta(p + parallax * .035 + drift, 62., 5.)
    + .6 * puncta(p + parallax * .02 + drift * .7, 96., 9.);

  float exposure = .32 + .55 * light + .8 * focus;
  vec3 col = BG + glow * .42;
  col += far * .045 * exposure;
  col += near * .03 * exposure;
  col += mid * .19 * exposure;
  col += mix(MAGENTA, vec3(1.), .12) * specks * .17 * exposure;
  col += (hash21(gl_FragCoord.xy) - .5) / 255.;

  outColor = vec4(col, 1.);
}
