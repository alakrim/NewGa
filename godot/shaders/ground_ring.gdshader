// Flat ground indicator: a filled disc (or cone) with an edge ring and an optional clockwise progress arc.
// Used for outpost capture zones and ability telegraphs.
shader_type spatial;
render_mode unshaded, cull_disabled, depth_draw_never, shadows_disabled;

uniform vec4 color : source_color = vec4(1.0);
uniform float fill = 0.15;
uniform float edge = 0.8;
uniform float thickness = 0.05;
uniform float progress = 0.0;
uniform vec4 progress_color : source_color = vec4(1.0);
uniform float cone = 360.0;
uniform float grow = 0.0;

void fragment() {
	vec2 p = UV * 2.0 - 1.0;
	float r = length(p);
	if (r > 1.0) discard;
	if (cone < 359.0 && abs(degrees(atan(p.y, p.x))) > cone * 0.5) discard;
	vec3 c = color.rgb;
	float a = fill;
	if (r > 1.0 - thickness) a = edge;
	if (grow > 0.0 && r < grow) a = max(a, 0.32);
	if (progress > 0.0 && r > 1.0 - thickness * 3.2 && r <= 1.0 - thickness) {
		float t = atan(p.x, -p.y);
		t = (t < 0.0 ? t + 6.2831853 : t) / 6.2831853;
		if (t < progress) {
			c = progress_color.rgb;
			a = 0.95;
		}
	}
	ALBEDO = c;
	ALPHA = a * color.a;
}
