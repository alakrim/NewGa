extends Node2D
## A keep, building or watchtower. Shows scaffolding while under construction and ruins when destroyed.

const V = preload("res://scripts/visuals.gd")

var id := 0
var team := 0
var bid := "house"
var color := "blue"
var progress := 1.0
var hp := 1.0
var max_hp := 1.0
var dead := false
var _sprite: Sprite2D
var _def: Dictionary


func setup(p_id: int, p_team: int, p_bid: String, p_color: String) -> void:
	id = p_id
	team = p_team
	bid = p_bid
	color = p_color
	_def = V.BUILDINGS.get(bid, V.BUILDINGS["house"])
	_sprite = Sprite2D.new()
	_sprite.centered = false
	add_child(_sprite)
	_refresh()


func _sheet(key: String) -> String:
	return Sprites.sheet_path(_def.get(key, _def.sheet), color)


func _refresh() -> void:
	var path := _sheet("ruin") if dead else (_sheet("construction") if progress < 1.0 else _sheet("sheet"))
	var t := Sprites.tex(path)
	_sprite.texture = t
	if t == null:
		return
	var frames: int = _def.get("hframes", 1) if (not dead and progress >= 1.0) else 1
	_sprite.hframes = frames
	var w := t.get_width() / frames
	var s: float = _def.get("scale", 1.0)
	_sprite.scale = Vector2.ONE * s
	_sprite.position = Vector2(-w * s / 2.0, -t.get_height() * s + 24 * s)
	queue_redraw()


func apply(snap: Array) -> void:
	position = V.to_px(snap[3], snap[4])
	hp = snap[6]
	max_hp = maxf(1.0, snap[7])
	var now_dead := (int(snap[9]) & 1) != 0
	if now_dead != dead:
		dead = now_dead
		_refresh()
	queue_redraw()


func set_progress(p: float) -> void:
	var was_done := progress >= 1.0
	progress = p
	if was_done != (p >= 1.0):
		_refresh()


func _process(_delta: float) -> void:
	if _sprite.hframes > 1:
		_sprite.frame = int(Time.get_ticks_msec() / 150) % _sprite.hframes


func _draw() -> void:
	if dead:
		return
	var top := -(_sprite.texture.get_height() * _sprite.scale.y if _sprite.texture else 120.0) + 10
	var w := 120.0 if bid == "castle" else 64.0
	if progress < 1.0:
		draw_rect(Rect2(-w / 2 - 1, top - 1, w + 2, 7), Color(0, 0, 0, 0.75))
		draw_rect(Rect2(-w / 2, top, w * progress, 5), Color("ffd166"))
	elif hp < max_hp:
		draw_rect(Rect2(-w / 2 - 1, top - 1, w + 2, 7), Color(0, 0, 0, 0.75))
		draw_rect(Rect2(-w / 2, top, w * hp / max_hp, 5), V.TEAM_COLORS[team])
