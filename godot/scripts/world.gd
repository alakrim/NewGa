extends Node2D
## The Frontline battlefield: an island in animated water, a sand road for the lane,
## a raised plateau behind each keep for building plots, trees, sheep, rocks and clouds.
## Units and buildings are added to `ysort` by the game so they overlap correctly.

const V = preload("res://scripts/visuals.gd")
const M = preload("res://scripts/fl_map.gd")

const T := 64  # tile size in px (= 2 world units)
const TX0 := -50  # island tile bounds
const TX1 := 49
const TZ0 := -18
const TZ1 := 9
const PLATEAU := [[-50, -20], [19, 49]]  # tile x ranges of the two base plateaus
const PZ_TOP := -18
const PZ_EDGE := -8  # last grass row on the plateau
const ROAD_Z := [-1, 1]  # sand road tile rows

var ysort: Node2D
var ground: Node2D
var _rng := RandomNumberGenerator.new()
var _clouds: Array[Sprite2D] = []
var _grass: Texture2D
var _sand: Texture2D
var _shadow: Texture2D


func _ready() -> void:
	_rng.seed = 7
	_grass = Sprites.tex(V.FREE + "Terrain/Tileset/Tilemap_color1.png")
	_sand = Sprites.tex(V.CC0 + "Terrain/Ground/Tilemap_Flat.png")
	_shadow = Sprites.tex(V.FREE + "Terrain/Tileset/Shadow.png")
	_build_foam()
	ground = Node2D.new()
	ground.z_index = -10
	ground.draw.connect(_draw_ground.bind(ground))
	add_child(ground)
	ysort = Node2D.new()
	ysort.y_sort_enabled = true
	add_child(ysort)
	_decorate()
	_build_clouds()


# ------------------------------------------------------------------ terrain
func _tile(ci: CanvasItem, tex: Texture2D, tx: int, tz: int, col: int, row: int, mod := Color.WHITE) -> void:
	if tex:
		ci.draw_texture_rect_region(tex, Rect2(tx * T, tz * T, T, T), Rect2(col * T, row * T, T, T), mod)


func _edge(i: int, lo: int, hi: int) -> int:
	return 0 if i == lo else (2 if i == hi else 1)


func _on_plateau(tx: int) -> bool:
	for r in PLATEAU:
		if tx >= r[0] and tx <= r[1]:
			return true
	return false


func _draw_ground(ci: Node2D) -> void:
	# flat island
	for tz in range(TZ0, TZ1 + 1):
		for tx in range(TX0, TX1 + 1):
			_tile(ci, _grass, tx, tz, _edge(tx, TX0, TX1), _edge(tz, TZ0, TZ1))
	# sand road along the lane
	var rx0 := int(M.MIN_X / 2) - 1
	var rx1 := int(M.MAX_X / 2)
	for tz in range(ROAD_Z[0], ROAD_Z[1] + 1):
		for tx in range(rx0, rx1 + 1):
			_tile(ci, _sand, tx, tz, 5 + _edge(tx, rx0, rx1), _edge(tz, ROAD_Z[0], ROAD_Z[1]), Color(0.86, 0.76, 0.62))
	# plateaus: soft shadow, then cliff and raised grass
	for r in PLATEAU:
		for tx in range(r[0], r[1] + 1):
			if _shadow:
				ci.draw_texture_rect(_shadow, Rect2(tx * T - 64, (PZ_EDGE + 2) * T - 40, 192, 120), false, Color(1, 1, 1, 0.55))
		for tz in range(PZ_TOP, PZ_EDGE + 3):
			for tx in range(r[0], r[1] + 1):
				var col := 5 + _edge(tx, r[0], r[1])
				var row := 1
				if tz == PZ_TOP:
					row = 0
				elif tz == PZ_EDGE:
					row = 3
				elif tz == PZ_EDGE + 1:
					row = 4
				elif tz == PZ_EDGE + 2:
					row = 5
				_tile(ci, _grass, tx, tz, col, row)


func _build_foam() -> void:
	var foam := Node2D.new()
	foam.z_index = -11
	add_child(foam)
	var sf := SpriteFrames.new()
	sf.remove_animation("default")
	sf.add_animation("f")
	sf.set_animation_speed("f", 10)
	var t := Sprites.tex(V.FREE + "Terrain/Tileset/Water Foam.png")
	if t == null:
		return
	var n := int(t.get_width() / 192.0)
	for i in range(n):
		var at := AtlasTexture.new()
		at.atlas = t
		at.region = Rect2(i * 192, 0, 192, 192)
		sf.add_frame("f", at)
	for tz in range(TZ0, TZ1 + 1):
		for tx in range(TX0, TX1 + 1):
			if tz != TZ0 and tz != TZ1 and tx != TX0 and tx != TX1:
				continue
			var a := AnimatedSprite2D.new()
			a.sprite_frames = sf
			a.position = Vector2(tx * T + 32, tz * T + 32)
			a.play("f")
			a.frame = _rng.randi_range(0, n - 1)
			foam.add_child(a)


# ------------------------------------------------------------------ props
func _anim_sprite(path: String, frame: Vector2i, count: int, fps: float, pos: Vector2, scale_ := 1.0, feet := 0.0) -> AnimatedSprite2D:
	var t := Sprites.tex(path)
	var a := AnimatedSprite2D.new()
	if t == null:
		return a
	var sf := SpriteFrames.new()
	sf.remove_animation("default")
	sf.add_animation("a")
	sf.set_animation_speed("a", fps)
	for i in range(count):
		var at := AtlasTexture.new()
		at.atlas = t
		at.region = Rect2(i * frame.x, 0, frame.x, frame.y)
		sf.add_frame("a", at)
	a.sprite_frames = sf
	a.position = pos
	a.offset = Vector2(0, -feet)
	a.scale = Vector2.ONE * scale_
	a.play("a")
	a.frame = _rng.randi_range(0, count - 1)
	return a


func _static_sprite(path: String, pos: Vector2, scale_ := 1.0, feet := 0.0) -> Sprite2D:
	var s := Sprite2D.new()
	s.texture = Sprites.tex(path)
	s.position = pos
	s.offset = Vector2(0, -feet)
	s.scale = Vector2.ONE * scale_
	return s


func _free_spot(p: Vector2) -> bool:
	var w := p / V.PX  # world units
	if w.y > M.LANE_MIN_Z - 2 and w.y < M.LANE_MAX_Z + 3:
		return false  # keep the lane clear
	for n in M.NODES:
		if Vector2(n[0], n[1]).distance_to(w) < 6:
			return false
	for p2 in M.plots():
		if Vector2(p2.x, p2.z).distance_to(w) < 5:
			return false
	if absf(w.x) > 78 and w.y < 4:
		return false  # keeps
	return true


func _decorate() -> void:
	var trees := [V.FREE + "Terrain/Resources/Wood/Trees/Tree1.png", V.FREE + "Terrain/Resources/Wood/Trees/Tree2.png"]
	var small_trees := [V.FREE + "Terrain/Resources/Wood/Trees/Tree3.png", V.FREE + "Terrain/Resources/Wood/Trees/Tree4.png"]
	# forest along the top edge and the middle meadow behind the lane
	for i in range(140):
		var x := _rng.randf_range(TX0 * T + 40, TX1 * T + 20)
		var y := _rng.randf_range(TZ0 * T + 60, -11 * T)
		var p := Vector2(x, y)
		if _on_plateau(int(floor(x / T))) and y > (PZ_TOP + 1) * T:
			continue
		if not _free_spot(p):
			continue
		var big := _rng.randf() < 0.6
		ysort.add_child(_anim_sprite((trees if big else small_trees)[_rng.randi() % 2], Vector2i(192, 256 if big else 192), 8, 6, p, _rng.randf_range(0.85, 1.1), 100 if big else 70))
	# a few trees along the bottom shore
	for i in range(26):
		var p := Vector2(_rng.randf_range(TX0 * T + 60, TX1 * T - 60), _rng.randf_range(14 * V.PX, TZ1 * T + 10))
		if _free_spot(p):
			ysort.add_child(_anim_sprite(small_trees[_rng.randi() % 2], Vector2i(192, 192), 8, 6, p, _rng.randf_range(0.8, 1.0), 70))
	# bushes and rocks
	for i in range(70):
		var p := Vector2(_rng.randf_range(TX0 * T + 30, TX1 * T - 30), _rng.randf_range(TZ0 * T + 40, TZ1 * T + 20))
		if not _free_spot(p):
			continue
		if _rng.randf() < 0.6:
			ysort.add_child(_anim_sprite(V.FREE + "Terrain/Decorations/Bushes/Bushe%d.png" % _rng.randi_range(1, 4), Vector2i(128, 128), 8, 8, p, 0.8, 40))
		else:
			ysort.add_child(_static_sprite(V.FREE + "Terrain/Decorations/Rocks/Rock%d.png" % _rng.randi_range(1, 4), p, 1.0, 16))
	# sheep grazing in the meadow
	for i in range(8):
		var p := Vector2(_rng.randf_range(-30, 30) * V.PX, _rng.randf_range(-22, -13) * V.PX)
		ysort.add_child(_anim_sprite(V.FREE + "Terrain/Resources/Meat/Sheep/Sheep_Grass.png", Vector2i(128, 128), 12, 8, p, 0.8, 34))
	# rocks in the water around the island
	for i in range(30):
		var side := _rng.randi() % 4
		var p := Vector2.ZERO
		match side:
			0: p = Vector2(_rng.randf_range(TX0, TX1) * T, (TZ0 - _rng.randf_range(1.5, 4)) * T)
			1: p = Vector2(_rng.randf_range(TX0, TX1) * T, (TZ1 + _rng.randf_range(2.5, 5)) * T)
			2: p = Vector2((TX0 - _rng.randf_range(1.5, 4)) * T, _rng.randf_range(TZ0, TZ1) * T)
			3: p = Vector2((TX1 + _rng.randf_range(2.5, 5)) * T, _rng.randf_range(TZ0, TZ1) * T)
		var r := _anim_sprite(V.FREE + "Terrain/Decorations/Rocks in the Water/Water Rocks_0%d.png" % _rng.randi_range(1, 4), Vector2i(64, 64), 16, 8, p, 1.2)
		r.z_index = -11
		add_child(r)
	# gold veins: clusters of gold stones
	for n in M.NODES:
		var c := V.to_px(n[0], n[1])
		var k := 5 if n[2] else 3
		for i in range(k):
			var off := Vector2(_rng.randf_range(-48, 48), _rng.randf_range(-20, 24)) if i > 0 else Vector2.ZERO
			ysort.add_child(_anim_sprite(V.FREE + "Terrain/Resources/Gold/Gold Stones/Gold Stone %d_Highlight.png" % _rng.randi_range(1, 6), Vector2i(128, 128), 6, 6, c + off, 0.9 if i == 0 else 0.7, 30))


func _build_clouds() -> void:
	for i in range(10):
		var s := Sprite2D.new()
		s.texture = Sprites.tex(V.FREE + "Terrain/Decorations/Clouds/Clouds_0%d.png" % _rng.randi_range(1, 8))
		var top := _rng.randf() < 0.5
		s.position = Vector2(_rng.randf_range(TX0 * T, TX1 * T), (TZ0 - 4) * T if top else (TZ1 + 5) * T) + Vector2(0, _rng.randf_range(-80, 80))
		s.modulate = Color(1, 1, 1, 0.85)
		s.z_index = 40
		s.scale = Vector2.ONE * _rng.randf_range(0.8, 1.3)
		add_child(s)
		_clouds.append(s)


func _process(delta: float) -> void:
	for c in _clouds:
		c.position.x += delta * 12.0
		if c.position.x > TX1 * T + 600:
			c.position.x = TX0 * T - 600
