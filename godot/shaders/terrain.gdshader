// Pixel-art terrain for the HD-2D battlefield. Top faces sample the grass tile in world space (one 64 px
// tile = 2 units, so 32 texels per unit) with dithered colour patches and a dithered dirt road; side faces
// sample the cliff strip through the mesh UVs.
shader_type spatial;
render_mode specular_disabled, cull_disabled;

uniform sampler2D grass_tex : source_color, filter_nearest, repeat_enable;
uniform sampler2D road_tex : source_color, filter_nearest, repeat_enable;
uniform sampler2D cliff_tex : source_color, filter_nearest, repeat_enable;
uniform vec4 road = vec4(-97.0, -2.4, 97.0, 4.4); // x0, z0, x1, z1
uniform float tile = 2.0;

varying vec3 wp;
varying vec3 wn;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p) {
	vec2 i = floor(p);
	vec2 f = fract(p);
	f = f * f * (3.0 - 2.0 * f);
	return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}

void vertex() {
	wp = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz;
	wn = normalize((MODEL_MATRIX * vec4(NORMAL, 0.0)).xyz);
}

void fragment() {
	vec3 c;
	if (wn.y > 0.5) {
		vec2 texel = floor(wp.xz * 32.0);
		vec2 q = texel / 32.0;
		float dither = hash(texel) - 0.5;
		c = texture(grass_tex, wp.xz / tile).rgb;
		// large soft patches, quantised and dithered so they read as pixel art
		float n = vnoise(q * 0.07) * 0.65 + vnoise(q * 0.23) * 0.35 + dither * 0.06;
		c *= n > 0.62 ? vec3(0.86, 0.93, 0.78) : (n < 0.3 ? vec3(1.06, 1.05, 0.9) : vec3(1.0));
		// dirt road with a wobbly, darker rim
		float wob0 = (vnoise(vec2(q.x * 0.55, 3.1)) - 0.5) * 1.3;
		float wob1 = (vnoise(vec2(q.x * 0.55, 9.7)) - 0.5) * 1.3;
		float inside = min(min(q.y - (road.y + wob0), (road.w + wob1) - q.y), min(q.x - road.x, road.z - q.x));
		inside += dither * 0.18;
		if (inside > 0.0) {
			vec3 r = texture(road_tex, wp.xz / tile).rgb * vec3(0.88, 0.78, 0.64);
			float ruts = vnoise(vec2(q.x * 0.9, q.y * 3.0));
			r *= ruts > 0.7 ? 0.9 : 1.0;
			c = inside < 0.22 ? r * 0.78 : r;
		}
	} else {
		c = texture(cliff_tex, UV).rgb;
	}
	ALBEDO = c;
}
