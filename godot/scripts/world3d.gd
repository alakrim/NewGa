extends Node3D
## The Frontline battlefield in HD-2D: lit 3D terrain with pixel-art textures (an island with a road lane and
## a raised plateau behind each keep), pixel-art trees and ground cover standing in it, warm low sun with real
## shadows, fog, bloom and fireflies. One world unit = one sim unit; sprites use 32 texels per unit like the 2D art.
## Units, buildings and effects go under `actors`.

const V = preload("res://scripts/visuals.gd")
const M = preload("res://scripts/fl_map.gd")
const HD := "res://assets/hd2d/"
const PIX := 1.0 / 32.0
## Upright sprites lean back toward the camera by this much so they are not squashed by the top-down view.
const TILT := deg_to_rad(36.0)

const ISLAND := Rect2(-100, -36, 198, 54)  # x, z, width, depth
const PLATEAU_H := 3.0
const PLATEAU_FRONT := -12.0
const PLATEAUS := [[-100.0, -40.0], [38.0, 98.0]]
const SHORE_H := 1.2
const WATER_Y := -0.75

var actors: Node3D
## Graphics preference: "high" or "low" (battery saver: sparser grass, no fireflies, cheaper shadows).
var quality: String = Prefs.get_value("gfx", "high")
var sun: DirectionalLight3D
var environment: Environment
var _rng := RandomNumberGenerator.new()
var _plot_rects: Array[Rect2] = []


static func on_plateau(x: float, z: float) -> bool:
	if z > PLATEAU_FRONT:
		return false
	for r in PLATEAUS:
		if x >= r[0] and x <= r[1]:
			return true
	return false


static func ground_y(x: float, z: float) -> float:
	return PLATEAU_H if on_plateau(x, z) else 0.0


func _ready() -> void:
	_rng.seed = 7
	for p in M.plots():
		_plot_rects.append(Rect2(p.x - 3.0, p.z - 2.2, 6.0, 4.4))
	_build_env()
	_build_terrain()
	_build_water()
	actors = Node3D.new()
	actors.name = "Actors"
	add_child(actors)
	_build_foliage()
	_build_trees()
	_build_props()
	_road_edges()
	_build_fireflies()
	_build_braziers()


# ------------------------------------------------------------------ light and atmosphere
func _build_env() -> void:
	var e := Environment.new()
	e.background_mode = Environment.BG_COLOR
	e.background_color = Color(0.2, 0.5, 0.54)
	e.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	e.ambient_light_color = Color(0.58, 0.68, 0.88)  # cool sky fill so shadows read blue against the warm sun
	e.ambient_light_energy = 0.56
	e.tonemap_mode = Environment.TONE_MAPPER_FILMIC
	e.tonemap_exposure = 1.05
	e.tonemap_white = 5.0
	e.glow_enabled = true
	e.glow_intensity = 0.35
	e.glow_strength = 1.0
	e.glow_bloom = 0.04
	e.glow_hdr_threshold = 1.1
	e.glow_blend_mode = Environment.GLOW_BLEND_MODE_ADDITIVE
	for i in range(7):
		e.set_glow_level(i, 1.0 if i in [2, 3, 4] else 0.0)
	e.fog_enabled = true
	e.fog_light_color = Color(1.0, 0.84, 0.64)
	e.fog_light_energy = 0.9
	e.fog_density = 0.0016
	e.fog_aerial_perspective = 0.25
	e.fog_sky_affect = 0.0
	e.adjustment_enabled = true
	e.adjustment_saturation = 1.12
	e.adjustment_contrast = 1.14
	# split tone: shadows lean cool blue, highlights warm gold
	var g := Gradient.new()
	g.set_color(0, Color(0.05, 0.06, 0.15))
	g.add_point(0.5, Color(0.5, 0.49, 0.47))
	g.set_color(g.get_point_count() - 1, Color(1.0, 0.95, 0.83))
	var lut := GradientTexture1D.new()
	lut.gradient = g
	lut.width = 256
	e.adjustment_color_correction = lut
	if RenderingServer.get_current_rendering_method() == "forward_plus":
		e.ssao_enabled = true
		e.ssao_intensity = 1.4
	environment = e
	var we := WorldEnvironment.new()
	we.environment = e
	add_child(we)
	sun = DirectionalLight3D.new()
	sun.light_color = Color(1.0, 0.83, 0.6)
	sun.light_energy = 1.55
	sun.rotation_degrees = Vector3(-34, -38, 0)  # low golden-hour sun from the front left
	sun.shadow_enabled = true
	sun.shadow_blur = 1.2
	sun.shadow_opacity = 0.85
	sun.directional_shadow_mode = DirectionalLight3D.SHADOW_PARALLEL_2_SPLITS
	sun.directional_shadow_max_distance = 130.0
	if quality == "low":
		sun.directional_shadow_mode = DirectionalLight3D.SHADOW_ORTHOGONAL
		sun.shadow_blur = 0.6
	add_child(sun)


# ------------------------------------------------------------------ terrain
func _crop(path: String, rect: Rect2i) -> ImageTexture:
	var t: Texture2D = Sprites.tex(path)
	if t == null:
		return null
	var img := t.get_image()
	if img.is_compressed():
		img.decompress()
	return ImageTexture.create_from_image(img.get_region(rect))


func _quad(st: SurfaceTool, a: Vector3, b: Vector3, c: Vector3, d: Vector3, n: Vector3, ua: Vector2, ub: Vector2, uc: Vector2, ud: Vector2) -> void:
	# a b c d go around the quad
	st.set_normal(n)
	for pair in [[a, ua], [b, ub], [c, uc], [a, ua], [c, uc], [d, ud]]:
		st.set_uv(pair[1])
		st.add_vertex(pair[0])


## A vertical cliff face from p0 to p1 (horizontal), spanning y0..y1, textured with v0..v1 of the cliff strip.
func _face(st: SurfaceTool, p0: Vector2, p1: Vector2, y0: float, y1: float, n: Vector3, v0: float, v1: float) -> void:
	var u1 := p0.distance_to(p1) / 2.0
	_quad(st, Vector3(p0.x, y1, p0.y), Vector3(p1.x, y1, p1.y), Vector3(p1.x, y0, p1.y), Vector3(p0.x, y0, p0.y), n,
		Vector2(0, v0), Vector2(u1, v0), Vector2(u1, v1), Vector2(0, v1))


func _top(st: SurfaceTool, x0: float, z0: float, x1: float, z1: float, y: float) -> void:
	_quad(st, Vector3(x0, y, z0), Vector3(x1, y, z0), Vector3(x1, y, z1), Vector3(x0, y, z1), Vector3.UP,
		Vector2.ZERO, Vector2.ZERO, Vector2.ZERO, Vector2.ZERO)


func _build_terrain() -> void:
	var st := SurfaceTool.new()
	st.begin(Mesh.PRIMITIVE_TRIANGLES)
	var x0 := ISLAND.position.x
	var z0 := ISLAND.position.y
	var x1 := ISLAND.end.x
	var z1 := ISLAND.end.y
	_top(st, x0, z0, x1, z1, 0.0)
	# shore: a short rock edge down to the water
	_face(st, Vector2(x0, z1), Vector2(x1, z1), -SHORE_H, 0.0, Vector3.BACK, 0.5, 1.0)
	_face(st, Vector2(x0, z0), Vector2(x0, z1), -SHORE_H, 0.0, Vector3.LEFT, 0.5, 1.0)
	_face(st, Vector2(x1, z1), Vector2(x1, z0), -SHORE_H, 0.0, Vector3.RIGHT, 0.5, 1.0)
	# plateaus behind each keep
	for r in PLATEAUS:
		var a: float = r[0]
		var b: float = r[1]
		_top(st, a, z0, b, PLATEAU_FRONT, PLATEAU_H)
		_face(st, Vector2(a, PLATEAU_FRONT), Vector2(b, PLATEAU_FRONT), 0.0, PLATEAU_H, Vector3.BACK, 0.0, 1.0)
		_face(st, Vector2(a, z0), Vector2(a, PLATEAU_FRONT), 0.0, PLATEAU_H, Vector3.LEFT, 0.0, 1.0)
		_face(st, Vector2(b, PLATEAU_FRONT), Vector2(b, z0), 0.0, PLATEAU_H, Vector3.RIGHT, 0.0, 1.0)
	var mat := ShaderMaterial.new()
	mat.shader = load("res://shaders/terrain.gdshader")
	mat.set_shader_parameter("grass_tex", _crop(V.FREE + "Terrain/Tileset/Tilemap_color1.png", Rect2i(64, 64, 64, 64)))
	mat.set_shader_parameter("grass2_tex", _crop(V.FREE + "Terrain/Tileset/Tilemap_color2.png", Rect2i(64, 64, 64, 64)))
	mat.set_shader_parameter("grass3_tex", _crop(V.FREE + "Terrain/Tileset/Tilemap_color3.png", Rect2i(64, 64, 64, 64)))
	mat.set_shader_parameter("cliff_tex", _crop(V.FREE + "Terrain/Tileset/Tilemap_color1.png", Rect2i(384, 256, 64, 128)))
	mat.set_shader_parameter("road_tex", _crop(V.CC0 + "Terrain/Ground/Tilemap_Flat.png", Rect2i(384, 64, 64, 64)))
	var mi := MeshInstance3D.new()
	mi.mesh = st.commit()
	mi.material_override = mat
	mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_ON
	add_child(mi)
	# a sand foundation on every building plot
	var sand := _crop(V.CC0 + "Terrain/Ground/Tilemap_Flat.png", Rect2i(320, 0, 192, 192))
	for p in M.plots():
		var s := Sprite3D.new()
		s.texture = sand
		s.axis = Vector3.Axis.AXIS_Y
		s.pixel_size = PIX * 0.78
		s.texture_filter = BaseMaterial3D.TEXTURE_FILTER_NEAREST
		s.alpha_cut = SpriteBase3D.ALPHA_CUT_DISCARD
		s.shaded = true
		s.position = Vector3(p.x, ground_y(p.x, p.z) + 0.02, p.z)
		s.modulate = Color(0.95, 0.88, 0.78)
		add_child(s)


func _build_water() -> void:
	var pm := PlaneMesh.new()
	pm.size = Vector2(700, 420)
	var mat := ShaderMaterial.new()
	mat.shader = load("res://shaders/water.gdshader")
	mat.set_shader_parameter("island", Vector4(ISLAND.position.x, ISLAND.position.y, ISLAND.end.x, ISLAND.end.y))
	var mi := MeshInstance3D.new()
	mi.mesh = pm
	mi.material_override = mat
	mi.position = Vector3(0, WATER_Y, -9)
	mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	add_child(mi)


# ------------------------------------------------------------------ ground cover
func _blocked(x: float, z: float, road_margin := 0.0) -> bool:
	if x < ISLAND.position.x + 0.6 or x > ISLAND.end.x - 0.6 or z < ISLAND.position.y + 0.6 or z > ISLAND.end.y - 0.5:
		return true
	if z > -2.6 - road_margin and z < 4.6 + road_margin:
		return true  # the road
	if absf(z - PLATEAU_FRONT) < 0.5 and on_plateau(x, z - 1.0):
		return true  # cliff lip
	for r in _plot_rects:
		if r.has_point(Vector2(x, z)):
			return true
	for n in M.NODES:
		if Vector2(n[0], n[1]).distance_to(Vector2(x, z)) < 3.5:
			return true
	if absf(x) > 79 and z > -10 and z < 4:
		return true  # keeps
	return false


var _clump := FastNoiseLite.new()


## Scatters `count` camera-facing quads of one texture over `area`. With `clump` > 0 they gather in
## patches (higher = tighter patches) instead of spreading evenly.
func _cover(tex_path: String, count: int, scale_min: float, scale_max: float, tint: Color, wind: float, road_margin := 0.0, area := ISLAND, clump := 0.0) -> void:
	var tex: Texture2D = Sprites.tex(tex_path)
	if tex == null:
		return
	var qm := QuadMesh.new()
	var sz := tex.get_size() * PIX
	qm.size = sz
	qm.center_offset = Vector3(0, sz.y / 2.0, 0)
	var mat := ShaderMaterial.new()
	mat.shader = load("res://shaders/foliage.gdshader")
	mat.set_shader_parameter("tex", tex)
	mat.set_shader_parameter("wind", wind)
	qm.material = mat
	var mm := MultiMesh.new()
	mm.transform_format = MultiMesh.TRANSFORM_3D
	mm.use_colors = true
	mm.mesh = qm
	var xs: Array[Transform3D] = []
	var tries := 0
	while xs.size() < count and tries < count * 12:
		tries += 1
		var x := _rng.randf_range(area.position.x, area.end.x)
		var z := _rng.randf_range(area.position.y, area.end.y)
		if _blocked(x, z, road_margin):
			continue
		var k := 1.0
		if clump > 0.0:
			k = clampf((_clump.get_noise_2d(x * 3.0, z * 3.0) + 0.15) * 2.2, 0.0, 1.0)
			if _rng.randf() > pow(k, clump):
				continue
		var s := _rng.randf_range(scale_min, scale_max) * (0.75 + 0.45 * k)
		var b := Basis(Vector3.RIGHT, -TILT) * Basis.from_scale(Vector3(s * (1.0 if _rng.randf() < 0.5 else -1.0), s, s))
		var t := Transform3D(b, Vector3(x, ground_y(x, z), z))
		xs.append(t)
	if quality == "low":
		xs.resize(int(xs.size() * 0.35))
	mm.instance_count = xs.size()
	for i in range(xs.size()):
		mm.set_instance_transform(i, xs[i])
		var k := _rng.randf_range(0.85, 1.12)
		mm.set_instance_color(i, Color(tint.r * k, tint.g * k, tint.b * k))
	var mmi := MultiMeshInstance3D.new()
	mmi.multimesh = mm
	mmi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	add_child(mmi)


func _build_foliage() -> void:
	_clump.seed = 5
	_clump.frequency = 0.02
	for i in range(4):
		_cover(HD + "grass%d.png" % i, 2000, 0.8, 1.2, Color(1.08, 1.08, 1.0), 0.06)
		_cover(HD + "grass%d.png" % i, 1700, 1.0, 1.5, Color(1.12, 1.12, 1.0), 0.07, 0.6, ISLAND, 1.5)
	for i in range(5):
		_cover(HD + "flower%d.png" % i, 520, 0.8, 1.1, Color(1, 1, 1), 0.05, 1.5, ISLAND, 3.0)
	var deco := V.CC0 + "Deco/%02d.png"
	for n in [7, 10, 11]:
		_cover(deco % n, 70, 0.7, 1.0, Color(1, 1, 1), 0.04, 1.0)
	for n in [1, 2, 4, 5]:
		_cover(deco % n, 30, 0.7, 1.0, Color(1, 1, 1), 0.0, 1.0)


## Small stones and pebbles lining both edges of the road.
func _road_edges() -> void:
	var deco := V.CC0 + "Deco/%02d.png"
	for edge_z in [-2.5, 4.5]:
		var x := -96.0
		while x < 96.0:
			x += _rng.randf_range(0.8, 2.6)
			var z: float = edge_z + _rng.randf_range(-0.35, 0.35)
			if absf(x) > 79.0 or _rng.randf() < 0.25:
				continue
			var r := Sprite3D.new()
			r.texture = Sprites.tex(deco % [4, 5, 4, 5, 6, 14][_rng.randi() % 6])
			standee(r, 64, 22, _rng.randf_range(0.6, 0.9))
			r.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
			r.position = Vector3(x, 0, z)
			add_child(r)


# ------------------------------------------------------------------ trees, rocks, sheep, gold
func sprite_frames(path: String, frame: Vector2i, count: int, fps: float) -> SpriteFrames:
	var t := Sprites.tex(path)
	var sf := SpriteFrames.new()
	sf.remove_animation("default")
	sf.add_animation("a")
	sf.set_animation_speed("a", fps)
	if t == null:
		return sf
	for i in range(count):
		var at := AtlasTexture.new()
		at.atlas = t
		at.region = Rect2(i * frame.x, 0, frame.x, frame.y)
		sf.add_frame("a", at)
	return sf


## A pixel-art sprite standing upright in the world: faces the camera, casts and receives shadows.
## `feet` is how many texels above the bottom of the frame the sprite touches the ground.
static func standee(s: SpriteBase3D, frame_h: float, feet: float, scale_ := 1.0) -> void:
	s.billboard = BaseMaterial3D.BILLBOARD_DISABLED
	s.rotation.x = -TILT
	s.pixel_size = PIX * scale_
	s.texture_filter = BaseMaterial3D.TEXTURE_FILTER_NEAREST
	s.alpha_cut = SpriteBase3D.ALPHA_CUT_DISCARD
	s.shaded = true
	s.double_sided = true
	s.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_ON
	s.offset = Vector2(0, frame_h / 2.0 - feet)


func _tree(x: float, z: float, big: bool) -> void:
	var a := AnimatedSprite3D.new()
	var path := V.FREE + "Terrain/Resources/Wood/Trees/Tree%d.png" % ((1 if _rng.randf() < 0.5 else 2) if big else (3 if _rng.randf() < 0.5 else 4))
	var h := 256 if big else 192
	a.sprite_frames = sprite_frames(path, Vector2i(192, h), 8, 6)
	standee(a, h, 40 if big else 36, _rng.randf_range(0.9, 1.15))
	a.position = Vector3(x, ground_y(x, z), z)
	a.flip_h = _rng.randf() < 0.5
	a.play("a")
	a.frame = _rng.randi_range(0, 7)
	add_child(a)


func _build_trees() -> void:
	# forest in the meadow between the plateaus and along the back of each plateau
	var placed := 0
	var tries := 0
	while placed < 170 and tries < 3000:
		tries += 1
		var x := _rng.randf_range(ISLAND.position.x + 2, ISLAND.end.x - 2)
		var z := _rng.randf_range(ISLAND.position.y + 1, -13.0)
		if on_plateau(x, z) and z > -26:
			continue
		if not on_plateau(x, z) and z > -17 and _rng.randf() < 0.7:
			continue
		if absf(x) < 30 and z > -26 and z < -14 and _rng.randf() < 0.85:
			continue  # leave the meadow open for the sheep
		if _blocked(x, z):
			continue
		_tree(x, z, _rng.randf() < 0.6)
		placed += 1
	# a few along the front shore
	for i in range(34):
		var x := _rng.randf_range(ISLAND.position.x + 3, ISLAND.end.x - 3)
		var z := _rng.randf_range(13.5, 17.0)
		if not _blocked(x, z):
			_tree(x, z, false)


func _build_props() -> void:
	for i in range(28):
		var x := _rng.randf_range(ISLAND.position.x + 2, ISLAND.end.x - 2)
		var z := _rng.randf_range(ISLAND.position.y + 1, ISLAND.end.y - 1)
		if _blocked(x, z, 1.0):
			continue
		if _rng.randf() < 0.75:
			var b := AnimatedSprite3D.new()
			b.sprite_frames = sprite_frames(V.FREE + "Terrain/Decorations/Bushes/Bushe%d.png" % _rng.randi_range(1, 4), Vector2i(128, 128), 8, 8)
			standee(b, 128, 30, 0.8)
			b.position = Vector3(x, ground_y(x, z), z)
			b.play("a")
			add_child(b)
		else:
			var r := Sprite3D.new()
			r.texture = Sprites.tex(V.FREE + "Terrain/Decorations/Rocks/Rock%d.png" % _rng.randi_range(1, 4))
			standee(r, 64, 14)
			r.position = Vector3(x, ground_y(x, z), z)
			add_child(r)
	for i in range(8):
		var s := AnimatedSprite3D.new()
		s.sprite_frames = sprite_frames(V.FREE + "Terrain/Resources/Meat/Sheep/Sheep_Grass.png", Vector2i(128, 128), 12, 8)
		standee(s, 128, 36, 0.8)
		var x := _rng.randf_range(-26, 26)
		var z := _rng.randf_range(-24, -15)
		s.position = Vector3(x, 0, z)
		s.flip_h = _rng.randf() < 0.5
		s.play("a")
		add_child(s)
	# gold veins
	for n in M.NODES:
		var k := 5 if n[2] else 3
		for i in range(k):
			var off := Vector2(_rng.randf_range(-1.6, 1.6), _rng.randf_range(-0.8, 0.9)) if i > 0 else Vector2.ZERO
			var g := AnimatedSprite3D.new()
			g.sprite_frames = sprite_frames(V.FREE + "Terrain/Resources/Gold/Gold Stones/Gold Stone %d_Highlight.png" % _rng.randi_range(1, 6), Vector2i(128, 128), 6, 6)
			standee(g, 128, 40, 0.9 if i == 0 else 0.7)
			g.position = Vector3(n[0] + off.x, 0, n[1] + off.y)
			g.play("a")
			add_child(g)


# ------------------------------------------------------------------ fireflies and drifting motes
func _build_fireflies() -> void:
	var p := GPUParticles3D.new()
	p.amount = 520 if quality != "low" else 140
	p.lifetime = 9.0
	p.preprocess = 9.0
	p.visibility_aabb = AABB(Vector3(-110, -2, -45), Vector3(220, 14, 70))
	var pm := ParticleProcessMaterial.new()
	pm.emission_shape = ParticleProcessMaterial.EMISSION_SHAPE_BOX
	pm.emission_box_extents = Vector3(100, 1.6, 27)
	pm.gravity = Vector3(0, 0.04, 0)
	pm.direction = Vector3(0, 1, 0)
	pm.spread = 180.0
	pm.initial_velocity_min = 0.05
	pm.initial_velocity_max = 0.35
	pm.turbulence_enabled = true
	pm.turbulence_noise_strength = 0.6
	pm.turbulence_noise_scale = 4.0
	pm.scale_min = 0.6
	pm.scale_max = 1.3
	var ramp := Gradient.new()
	ramp.set_color(0, Color(1, 1, 1, 0))
	ramp.add_point(0.2, Color(1, 1, 1, 1))
	ramp.add_point(0.8, Color(1, 1, 1, 1))
	ramp.set_color(ramp.get_point_count() - 1, Color(1, 1, 1, 0))
	var gt := GradientTexture1D.new()
	gt.gradient = ramp
	pm.color_ramp = gt
	p.process_material = pm
	var q := QuadMesh.new()
	q.size = Vector2(0.22, 0.22)
	var m := StandardMaterial3D.new()
	m.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	m.blend_mode = BaseMaterial3D.BLEND_MODE_ADD
	m.billboard_mode = BaseMaterial3D.BILLBOARD_PARTICLES
	m.vertex_color_use_as_albedo = true
	m.albedo_texture = load(HD + "glow.png")
	m.albedo_color = Color(2.4, 2.0, 0.9)
	q.material = m
	p.draw_pass_1 = q
	p.position = Vector3(0, 1.8, -9)
	add_child(p)


# ------------------------------------------------------------------ fire light at each keep's gate
func _build_braziers() -> void:
	for sx in [-1.0, 1.0]:
		for dz in [-4.2, 3.6]:
			var p := Vector3(sx * 78.5, 0, -3.0 + dz)
			var f := AnimatedSprite3D.new()
			f.sprite_frames = Sprites.effect_frames("fire")
			standee(f, 128, 30, 1.1)
			f.shaded = false
			f.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
			f.modulate = Color(1.8, 1.5, 1.2)
			f.position = p
			f.play("play")
			add_child(f)
			var l := OmniLight3D.new()
			l.light_color = Color(1.0, 0.62, 0.3)
			l.light_energy = 2.2
			l.omni_range = 7.5
			l.position = p + Vector3(0, 1.4, 0.4)
			add_child(l)
