class_name HeroBrowser
extends Control
## Role filter + grid of the 20 heroes + a detail panel with stats and abilities.
## instant = true (lobby): tapping a tile picks the hero.  instant = false (gallery): a "Choose hero" button confirms.

signal hero_picked(hero_id: String)

var instant := false
var current := ""  # the hero you play
var locked := {}  # hero id -> player colour of the teammate who took it
var _filter := "All"
var _preview := ""
var _grid: GridContainer
var _detail: VBoxContainer
var _filter_btns := {}
var _tiles := {}
var _pick_btn: Button
var _detail_scroll: ScrollContainer


class HeroTile extends Control:
	signal tapped
	var hero: Dictionary
	var selected := false  # previewed
	var current := false  # equipped
	var taken := ""  # teammate colour
	var held := false
	var _down := Vector2.ZERO
	var _is_down := false

	func _init() -> void:
		custom_minimum_size = Vector2(104, 124)
		mouse_filter = Control.MOUSE_FILTER_PASS
		texture_filter = CanvasItem.TEXTURE_FILTER_NEAREST

	func _gui_input(ev: InputEvent) -> void:
		if ev is InputEventMouseButton and ev.button_index == MOUSE_BUTTON_LEFT:
			if ev.pressed:
				_is_down = true
				held = true
				_down = ev.position
				queue_redraw()
			else:
				if _is_down and ev.position.distance_to(_down) < 14.0:
					tapped.emit()
				_is_down = false
				held = false
				queue_redraw()
		elif ev is InputEventMouseMotion and _is_down and ev.position.distance_to(_down) > 14.0:
			held = false
			queue_redraw()

	func _draw() -> void:
		var tile := "Button_Blue_9Slides.png"
		if taken != "":
			tile = "Button_Disable_9Slides.png"
		elif held:
			tile = "Button_Blue_9Slides_Pressed.png"
		elif selected or current:
			tile = "Button_Hover_9Slides.png"
		UiArt.sb_tile(UiArt.CC0 + "Buttons/" + tile, 26).draw(get_canvas_item(), Rect2(Vector2.ZERO, size))
		var t := UiArt.gallery_portrait(hero.id)
		var off := 2.0 if held else 0.0
		if t:
			draw_texture_rect(t, Rect2(Vector2(size.x / 2.0 - 36, 8 + off), Vector2(72, 72)), false, Color(0.6, 0.6, 0.6, 0.8) if taken != "" else Color.WHITE)
		UiArt.dtext(self, hero.name, Vector2(0, 100 + off), 19, Color.WHITE, HORIZONTAL_ALIGNMENT_CENTER, size.x, 4)
		var rc: Color = UiArt.ROLE_COL.get(hero.role, Color.WHITE)
		draw_rect(Rect2(size.x / 2.0 - 26, size.y - 18 + off, 52, 5), rc)
		if current:
			draw_circle(Vector2(size.x - 14, 16), 11, UiArt.OUTLINE)
			draw_circle(Vector2(size.x - 14, 16), 8.5, UiArt.GOOD)
			UiArt.dtext_c(self, "v", Vector2(size.x - 14, 15), 14, UiArt.OUTLINE, 0)
		if taken != "":
			var tc: Color = UiArt.PLAYER_COL.get(taken, Color.WHITE)
			draw_rect(Rect2(8, 8, 8, 8), tc)
			UiArt.dtext(self, "taken", Vector2(0, 62), 15, Color("ffd9a0"), HORIZONTAL_ALIGNMENT_CENTER, size.x, 4)


func _ready() -> void:
	set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	var h := HBoxContainer.new()
	h.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	h.add_theme_constant_override("separation", 14)
	add_child(h)
	# left: filters + grid
	var left := VBoxContainer.new()
	left.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	left.add_theme_constant_override("separation", 8)
	h.add_child(left)
	var fr := HFlowContainer.new()
	fr.add_theme_constant_override("h_separation", 6)
	fr.add_theme_constant_override("v_separation", 4)
	left.add_child(fr)
	for r in ["All"] + HeroesData.ROLES:
		var b := Button.new()
		b.text = r
		b.theme_type_variation = "ButtonSmall"
		b.toggle_mode = true
		b.custom_minimum_size = Vector2(0, 52)
		b.pressed.connect(_set_filter.bind(r))
		fr.add_child(b)
		_filter_btns[r] = b
	var sc := ScrollContainer.new()
	sc.size_flags_vertical = Control.SIZE_EXPAND_FILL
	sc.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	left.add_child(sc)
	_grid = GridContainer.new()
	_grid.columns = 4
	_grid.add_theme_constant_override("h_separation", 6)
	_grid.add_theme_constant_override("v_separation", 6)
	_grid.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	sc.add_child(_grid)
	for hd in HeroesData.HEROES:
		var t := HeroTile.new()
		t.hero = hd
		t.tapped.connect(_on_tile.bind(hd.id))
		_grid.add_child(t)
		_tiles[hd.id] = t
	# right: details
	var panel := PanelContainer.new()
	panel.theme_type_variation = "PanelDark"
	panel.custom_minimum_size = Vector2(400, 0)
	panel.size_flags_vertical = Control.SIZE_EXPAND_FILL
	h.add_child(panel)
	var pv := VBoxContainer.new()
	pv.add_theme_constant_override("separation", 8)
	panel.add_child(pv)
	_detail_scroll = ScrollContainer.new()
	_detail_scroll.size_flags_vertical = Control.SIZE_EXPAND_FILL
	_detail_scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	pv.add_child(_detail_scroll)
	_detail = VBoxContainer.new()
	_detail.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_detail.add_theme_constant_override("separation", 8)
	_detail_scroll.add_child(_detail)
	_pick_btn = Button.new()
	_pick_btn.text = "Choose this hero"
	_pick_btn.custom_minimum_size = Vector2(0, 66)
	_pick_btn.pressed.connect(func(): if _preview != "": hero_picked.emit(_preview))
	pv.add_child(_pick_btn)
	_pick_btn.visible = not instant
	_filter_btns["All"].button_pressed = true
	if _preview == "":
		_preview = current if current != "" else HeroesData.HEROES[0].id
	_refresh()


func set_state(p_current: String, p_locked: Dictionary) -> void:
	current = p_current
	locked = p_locked
	if _preview == "":
		_preview = current
	if is_inside_tree() and _grid:
		_refresh()


func _set_filter(r: String) -> void:
	_filter = r
	for k in _filter_btns:
		_filter_btns[k].button_pressed = k == r
	_refresh()


func _on_tile(id: String) -> void:
	_preview = id
	if instant and not locked.has(id):
		hero_picked.emit(id)
	_refresh()


func _refresh() -> void:
	for id in _tiles:
		var t: HeroTile = _tiles[id]
		t.visible = _filter == "All" or t.hero.role == _filter
		t.selected = id == _preview
		t.current = id == current
		t.taken = locked.get(id, "")
		t.queue_redraw()
	_build_detail()
	if _pick_btn:
		_pick_btn.disabled = _preview == current
		_pick_btn.text = "Your hero" if _preview == current else "Choose this hero"


func _tag(text: String, col: Color) -> Control:
	var p := PanelContainer.new()
	p.add_theme_stylebox_override("panel", UiArt.sb_flat(Color(col.r, col.g, col.b, 0.9), 8))
	var l := UiArt.label(text, 18, Color("1d1410"), 0)
	p.add_child(l)
	return p


func _build_detail() -> void:
	for c in _detail.get_children():
		c.queue_free()
	var hd := HeroesData.by_id(_preview)
	if hd.is_empty():
		return
	var head := HBoxContainer.new()
	head.add_theme_constant_override("separation", 12)
	_detail.add_child(head)
	head.add_child(UiArt.tex_rect(UiArt.gallery_portrait(hd.id), Vector2(84, 84)))
	var hv := VBoxContainer.new()
	hv.add_theme_constant_override("separation", 0)
	hv.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	head.add_child(hv)
	hv.add_child(UiArt.label(hd.name, 36, UiArt.GOLD, 6))
	var tl := UiArt.label(hd.title, 18, UiArt.CREAM, 3)
	tl.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	tl.custom_minimum_size = Vector2(240, 0)
	hv.add_child(tl)
	var tags := HBoxContainer.new()
	tags.add_theme_constant_override("separation", 6)
	hv.add_child(tags)
	tags.add_child(_tag(hd.role, UiArt.ROLE_COL.get(hd.role, Color.WHITE)))
	tags.add_child(_tag("Melee" if hd.melee else "Ranged", Color("e8d9b5")))
	tags.add_child(_tag("*".repeat(int(hd.difficulty)), Color("e8d9b5")))
	var st: Dictionary = hd.stats
	var stats := UiArt.label("HP %d   ATK %d   ARM %d   RNG %s   SPD %s" % [int(st.hp), int(st.damage), int(st.armor), str(st.range), str(st.speed)], 17, Color("d9ecff"), 3)
	stats.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	_detail.add_child(stats)
	var q := UiArt.label("\"%s\"" % hd.quote, 16, Color("e8d9b5"), 2)
	q.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	_detail.add_child(q)
	# passive
	_detail.add_child(_ability_card("P", hd.passive.name, "Passive", hd.passive.description, false))
	for i in range(4):
		var a: Dictionary = hd.abilities[i]
		var tgt := _targeting_text(a)
		var cd: Array = a.cooldown
		var tag := "%s   CD %s   Mana %s" % [tgt, _range_text(cd), _range_text(a.mana)]
		_detail.add_child(_ability_card(HeroesData.SLOT_KEYS[i], a.name, tag, a.description, i == 3))


func _range_text(a: Array) -> String:
	if a.is_empty():
		return "-"
	if a[0] == a[a.size() - 1]:
		return str(int(a[0]))
	return "%d-%d" % [int(a[0]), int(a[a.size() - 1])]


func _targeting_text(a: Dictionary) -> String:
	match a.targeting:
		"self":
			return "Self"
		"direction":
			return "Skillshot %s" % str(a.range)
		"point":
			return "Ground %s" % str(a.range)
		"enemy":
			return "Enemy %s" % str(a.range)
		"ally":
			return "Ally %s" % str(a.range)
	return "Any %s" % str(a.range)


class Badge extends Control:
	var letter := "Q"
	var red := false

	func _init() -> void:
		custom_minimum_size = Vector2(52, 52)
		texture_filter = CanvasItem.TEXTURE_FILTER_LINEAR

	func _draw() -> void:
		UiArt.draw_round(self, size / 2.0, 48.0, red, false)
		UiArt.dtext_c(self, letter, size / 2.0 + Vector2(0, -2), 26, Color.WHITE, 5)


func _ability_card(letter: String, title: String, tag: String, desc: String, ult: bool) -> Control:
	var p := PanelContainer.new()
	p.add_theme_stylebox_override("panel", UiArt.sb_flat(Color(0.05, 0.04, 0.08, 0.45), 10, Color(1, 0.85, 0.5, 0.2), 2))
	var h := HBoxContainer.new()
	h.add_theme_constant_override("separation", 10)
	p.add_child(h)
	var b := Badge.new()
	b.letter = letter
	b.red = ult
	h.add_child(b)
	var v := VBoxContainer.new()
	v.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	v.add_theme_constant_override("separation", 0)
	h.add_child(v)
	v.add_child(UiArt.label(title, 22, UiArt.GOLD, 4))
	var tg := UiArt.label(tag, 15, Color("9fd0ff"), 2)
	v.add_child(tg)
	var d := UiArt.label(desc, 16, UiArt.CREAM, 2)
	d.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	d.custom_minimum_size = Vector2(240, 0)
	v.add_child(d)
	return p
