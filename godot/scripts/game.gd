extends Node3D
## Renders a Frontline match from server snapshots in HD-2D: units, buildings, outposts, projectiles and
## effects in the lit 3D world, with health bars, names and floating numbers drawn crisply on screen.
## Gameplay input and the HUD live in hud.gd. The HUD works in the 2D "px" space (32 px per sim unit,
## y = sim z), so `camera` is a small rig with a px `position` and a `zoom`, and any Node2D the HUD adds
## as a child of this node is drawn on the ground plane.

signal snapshot_applied(snap: Dictionary)
signal game_event(e: Dictionary)

const V = preload("res://scripts/visuals.gd")
const M = preload("res://scripts/fl_map.gd")
const UnitView = preload("res://scripts/unit_view.gd")
const BuildingView = preload("res://scripts/building_view.gd")
const World = preload("res://scripts/world3d.gd")
const FONT := preload("res://assets/fonts/PixelifySans.ttf")

const FOV := 30.0
const PITCH := 52.0
const Z_OFFSET := 3.0  # the rig's y (px) is 3 units behind the point the camera looks at


## What the HUD moves: `position` in px (x = sim x * 32, y = sim z * 32), `zoom` like a Camera2D.
class CamRig extends RefCounted:
	var position := Vector2(0, -224)
	var zoom := Vector2.ONE * 0.85
	var offset := Vector2.ZERO


var world: Node3D
var camera := CamRig.new()
var cam3d: Camera3D
var init: Dictionary = {}
var snap: Dictionary = {}
var my_unit := 0
var my_team := 0
var my_color := "blue"
var cam_locked := true
var units := {}  # id -> UnitView
var buildings := {}  # id -> BuildingView
var projs := {}  # id -> Node3D
var _outposts: Array = []
var _glow: Texture2D
var _shake := 0.0
var _bars: Node2D
var _ring_shader: Shader
var _cam_attr: CameraAttributesPractical
var _ground_layer: CanvasLayer  # Node2D children (HUD aim overlay, pings) are moved here and drawn on the ground


func _ready() -> void:
	world = World.new()
	add_child(world)
	_glow = load(World.HD + "glow.png")
	_ring_shader = load("res://shaders/ground_ring.gdshader")
	cam3d = Camera3D.new()
	cam3d.fov = FOV
	cam3d.near = 0.5
	cam3d.far = 400.0
	_cam_attr = CameraAttributesPractical.new()
	_cam_attr.dof_blur_far_enabled = true
	_cam_attr.dof_blur_near_enabled = true
	_cam_attr.dof_blur_amount = 0.09
	cam3d.attributes = _cam_attr
	add_child(cam3d)
	cam3d.make_current()
	_ground_layer = CanvasLayer.new()
	_ground_layer.layer = 0
	add_child(_ground_layer)
	child_entered_tree.connect(func(n: Node):
		if n is Node2D and not n.has_meta("screen"):
			n.reparent.call_deferred(_ground_layer, false))
	# screen layer: light shafts and vignette under the bars and names
	var screen := CanvasLayer.new()
	screen.layer = 0
	add_child(screen)
	var beams := ColorRect.new()
	beams.set_anchors_preset(Control.PRESET_FULL_RECT)
	beams.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var bm := ShaderMaterial.new()
	bm.shader = load("res://shaders/sunbeams.gdshader")
	beams.material = bm
	screen.add_child(beams)
	var vig := TextureRect.new()
	vig.set_anchors_preset(Control.PRESET_FULL_RECT)
	vig.mouse_filter = Control.MOUSE_FILTER_IGNORE
	vig.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	vig.stretch_mode = TextureRect.STRETCH_SCALE
	var vg := Gradient.new()
	vg.set_color(0, Color(0.1, 0.06, 0.03, 0.0))
	vg.add_point(0.62, Color(0.1, 0.06, 0.03, 0.0))
	vg.set_color(vg.get_point_count() - 1, Color(0.1, 0.05, 0.02, 0.36))
	var vt := GradientTexture2D.new()
	vt.gradient = vg
	vt.fill = GradientTexture2D.FILL_RADIAL
	vt.fill_from = Vector2(0.5, 0.5)
	vt.fill_to = Vector2(1.05, 0.5)
	vt.width = 256
	vt.height = 256
	vig.texture = vt
	screen.add_child(vig)
	_bars = Node2D.new()
	_bars.set_meta("screen", true)
	_bars.draw.connect(_draw_bars)
	screen.add_child(_bars)
	for b in M.BANNERS:
		var o := Node3D.new()
		o.position = Vector3(b[2], 0, b[3])
		var tower := Sprite3D.new()
		World.standee(tower, 256, 26, 0.9)
		o.add_child(tower)
		var ring := _ground_disc(M.BANNER_RADIUS, Color(1, 1, 1), 0.1, 0.75)
		o.add_child(ring)
		o.set_meta("sprite", tower)
		o.set_meta("ring", ring)
		o.set_meta("owner", -2)
		world.actors.add_child(o)
		_outposts.append(o)
	_apply_camera(1.0)
	Net.snapshot.connect(_on_snapshot)


func start(p_init: Dictionary) -> void:
	init = p_init
	for p in init.players:
		if p.playerId == init.you:
			my_unit = int(p.unitId)
			my_team = int(p.team)
	var home_x := -M.DROP_X if my_team == 0 else M.DROP_X
	camera.position = Vector2((home_x + (11.0 if my_team == 0 else -11.0)) * V.PX, -224)
	_apply_camera(1.0)


func _ground_disc(radius: float, col: Color, fill: float, edge: float) -> MeshInstance3D:
	var pm := PlaneMesh.new()
	pm.size = Vector2(radius * 2.0, radius * 2.0)
	var mat := ShaderMaterial.new()
	mat.shader = _ring_shader
	mat.set_shader_parameter("color", col)
	mat.set_shader_parameter("fill", fill)
	mat.set_shader_parameter("edge", edge)
	mat.set_shader_parameter("thickness", clampf(0.22 / radius, 0.02, 0.2))
	var mi := MeshInstance3D.new()
	mi.mesh = pm
	mi.material_override = mat
	mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	mi.position.y = 0.08
	return mi


# ------------------------------------------------------------------ snapshots
func _vis(key: String) -> Dictionary:
	return init.get("visuals", {}).get(key, {})


func _player_color_of_hero(unit_id: int) -> String:
	var fl: Dictionary = snap.get("fl", {})
	for p in fl.get("players", []):
		if int(p.hero) == unit_id:
			return p.color
	return "blue"


func _on_snapshot(s: Dictionary) -> void:
	snap = s
	if s.has("vis") and init.has("visuals"):
		init.visuals.merge(s.vis, true)
	var seen := {}
	for u in s.units:
		var uid := int(u[0])
		seen[uid] = true
		var vis: String = u[1]
		var info := _vis(vis)
		var kind: String = info.get("kind", "building" if vis.begins_with("b:") else ("hero" if vis.begins_with("h:") else ("tower" if vis.begins_with("tw:") else "minion")))
		if kind == "building" or kind == "tower":
			_apply_building(uid, vis, info, u)
			continue
		var view: Node3D = units.get(uid)
		if view == null:
			view = UnitView.new()
			var body := ""
			var color := ""
			if kind == "hero":
				body = V.HERO_BODY.get(info.get("role", "Fighter"), "swordsman")
				color = _player_color_of_hero(uid)
			else:
				var parsed := V.parse_vis(vis)
				body = parsed[0] if parsed[0] != "" else "swordsman"
				color = parsed[1] if parsed[1] != "" else ("blue" if int(u[2]) == 0 else "red")
			view.setup(uid, int(u[2]), kind, body, color, uid == my_unit, _hero_label(uid, info))
			world.actors.add_child(view)
			units[uid] = view
		view.apply(u)
	for uid in units.keys():
		if not seen.has(uid):
			units[uid].queue_free()
			units.erase(uid)
	var fl: Dictionary = s.get("fl", {})
	for p in fl.get("plots", []):
		var bview: Node3D = buildings.get(int(p[4]))
		if bview:
			bview.set_progress(float(p[3]))
	_apply_banners(fl.get("banners", []))
	_apply_projectiles(s.get("projs", []))
	for e in s.get("events", []):
		_on_event(e)
	snapshot_applied.emit(s)


func _hero_label(uid: int, info: Dictionary) -> String:
	for b in snap.get("board", []):
		if int(b.id) == uid:
			return "%s" % b.name
	return info.get("name", "")


func _apply_building(uid: int, vis: String, info: Dictionary, u: Array) -> void:
	var view: Node3D = buildings.get(uid)
	if view == null:
		view = BuildingView.new()
		var bid := "tower" if info.get("model", "fortress") == "tower" else "castle"
		var color := "blue" if int(u[2]) == 0 else "red"
		if vis.begins_with("b:"):
			var parts := vis.split(":")
			bid = parts[1]
			color = parts[2]
		view.setup(uid, int(u[2]), bid, color)
		world.actors.add_child(view)
		buildings[uid] = view
	view.apply(u)


func _apply_banners(banners: Array) -> void:
	for i in range(min(banners.size(), _outposts.size())):
		var o: Node3D = _outposts[i]
		var b: Array = banners[i]
		var owner := int(b[1])
		var ring: MeshInstance3D = o.get_meta("ring")
		var mat: ShaderMaterial = ring.material_override
		if owner != int(o.get_meta("owner")):
			o.set_meta("owner", owner)
			var c := "Blue" if owner == 0 else ("Red" if owner == 1 else "Black")
			var s: Sprite3D = o.get_meta("sprite")
			s.texture = Sprites.tex(V.FREE + "Buildings/%s Buildings/Tower.png" % c)
			var col: Color = V.TEAM_COLORS[owner] if owner >= 0 else Color(1, 1, 1)
			mat.set_shader_parameter("color", Color(col.r, col.g, col.b, 1.0))
		var prog := float(b[2])
		var cap := int(b[3])
		mat.set_shader_parameter("progress", prog if cap >= 0 else 0.0)
		if cap >= 0:
			mat.set_shader_parameter("progress_color", V.TEAM_COLORS[cap])


func _apply_projectiles(list: Array) -> void:
	var seen := {}
	for p in list:
		var pid := int(p[0])
		seen[pid] = true
		var x := float(p[1])
		var z := float(p[2])
		var pos := Vector3(x, World.ground_y(x, z) + 1.3, z)
		var node: Node3D = projs.get(pid)
		if node == null:
			node = _make_projectile(p[3], Color(p[4]), float(p[5]))
			node.position = pos
			world.actors.add_child(node)
			projs[pid] = node
		var d: Vector3 = pos - node.position
		if Vector2(d.x, d.z).length() > 0.05 and node.has_meta("flat"):
			node.rotation.y = atan2(-d.z, d.x)
		node.set_meta("target", pos)
	for pid in projs.keys():
		if not seen.has(pid):
			var n: Node3D = projs[pid]
			if n.get_meta("style", "") == "fireball":
				_spawn_effect("explosion", Vector3(n.position.x, World.ground_y(n.position.x, n.position.z), n.position.z), 0.8)
				_flash_light(n.position, Color(1.0, 0.6, 0.3), 5.0, 9.0)
			n.queue_free()
			projs.erase(pid)


func _make_projectile(style: String, color: Color, size: float) -> Node3D:
	var n := Node3D.new()
	n.set_meta("style", style)
	if style == "arrow" or style == "spear":
		var s := Sprite3D.new()
		s.texture = Sprites.tex(V.FREE + "Units/Blue Units/Archer/Arrow.png")
		s.axis = Vector3.Axis.AXIS_Y
		s.pixel_size = World.PIX
		s.texture_filter = BaseMaterial3D.TEXTURE_FILTER_NEAREST
		s.alpha_cut = SpriteBase3D.ALPHA_CUT_DISCARD
		s.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_ON
		n.add_child(s)
		n.set_meta("flat", true)
	elif style == "fireball":
		var a := AnimatedSprite3D.new()
		var sf := SpriteFrames.new()
		var t := Sprites.tex(V.CC0 + "Factions/Goblins/Troops/TNT/Dynamite/Dynamite.png")
		if t:
			for i in range(6):
				var at := AtlasTexture.new()
				at.atlas = t
				at.region = Rect2(i * 64, 0, 64, 64)
				sf.add_frame("default", at)
		sf.set_animation_speed("default", 18)
		a.sprite_frames = sf
		World.standee(a, 64, 32, 1.0)
		a.play("default")
		n.add_child(a)
	else:
		var r := 0.9 * maxf(0.6, size)
		var g := _glow_sprite(r, color * Color(2.2, 2.2, 2.2, 1.0))
		var core := _glow_sprite(r * 0.4, Color(2.5, 2.5, 2.5, 1.0))
		n.add_child(g)
		n.add_child(core)
		var l := OmniLight3D.new()
		l.light_color = color
		l.light_energy = 1.6
		l.omni_range = 4.5
		n.add_child(l)
	return n


func _glow_sprite(size_units: float, col: Color) -> Sprite3D:
	var s := Sprite3D.new()
	s.texture = _glow
	s.pixel_size = size_units / 32.0
	s.billboard = BaseMaterial3D.BILLBOARD_ENABLED
	var m := StandardMaterial3D.new()
	m.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	m.blend_mode = BaseMaterial3D.BLEND_MODE_ADD
	m.billboard_mode = BaseMaterial3D.BILLBOARD_ENABLED
	m.albedo_texture = _glow
	m.albedo_color = col
	s.material_override = m
	s.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	return s


# ------------------------------------------------------------------ events
func _unit_pos(id: int) -> Vector3:
	var u: Node3D = units.get(id)
	if u == null:
		u = buildings.get(id)
	return u.position if u else Vector3.INF


func _on_event(e: Dictionary) -> void:
	match e.get("e", ""):
		"atk":
			var u: Node3D = units.get(int(e.id))
			if u:
				var tp := _unit_pos(int(e.get("tid", 0)))
				u.play_attack((tp.x - u.position.x) if tp != Vector3.INF else 0.0)
		"cast":
			var u: Node3D = units.get(int(e.id))
			if u:
				u.play_attack(0.0)
		"dmg":
			var u: Node3D = units.get(int(e.id))
			if u:
				u.hit()
				var mine := int(e.id) == my_unit or int(e.get("s", 0)) == my_unit
				if mine or randf() < 0.35:
					_float_text(u.position + Vector3(randf_range(-0.4, 0.4), u.head_height() + 0.3, 0), str(int(e.a)), Color("ffb38a") if int(e.k) == 0 else (Color("c4a5ff") if int(e.k) == 1 else Color.WHITE), e.has("c"))
		"heal":
			var u: Node3D = units.get(int(e.id))
			if u and int(e.a) >= 10:
				_float_text(u.position + Vector3(0, u.head_height() + 0.3, 0), "+%d" % int(e.a), Color("7cff8a"), false)
		"gold":
			var u: Node3D = units.get(int(e.id))
			if u:
				_float_text(u.position + Vector3(0, u.head_height(), 0), "+%d" % int(e.a), Color("ffd34d"), false)
		"death":
			var u: Node3D = units.get(int(e.id))
			if u:
				_spawn_effect("dead", u.position, 0.8)
			var b: Node3D = buildings.get(int(e.id))
			if b:
				_spawn_effect("explosion_big", b.position, 1.8)
				_spawn_effect("fire", b.position + Vector3(1.0, 0, 0.5), 1.2)
				_flash_light(b.position + Vector3(0, 2, 0), Color(1.0, 0.55, 0.25), 8.0, 16.0)
				_shake = 0.5
		"vfx":
			_vfx(e)
		"chain":
			_chain(e.pts, Color(e.color))
		"blink":
			var u: Node3D = units.get(int(e.id))
			var x := float(e.x)
			var z := float(e.z)
			var p := Vector3(x, World.ground_y(x, z), z)
			_spawn_effect("dust", p, 1.5)
			if u:
				u.position = p
				u.target = p
		"level":
			var u: Node3D = units.get(int(e.id))
			if u:
				_spawn_effect("heal", u.position, 1.0)
				_flash_light(u.position + Vector3(0, 1.5, 0), Color(1.0, 0.9, 0.5), 3.0, 6.0)
				if int(e.id) == my_unit:
					_float_text(u.position + Vector3(0, u.head_height() + 1.0, 0), "LEVEL %d!" % int(e.lvl), Color("ffd166"), true)
	game_event.emit(e)


func _vfx(e: Dictionary) -> void:
	var x := float(e.x)
	var z := float(e.z)
	var p := Vector3(x, World.ground_y(x, z), z)
	var style: String = e.get("style", "nova")
	var r := float(e.get("r", 2.0))
	var col := Color(e.get("color", "#ffffff"))
	var delay := float(e.get("delay", 0.0))
	_telegraph(p, r, col, delay, e.get("shape", "circle"), Vector2(e.get("dx", 1.0), e.get("dz", 0.0)), float(e.get("angle", 60)), float(e.get("w", 2)))
	if delay > 0.0:
		return
	if style in ["fire", "meteor", "earth"] and r >= 1.8:
		_spawn_effect("explosion", p, clampf(r / 3.4, 0.6, 1.8))
		_flash_light(p + Vector3(0, 1.2, 0), Color(1.0, 0.55, 0.25), 6.0, r * 3.0 + 4.0)
		_shake = maxf(_shake, 0.25)
	elif style in ["holy", "nova"]:
		_spawn_effect("heal", p, clampf(r / 3.8, 0.6, 1.6), col)
		_flash_light(p + Vector3(0, 1.2, 0), col, 3.5, r * 2.5 + 3.0)
	elif style in ["smoke", "shadow", "wind", "poison"]:
		_spawn_effect("dust", p, clampf(r / 1.25, 1.0, 3.0), col)
	elif style in ["frost", "lightning", "arcane"]:
		_flash_light(p + Vector3(0, 1.2, 0), col, 4.0, r * 2.5 + 3.0)


## Ground indicator: flashes for instant effects, fills up for delayed (telegraphed) ones.
func _telegraph(p: Vector3, r: float, col: Color, delay: float, shape: String, dir: Vector2, angle: float, w: float) -> void:
	var mi: MeshInstance3D
	if shape == "line":
		mi = _ground_disc(1.0, col, 0.4, 0.4)
		var pm := PlaneMesh.new()
		pm.size = Vector2(r, maxf(0.4, w))
		pm.center_offset = Vector3(r / 2.0, 0, 0)
		mi.mesh = pm
		(mi.material_override as ShaderMaterial).set_shader_parameter("cone", 360.0)
		var lm := StandardMaterial3D.new()
		lm.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
		lm.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
		lm.albedo_color = Color(col.r, col.g, col.b, 0.35)
		mi.material_override = lm
	else:
		mi = _ground_disc(r, col, 0.16, 0.85)
		if shape == "cone":
			(mi.material_override as ShaderMaterial).set_shader_parameter("cone", angle)
	mi.position = p + Vector3(0, 0.1, 0)
	mi.rotation.y = atan2(-dir.y, dir.x)
	world.actors.add_child(mi)
	var life := delay if delay > 0.0 else 0.45
	var tw := create_tween()
	if delay > 0.0 and mi.material_override is ShaderMaterial:
		tw.tween_method(func(v: float): (mi.material_override as ShaderMaterial).set_shader_parameter("grow", v), 0.01, 1.0, life)
	else:
		tw.tween_property(mi, "scale", Vector3.ONE * 1.08, life)
		tw.parallel().tween_method(func(v: float):
			if mi.material_override is ShaderMaterial:
				(mi.material_override as ShaderMaterial).set_shader_parameter("color", Color(col.r, col.g, col.b, v))
			, 1.0, 0.0, life)
	tw.tween_callback(mi.queue_free)


func _chain(pts: Array, col: Color) -> void:
	var line := Line2D.new()
	line.width = 4
	line.default_color = col * Color(1.6, 1.6, 1.6)
	line.set_meta("screen", true)
	for i in range(0, pts.size() - 1, 2):
		var a := _screen(Vector3(pts[i], 1.4, pts[i + 1]))
		line.add_point(a)
		if i + 3 < pts.size():
			var b := _screen(Vector3(pts[i + 2], 1.4, pts[i + 3]))
			for k in range(1, 4):
				line.add_point(a.lerp(b, k / 4.0) + Vector2(randf_range(-10, 10), randf_range(-10, 10)))
	add_child(line)
	for i in range(0, pts.size() - 1, 2):
		_flash_light(Vector3(pts[i], 1.4, pts[i + 1]), col, 3.0, 5.0)
	var tw := create_tween()
	tw.tween_property(line, "modulate:a", 0.0, 0.35)
	tw.tween_callback(line.queue_free)


func _spawn_effect(id: String, p: Vector3, s := 1.0, tint := Color.WHITE) -> void:
	var a := AnimatedSprite3D.new()
	a.sprite_frames = Sprites.effect_frames(id)
	var h := 128.0
	if a.sprite_frames.get_frame_count("play") > 0:
		h = a.sprite_frames.get_frame_texture("play", 0).get_height()
	World.standee(a, h, h * 0.22, s)
	a.shaded = false
	a.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	a.modulate = (tint if tint != Color.WHITE else Color.WHITE) * Color(1.5, 1.4, 1.3, 1.0)
	a.position = p + Vector3(0, 0, 0.3)
	world.actors.add_child(a)
	a.play("play")
	a.animation_finished.connect(a.queue_free)
	var ref: WeakRef = weakref(a)
	get_tree().create_timer(3.0).timeout.connect(func():
		var n: Node = ref.get_ref()
		if n:
			n.queue_free())


## A short burst of real light, so explosions and spells light up the ground and units around them.
func _flash_light(p: Vector3, col: Color, energy: float, rng: float) -> void:
	var l := OmniLight3D.new()
	l.light_color = col
	l.light_energy = energy
	l.omni_range = rng
	l.position = p
	world.actors.add_child(l)
	var tw := create_tween()
	tw.tween_property(l, "light_energy", 0.0, 0.45).set_ease(Tween.EASE_OUT)
	tw.tween_callback(l.queue_free)


func _float_text(p: Vector3, text: String, col: Color, big: bool) -> void:
	var l := Label3D.new()
	l.text = text
	l.font = FONT
	l.font_size = 64 if big else 44
	l.pixel_size = 0.012
	l.outline_size = 14
	l.modulate = col
	l.outline_modulate = Color(0.05, 0.03, 0.02, 0.9)
	l.billboard = BaseMaterial3D.BILLBOARD_ENABLED
	l.no_depth_test = true
	l.shaded = false
	l.render_priority = 10
	l.outline_render_priority = 9
	l.position = p
	world.actors.add_child(l)
	var tw := create_tween().set_parallel(true)
	tw.tween_property(l, "position:y", p.y + 1.6, 0.8).set_ease(Tween.EASE_OUT).set_trans(Tween.TRANS_QUAD)
	tw.tween_property(l, "modulate:a", 0.0, 0.5).set_delay(0.35)
	tw.tween_property(l, "outline_modulate:a", 0.0, 0.5).set_delay(0.35)
	tw.chain().tween_callback(l.queue_free)


# ------------------------------------------------------------------ screen overlay: bars and names
func _screen(p: Vector3) -> Vector2:
	return cam3d.unproject_position(p)


func _bar(c: Vector2, w: float, frac: float, col: Color, shield_frac := 0.0) -> void:
	_bars.draw_rect(Rect2(c.x - w / 2 - 1, c.y - 1, w + 2, 7), Color(0.05, 0.03, 0.02, 0.8))
	_bars.draw_rect(Rect2(c.x - w / 2, c.y, w * frac, 5), col)
	_bars.draw_rect(Rect2(c.x - w / 2, c.y, w * frac, 2), Color(1, 1, 1, 0.25))
	if shield_frac > 0.0:
		_bars.draw_rect(Rect2(c.x - w / 2 + w * frac, c.y, w * shield_frac, 5), Color(0.95, 0.95, 1.0))


func _draw_bars() -> void:
	var zoom_k := clampf(camera.zoom.x / 0.85, 0.7, 1.4)
	for u in units.values():
		if u.dead or not u.visible:
			continue
		var hero: bool = u.kind == "hero"
		if not hero and u.hp >= u.max_hp and u.shield <= 0.0:
			continue
		var wp: Vector3 = u.position + Vector3(0, u.head_height(), 0)
		if cam3d.is_position_behind(wp):
			continue
		var c := _screen(wp)
		var total := maxf(u.max_hp, u.hp + u.shield)
		var w := (58.0 if hero else (56.0 if u.body_id == "giant" else 26.0)) * zoom_k
		var col: Color = Color("4ade80") if u.is_me else (V.TEAM_COLORS[u.team] if u.team < 2 else Color("facc15"))
		_bar(c, w, u.hp / total, col, u.shield / total)
		if hero:
			_bars.draw_string(FONT, c + Vector2(-w / 2 - 16, 7), str(u.level), HORIZONTAL_ALIGNMENT_LEFT, -1, 14, Color("ffd166"))
			var name_col: Color = V.PLAYER_COLORS.get(u.color, Color.WHITE).lightened(0.4)
			var tw := FONT.get_string_size(u.hero_name, HORIZONTAL_ALIGNMENT_LEFT, -1, 14).x
			_bars.draw_string_outline(FONT, c + Vector2(-tw / 2, -6), u.hero_name, HORIZONTAL_ALIGNMENT_LEFT, -1, 14, 5, Color(0.05, 0.03, 0.02, 0.9))
			_bars.draw_string(FONT, c + Vector2(-tw / 2, -6), u.hero_name, HORIZONTAL_ALIGNMENT_LEFT, -1, 14, name_col)
	for b in buildings.values():
		if b.dead:
			continue
		var building_done: bool = b.progress >= 1.0
		if building_done and b.hp >= b.max_hp:
			continue
		var wp: Vector3 = b.position + Vector3(0, b.head_height(), 0)
		if cam3d.is_position_behind(wp):
			continue
		var c := _screen(wp)
		var w := (110.0 if b.bid == "castle" else 60.0) * zoom_k
		if not building_done:
			_bar(c, w, b.progress, Color("ffd166"))
		else:
			_bar(c, w, b.hp / b.max_hp, V.TEAM_COLORS[b.team] if b.team < 2 else Color.WHITE)


# ------------------------------------------------------------------ camera
func _apply_camera(delta: float) -> void:
	var vh := get_viewport().get_visible_rect().size.y if is_inside_tree() else 720.0
	var half_h := vh * 0.5 / camera.zoom.x / V.PX
	var dist := half_h / tan(deg_to_rad(FOV * 0.5))
	var target := Vector3(camera.position.x / V.PX, 0.0, camera.position.y / V.PX + Z_OFFSET)
	var r := deg_to_rad(PITCH)
	cam3d.position = target + Vector3(0, sin(r) * dist, cos(r) * dist)
	cam3d.rotation = Vector3(-r, 0, 0)
	cam3d.h_offset = camera.offset.x / V.PX
	cam3d.v_offset = camera.offset.y / V.PX
	# tilt-shift: the band around the focus stays sharp, far hills and the near edge soften
	_cam_attr.dof_blur_far_distance = dist + 7.0
	_cam_attr.dof_blur_far_transition = dist * 0.45
	_cam_attr.dof_blur_near_distance = dist - 9.0
	_cam_attr.dof_blur_near_transition = 6.0


## The affine map from the HUD's px ground space to the screen, around where the camera looks.
func ground_transform() -> Transform2D:
	var cx := camera.position.x / V.PX
	var cz := camera.position.y / V.PX + Z_OFFSET
	var s0 := _screen(Vector3(cx, 0, cz))
	var ex := (_screen(Vector3(cx + 1, 0, cz)) - s0) / V.PX
	var ez := (_screen(Vector3(cx, 0, cz + 1)) - s0) / V.PX
	return Transform2D(ex, ez, s0 - ex * cx * V.PX - ez * cz * V.PX)


func _process(delta: float) -> void:
	for pid in projs:
		var n: Node3D = projs[pid]
		n.position = n.position.lerp(n.get_meta("target", n.position), 1.0 - exp(-delta * 20.0))
	var me: Node3D = units.get(my_unit)
	if cam_locked and me and not me.dead:
		camera.position.x = lerpf(camera.position.x, me.position.x * V.PX, 1.0 - exp(-delta * 5.0))
	camera.position.x = clampf(camera.position.x, (M.MIN_X - 6.0) * V.PX, (M.MAX_X + 6.0) * V.PX)
	if _shake > 0.0:
		_shake -= delta
		camera.offset = Vector2(randf_range(-6, 6), randf_range(-6, 6)) * _shake * 2.0
	else:
		camera.offset = Vector2.ZERO
	_apply_camera(delta)
	_ground_layer.transform = ground_transform()
	_bars.queue_redraw()


## World point (sim units) under a screen position, on the lane's ground plane.
func screen_to_world(screen: Vector2) -> Vector2:
	var o := cam3d.project_ray_origin(screen)
	var d := cam3d.project_ray_normal(screen)
	if absf(d.y) < 0.0001:
		return Vector2(o.x, o.z)
	var t := -o.y / d.y
	var p := o + d * t
	return Vector2(p.x, p.z)
