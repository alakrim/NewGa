class_name BuildPanel
extends Control
## Build / research panel (a regular GUI panel; the HUD ignores touches that land on it).
## Plots column on the left (your 7 plots), details on the right: building choices for an empty plot, or the
## state of a built one, plus Forge research rows.

signal closed
signal build_requested(plot: int, building: String)
signal research_requested(kind: String)
signal toast(text: String)

var color := "blue"
var _ctx: Dictionary = {}
var _sel := -1  # selected plot index (global)
var _panel: PanelContainer
var _gold_lbl: Label
var _pop_lbl: Label
var _plot_tiles: Array = []
var _rows := {}  # building id -> Row
var _res_rows := {}  # research kind -> Row
var _choose_lbl: Label
var _rows_box: VBoxContainer
var _card: Control
var _card_draw: Control
var _forge_note: Label


# ------------------------------------------------------------------ tappable custom row (building choice / research / plot tile)
class Tap extends Control:
	signal tapped
	var _down := Vector2.ZERO
	var _is_down := false
	var held := false

	func _init() -> void:
		mouse_filter = Control.MOUSE_FILTER_PASS

	func _gui_input(ev: InputEvent) -> void:
		if ev is InputEventMouseButton and ev.button_index == MOUSE_BUTTON_LEFT:
			if ev.pressed:
				_is_down = true
				held = true
				_down = ev.position
				queue_redraw()
			else:
				if _is_down and ev.position.distance_to(_down) < 14.0 and Rect2(Vector2.ZERO, size).has_point(ev.position):
					tapped.emit()
				_is_down = false
				held = false
				queue_redraw()
		elif ev is InputEventMouseMotion and _is_down and ev.position.distance_to(_down) > 14.0:
			held = false
			queue_redraw()


class PlotTile extends Tap:
	var no := 1
	var building := ""
	var progress := 1.0
	var selected := false
	var color := "blue"

	func _init() -> void:
		super._init()
		custom_minimum_size = Vector2(96, 96)
		texture_filter = CanvasItem.TEXTURE_FILTER_LINEAR

	func _draw() -> void:
		var tile := "Button_Hover_9Slides.png" if selected else ("Button_Blue_9Slides_Pressed.png" if held else "Button_Blue_9Slides.png")
		if building == "":
			tile = "Button_Hover_9Slides.png" if selected else "Button_Disable_9Slides.png"
		UiArt.sb_tile(UiArt.CC0 + "Buttons/" + tile, 26).draw(get_canvas_item(), Rect2(Vector2.ZERO, size))
		if building != "":
			var t := UiArt.building_icon(building, color)
			if t:
				var box := size.x - 26.0
				var sc := minf(box / t.get_width(), (size.y - 30.0) / t.get_height())
				var sz := Vector2(t.get_width(), t.get_height()) * sc
				draw_texture_rect(t, Rect2(Vector2((size.x - sz.x) / 2.0, size.y - 22.0 - sz.y), sz), false, Color(1, 1, 1, 0.55 if progress < 1.0 else 1.0))
		else:
			UiArt.dtext_c(self, "+", size / 2.0 + Vector2(0, -6), 40, Color(1, 1, 1, 0.55), 4)
		UiArt.dtext(self, str(no), Vector2(9, 22), 18, UiArt.CREAM, HORIZONTAL_ALIGNMENT_LEFT, -1, 4)
		if building != "" and progress < 1.0:
			draw_rect(Rect2(10, size.y - 18, size.x - 20, 8), Color(0, 0, 0, 0.7))
			draw_rect(Rect2(10, size.y - 18, (size.x - 20) * progress, 8), UiArt.GOLD)


class Row extends Tap:
	var title := ""
	var desc := ""
	var reason := ""
	var icon: Texture2D
	var cost := 0
	var sub := ""  # small line under the cost (build time / owned count)
	var can := true
	var afford := true
	var pips := 0
	var pips_max := 0
	var maxed := false
	var key := ""

	func _init() -> void:
		super._init()
		custom_minimum_size = Vector2(300, 84)
		texture_filter = CanvasItem.TEXTURE_FILTER_LINEAR

	func set_state(p_can: bool, p_reason: String, p_afford: bool) -> void:
		if p_can != can or p_reason != reason or p_afford != afford:
			can = p_can
			reason = p_reason
			afford = p_afford
			queue_redraw()

	func _draw() -> void:
		var tile := "Button_Blue_9Slides.png" if can else "Button_Disable_9Slides.png"
		if held and can:
			tile = "Button_Blue_9Slides_Pressed.png"
		UiArt.sb_tile(UiArt.CC0 + "Buttons/" + tile, 26).draw(get_canvas_item(), Rect2(Vector2.ZERO, size))
		var off := 2.0 if held and can else 0.0
		var x := 16.0
		if icon:
			var sc := minf(56.0 / icon.get_width(), 58.0 / icon.get_height())
			var sz := Vector2(icon.get_width(), icon.get_height()) * sc
			draw_texture_rect(icon, Rect2(Vector2(x + (58.0 - sz.x) / 2.0, 10.0 + (58.0 - sz.y) / 2.0 + off), sz), false, Color.WHITE if can else Color(0.8, 0.8, 0.8, 0.7))
		x += 70.0
		UiArt.dtext(self, title, Vector2(x, 31 + off), 23, UiArt.CREAM if can else Color(0.82, 0.76, 0.66), HORIZONTAL_ALIGNMENT_LEFT, size.x - x - 120, 4)
		var line2 := reason if reason != "" else desc
		var col2 := Color("ffb089") if reason != "" else Color("d9ecff")
		if not can:
			col2 = Color("ff9f80") if reason != "" else Color(0.75, 0.7, 0.62)
		UiArt.dtext(self, line2, Vector2(x, 56 + off), 16, col2, HORIZONTAL_ALIGNMENT_LEFT, size.x - x - 112, 3)
		if pips_max > 0:
			for i in range(pips_max):
				var pc := Vector2(x + 6 + i * 16, 68 + off)
				draw_circle(pc, 5.5, UiArt.OUTLINE)
				draw_circle(pc, 4.0, UiArt.GOLD if i < pips else Color(0.3, 0.26, 0.22))
		if maxed:
			UiArt.dtext(self, "MAX", Vector2(size.x - 100, 46 + off), 24, UiArt.GOOD, HORIZONTAL_ALIGNMENT_RIGHT, 84, 4)
		elif cost > 0:
			var cs := str(cost)
			var tw := UiArt.font().get_string_size(cs, HORIZONTAL_ALIGNMENT_LEFT, -1, 24).x
			var cx := size.x - 16.0 - tw
			UiArt.dtext(self, cs, Vector2(cx, 38 + off), 24, UiArt.GOLD if afford else UiArt.BAD, HORIZONTAL_ALIGNMENT_LEFT, -1, 4)
			draw_texture_rect(UiArt.coin(), Rect2(cx - 28, 16 + off, 26, 26), false)
			if sub != "":
				UiArt.dtext(self, sub, Vector2(size.x - 116, 62 + off), 15, Color(0.9, 0.9, 0.95, 0.9), HORIZONTAL_ALIGNMENT_RIGHT, 100, 3)


class Card extends Control:
	var info: Dictionary = {}

	func _init() -> void:
		mouse_filter = Control.MOUSE_FILTER_IGNORE
		custom_minimum_size = Vector2(300, 160)
		texture_filter = CanvasItem.TEXTURE_FILTER_LINEAR

	func _draw() -> void:
		if info.is_empty():
			return
		UiArt.sb_tile(UiArt.CC0 + "Banners/Carved_9Slides.png", 30).draw(get_canvas_item(), Rect2(Vector2.ZERO, size))
		var t: Texture2D = info.get("icon")
		if t:
			var sc := minf(110.0 / t.get_width(), 120.0 / t.get_height())
			var sz := Vector2(t.get_width(), t.get_height()) * sc
			draw_texture_rect(t, Rect2(Vector2(26 + (110 - sz.x) / 2.0, 20 + (120 - sz.y)), sz), false)
		var x := 160.0
		UiArt.dtext(self, info.title, Vector2(x, 44), 30, UiArt.INK, HORIZONTAL_ALIGNMENT_LEFT, size.x - x - 16, 0)
		UiArt.dtext(self, info.desc, Vector2(x, 72), 18, UiArt.INK_SOFT, HORIZONTAL_ALIGNMENT_LEFT, size.x - x - 16, 0)
		if info.progress < 1.0:
			UiArt.dtext(self, "Under construction  %d%%" % int(info.progress * 100.0), Vector2(x, 106), 19, UiArt.INK, HORIZONTAL_ALIGNMENT_LEFT, -1, 0)
			draw_rect(Rect2(x, 116, size.x - x - 24, 14), UiArt.INK)
			draw_rect(Rect2(x + 2, 118, (size.x - x - 28) * info.progress, 10), UiArt.GOLD)
		else:
			UiArt.dtext(self, "Ready", Vector2(x, 106), 22, Color("2f7d3a"), HORIZONTAL_ALIGNMENT_LEFT, -1, 0)
			UiArt.dtext(self, "Health  %d / %d" % [int(info.hp), int(info.max_hp)], Vector2(x, 134), 16, UiArt.INK_SOFT, HORIZONTAL_ALIGNMENT_LEFT, -1, 0)


# ------------------------------------------------------------------ construction
func _ready() -> void:
	mouse_filter = Control.MOUSE_FILTER_IGNORE
	set_anchors_preset(Control.PRESET_FULL_RECT)
	_panel = PanelContainer.new()
	_panel.theme_type_variation = ""
	add_child(_panel)
	_panel.set_anchors_preset(Control.PRESET_CENTER)
	_panel.custom_minimum_size = Vector2(880, 560)
	_panel.grow_horizontal = Control.GROW_DIRECTION_BOTH
	_panel.grow_vertical = Control.GROW_DIRECTION_BOTH
	var v := VBoxContainer.new()
	v.add_theme_constant_override("separation", 8)
	_panel.add_child(v)
	# header
	var head := HBoxContainer.new()
	head.add_theme_constant_override("separation", 14)
	v.add_child(head)
	var title := UiArt.label("BUILD", 38, UiArt.INK, 0)
	head.add_child(title)
	var coin := UiArt.tex_rect(UiArt.coin(), Vector2(34, 34))
	head.add_child(coin)
	_gold_lbl = UiArt.label("0", 30, Color("8a5a00"), 0)
	head.add_child(_gold_lbl)
	_pop_lbl = UiArt.label("", 24, UiArt.INK_SOFT, 0)
	head.add_child(_pop_lbl)
	var sp := Control.new()
	sp.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	head.add_child(sp)
	var close := Button.new()
	close.text = "X"
	close.theme_type_variation = "ButtonRed"
	close.custom_minimum_size = Vector2(72, 64)
	close.pressed.connect(func(): closed.emit())
	head.add_child(close)
	# body
	var body := HBoxContainer.new()
	body.size_flags_vertical = Control.SIZE_EXPAND_FILL
	body.add_theme_constant_override("separation", 18)
	v.add_child(body)
	var left := VBoxContainer.new()
	left.add_theme_constant_override("separation", 6)
	body.add_child(left)
	left.add_child(UiArt.label("Your plots", 22, UiArt.INK_SOFT, 0))
	var grid := GridContainer.new()
	grid.columns = 2
	grid.add_theme_constant_override("h_separation", 8)
	grid.add_theme_constant_override("v_separation", 8)
	left.add_child(grid)
	for i in range(7):
		var tile := PlotTile.new()
		tile.no = i + 1
		tile.tapped.connect(_on_plot_tapped.bind(i))
		grid.add_child(tile)
		_plot_tiles.append(tile)
	var scroll := ScrollContainer.new()
	scroll.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	scroll.size_flags_vertical = Control.SIZE_EXPAND_FILL
	scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	body.add_child(scroll)
	var rv := VBoxContainer.new()
	rv.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	rv.add_theme_constant_override("separation", 8)
	scroll.add_child(rv)
	_choose_lbl = UiArt.label("", 24, UiArt.INK, 0)
	rv.add_child(_choose_lbl)
	_card = Card.new()
	_card_draw = _card
	rv.add_child(_card)
	_rows_box = VBoxContainer.new()
	_rows_box.add_theme_constant_override("separation", 8)
	rv.add_child(_rows_box)
	for id in FlData.BUILDING_ORDER:
		var d: Dictionary = FlData.BUILDINGS[id]
		var row := Row.new()
		row.title = d.name
		row.desc = d.description
		row.cost = d.cost
		row.sub = "%ds" % d.build_time
		row.key = id
		row.tapped.connect(_on_building_tapped.bind(id))
		_rows_box.add_child(row)
		_rows[id] = row
	var hr := UiArt.label("Forge research", 26, UiArt.INK, 0)
	rv.add_child(hr)
	_forge_note = UiArt.label("Build and finish a Forge to research upgrades.", 18, UiArt.INK_SOFT, 0)
	rv.add_child(_forge_note)
	for k in FlData.RESEARCH:
		var r: Dictionary = FlData.RESEARCH[k]
		var row2 := Row.new()
		row2.title = r.name
		row2.desc = r.text
		row2.key = k
		row2.icon = UiArt.icon("weapons" if k == "weapons" else "armor")
		row2.pips_max = r.costs.size()
		row2.tapped.connect(_on_research_tapped.bind(k))
		rv.add_child(row2)
		_res_rows[k] = row2
	visible = false


func _on_plot_tapped(i: int) -> void:
	var plots: Array = _ctx.get("plots", [])
	if i < plots.size():
		_sel = int(plots[i].index)
		_apply(_ctx)


func _on_building_tapped(id: String) -> void:
	var why := _build_block(id)
	if why != "":
		toast.emit(why)
		return
	var cur := _cur_plot()
	if cur.is_empty():
		return
	build_requested.emit(int(cur.index), id)
	_sel = -1  # jump to the next empty plot


func _on_research_tapped(k: String) -> void:
	var why := _research_block(k)
	if why != "":
		toast.emit(why)
		return
	research_requested.emit(k)


func rect_global() -> Rect2:
	return Rect2(_panel.global_position, _panel.size)


# ------------------------------------------------------------------ state
func update(ctx: Dictionary) -> void:
	_ctx = ctx
	if visible:
		_apply(ctx)


func open(ctx: Dictionary) -> void:
	_ctx = ctx
	visible = true
	_sel = -1
	_apply(ctx)


func close() -> void:
	visible = false


func _cur_plot() -> Dictionary:
	var plots: Array = _ctx.get("plots", [])
	for p in plots:
		if int(p.index) == _sel:
			return p
	for p in plots:
		if p.building == "":
			return p
	return plots[0] if not plots.is_empty() else {}


func _built(id: String) -> Dictionary:
	return _ctx.get("built", {}).get(id, {"done": 0, "total": 0})


func _build_block(id: String) -> String:
	var d: Dictionary = FlData.BUILDINGS[id]
	var cur := _cur_plot()
	if cur.is_empty():
		return "No plot available"
	if cur.building != "":
		return "This plot is already in use"
	var have: int = _built(id).total
	if d.max > 0 and have >= d.max:
		return "%s: limit reached (%d/%d)" % [d.name, have, d.max]
	if d.requires != "" and int(_built(d.requires).done) == 0:
		return "Needs a finished %s" % FlData.BUILDINGS[d.requires].name
	var gold: int = _ctx.get("gold", 0)
	if gold < d.cost:
		return "Need %d more gold" % (d.cost - gold)
	return ""


func _research_block(k: String) -> String:
	var r: Dictionary = FlData.RESEARCH[k]
	var lvl: int = _ctx.get("research", {}).get(k, 0)
	if int(_built("forge").done) == 0:
		return "Needs a finished Forge"
	if lvl >= r.costs.size():
		return "Already at maximum level"
	var gold: int = _ctx.get("gold", 0)
	if gold < r.costs[lvl]:
		return "Need %d more gold" % (r.costs[lvl] - gold)
	return ""


func _apply(ctx: Dictionary) -> void:
	color = ctx.get("color", "blue")
	_gold_lbl.text = str(ctx.get("gold", 0))
	_pop_lbl.text = "Population %d/%d" % [ctx.get("pop", 0), ctx.get("pop_cap", 0)]
	var plots: Array = ctx.get("plots", [])
	var cur := _cur_plot()
	for i in range(_plot_tiles.size()):
		var t: PlotTile = _plot_tiles[i]
		if i < plots.size():
			var p: Dictionary = plots[i]
			t.visible = true
			var ch: bool = t.building != p.building or absf(t.progress - float(p.progress)) > 0.004 or t.selected != (not cur.is_empty() and int(cur.index) == int(p.index)) or t.color != color
			t.building = p.building
			t.progress = p.progress
			t.color = color
			t.selected = not cur.is_empty() and int(cur.index) == int(p.index)
			if ch:
				t.queue_redraw()
		else:
			t.visible = false
	var empty := not cur.is_empty() and cur.building == ""
	_rows_box.visible = empty
	_card.visible = not empty and not cur.is_empty()
	if empty:
		_choose_lbl.text = "Plot %d: choose a building" % (plots.find(cur) + 1)
		for id in FlData.BUILDING_ORDER:
			var d: Dictionary = FlData.BUILDINGS[id]
			var row: Row = _rows[id]
			var why := _build_block(id)
			var have: int = _built(id).total
			row.icon = UiArt.building_icon(id, color)
			var afford: bool = int(ctx.get("gold", 0)) >= int(d.cost)
			row.sub = "%ds%s" % [d.build_time, ("  %d/%d" % [have, d.max]) if d.max > 0 else ""]
			row.set_state(why == "", why, afford)
			row.queue_redraw()
	elif not cur.is_empty():
		var d2: Dictionary = FlData.BUILDINGS[cur.building]
		_choose_lbl.text = "Plot %d: %s" % [plots.find(cur) + 1, d2.name]
		var card: Card = _card as Card
		card.info = {"icon": UiArt.building_icon(cur.building, color), "title": d2.name, "desc": d2.description, "progress": cur.progress, "hp": cur.hp, "max_hp": cur.max_hp}
		card.queue_redraw()
	var forge_done: bool = int(_built("forge").done) > 0
	_forge_note.visible = not forge_done
	for k in FlData.RESEARCH:
		var r: Dictionary = FlData.RESEARCH[k]
		var row2: Row = _res_rows[k]
		var lvl: int = ctx.get("research", {}).get(k, 0)
		row2.pips = lvl
		row2.maxed = lvl >= r.costs.size()
		row2.cost = r.costs[lvl] if lvl < r.costs.size() else 0
		var why2 := _research_block(k)
		row2.set_state(why2 == "", why2 if forge_done else "", int(ctx.get("gold", 0)) >= row2.cost)
		row2.queue_redraw()
