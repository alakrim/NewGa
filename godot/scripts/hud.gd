extends CanvasLayer
## In-game HUD for the Frontline match, designed for touch first (mouse + keyboard also work).
##   left thumb: floating virtual joystick (hero steering)   right thumb: 4 abilities + attack + recall
##   bottom: army / economy dock, left edge: stance toggles, top: keeps, timer + outposts, minimap
## All touch widgets are custom-drawn (hud_widgets.gd) and fed from raw multi-touch events in _input(), because
## Godot's GUI only emulates a mouse for the first finger. Panels (build, end screen) are regular GUI controls.

const W = preload("res://scripts/hud_widgets.gd")
const V = preload("res://scripts/visuals.gd")

signal leave_requested
signal play_again_requested

const ZOOM_MIN := 0.34
const ZOOM_MAX := 1.0
const SLOT_KEYS := ["Q", "W", "E", "R"]
const ABILITY_KEYCAPS := ["Q", "E", "R", "F"]
const DEFAULT_CAM_Y := -224.0
const DIR_THROTTLE := 0.1
const AIM_DRAG_RANGE := 130.0

var game: Node2D
var init: Dictionary = {}
var snap: Dictionary = {}
var fl: Dictionary = {}
var me: Dictionary = {}
var mine: Dictionary = {}  # my FlPlayerSnap
var my_unit := 0
var my_team := 0
var my_color := "blue"
var hero_id := ""
var hero_def: Dictionary = {}
var ended := false
var desktop := true

var root: Control
var overlay: Node2D
var joy: W.Joystick
var _touchables: Array = []
var _blockers: Array = []
var _owner := {}
var _free := {}
var _pinch_prev := {}
var _pan_accum := 0.0

# widgets
var keep_bars: Array = []
var chips := {}
var timer_plate: W.TimerPlate
var minimap: W.Minimap
var hero_panel: Control
var portrait: TextureRect
var lvl_lbl: Label
var hp_bar: W.SlimBar
var mp_bar: W.SlimBar
var xp_bar: W.SlimBar
var ability_btns: Array = []
var attack_btn: W.CircleButton
var recall_btn: W.CircleButton
var stance_btns := {}
var build_btn: W.PillButton
var center_btn: W.PillButton
var army_btns := {}
var dock: Panel
var gold_lbl: Label
var inc_lbl: Label
var pop_lbl: Label
var feed_box: VBoxContainer
var toast_box: VBoxContainer
var death_layer: Control
var death_lbl: Label
var death_sub: Label
var net_lbl: Label
var build_panel: BuildPanel
var end_screen: EndScreen

# state
var _units: Array = []
var _by_id := {}
var _built := {}
var _my_plots: Array = []
var _facing := Vector2.RIGHT
var _steer := Vector2.ZERO
var _sent_dir := Vector2.ZERO
var _sent_t := 0.0
var _keys_down := {}
var _picking := false
var _picking_until := 0.0
var _aim_slot := -1
var _aim_key := false
var _aim_key_t := 0.0
var _aim_touch := false
var _attack_t := 0.0
var _keep_hp := [[7000.0, 7000.0], [7000.0, 7000.0]]
var _last_toast := ""
var _net_check := 0.0
var _hold_start := {}


# ------------------------------------------------------------------ setup
func setup(p_game: Node2D, p_init: Dictionary) -> void:
	game = p_game
	init = p_init
	layer = 10
	desktop = not DisplayServer.is_touchscreen_available()
	for p in init.players:
		if p.playerId == init.you:
			my_unit = int(p.unitId)
			my_team = int(p.team)
			hero_id = p.heroId
	hero_def = HeroesData.by_id(hero_id)
	_facing = Vector2.RIGHT if my_team == 0 else Vector2.LEFT
	root = Control.new()
	root.theme = UiArt.make_theme()
	root.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	root.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(root)
	joy = W.Joystick.new()
	joy.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	root.add_child(joy)
	_build_top()
	_build_hero_panel()
	_build_stances()
	_build_dock()
	_build_actions()
	_build_overlays()
	overlay = W.WorldOverlay.new()
	game.add_child(overlay)
	game.snapshot_applied.connect(_on_snapshot)
	game.game_event.connect(_on_event)
	Net.room.connect(_on_room)
	root.resized.connect(_layout)
	_layout()
	if not game.snap.is_empty():
		_on_snapshot(game.snap)


func _exit_tree() -> void:
	if is_instance_valid(overlay):
		overlay.queue_free()


## Anchor `anchor` of the parent, control pivot `pivot`, offset `pos` of the pivot from the anchor, size `sz`.
func _place(c: Control, anchor: Vector2, pivot: Vector2, pos: Vector2, sz: Vector2) -> void:
	c.anchor_left = anchor.x
	c.anchor_right = anchor.x
	c.anchor_top = anchor.y
	c.anchor_bottom = anchor.y
	c.offset_left = pos.x - pivot.x * sz.x
	c.offset_right = c.offset_left + sz.x
	c.offset_top = pos.y - pivot.y * sz.y
	c.offset_bottom = c.offset_top + sz.y
	c.grow_horizontal = Control.GROW_DIRECTION_END
	c.grow_vertical = Control.GROW_DIRECTION_END


func _layout() -> void:
	if joy and not joy.active:
		joy.base = Vector2(150.0, root.size.y - 155.0)
		joy.knob = joy.base
		joy.queue_redraw()


# ------------------------------------------------------------------ building the UI
func _build_top() -> void:
	for t in [0, 1]:
		var kb := W.KeepBar.new()
		kb.custom_minimum_size = Vector2(320, 66)
		kb.col = UiArt.PLAYER_COL["blue" if t == 0 else "red"]
		kb.label = "DAWNGUARD KEEP" if t == 0 else "DUSKBORN KEEP"
		kb.align_right = t == 1
		root.add_child(kb)
		_place(kb, Vector2(0 if t == 0 else 1, 0), Vector2(0 if t == 0 else 1, 0), Vector2(12 if t == 0 else -12, 2), Vector2(320, 66))
		keep_bars.append(kb)
	timer_plate = W.TimerPlate.new()
	root.add_child(timer_plate)
	_place(timer_plate, Vector2(0.5, 0), Vector2(0.5, 0), Vector2(0, 2), Vector2(310, 58))
	minimap = W.Minimap.new()
	root.add_child(minimap)
	_place(minimap, Vector2(0.5, 0), Vector2(0.5, 0), Vector2(0, 64), Vector2(560, 64))
	minimap.on_seek = _minimap_seek
	minimap.on_lock = _relock
	minimap.on_pick = _minimap_pick
	_touchables.append(minimap)
	center_btn = W.PillButton.new()
	center_btn.label = "Follow hero"
	center_btn.icon = UiArt.icon("attack")
	center_btn.on_tap = func(_b): _relock()
	root.add_child(center_btn)
	_place(center_btn, Vector2(0.5, 0), Vector2(0.5, 0), Vector2(0, 132), Vector2(190, 48))
	center_btn.visible = false
	_touchables.append(center_btn)
	_blockers.append(timer_plate)
	_blockers.append(keep_bars[0])
	_blockers.append(keep_bars[1])


func _build_hero_panel() -> void:
	hero_panel = Panel.new()
	hero_panel.add_theme_stylebox_override("panel", UiArt.sb(UiArt.paper_dark(), Vector4(8, 8, 8, 8)))
	root.add_child(hero_panel)
	_place(hero_panel, Vector2(0, 0), Vector2(0, 0), Vector2(8, 108), Vector2(316, 98))
	portrait = UiArt.tex_rect(UiArt.hero_portrait(hero_id, "blue"), Vector2(78, 78))
	portrait.position = Vector2(14, 10)
	portrait.size = Vector2(78, 78)
	hero_panel.add_child(portrait)
	var badge := Panel.new()
	var bsb := UiArt.sb_flat(Color("2a1a0c"), 14, UiArt.GOLD, 3)
	badge.add_theme_stylebox_override("panel", bsb)
	badge.position = Vector2(8, 62)
	badge.size = Vector2(34, 30)
	hero_panel.add_child(badge)
	lvl_lbl = UiArt.label("1", 20, UiArt.GOLD, 3, HORIZONTAL_ALIGNMENT_CENTER)
	lvl_lbl.position = Vector2(8, 62)
	lvl_lbl.size = Vector2(34, 30)
	lvl_lbl.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
	hero_panel.add_child(lvl_lbl)
	var nm := UiArt.label(hero_def.get("name", ""), 20, UiArt.CREAM, 4)
	nm.position = Vector2(104, 6)
	hero_panel.add_child(nm)
	hp_bar = W.SlimBar.new()
	hp_bar.col = Color("d9453f")
	hp_bar.position = Vector2(104, 34)
	hp_bar.size = Vector2(196, 22)
	hero_panel.add_child(hp_bar)
	mp_bar = W.SlimBar.new()
	mp_bar.col = Color("3f86e0")
	mp_bar.position = Vector2(104, 60)
	mp_bar.size = Vector2(196, 18)
	hero_panel.add_child(mp_bar)
	xp_bar = W.SlimBar.new()
	xp_bar.col = Color("e8b923")
	xp_bar.position = Vector2(104, 82)
	xp_bar.size = Vector2(196, 8)
	hero_panel.add_child(xp_bar)
	_blockers.append(hero_panel)
	# chips under the keep bars
	for t in [0, 1]:
		for i in range(2):
			var c := W.Chip.new()
			root.add_child(c)
			var x := 12.0 + i * 160.0
			if t == 0:
				_place(c, Vector2(0, 0), Vector2(0, 0), Vector2(x, 72), Vector2(154, 30))
			else:
				_place(c, Vector2(1, 0), Vector2(1, 0), Vector2(-x, 72), Vector2(154, 30))
			c.visible = false
			chips["%d:%d" % [t, i]] = c


func _build_stances() -> void:
	var y := 218.0
	for st in FlData.STANCE_ORDER:
		var b := W.PillButton.new()
		var d: Dictionary = FlData.STANCES[st]
		b.label = d.name if st != "hold" else "Hold"
		b.icon = UiArt.stance_icon(st)
		b.key_hint = d.key if desktop else ""
		var s: String = st
		b.on_tap = func(_b): _set_stance(s)
		root.add_child(b)
		_place(b, Vector2(0, 0), Vector2(0, 0), Vector2(8, y), Vector2(150, 56))
		y += 62.0
		stance_btns[st] = b
		_touchables.append(b)


func _build_dock() -> void:
	dock = Panel.new()
	dock.add_theme_stylebox_override("panel", UiArt.sb(UiArt.paper_dark(), Vector4(8, 8, 8, 8)))
	root.add_child(dock)
	_place(dock, Vector2(0.5, 1), Vector2(0.5, 1), Vector2(-52, -4), Vector2(680, 150))
	_blockers.append(dock)
	var coin := UiArt.tex_rect(UiArt.coin(), Vector2(34, 34))
	coin.position = Vector2(26, 12)
	coin.size = Vector2(34, 34)
	dock.add_child(coin)
	gold_lbl = UiArt.label("0", 32, UiArt.GOLD, 5)
	gold_lbl.position = Vector2(66, 8)
	dock.add_child(gold_lbl)
	inc_lbl = UiArt.label("+3.0/s", 21, Color("a8f0b0"), 4)
	inc_lbl.position = Vector2(196, 14)
	dock.add_child(inc_lbl)
	var pic := UiArt.tex_rect(UiArt.icon("population"), Vector2(30, 30), true)
	pic.position = Vector2(308, 14)
	pic.size = Vector2(30, 30)
	dock.add_child(pic)
	pop_lbl = UiArt.label("0/12", 24, UiArt.CREAM, 4)
	pop_lbl.position = Vector2(344, 12)
	dock.add_child(pop_lbl)
	build_btn = W.PillButton.new()
	build_btn.label = "Build"
	build_btn.icon = UiArt.ui_icon(1)
	build_btn.key_hint = "B" if desktop else ""
	build_btn.on_tap = func(_b): _toggle_build()
	dock.add_child(build_btn)
	build_btn.position = Vector2(502, 6)
	build_btn.size = Vector2(150, 46)
	_touchables.append(build_btn)
	var i := 0
	for id in FlData.UNIT_ORDER:
		var b := W.ArmyButton.new()
		b.unit_id = id
		b.cost = FlData.UNITS[id].cost
		b.key_hint = str(i + 1) if desktop else ""
		var tr: String = FlData.UNITS[id].trainer
		if tr != "castle":
			b.trainer_icon = UiArt.building_icon(tr, "blue")
		b.on_train = _train
		b.on_blocked = _train_blocked
		dock.add_child(b)
		b.position = Vector2(24 + i * 80, 52)
		b.size = Vector2(76, 92)
		army_btns[id] = b
		_touchables.append(b)
		i += 1


func _build_actions() -> void:
	attack_btn = W.CircleButton.new()
	attack_btn.diameter = 108.0
	attack_btn.red = true
	attack_btn.icon = UiArt.ui_icon(5)
	attack_btn.icon_scale = 1.15
	attack_btn.sub = ""
	attack_btn.key_hint = ""
	attack_btn.on_tap = func(_b): _attack_nearest()
	root.add_child(attack_btn)
	_place(attack_btn, Vector2(1, 1), Vector2(0.5, 0.5), Vector2(-84, -88), Vector2(128, 128))
	_touchables.append(attack_btn)
	var centre := Vector2(-84, -88)
	var ang0 := 178.0
	for i in range(4):
		var b := W.CircleButton.new()
		b.diameter = 90.0
		b.red = i == 3
		b.aimable = true
		b.key_hint = ABILITY_KEYCAPS[i] if desktop else ""
		var slot := i
		b.on_tap = func(_b): _ability_tap(slot)
		b.on_aim_begin = func(_b): _aim_begin(slot)
		b.on_aim_move = func(_b, off): _aim_move(slot, off)
		b.on_aim_end = func(_b, off, cancelled): _aim_end(slot, off, cancelled)
		root.add_child(b)
		var a := deg_to_rad(ang0 + i * 33.0)
		var p := centre + Vector2(cos(a), sin(a)) * 176.0
		_place(b, Vector2(1, 1), Vector2(0.5, 0.5), p, Vector2(120, 120))
		ability_btns.append(b)
		_touchables.append(b)
	recall_btn = W.CircleButton.new()
	recall_btn.diameter = 64.0
	recall_btn.icon = UiArt.icon("garrison")
	recall_btn.icon_scale = 0.9
	recall_btn.on_tap = func(_b): _recall()
	recall_btn.key_hint = ""
	root.add_child(recall_btn)
	_place(recall_btn, Vector2(1, 1), Vector2(0.5, 0.5), centre + Vector2(30, -262), Vector2(84, 84))
	_touchables.append(recall_btn)
	var rl := UiArt.label("Recall", 15, UiArt.CREAM, 3, HORIZONTAL_ALIGNMENT_CENTER)
	rl.size = Vector2(84, 20)
	rl.position = Vector2(0, 62)
	rl.mouse_filter = Control.MOUSE_FILTER_IGNORE
	recall_btn.add_child(rl)


func _build_overlays() -> void:
	feed_box = VBoxContainer.new()
	feed_box.add_theme_constant_override("separation", 2)
	feed_box.mouse_filter = Control.MOUSE_FILTER_IGNORE
	root.add_child(feed_box)
	_place(feed_box, Vector2(1, 0), Vector2(1, 0), Vector2(-12, 112), Vector2(380, 120))
	toast_box = VBoxContainer.new()
	toast_box.alignment = BoxContainer.ALIGNMENT_BEGIN
	toast_box.add_theme_constant_override("separation", 4)
	toast_box.mouse_filter = Control.MOUSE_FILTER_IGNORE
	root.add_child(toast_box)
	_place(toast_box, Vector2(0.5, 0), Vector2(0.5, 0), Vector2(0, 186), Vector2(640, 130))
	death_layer = Control.new()
	death_layer.mouse_filter = Control.MOUSE_FILTER_IGNORE
	death_layer.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	death_layer.visible = false
	root.add_child(death_layer)
	var dim := ColorRect.new()
	dim.color = Color(0.1, 0.0, 0.0, 0.32)
	dim.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	dim.mouse_filter = Control.MOUSE_FILTER_IGNORE
	death_layer.add_child(dim)
	death_lbl = UiArt.label("YOU HAVE FALLEN", 54, Color("ffd9c9"), 10, HORIZONTAL_ALIGNMENT_CENTER)
	death_layer.add_child(death_lbl)
	_place(death_lbl, Vector2(0.5, 0.5), Vector2(0.5, 0.5), Vector2(0, -50), Vector2(900, 70))
	death_sub = UiArt.label("Respawning in 8", 38, UiArt.GOLD, 8, HORIZONTAL_ALIGNMENT_CENTER)
	death_layer.add_child(death_sub)
	_place(death_sub, Vector2(0.5, 0.5), Vector2(0.5, 0.5), Vector2(0, 14), Vector2(900, 54))
	net_lbl = UiArt.label("Reconnecting...", 26, UiArt.BAD, 5, HORIZONTAL_ALIGNMENT_CENTER)
	root.add_child(net_lbl)
	_place(net_lbl, Vector2(0.5, 0), Vector2(0.5, 0), Vector2(0, 190), Vector2(500, 36))
	net_lbl.visible = false
	build_panel = BuildPanel.new()
	root.add_child(build_panel)
	build_panel.closed.connect(_close_build)
	build_panel.build_requested.connect(func(plot, b): Net.cmd({"c": "buildAt", "plot": plot, "building": b}))
	build_panel.research_requested.connect(func(k): Net.cmd({"c": "research", "kind": k}))
	build_panel.toast.connect(func(t): toast(t, UiArt.BAD))
	end_screen = EndScreen.new()
	end_screen.visible = false
	root.add_child(end_screen)
	end_screen.leave_pressed.connect(func(): leave_requested.emit())
	end_screen.again_pressed.connect(func(): play_again_requested.emit())


# ------------------------------------------------------------------ toasts and feed
func toast(text: String, col := Color("fff1cf")) -> void:
	var l := UiArt.label(text, 26, col, 6, HORIZONTAL_ALIGNMENT_CENTER)
	l.mouse_filter = Control.MOUSE_FILTER_IGNORE
	toast_box.add_child(l)
	while toast_box.get_child_count() > 3:
		toast_box.get_child(0).queue_free()
		toast_box.remove_child(toast_box.get_child(0))
	var tw := l.create_tween()
	tw.tween_interval(1.8)
	tw.tween_property(l, "modulate:a", 0.0, 0.6)
	tw.tween_callback(l.queue_free)


func feed(bb: String) -> void:
	var r := RichTextLabel.new()
	r.bbcode_enabled = true
	r.fit_content = true
	r.scroll_active = false
	r.autowrap_mode = TextServer.AUTOWRAP_OFF
	r.mouse_filter = Control.MOUSE_FILTER_IGNORE
	r.add_theme_font_size_override("normal_font_size", 20)
	r.add_theme_font_size_override("bold_font_size", 20)
	r.add_theme_color_override("font_outline_color", UiArt.OUTLINE)
	r.add_theme_constant_override("outline_size", 5)
	r.text = "[right]%s[/right]" % bb
	r.custom_minimum_size = Vector2(380, 26)
	feed_box.add_child(r)
	while feed_box.get_child_count() > 5:
		var o := feed_box.get_child(0)
		feed_box.remove_child(o)
		o.queue_free()
	var tw := r.create_tween()
	tw.tween_interval(6.0)
	tw.tween_property(r, "modulate:a", 0.0, 0.8)
	tw.tween_callback(r.queue_free)


func _hex(c: Color) -> String:
	return "#" + c.to_html(false)


func _name_bb(uid: int) -> String:
	var u: Dictionary = _by_id.get(uid, {})
	for b in snap.get("board", []):
		if int(b.id) == uid:
			return "[color=%s]%s[/color]" % [_hex(_color_of_pid(b.pid, int(b.team)).lightened(0.25)), b.name]
	if u.is_empty():
		return "[color=#cccccc]Something[/color]"
	var info: Dictionary = init.get("visuals", {}).get(u.vis, {})
	var team_col: Color = UiArt.PLAYER_COL["blue"] if int(u.team) == 0 else (UiArt.PLAYER_COL["red"] if int(u.team) == 1 else Color("c8c8c8"))
	return "[color=%s]%s[/color]" % [_hex(team_col.lightened(0.25)), info.get("name", "Unit")]


func _color_of_pid(pid: String, team: int) -> Color:
	for p in fl.get("players", []):
		if p.pid == pid:
			return UiArt.PLAYER_COL.get(p.color, Color.WHITE)
	return UiArt.PLAYER_COL["blue" if team == 0 else "red"]


func _on_event(e: Dictionary) -> void:
	match e.get("e", ""):
		"kill":
			var involved := false
			for b in snap.get("board", []):
				if int(b.id) == int(e.killer) or int(b.id) == int(e.victim):
					involved = true
			if involved:
				var k := _name_bb(int(e.killer)) if int(e.killer) != 0 else "[color=#dddddd]The keep[/color]"
				feed("%s  [color=#ffd9a0]slew[/color]  %s" % [k, _name_bb(int(e.victim))])
		"struct":
			var tn := "Dawnguard" if int(e.team) == 0 else "Duskborn"
			feed("[color=#ffb089]%s lost %s[/color]" % [tn, e.name])
		"banner":
			var spot := {"west": "Dawn Outpost", "heart": "Heart Banner", "east": "Dusk Outpost"}.get(e.key, "an outpost") as String
			var tn2 := "Dawnguard" if int(e.team) == 0 else "Duskborn"
			var c: Color = UiArt.PLAYER_COL["blue" if int(e.team) == 0 else "red"].lightened(0.3)
			toast("%s took the %s" % [tn2, spot], c)
		"msg":
			toast(str(e.text), Color(str(e.get("color", "#fff1cf"))))


func _on_room(info: Dictionary) -> void:
	if end_screen and end_screen.visible:
		end_screen.set_host(info.get("host", "") == Net.pid)


# ------------------------------------------------------------------ snapshot -> UI
func _kind_of(vis: String) -> String:
	var info: Dictionary = init.get("visuals", {}).get(vis, {})
	return info.get("kind", "building" if vis.begins_with("b:") else ("hero" if vis.begins_with("h:") else ("tower" if vis.begins_with("tw:") else "minion")))


func _on_snapshot(s: Dictionary) -> void:
	snap = s
	fl = s.get("fl", {})
	me = s.get("me", {})
	_cache_units()
	mine = {}
	for p in fl.get("players", []):
		if p.pid == init.you:
			mine = p
	if not mine.is_empty():
		if mine.color != my_color:
			my_color = mine.color
			portrait.texture = UiArt.hero_portrait(hero_id, my_color)
			for id in army_btns:
				army_btns[id].color = my_color
	_cache_plots()
	_update_top()
	_update_hero()
	_update_dock()
	_update_actions()
	_update_minimap()
	_update_rally()
	if build_panel.visible:
		build_panel.update(_build_ctx())
	if s.get("winner") != null and not ended:
		_show_end()


func _cache_units() -> void:
	_units.clear()
	_by_id.clear()
	for u in snap.get("units", []):
		var d := {
			"id": int(u[0]), "vis": u[1], "team": int(u[2]), "x": float(u[3]), "z": float(u[4]),
			"hp": float(u[6]), "max_hp": maxf(1.0, float(u[7])), "dead": (int(u[9]) & 1) != 0, "kind": _kind_of(u[1]),
		}
		_units.append(d)
		_by_id[d.id] = d


func _cache_plots() -> void:
	_built.clear()
	_my_plots.clear()
	if mine.is_empty():
		return
	var plots: Array = fl.get("plots", [])
	for i in range(FlData.PLOTS.size()):
		var spot: Array = FlData.PLOTS[i]
		if int(spot[0]) != int(mine.team) or int(spot[1]) != int(mine.slot):
			continue
		var st: Array = plots[i] if i < plots.size() else [i, "", "", 0.0, 0]
		var b: String = st[2]
		var prog: float = float(st[3])
		var uinfo: Dictionary = _by_id.get(int(st[4]), {})
		_my_plots.append({
			"index": i, "building": b, "progress": prog, "uid": int(st[4]),
			"hp": uinfo.get("hp", 0.0), "max_hp": uinfo.get("max_hp", 1.0),
		})
		if b != "":
			var e: Dictionary = _built.get(b, {"done": 0, "total": 0})
			e.total += 1
			if prog >= 1.0:
				e.done += 1
			_built[b] = e


func _gold() -> int:
	return int(me.get("gold", mine.get("gold", 0)))


func _build_ctx() -> Dictionary:
	return {
		"gold": _gold(), "pop": int(mine.get("pop", 0)), "pop_cap": int(mine.get("popCap", 12)),
		"plots": _my_plots, "built": _built, "research": mine.get("research", {}), "color": my_color,
	}


func _update_top() -> void:
	var castles: Array = fl.get("castles", [0, 0])
	for t in [0, 1]:
		var u: Dictionary = _by_id.get(int(castles[t]), {})
		if not u.is_empty():
			_keep_hp[t] = [u.hp, u.max_hp]
		elif _by_id.size() > 0:
			_keep_hp[t][0] = 0.0
		var kb: W.KeepBar = keep_bars[t]
		var hpv: float = _keep_hp[t][0]
		var mx: float = _keep_hp[t][1]
		kb.set_value(hpv / maxf(1.0, mx), "%d / %d" % [ceili(hpv), int(mx)])
	var tm := int(snap.get("time", 0))
	timer_plate.set_state("%d:%02d" % [tm / 60, tm % 60], fl.get("banners", []))
	# chips
	var counts := {0: 0, 1: 0}
	for p in fl.get("players", []):
		var t2: int = int(p.team)
		var slot: int = counts[t2]
		counts[t2] = slot + 1
		var c: W.Chip = chips.get("%d:%d" % [t2, slot])
		if c == null:
			continue
		var b := {}
		for bb in snap.get("board", []):
			if bb.pid == p.pid:
				b = bb
		c.visible = true
		c.set_info({
			"name": p.name, "color": p.color, "stance": p.stance, "lvl": int(b.get("lvl", 0)), "pop": int(p.pop),
			"dead": float(b.get("respawn", 0)) > 0.0, "mine": p.pid == init.get("you", ""), "bot": b.get("bot", false),
		})
		c.align_right = t2 == 1


func _update_hero() -> void:
	var u: Dictionary = _by_id.get(my_unit, {})
	if not u.is_empty():
		var sh := 0.0
		for raw in snap.get("units", []):
			if int(raw[0]) == my_unit:
				sh = float(raw[8])
		var tot := maxf(u.max_hp, u.hp + sh)
		hp_bar.set_value(u.hp / tot, "%d / %d" % [int(u.hp), int(u.max_hp)], sh / tot)
	if not me.is_empty():
		mp_bar.set_value(float(me.mana) / maxf(1.0, float(me.maxMana)), "%d" % int(me.mana))
		var span := maxf(1.0, float(me.xpNext) - float(me.xpPrev))
		xp_bar.set_value(clampf((float(me.xp) - float(me.xpPrev)) / span, 0.0, 1.0), "")
		lvl_lbl.text = str(int(me.level))
		var resp := float(me.get("respawn", 0))
		death_layer.visible = resp > 0.0 and not ended
		if death_layer.visible:
			death_sub.text = "Respawning in %d" % ceili(resp)


func _unit_status(id: String) -> Dictionary:
	var d: Dictionary = FlData.UNITS[id]
	if mine.is_empty():
		return {"state": "ok", "reason": ""}
	if d.trainer != "castle":
		var b: Dictionary = _built.get(d.trainer, {})
		var bn: String = FlData.BUILDINGS[d.trainer].name
		if b.is_empty():
			return {"state": "locked", "reason": "Needs a %s (open Build)" % bn}
		if int(b.done) == 0:
			return {"state": "locked", "reason": "%s is still under construction" % bn}
	var qn := 0
	for q in fl.get("queue", []):
		if q.trainer == d.trainer:
			qn += 1
	if qn >= 5:
		return {"state": "full", "reason": "Training queue is full (5)"}
	if int(mine.pop) + int(d.pop) > int(mine.popCap):
		return {"state": "pop", "reason": "Population full (%d/%d): build Houses" % [int(mine.pop), int(mine.popCap)]}
	if _gold() < int(d.cost):
		return {"state": "gold", "reason": "Need %d more gold" % (int(d.cost) - _gold())}
	return {"state": "ok", "reason": ""}


func _update_dock() -> void:
	if mine.is_empty():
		return
	var g := str(_gold())
	if gold_lbl.text != g:
		gold_lbl.text = g
	var inc := "+%.1f/s" % float(mine.income)
	if inc_lbl.text != inc:
		inc_lbl.text = inc
	var pp := "%d/%d" % [int(mine.pop), int(mine.popCap)]
	if pop_lbl.text != pp:
		pop_lbl.text = pp
		pop_lbl.add_theme_color_override("font_color", UiArt.BAD if int(mine.pop) >= int(mine.popCap) else UiArt.CREAM)
	for id in FlData.UNIT_ORDER:
		var b: W.ArmyButton = army_btns[id]
		var st := _unit_status(id)
		var queued := 0
		var prog := 0.0
		for q in fl.get("queue", []):
			if q.unit == id:
				if queued == 0:
					prog = clampf(1.0 - float(q.left) / maxf(0.1, float(q.total)), 0.0, 1.0)
				queued += 1
		var count: int = int(mine.get("army", {}).get(id, 0))
		var changed: bool = b.state != st.state or b.queued != queued or b.count != count or absf(b.progress - prog) > 0.01
		b.state = st.state
		b.reason = st.reason
		b.queued = queued
		b.count = count
		b.progress = prog
		if changed:
			b.queue_redraw()
	for st in FlData.STANCE_ORDER:
		var pb: W.PillButton = stance_btns[st]
		var on: bool = mine.stance == st
		var pulse: bool = st == "hold" and _picking
		if pb.on != on or pb.pulse != pulse:
			pb.on = on
			pb.pulse = pulse
			pb.queue_redraw()
	build_btn.on = build_panel.visible
	build_btn.queue_redraw()


func _ability_cost(i: int) -> int:
	var rank := int(me.get("ranks", [0, 0, 0, 0])[i])
	var arr: Array = hero_def.get("abilities", [])[i].mana
	return int(arr[clampi(maxi(rank, 1) - 1, 0, arr.size() - 1)])


func _ability_ready(i: int) -> bool:
	if me.is_empty():
		return false
	return int(me.ranks[i]) > 0 and float(me.cd[i]) <= 0.0 and float(me.mana) >= _ability_cost(i)


func _initials(n: String) -> String:
	var parts := n.split(" ", false)
	if parts.size() >= 2:
		return (parts[0].substr(0, 1) + parts[1].substr(0, 1)).to_upper()
	return n.substr(0, 2)


func _update_actions() -> void:
	if me.is_empty() or hero_def.is_empty():
		return
	for i in range(4):
		var b: W.CircleButton = ability_btns[i]
		var a: Dictionary = hero_def.abilities[i]
		var rank := int(me.ranks[i])
		b.label = _initials(a.name)
		b.cd = float(me.cd[i])
		b.cd_max = maxf(0.1, float(me.cdMax[i]))
		b.pips = rank
		b.pips_max = 3 if i == 3 else 5
		var cost := _ability_cost(i)
		b.badge = str(cost) if cost > 0 and rank > 0 else ""
		b.badge_bad = float(me.mana) < cost
		b.locked_text = "Lv 4" if rank == 0 and i == 3 else ("-" if rank == 0 else "")
		b.disabled = not _ability_ready(i)
		b.queue_redraw()
	recall_btn.progress = float(me.get("recall", 0))
	recall_btn.queue_redraw()
	var dead := float(me.get("respawn", 0)) > 0.0
	attack_btn.disabled = dead
	attack_btn.queue_redraw()


func _update_minimap() -> void:
	var mu: Array = []
	var hero_colors := {}
	for p in fl.get("players", []):
		hero_colors[int(p.hero)] = UiArt.PLAYER_COL.get(p.color, Color.WHITE)
	for u in _units:
		if u.dead:
			continue
		if u.kind == "building" or u.kind == "tower":
			continue
		var col := Color("c8c8c8")
		var miner := false
		if u.kind == "hero":
			col = hero_colors.get(u.id, UiArt.PLAYER_COL["blue" if u.team == 0 else "red"])
		else:
			var parsed := V.parse_vis(u.vis)
			if parsed[1] != "":
				col = UiArt.PLAYER_COL.get(parsed[1], col)
			elif u.team < 2:
				col = UiArt.PLAYER_COL["blue" if u.team == 0 else "red"]
			miner = parsed[0] == "miner"
		mu.append({"x": u.x, "z": u.z, "team": u.team, "kind": u.kind, "color": col, "mine": u.id == my_unit, "miner": miner})
	minimap.units = mu
	minimap.banners = fl.get("banners", [])
	var castles: Array = []
	for t in [0, 1]:
		var cid: int = int(fl.get("castles", [0, 0])[t])
		var cu: Dictionary = _by_id.get(cid, {})
		if not cu.is_empty() and not cu.dead:
			castles.append({"x": cu.x, "z": cu.z, "team": t, "hp": cu.hp})
	minimap.castles = castles
	minimap.picking = _picking
	minimap.locked = game.cam_locked
	center_btn.visible = not game.cam_locked
	var cam: Camera2D = game.camera
	var half := (root.size.x * 0.5 / cam.zoom.x) / V.PX
	minimap.cam_x0 = cam.position.x / V.PX - half
	minimap.cam_x1 = cam.position.x / V.PX + half
	minimap.queue_redraw()


func _update_rally() -> void:
	var on: bool = not mine.is_empty() and mine.stance == "hold" and float(mine.rallyX) != 0.0
	overlay.rally_on = on
	if on:
		overlay.rally_px = float(mine.rallyX) * V.PX
		overlay.rally_col = UiArt.PLAYER_COL.get(my_color, Color.WHITE)
	minimap.rally_x = float(mine.rallyX) if on else 0.0
	minimap.rally_col = overlay.rally_col
	minimap.picking = _picking
	minimap.queue_redraw()
	if _picking:
		overlay.picking = true


func _show_end() -> void:
	ended = true
	_release_all()
	_close_build()
	death_layer.visible = false
	end_screen.visible = true
	end_screen.show_result(snap, init, my_team, Net.last_room.get("host", "") == Net.pid)


# ------------------------------------------------------------------ commands
func _train(unit_id: String, count: int) -> void:
	var st := _unit_status(unit_id)
	if st.state != "ok":
		toast(st.reason, UiArt.BAD)
		return
	Net.cmd({"c": "train", "unit": unit_id, "count": count})


func _train_blocked(_unit_id: String, reason: String) -> void:
	toast(reason, UiArt.BAD)


func _set_stance(st: String) -> void:
	if ended:
		return
	if st == "hold":
		Net.cmd({"c": "stance", "stance": "hold"})
		_picking = not _picking
		_picking_until = Time.get_ticks_msec() / 1000.0 + 8.0
		if _picking:
			toast("Tap the battlefield to set the rally point", Color("ffe9a0"))
	else:
		_picking = false
		Net.cmd({"c": "stance", "stance": st})


func _set_rally(x: float) -> void:
	Net.cmd({"c": "stance", "stance": "hold", "x": roundi(x)})
	_picking = false
	overlay.picking = false
	toast("Rally point set", Color("ffe9a0"))


func _minimap_pick(wx: float) -> void:
	_set_rally(wx)


func _minimap_seek(wx: float) -> void:
	game.cam_locked = false
	game.camera.position.x = wx * V.PX


func _relock() -> void:
	game.cam_locked = true


func _toggle_build() -> void:
	if ended:
		return
	if build_panel.visible:
		_close_build()
	else:
		build_panel.open(_build_ctx())


func _close_build() -> void:
	build_panel.close()


func _recall() -> void:
	if float(me.get("respawn", 0)) > 0.0:
		return
	Net.cmd({"c": "recall"})
	toast("Recalling to the keep...", Color("bfe3ff"))


func _hero_pos() -> Vector2:
	var u: Dictionary = _by_id.get(my_unit, {})
	if u.is_empty():
		return Vector2.ZERO
	return Vector2(u.x, u.z)


func _enemies() -> Array:
	var out: Array = []
	for u in _units:
		if u.dead or u.team == my_team or u.team > 1:
			continue
		out.append(u)
	return out


## Nearest enemy to `p` (sim units), heroes/units before buildings. `reach` limits the search distance (measured from p).
func _nearest_enemy(p: Vector2, reach := 9999.0, include_buildings := true) -> Dictionary:
	var best := {}
	var best_d := reach
	for u in _enemies():
		var is_b: bool = u.kind == "building" or u.kind == "tower"
		if is_b and not include_buildings:
			continue
		var d := p.distance_to(Vector2(u.x, u.z)) - (3.0 if is_b else 0.0)
		if d < best_d:
			best_d = d
			best = u
	return best


func _attack_nearest() -> void:
	var t := _nearest_enemy(_hero_pos(), 14.0)
	if t.is_empty():
		t = _nearest_enemy(_hero_pos(), 40.0)
	if t.is_empty():
		toast("No enemy nearby", UiArt.MUTED)
		return
	Net.cmd({"c": "attack", "id": t.id})


# ------------------------------------------------------------------ abilities
func _ability_def(i: int) -> Dictionary:
	return hero_def.abilities[i]


func _ability_tap(i: int) -> void:
	if ended or me.is_empty():
		return
	if int(me.ranks[i]) <= 0:
		toast("Unlocks at level 4" if i == 3 else "Not learned yet", UiArt.MUTED)
		return
	if float(me.cd[i]) > 0.0:
		toast("%s is on cooldown" % _ability_def(i).name, UiArt.MUTED)
		return
	if float(me.mana) < _ability_cost(i):
		toast("Not enough mana", UiArt.MANA)
		return
	_cast_resolved(i, _resolve(i, null))


func _cast_resolved(i: int, res: Dictionary) -> void:
	if not res.ok:
		toast(res.get("why", "No target"), UiArt.MUTED)
		return
	var c := {"c": "cast", "slot": SLOT_KEYS[i], "x": res.pos.x, "z": res.pos.y}
	if int(res.id) > 0:
		c["id"] = int(res.id)
	Net.cmd(c)


func _allies() -> Array:
	var out: Array = []
	for u in _units:
		if u.dead or u.team != my_team or u.kind == "building" or u.kind == "tower":
			continue
		out.append(u)
	return out


## Works out where / who an ability would hit. aim == null: quick-cast (auto target); else aim is a sim-unit point.
func _resolve(i: int, aim: Variant) -> Dictionary:
	var def := _ability_def(i)
	var hp := _hero_pos()
	var rng: float = maxf(0.5, float(def.range))
	var out := {"ok": true, "pos": hp, "id": 0, "kind": def.targeting, "aim": hp, "dir": _facing, "has_target": false, "why": ""}
	match def.targeting:
		"self":
			out.pos = hp
		"direction":
			var dir := _facing
			if aim != null:
				var d: Vector2 = aim - hp
				if d.length() > 0.3:
					dir = d.normalized()
			else:
				var t := _nearest_enemy(hp, rng * 1.35, false)
				if not t.is_empty():
					dir = (Vector2(t.x, t.z) - hp).normalized()
			out.dir = dir
			out.pos = hp + dir * rng
			out.aim = out.pos
		"point":
			var pt := hp + _facing * rng * 0.55
			if aim != null:
				pt = aim
			else:
				var t2 := _nearest_enemy(hp, rng + float(def.radius) * 0.5 + 1.0, false)
				if not t2.is_empty():
					pt = Vector2(t2.x, t2.z)
			var off := pt - hp
			if off.length() > rng:
				pt = hp + off.normalized() * rng
			out.pos = pt
			out.aim = pt
			out.dir = (pt - hp).normalized() if pt != hp else _facing
		"enemy", "ally", "unit":
			var cand: Array = []
			var ref: Vector2 = aim if aim != null else hp
			var best := {}
			var best_d := 9999.0
			var want: String = def.targeting
			for u in _units:
				if u.dead:
					continue
				var is_b: bool = u.kind == "building" or u.kind == "tower"
				var enemy: bool = u.team != my_team and u.team <= 1
				if want == "enemy" and not enemy:
					continue
				if want == "ally" and (u.team != my_team or is_b):
					continue
				if want == "unit" and not (enemy or u.team == my_team):
					continue
				if is_b and aim == null and want != "enemy":
					continue
				var d2 := ref.distance_to(Vector2(u.x, u.z)) - (3.0 if is_b else 0.0)
				if want == "ally" and aim == null:
					if u.id == my_unit:
						d2 = 400.0  # prefer someone else, fall back to self
				if want == "unit" and aim == null and not enemy:
					d2 += 25.0
				if d2 < best_d:
					best_d = d2
					best = u
			if aim != null and best_d > 5.0:
				best = {}
			if not best.is_empty() and aim == null and want == "enemy" and hp.distance_to(Vector2(best.x, best.z)) > rng + 8.0:
				best = {}
			if best.is_empty():
				if want == "ally" or want == "unit":
					best = _by_id.get(my_unit, {})
				if best.is_empty():
					out.ok = false
					out.why = "No target in range"
					out.aim = hp + _facing * rng * 0.7
					return out
			out.id = best.id
			out.pos = Vector2(best.x, best.z)
			out.aim = out.pos
			out.has_target = true
	return out


func _aim_show(i: int, res: Dictionary) -> void:
	var def := _ability_def(i)
	var u: Node2D = game.units.get(my_unit)
	overlay.hero = u.position if u else _hero_pos() * V.PX
	overlay.kind = def.targeting
	overlay.range_px = float(def.range) * V.PX
	overlay.radius_px = float(def.radius) * V.PX
	overlay.aim_pt = res.aim * V.PX
	overlay.dir = res.dir
	overlay.has_target = res.has_target
	overlay.col = UiArt.PLAYER_COL["red"].lerp(Color("ffcf6a"), 0.35) if def.targeting in ["enemy", "direction", "point"] else Color("7be08a")
	if def.targeting == "ally":
		overlay.col = Color("7be08a")
	overlay.aim_on = true


func _aim_begin(i: int) -> void:
	if ended or me.is_empty() or not _ability_ready(i):
		return
	_aim_slot = i
	_aim_touch = true
	_aim_show(i, _resolve(i, null))


func _aim_move(i: int, off: Vector2) -> void:
	if _aim_slot != i:
		return
	var def := _ability_def(i)
	var hp := _hero_pos()
	var mag := clampf(off.length() / AIM_DRAG_RANGE, 0.0, 1.0)
	var res: Dictionary
	if off.length() < 24.0:
		res = _resolve(i, null)
	else:
		var dir := off.normalized()
		var rng := maxf(1.0, float(def.range))
		res = _resolve(i, hp + dir * mag * rng)
	_aim_show(i, res)
	_aim_res = res


var _aim_res: Dictionary = {}


func _aim_end(i: int, off: Vector2, cancelled: bool) -> void:
	if _aim_slot != i:
		return
	_aim_slot = -1
	_aim_touch = false
	overlay.aim_on = false
	if cancelled or off.length() < 24.0:
		return
	var def := _ability_def(i)
	var hp := _hero_pos()
	var mag := clampf(off.length() / AIM_DRAG_RANGE, 0.0, 1.0)
	var res := _resolve(i, hp + off.normalized() * mag * maxf(1.0, float(def.range)))
	_cast_resolved(i, res)


# ------------------------------------------------------------------ per frame
func _process(delta: float) -> void:
	if game == null:
		return
	var now := Time.get_ticks_msec() / 1000.0
	# steering
	var v := Vector2.ZERO
	if joy.active:
		v = joy.vec
	else:
		var k := Vector2.ZERO
		if _keys_down.get(KEY_W, false) or _keys_down.get(KEY_UP, false):
			k.y -= 1
		if _keys_down.get(KEY_S, false) or _keys_down.get(KEY_DOWN, false):
			k.y += 1
		if _keys_down.get(KEY_A, false) or _keys_down.get(KEY_LEFT, false):
			k.x -= 1
		if _keys_down.get(KEY_D, false) or _keys_down.get(KEY_RIGHT, false):
			k.x += 1
		v = k.normalized()
	if v.length() < 0.22:
		v = Vector2.ZERO
	else:
		_facing = v.normalized()
	_send_steer(v, now)
	# attack button held: keep hitting the nearest enemy
	if attack_btn.pressed and now - _attack_t > 0.4 and not ended:
		_attack_t = now
		var t := _nearest_enemy(_hero_pos(), 14.0)
		if not t.is_empty():
			Net.cmd({"c": "attack", "id": t.id})
	# keyboard ability aim follows the cursor
	if _aim_key and _aim_slot >= 0:
		var mp: Vector2 = game.screen_to_world(get_viewport().get_mouse_position())
		_aim_show(_aim_slot, _resolve(_aim_slot, mp))
	if _aim_slot >= 0:
		var u: Node2D = game.units.get(my_unit)
		if u:
			overlay.hero = u.position
	# camera: ease vertically back when following, clamp zoom/pan
	var cam: Camera2D = game.camera
	if game.cam_locked:
		cam.position.y = lerpf(cam.position.y, DEFAULT_CAM_Y, 1.0 - exp(-delta * 4.0))
	else:
		cam.position.y = clampf(cam.position.y, -520.0, 120.0)
	if _picking and now > _picking_until:
		_picking = false
		overlay.picking = false
		minimap.picking = false
	_net_check -= delta
	if _net_check <= 0.0:
		_net_check = 0.5
		net_lbl.visible = not Net.is_open() and not ended


func _send_steer(v: Vector2, now: float) -> void:
	if v == Vector2.ZERO:
		if _sent_dir != Vector2.ZERO:
			Net.cmd({"c": "dir", "x": 0, "z": 0})
			_sent_dir = Vector2.ZERO
			_sent_t = now
		return
	var turned := _sent_dir == Vector2.ZERO or absf(v.normalized().angle_to(_sent_dir.normalized())) > 0.12
	if turned and (_sent_dir == Vector2.ZERO or now - _sent_t >= DIR_THROTTLE):
		Net.cmd({"c": "dir", "x": snappedf(v.x, 0.01), "z": snappedf(v.y, 0.01)})
		_sent_dir = v
		_sent_t = now


func _release_all() -> void:
	for idx in _owner.keys():
		var w = _owner[idx]
		if w == joy:
			joy.end()
		elif w != null:
			w.touch_up(idx, Vector2(-9999, -9999))
	_owner.clear()
	_free.clear()
	_aim_slot = -1
	overlay.aim_on = false


# ------------------------------------------------------------------ input
func _input(ev: InputEvent) -> void:
	if game == null:
		return
	if ev is InputEventScreenTouch:
		if ended:
			return
		if ev.pressed:
			_touch_press(ev.index, ev.position)
		else:
			_touch_release(ev.index, ev.position)
	elif ev is InputEventScreenDrag:
		if ended:
			return
		_touch_drag(ev.index, ev.position)
	elif ev is InputEventMouseButton:
		_mouse_button(ev)
	elif ev is InputEventMouseMotion:
		if ev.button_mask & MOUSE_BUTTON_MASK_MIDDLE:
			_pan_screen(ev.relative)
	elif ev is InputEventMagnifyGesture:
		_zoom_by(ev.factor)
	elif ev is InputEventPanGesture:
		_pan_screen(-ev.delta * 12.0)
	elif ev is InputEventKey:
		_key(ev)


func _modal_open() -> bool:
	return build_panel.visible


func _in_blocker(p: Vector2) -> bool:
	for b in _blockers:
		if b.is_visible_in_tree() and Rect2(b.global_position, b.size).has_point(p):
			return true
	return false


func _touch_press(idx: int, pos: Vector2) -> void:
	if _modal_open() and build_panel.rect_global().has_point(pos):
		return
	for w in _touchables:
		if w.is_visible_in_tree() and w.hit(pos):
			_owner[idx] = w
			w.touch_down(idx, pos)
			get_viewport().set_input_as_handled()
			return
	if _in_blocker(pos):
		return
	var vs := root.size
	if pos.x < vs.x * 0.4 and pos.y > vs.y * 0.3 and joy.touch < 0:
		var bp := Vector2(clampf(pos.x, 110.0, vs.x * 0.4), clampf(pos.y, vs.y * 0.45, vs.y - 110.0))
		joy.begin(idx, bp)
		joy.move(pos)
		_owner[idx] = joy
		get_viewport().set_input_as_handled()
		return
	_free[idx] = {"pos": pos, "start": pos, "t": Time.get_ticks_msec() / 1000.0}
	_pinch_prev = {}
	if _free.size() >= 2:
		_pinch_begin()


func _touch_drag(idx: int, pos: Vector2) -> void:
	var w = _owner.get(idx)
	if w != null:
		if w == joy:
			joy.move(pos)
		else:
			w.touch_move(idx, pos)
		return
	if _free.has(idx):
		_free[idx].pos = pos
		if _free.size() >= 2:
			_pinch_update()


func _touch_release(idx: int, pos: Vector2) -> void:
	var w = _owner.get(idx)
	if w != null:
		_owner.erase(idx)
		if w == joy:
			joy.end()
		else:
			w.touch_up(idx, pos)
		return
	if _free.has(idx):
		var f: Dictionary = _free[idx]
		var tap: bool = _free.size() == 1 and f.start.distance_to(pos) < 18.0 and Time.get_ticks_msec() / 1000.0 - float(f.t) < 0.4 and _pan_accum < 8.0
		_free.erase(idx)
		_pinch_prev = {}
		if _free.size() == 1:
			_pinch_prev = {}
		if _free.is_empty():
			_pan_accum = 0.0
		if tap:
			_battlefield_tap(pos)


func _pinch_begin() -> void:
	var ids := _free.keys()
	var a: Vector2 = _free[ids[0]].pos
	var b: Vector2 = _free[ids[1]].pos
	_pinch_prev = {"dist": a.distance_to(b), "mid": (a + b) * 0.5}
	_pan_accum = 0.0


func _pinch_update() -> void:
	var ids := _free.keys()
	var a: Vector2 = _free[ids[0]].pos
	var b: Vector2 = _free[ids[1]].pos
	var dist := a.distance_to(b)
	var mid := (a + b) * 0.5
	if _pinch_prev.is_empty():
		_pinch_prev = {"dist": dist, "mid": mid}
		return
	if float(_pinch_prev.dist) > 8.0 and dist > 8.0:
		_zoom_by(dist / float(_pinch_prev.dist))
	var dm: Vector2 = mid - _pinch_prev.mid
	_pan_accum += dm.length()
	if _pan_accum > 28.0:
		_pan_screen(dm)
	_pinch_prev = {"dist": dist, "mid": mid}


func _zoom_by(f: float) -> void:
	var z := clampf(game.camera.zoom.x * f, ZOOM_MIN, ZOOM_MAX)
	game.camera.zoom = Vector2(z, z)


func _pan_screen(rel: Vector2) -> void:
	game.cam_locked = false
	game.camera.position -= rel / game.camera.zoom.x


func _mouse_button(ev: InputEventMouseButton) -> void:
	if not ev.pressed:
		return
	match ev.button_index:
		MOUSE_BUTTON_WHEEL_UP:
			if not (_modal_open() and build_panel.rect_global().has_point(ev.position)):
				_zoom_by(1.1)
		MOUSE_BUTTON_WHEEL_DOWN:
			if not (_modal_open() and build_panel.rect_global().has_point(ev.position)):
				_zoom_by(1.0 / 1.1)
		MOUSE_BUTTON_RIGHT:
			if ended or (_modal_open() and build_panel.rect_global().has_point(ev.position)):
				return
			if _aim_slot >= 0:
				_cancel_aim()
				return
			var wp: Vector2 = game.screen_to_world(ev.position)
			var t := _nearest_enemy(wp, 3.0)
			if not t.is_empty():
				Net.cmd({"c": "attack", "id": t.id})
			else:
				Net.cmd({"c": "move", "x": wp.x, "z": wp.y})


func _battlefield_tap(pos: Vector2) -> void:
	var wp: Vector2 = game.screen_to_world(pos)
	if _picking:
		_set_rally(wp.x)
		return
	var t := _nearest_enemy(wp, 3.2)
	if not t.is_empty():
		Net.cmd({"c": "attack", "id": t.id})
		_ping_at(Vector2(t.x, t.z) * V.PX)


func _ping_at(p: Vector2) -> void:
	var n := Node2D.new()
	n.position = p
	n.z_index = 14
	n.draw.connect(func(): n.draw_arc(Vector2.ZERO, 26.0, 0, TAU, 28, Color(1, 0.4, 0.3, 0.9), 4.0, true))
	game.add_child(n)
	var tw := n.create_tween()
	tw.set_parallel(true)
	tw.tween_property(n, "scale", Vector2(1.7, 1.7), 0.4)
	tw.tween_property(n, "modulate:a", 0.0, 0.4)
	tw.chain().tween_callback(n.queue_free)


func _cancel_aim() -> void:
	_aim_slot = -1
	_aim_key = false
	overlay.aim_on = false
	for b in ability_btns:
		b.pressed = false


func _key(ev: InputEventKey) -> void:
	var k: int = ev.keycode
	if k in [KEY_W, KEY_A, KEY_S, KEY_D, KEY_UP, KEY_DOWN, KEY_LEFT, KEY_RIGHT]:
		_keys_down[k] = ev.pressed
		return
	if ended:
		return
	var idx: int = ABILITY_KEYCAPS_KEYS.find(k)
	if idx >= 0:
		if ev.echo:
			return
		if ev.pressed:
			if me.is_empty() or not _ability_ready(idx):
				_ability_tap(idx)
				return
			_aim_slot = idx
			_aim_key = true
			_aim_key_t = Time.get_ticks_msec() / 1000.0
			_aim_show(idx, _resolve(idx, game.screen_to_world(get_viewport().get_mouse_position())))
		elif _aim_key and _aim_slot == idx:
			var held := Time.get_ticks_msec() / 1000.0 - _aim_key_t
			var s := _aim_slot
			_aim_key = false
			_aim_slot = -1
			overlay.aim_on = false
			if held < 0.18:
				_ability_tap(s)
			else:
				_cast_resolved(s, _resolve(s, game.screen_to_world(get_viewport().get_mouse_position())))
		return
	if not ev.pressed or ev.echo:
		return
	if k >= KEY_1 and k <= KEY_8:
		var uid: String = FlData.UNIT_ORDER[k - KEY_1]
		_train(uid, 5 if ev.shift_pressed else 1)
	elif k == KEY_Z:
		_set_stance("garrison")
	elif k == KEY_X:
		_set_stance("defend")
	elif k == KEY_V:
		_set_stance("attack")
	elif k == KEY_C:
		_set_rally(game.screen_to_world(get_viewport().get_mouse_position()).x)
	elif k == KEY_B:
		_toggle_build()
	elif k == KEY_SPACE:
		_relock()
	elif k == KEY_ESCAPE:
		if _aim_slot >= 0:
			_cancel_aim()
		elif _picking:
			_picking = false
		elif build_panel.visible:
			_close_build()


const ABILITY_KEYCAPS_KEYS := [KEY_Q, KEY_E, KEY_R, KEY_F]
