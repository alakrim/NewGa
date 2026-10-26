extends Node2D
## Renders a Frontline match from server snapshots: units, buildings, outposts, projectiles and effects.
## Gameplay input and the HUD live in hud.gd; this node exposes helpers they use.

signal snapshot_applied(snap: Dictionary)
signal game_event(e: Dictionary)

const V = preload("res://scripts/visuals.gd")
const M = preload("res://scripts/fl_map.gd")
const UnitView = preload("res://scripts/unit_view.gd")
const BuildingView = preload("res://scripts/building_view.gd")
const World = preload("res://scripts/world.gd")

var world: Node2D
var camera: Camera2D
var init: Dictionary = {}
var snap: Dictionary = {}
var my_unit := 0
var my_team := 0
var my_color := "blue"
var cam_locked := true
var units := {}  # id -> UnitView
var buildings := {}  # id -> BuildingView
var projs := {}  # id -> Node2D
var _outposts: Array = []
var _glow: Texture2D
var _shake := 0.0


func _ready() -> void:
	world = World.new()
	add_child(world)
	camera = Camera2D.new()
	camera.zoom = Vector2.ONE * 0.56
	camera.position = Vector2(0, -7 * V.PX)
	add_child(camera)
	camera.make_current()
	_glow = _make_glow()
	for b in M.BANNERS:
		var o := Node2D.new()
		o.position = V.to_px(b[2], b[3])
		var s := Sprite2D.new()
		s.centered = false
		o.add_child(s)
		o.set_meta("sprite", s)
		o.set_meta("owner", -2)
		o.set_meta("progress", 0.0)
		o.set_meta("cap", -1)
		o.draw.connect(_draw_outpost.bind(o))
		world.ysort.add_child(o)
		_outposts.append(o)
	Net.snapshot.connect(_on_snapshot)


func start(p_init: Dictionary) -> void:
	init = p_init
	for p in init.players:
		if p.playerId == init.you:
			my_unit = int(p.unitId)
			my_team = int(p.team)
	var home := V.to_px(-M.DROP_X if my_team == 0 else M.DROP_X, 0)
	camera.position = Vector2(home.x + (360 if my_team == 0 else -360), -7 * V.PX)


func _make_glow() -> Texture2D:
	var g := Gradient.new()
	g.set_color(0, Color(1, 1, 1, 1))
	g.set_color(1, Color(1, 1, 1, 0))
	var t := GradientTexture2D.new()
	t.gradient = g
	t.fill = GradientTexture2D.FILL_RADIAL
	t.fill_from = Vector2(0.5, 0.5)
	t.fill_to = Vector2(1, 0.5)
	t.width = 64
	t.height = 64
	return t


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
		var view: Node2D = units.get(uid)
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
			world.ysort.add_child(view)
			units[uid] = view
		view.apply(u)
	for uid in units.keys():
		if not seen.has(uid):
			units[uid].queue_free()
			units.erase(uid)
	var fl: Dictionary = s.get("fl", {})
	for p in fl.get("plots", []):
		var bview: Node2D = buildings.get(int(p[4]))
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
	var view: Node2D = buildings.get(uid)
	if view == null:
		view = BuildingView.new()
		var bid := "castle"
		var color := "blue" if int(u[2]) == 0 else "red"
		if vis.begins_with("b:"):
			var parts := vis.split(":")
			bid = parts[1]
			color = parts[2]
		view.setup(uid, int(u[2]), bid, color)
		world.ysort.add_child(view)
		buildings[uid] = view
	view.apply(u)


func _apply_banners(banners: Array) -> void:
	for i in range(min(banners.size(), _outposts.size())):
		var o: Node2D = _outposts[i]
		var b: Array = banners[i]
		var owner := int(b[1])
		if owner != int(o.get_meta("owner")):
			o.set_meta("owner", owner)
			var c := "Blue" if owner == 0 else ("Red" if owner == 1 else "Black")
			var s: Sprite2D = o.get_meta("sprite")
			s.texture = Sprites.tex(V.FREE + "Buildings/%s Buildings/Tower.png" % c)
			if s.texture:
				s.position = Vector2(-s.texture.get_width() / 2.0, -s.texture.get_height() + 22)
		o.set_meta("progress", float(b[2]))
		o.set_meta("cap", int(b[3]))
		o.queue_redraw()


func _draw_outpost(o: Node2D) -> void:
	var owner := int(o.get_meta("owner"))
	var r := M.BANNER_RADIUS * V.PX
	var col: Color = V.TEAM_COLORS[owner] if owner >= 0 else Color(1, 1, 1)
	o.draw_set_transform(Vector2.ZERO, 0, Vector2(1, 0.5))
	o.draw_circle(Vector2.ZERO, r, Color(col.r, col.g, col.b, 0.12))
	o.draw_arc(Vector2.ZERO, r, 0, TAU, 64, Color(col.r, col.g, col.b, 0.8), 3.0)
	var prog := float(o.get_meta("progress"))
	var cap := int(o.get_meta("cap"))
	if prog > 0.0 and cap >= 0:
		o.draw_arc(Vector2.ZERO, r - 8, -PI / 2, -PI / 2 + TAU * prog, 64, V.TEAM_COLORS[cap], 8.0)
	o.draw_set_transform(Vector2.ZERO, 0, Vector2.ONE)


func _apply_projectiles(list: Array) -> void:
	var seen := {}
	for p in list:
		var pid := int(p[0])
		seen[pid] = true
		var pos := V.to_px(p[1], p[2]) + Vector2(0, -40)
		var node: Node2D = projs.get(pid)
		if node == null:
			node = _make_projectile(p[3], Color(p[4]), float(p[5]))
			node.position = pos
			node.z_index = 20
			add_child(node)
			projs[pid] = node
		var d: Vector2 = pos - node.position
		if d.length() > 0.5:
			node.rotation = d.angle()
		node.set_meta("target", pos)
	for pid in projs.keys():
		if not seen.has(pid):
			var n: Node2D = projs[pid]
			if n.get_meta("style", "") == "fireball":
				_spawn_effect("explosion", n.position + Vector2(0, 30), 0.7)
			n.queue_free()
			projs.erase(pid)


func _make_projectile(style: String, color: Color, size: float) -> Node2D:
	var n := Node2D.new()
	n.set_meta("style", style)
	if style == "arrow" or style == "spear":
		var s := Sprite2D.new()
		s.texture = Sprites.tex(V.FREE + "Units/Blue Units/Archer/Arrow.png")
		s.rotation = 0.0
		n.add_child(s)
	elif style == "fireball":
		var a := AnimatedSprite2D.new()
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
		a.play("default")
		n.add_child(a)
	else:
		var g := Sprite2D.new()
		g.texture = _glow
		g.modulate = color * Color(1.6, 1.6, 1.6, 1)
		g.scale = Vector2.ONE * (0.55 * maxf(0.6, size))
		var core := Sprite2D.new()
		core.texture = _glow
		core.modulate = Color(1, 1, 1, 0.9)
		core.scale = Vector2.ONE * 0.22 * maxf(0.6, size)
		n.add_child(g)
		n.add_child(core)
	return n


# ------------------------------------------------------------------ events
func _on_event(e: Dictionary) -> void:
	match e.get("e", ""):
		"atk":
			var u: Node2D = units.get(int(e.id))
			if u:
				var t: Node2D = units.get(int(e.get("tid", 0)))
				if t == null:
					t = buildings.get(int(e.get("tid", 0)))
				u.play_attack((t.position.x - u.position.x) if t else 0.0)
		"cast":
			var u: Node2D = units.get(int(e.id))
			if u:
				u.play_attack(0.0)
		"dmg":
			var u: Node2D = units.get(int(e.id))
			if u:
				u.hit()
				var mine := int(e.id) == my_unit or int(e.get("s", 0)) == my_unit
				if mine or randf() < 0.35:
					_float_text(u.position + Vector2(randf_range(-14, 14), -90), str(int(e.a)), Color("ffb38a") if int(e.k) == 0 else (Color("c4a5ff") if int(e.k) == 1 else Color.WHITE), e.has("c"))
		"heal":
			var u: Node2D = units.get(int(e.id))
			if u and int(e.a) >= 10:
				_float_text(u.position + Vector2(0, -90), "+%d" % int(e.a), Color("7cff8a"), false)
		"gold":
			var u: Node2D = units.get(int(e.id))
			if u:
				_float_text(u.position + Vector2(0, -80), "+%d" % int(e.a), Color("ffd34d"), false)
		"death":
			var u: Node2D = units.get(int(e.id))
			if u:
				_spawn_effect("dead", u.position + Vector2(0, -20), 0.8)
			var b: Node2D = buildings.get(int(e.id))
			if b:
				_spawn_effect("explosion_big", b.position + Vector2(0, -60), 1.4)
				_shake = 0.5
		"vfx":
			_vfx(e)
		"chain":
			_chain(e.pts, Color(e.color))
		"blink":
			var u: Node2D = units.get(int(e.id))
			var p := V.to_px(e.x, e.z)
			_spawn_effect("dust", p, 1.5)
			if u:
				u.position = p
				u.target = p
		"level":
			var u: Node2D = units.get(int(e.id))
			if u:
				_spawn_effect("heal", u.position + Vector2(0, -30), 1.0)
				if int(e.id) == my_unit:
					_float_text(u.position + Vector2(0, -120), "LEVEL %d!" % int(e.lvl), Color("ffd166"), true)
	game_event.emit(e)


func _vfx(e: Dictionary) -> void:
	var p := V.to_px(e.x, e.z)
	var style: String = e.get("style", "nova")
	var r := float(e.get("r", 2.0)) * V.PX
	var col := Color(e.get("color", "#ffffff"))
	var delay := float(e.get("delay", 0.0))
	_ring(p, r, col, delay, e.get("shape", "circle"), Vector2(e.get("dx", 1.0), e.get("dz", 0.0)), float(e.get("angle", 60)), float(e.get("w", 2)) * V.PX)
	if delay > 0.0:
		return
	if style in ["fire", "meteor", "earth"] and r >= 60:
		_spawn_effect("explosion", p, clampf(r / 110.0, 0.6, 1.8))
		_shake = maxf(_shake, 0.25)
	elif style in ["holy", "nova"]:
		_spawn_effect("heal", p + Vector2(0, -20), clampf(r / 120.0, 0.6, 1.6), col)
	elif style in ["smoke", "shadow", "wind", "poison"]:
		_spawn_effect("dust", p, clampf(r / 40.0, 1.0, 3.0), col)


## Ground indicator: flashes for instant effects, fills up for delayed (telegraphed) ones.
func _ring(p: Vector2, r: float, col: Color, delay: float, shape: String, dir: Vector2, angle: float, w: float) -> void:
	var n := Node2D.new()
	n.position = p
	n.z_index = -5
	var life := delay if delay > 0.0 else 0.45
	var state := {"t": 0.0}
	n.draw.connect(func():
		var f: float = state.t / life
		var a := (0.35 + 0.25 * sin(state.t * 14.0)) if delay > 0.0 else 0.55 * (1.0 - f)
		n.draw_set_transform(Vector2.ZERO, 0, Vector2(1, 0.55))
		if shape == "circle":
			n.draw_circle(Vector2.ZERO, r * (1.0 if delay > 0.0 else 0.85 + 0.15 * f), Color(col.r, col.g, col.b, a * 0.35))
			n.draw_arc(Vector2.ZERO, r, 0, TAU, 48, Color(col.r, col.g, col.b, a), 3.0)
			if delay > 0.0:
				n.draw_circle(Vector2.ZERO, r * f, Color(col.r, col.g, col.b, 0.25))
		elif shape == "cone":
			var ang := atan2(dir.y, dir.x)
			var half := deg_to_rad(angle) / 2.0
			var pts := PackedVector2Array([Vector2.ZERO])
			for i in range(13):
				pts.append(Vector2.from_angle(ang - half + 2.0 * half * i / 12.0) * r)
			n.draw_colored_polygon(pts, Color(col.r, col.g, col.b, a * 0.5))
		else:
			var ang2 := atan2(dir.y, dir.x)
			n.draw_set_transform(Vector2.ZERO, ang2, Vector2(1, 1))
			n.draw_rect(Rect2(0, -w / 2, r, w), Color(col.r, col.g, col.b, a * 0.5))
	)
	add_child(n)
	var tw := create_tween()
	tw.tween_method(func(v: float): state.t = v; n.queue_redraw(), 0.0, life, life)
	tw.tween_callback(n.queue_free)


func _chain(pts: Array, col: Color) -> void:
	var line := Line2D.new()
	line.width = 4
	line.default_color = col * Color(1.5, 1.5, 1.5)
	line.z_index = 25
	for i in range(0, pts.size() - 1, 2):
		var a := V.to_px(pts[i], pts[i + 1]) + Vector2(0, -50)
		line.add_point(a)
		if i + 3 < pts.size():
			var b := V.to_px(pts[i + 2], pts[i + 3]) + Vector2(0, -50)
			for k in range(1, 4):
				line.add_point(a.lerp(b, k / 4.0) + Vector2(randf_range(-12, 12), randf_range(-12, 12)))
	add_child(line)
	var tw := create_tween()
	tw.tween_property(line, "modulate:a", 0.0, 0.35)
	tw.tween_callback(line.queue_free)


func _spawn_effect(id: String, p: Vector2, s := 1.0, tint := Color.WHITE) -> void:
	var a := AnimatedSprite2D.new()
	a.sprite_frames = Sprites.effect_frames(id)
	a.position = p
	a.scale = Vector2.ONE * s
	a.modulate = tint if tint != Color.WHITE else Color.WHITE
	a.z_index = 15
	add_child(a)
	a.play("play")
	a.animation_finished.connect(a.queue_free)


func _float_text(p: Vector2, text: String, col: Color, big: bool) -> void:
	var l := Label.new()
	l.text = text
	l.add_theme_font_size_override("font_size", 26 if big else 18)
	l.add_theme_color_override("font_color", col)
	l.add_theme_color_override("font_outline_color", Color(0, 0, 0, 0.85))
	l.add_theme_constant_override("outline_size", 6)
	l.position = p - Vector2(30, 0)
	l.z_index = 30
	add_child(l)
	var tw := create_tween().set_parallel(true)
	tw.tween_property(l, "position:y", p.y - 50, 0.8).set_ease(Tween.EASE_OUT).set_trans(Tween.TRANS_QUAD)
	tw.tween_property(l, "modulate:a", 0.0, 0.8).set_delay(0.3)
	tw.chain().tween_callback(l.queue_free)


# ------------------------------------------------------------------ camera
func _process(delta: float) -> void:
	for pid in projs:
		var n: Node2D = projs[pid]
		n.position = n.position.lerp(n.get_meta("target", n.position), 1.0 - exp(-delta * 20.0))
	var me: Node2D = units.get(my_unit)
	if cam_locked and me and not me.dead:
		camera.position.x = lerpf(camera.position.x, me.position.x, 1.0 - exp(-delta * 5.0))
	camera.position.x = clampf(camera.position.x, M.MIN_X * V.PX - 200, M.MAX_X * V.PX + 200)
	if _shake > 0.0:
		_shake -= delta
		camera.offset = Vector2(randf_range(-6, 6), randf_range(-6, 6)) * _shake * 2.0
	else:
		camera.offset = Vector2.ZERO


## World point (sim units) under a screen position.
func screen_to_world(screen: Vector2) -> Vector2:
	var p := get_viewport().get_canvas_transform().affine_inverse() * screen
	return p / V.PX
