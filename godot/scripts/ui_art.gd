class_name UiArt
extends RefCounted
## Tiny Swords UI art helpers: stitches the gapped 3x3 sheets of the Free Pack into 9-slice textures, builds the project
## Theme (pixel font + Tiny Swords buttons/panels) and resolves unit / building / hero / stance icons.

const FREE := "res://assets/tinyswords_free/UI Elements/UI Elements/"
const CC0 := "res://assets/tinyswords/UI/"
const ICONS := "res://assets/icons/"
const FONT_PATH := "res://assets/fonts/PixelifySans.ttf"
const V = preload("res://scripts/visuals.gd")

# palette
const INK := Color("3a2616")  # text on parchment
const INK_SOFT := Color("6b4f33")
const CREAM := Color("fff1cf")
const GOLD := Color("ffd34d")
const GOLD_DARK := Color("b8841a")
const OUTLINE := Color("1d1410")
const GOOD := Color("7be08a")
const BAD := Color("ff7a6b")
const MUTED := Color("c9b99a")
const WOOD := Color("5c3b24")
const MANA := Color("5aa9ff")
const PLAYER_COL := {"blue": Color("3d8bfd"), "purple": Color("9b5de5"), "red": Color("e5484d"), "yellow": Color("e8b923"), "black": Color("8a8f9c")}
const COLOR_AVATAR_BASE := {"blue": 1, "red": 6, "yellow": 11, "purple": 16, "black": 21}
const ROLE_COL := {
	"Tank": Color("5aa0ff"), "Fighter": Color("e8a23d"), "Assassin": Color("b06be6"),
	"Mage": Color("ff6b5a"), "Marksman": Color("7be08a"), "Support": Color("5fe0d0"),
}
## Which of a colour's five avatars (knight, 2 helmets, 2 faces) suits each role.
const ROLE_AVATAR := {"Tank": 0, "Fighter": 1, "Assassin": 4, "Mage": 3, "Marksman": 2, "Support": 3}

static var _tex := {}
static var _font: Font
static var _theme: Theme
static var _stitched := {}
static var _crop := {}


static func load_tex(path: String) -> Texture2D:
	if _tex.has(path):
		return _tex[path]
	var t: Texture2D = null
	if ResourceLoader.exists(path):
		t = load(path)
	else:
		push_warning("UiArt: missing texture " + path)
	_tex[path] = t
	return t


static func font() -> Font:
	if _font == null:
		_font = load(FONT_PATH)
	return _font


# ------------------------------------------------------------------ stitching gapped sheets
## Cuts the three column runs x three row runs out of a Free Pack sheet and glues them into one tight image.
## cols/rows: [[a0,a1],[b0,b1],[c0,c1]] inclusive pixel ranges. Returns {tex, l, t, r, b} (9-slice margins).
static func stitch(path: String, cols: Array, rows: Array, band_y := 0) -> Dictionary:
	var key := "%s|%s|%s|%d" % [path, cols, rows, band_y]
	if _stitched.has(key):
		return _stitched[key]
	var src := load_tex(path)
	var out := {"tex": null, "l": 0, "t": 0, "r": 0, "b": 0}
	if src == null:
		return out
	var img := src.get_image()
	if img.is_compressed():
		img.decompress()
	img.convert(Image.FORMAT_RGBA8)
	var cw: Array[int] = []
	var rh: Array[int] = []
	for c in cols:
		cw.append(int(c[1]) - int(c[0]) + 1)
	for r in rows:
		rh.append(int(r[1]) - int(r[0]) + 1)
	var w := 0
	for v in cw:
		w += v
	var h := 0
	for v in rh:
		h += v
	var dst := Image.create(w, h, false, Image.FORMAT_RGBA8)
	var y := 0
	for ri in range(rows.size()):
		var x := 0
		for ci in range(cols.size()):
			dst.blit_rect(img, Rect2i(int(cols[ci][0]), band_y + int(rows[ri][0]), cw[ci], rh[ri]), Vector2i(x, y))
			x += cw[ci]
		y += rh[ri]
	out.tex = ImageTexture.create_from_image(dst)
	out.l = cw[0]
	out.r = cw[cw.size() - 1]
	out.t = rh[0] if rh.size() > 1 else 0
	out.b = rh[rh.size() - 1] if rh.size() > 1 else 0
	_stitched[key] = out
	return out


static func parchment() -> Dictionary:
	return stitch(FREE + "Banners/Banner.png", [[28, 127], [192, 255], [320, 403]], [[60, 127], [192, 255], [320, 430]])


static func paper() -> Dictionary:
	return stitch(FREE + "Papers/RegularPaper.png", [[12, 63], [128, 191], [256, 307]], [[20, 63], [128, 191], [256, 300]])


static func paper_dark() -> Dictionary:
	return stitch(FREE + "Papers/SpecialPaper.png", [[9, 63], [128, 191], [256, 310]], [[20, 63], [128, 191], [256, 298]])


static func wood_table() -> Dictionary:
	return stitch(FREE + "Wood Table/WoodTable.png", [[44, 127], [192, 255], [320, 403]], [[43, 127], [192, 255], [320, 422]])


static func big_button(red := false, pressed := false) -> Dictionary:
	var n := "Big%sButton_%s.png" % ["Red" if red else "Blue", "Pressed" if pressed else "Regular"]
	if pressed:
		return stitch(FREE + "Buttons/" + n, [[14, 63], [128, 191], [256, 305]], [[28, 63], [128, 191], [256, 304]])
	return stitch(FREE + "Buttons/" + n, [[19, 63], [128, 191], [256, 300]], [[17, 63], [128, 191], [256, 302]])


## Horizontal 3-slice ribbon (colour index: 0 blue, 1 red, 2 yellow, 3 purple, 4 black).
static func ribbon(ci: int) -> Dictionary:
	return stitch(FREE + "Ribbons/BigRibbons.png", [[30, 127], [192, 255], [320, 416]], [[20, 122]], ci * 128)


static func bar_base_big() -> Dictionary:
	return stitch(FREE + "Bars/BigBar_Base.png", [[40, 63], [128, 191], [256, 279]], [[9, 59]])


# ------------------------------------------------------------------ styleboxes
static func sb(d: Dictionary, content := Vector4(8, 6, 8, 6), extra_bottom := 0.0) -> StyleBoxTexture:
	var s := StyleBoxTexture.new()
	s.texture = d.tex
	s.texture_margin_left = d.l
	s.texture_margin_right = d.r
	s.texture_margin_top = d.t
	s.texture_margin_bottom = d.b
	s.content_margin_left = content.x
	s.content_margin_top = content.y
	s.content_margin_right = content.z
	s.content_margin_bottom = content.w + extra_bottom
	return s


## 9-slice from a plain 192x192 CC0 tile sheet (margins = corner size).
static func sb_tile(path: String, m := 40.0, content := Vector4(14, 10, 14, 14)) -> StyleBoxTexture:
	var s := StyleBoxTexture.new()
	s.texture = load_tex(path)
	s.texture_margin_left = m
	s.texture_margin_right = m
	s.texture_margin_top = m
	s.texture_margin_bottom = m
	s.content_margin_left = content.x
	s.content_margin_top = content.y
	s.content_margin_right = content.z
	s.content_margin_bottom = content.w
	return s


static func sb_flat(col: Color, radius := 10, border := Color(0, 0, 0, 0), bw := 0) -> StyleBoxFlat:
	var s := StyleBoxFlat.new()
	s.bg_color = col
	s.set_corner_radius_all(radius)
	s.border_color = border
	s.set_border_width_all(bw)
	s.content_margin_left = 10
	s.content_margin_right = 10
	s.content_margin_top = 6
	s.content_margin_bottom = 6
	return s


static func _btn_styles(theme: Theme, type: String, base: String, red := false) -> void:
	var n := "Red" if red else "Blue"
	theme.set_stylebox("normal", type, sb_tile(CC0 + "Buttons/Button_%s_9Slides.png" % n, 36, Vector4(18, 10, 18, 22)))
	theme.set_stylebox("hover", type, sb_tile(CC0 + "Buttons/Button_Hover_9Slides.png", 36, Vector4(18, 10, 18, 22)))
	theme.set_stylebox("pressed", type, sb_tile(CC0 + "Buttons/Button_%s_9Slides_Pressed.png" % n, 36, Vector4(18, 16, 18, 16)))
	theme.set_stylebox("disabled", type, sb_tile(CC0 + "Buttons/Button_Disable_9Slides.png", 36, Vector4(18, 10, 18, 22)))
	theme.set_stylebox("focus", type, StyleBoxEmpty.new())
	for st in ["font_color", "font_hover_color", "font_pressed_color", "font_focus_color", "font_hover_pressed_color"]:
		theme.set_color(st, type, CREAM if st != "font_hover_color" else Color.WHITE)
	theme.set_color("font_disabled_color", type, Color("a89a82"))
	theme.set_color("font_outline_color", type, OUTLINE)
	theme.set_constant("outline_size", type, 5)
	theme.set_font_size("font_size", type, 26)
	if base != "":
		theme.set_type_variation(type, base)


static func make_theme() -> Theme:
	if _theme:
		return _theme
	var t := Theme.new()
	t.default_font = font()
	t.default_font_size = 24
	# labels
	t.set_color("font_color", "Label", CREAM)
	t.set_color("font_outline_color", "Label", OUTLINE)
	t.set_constant("outline_size", "Label", 4)
	t.add_type("LabelInk")
	t.set_type_variation("LabelInk", "Label")
	t.set_color("font_color", "LabelInk", INK)
	t.set_constant("outline_size", "LabelInk", 0)
	t.add_type("LabelTitle")
	t.set_type_variation("LabelTitle", "Label")
	t.set_color("font_color", "LabelTitle", GOLD)
	t.set_constant("outline_size", "LabelTitle", 8)
	t.set_font_size("font_size", "LabelTitle", 40)
	# buttons
	_btn_styles(t, "Button", "")
	t.add_type("ButtonRed")
	_btn_styles(t, "ButtonRed", "Button", true)
	t.add_type("ButtonSmall")
	_btn_styles(t, "ButtonSmall", "Button")
	t.set_font_size("font_size", "ButtonSmall", 20)
	for sn in ["normal", "hover", "pressed", "disabled"]:
		var s: StyleBoxTexture = t.get_stylebox(sn, "ButtonSmall").duplicate()
		s.texture_margin_left = 30
		s.texture_margin_right = 30
		s.texture_margin_top = 30
		s.texture_margin_bottom = 30
		s.content_margin_left = 12
		s.content_margin_right = 12
		s.content_margin_top = 6
		s.content_margin_bottom = 16 if sn != "pressed" else 10
		t.set_stylebox(sn, "ButtonSmall", s)
	# panels
	t.set_stylebox("panel", "PanelContainer", sb(parchment(), Vector4(36, 30, 36, 40)))
	t.add_type("PanelWood")
	t.set_type_variation("PanelWood", "PanelContainer")
	t.set_stylebox("panel", "PanelWood", sb(wood_table(), Vector4(28, 24, 28, 30)))
	t.add_type("PanelDark")
	t.set_type_variation("PanelDark", "PanelContainer")
	t.set_stylebox("panel", "PanelDark", sb(paper_dark(), Vector4(26, 22, 26, 26)))
	t.add_type("PanelPaper")
	t.set_type_variation("PanelPaper", "PanelContainer")
	t.set_stylebox("panel", "PanelPaper", sb(paper(), Vector4(26, 22, 26, 26)))
	t.add_type("PanelSoft")
	t.set_type_variation("PanelSoft", "PanelContainer")
	t.set_stylebox("panel", "PanelSoft", sb_flat(Color(0.1, 0.07, 0.04, 0.62), 12, Color(1, 0.85, 0.5, 0.35), 2))
	# line edit
	var le := sb_flat(Color("fff7e0"), 8, Color("6b4f33"), 3)
	le.content_margin_left = 14
	le.content_margin_right = 14
	t.set_stylebox("normal", "LineEdit", le)
	var lef := le.duplicate()
	lef.border_color = Color("e8a23d")
	t.set_stylebox("focus", "LineEdit", lef)
	t.set_stylebox("read_only", "LineEdit", le)
	t.set_color("font_color", "LineEdit", INK)
	t.set_color("font_placeholder_color", "LineEdit", Color("a08a6a"))
	t.set_color("caret_color", "LineEdit", INK)
	t.set_color("selection_color", "LineEdit", Color("e8a23d88"))
	t.set_font_size("font_size", "LineEdit", 28)
	# scroll bars (slim wood handle)
	var gr := sb_flat(Color(0, 0, 0, 0.25), 6)
	gr.content_margin_left = 4
	gr.content_margin_right = 4
	t.set_stylebox("scroll", "VScrollBar", gr)
	t.set_stylebox("grabber", "VScrollBar", sb_flat(Color("c79a52"), 6))
	t.set_stylebox("grabber_highlight", "VScrollBar", sb_flat(Color("e8b96a"), 6))
	t.set_stylebox("grabber_pressed", "VScrollBar", sb_flat(Color("ffd9a0"), 6))
	t.set_stylebox("scroll", "HScrollBar", gr)
	t.set_stylebox("grabber", "HScrollBar", sb_flat(Color("c79a52"), 6))
	t.set_stylebox("grabber_highlight", "HScrollBar", sb_flat(Color("e8b96a"), 6))
	t.set_stylebox("grabber_pressed", "HScrollBar", sb_flat(Color("ffd9a0"), 6))
	t.set_constant("separation", "VBoxContainer", 10)
	t.set_constant("separation", "HBoxContainer", 10)
	# check / slider placeholders
	t.set_stylebox("slider", "HSlider", sb_flat(Color(0, 0, 0, 0.45), 6))
	t.set_stylebox("grabber_area", "HSlider", sb_flat(Color("e8a23d"), 6))
	t.set_stylebox("grabber_area_highlight", "HSlider", sb_flat(Color("ffc866"), 6))
	_theme = t
	return t


# ------------------------------------------------------------------ icons
static func icon(name: String) -> Texture2D:
	return load_tex(ICONS + name + ".png")


static func coin() -> Texture2D:
	return load_tex(FREE + "Icons/Icon_03.png")


static func ui_icon(n: int) -> Texture2D:
	return load_tex(FREE + "Icons/Icon_%02d.png" % n)


## Tight crop of a frame (alpha bounding box) as an AtlasTexture.
static func _cropped(atlas: Texture2D, region: Rect2i) -> AtlasTexture:
	var key := "%d:%s" % [atlas.get_instance_id(), region]
	if _crop.has(key):
		return _crop[key]
	var img := atlas.get_image()
	if img.is_compressed():
		img.decompress()
	var used := img.get_region(region).get_used_rect()
	var at := AtlasTexture.new()
	at.atlas = atlas
	at.region = Rect2(region.position + used.position, used.size) if used.size.x > 0 else Rect2(region)
	_crop[key] = at
	return at


static func unit_icon(unit_id: String, color := "blue") -> Texture2D:
	var key := "unit:%s:%s" % [unit_id, color]
	if _crop.has(key):
		return _crop[key]
	var def: Dictionary = V.UNITS.get(unit_id, V.UNITS["swordsman"])
	var a: Dictionary = def.anims.get("idle", {})
	var path: String = Sprites.sheet_path(a.get("sheet", def.sheet), color)
	var t := load_tex(path)
	var out: Texture2D = null
	if t:
		var fs: Vector2i = a.get("frame", def.frame)
		out = _cropped(t, Rect2i(0, int(a.get("row", 0)) * fs.y, fs.x, fs.y))
	_crop[key] = out
	return out


static func building_icon(bid: String, color := "blue") -> Texture2D:
	var key := "bld:%s:%s" % [bid, color]
	if _crop.has(key):
		return _crop[key]
	var def: Dictionary = V.BUILDINGS.get(bid, V.BUILDINGS["house"])
	var path: String = Sprites.sheet_path(def.sheet, color)
	var t := load_tex(path)
	var out: Texture2D = null
	if t:
		var hf: int = def.get("hframes", 1)
		out = _cropped(t, Rect2i(0, 0, t.get_width() / hf, t.get_height()))
	_crop[key] = out
	return out


## Index (1..25) into the Human Avatars sheet for a hero in a player colour.
static func avatar_no(hero_id: String, color := "black") -> int:
	var role := "Fighter"
	var hd := HeroesData.by_id(hero_id)
	if not hd.is_empty():
		role = hd.role
	var base: int = COLOR_AVATAR_BASE.get(color, 21)
	var idx: int = ROLE_AVATAR.get(role, 1)
	return base + idx


static func avatar(no: int) -> Texture2D:
	return load_tex(FREE + "Human Avatars/Avatars_%02d.png" % no)


static func hero_portrait(hero_id: String, color := "black") -> Texture2D:
	return avatar(avatar_no(hero_id, color))


static func stance_icon(st: String) -> Texture2D:
	return icon(st)


# ------------------------------------------------------------------ small widget factories
static func label(text: String, size := 24, col := CREAM, outline := 4, align := HORIZONTAL_ALIGNMENT_LEFT) -> Label:
	var l := Label.new()
	l.text = text
	l.add_theme_font_size_override("font_size", size)
	l.add_theme_color_override("font_color", col)
	l.add_theme_constant_override("outline_size", outline)
	l.add_theme_color_override("font_outline_color", OUTLINE)
	l.horizontal_alignment = align
	return l


static func tex_rect(t: Texture2D, size: Vector2, smooth := false) -> TextureRect:
	var r := TextureRect.new()
	r.texture = t
	r.custom_minimum_size = size
	r.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	r.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_CENTERED
	r.mouse_filter = Control.MOUSE_FILTER_IGNORE
	if smooth:
		r.texture_filter = CanvasItem.TEXTURE_FILTER_LINEAR_WITH_MIPMAPS
	return r


# ------------------------------------------------------------------ custom-draw helpers (used by hud_widgets.gd)
static func dtext(ci: CanvasItem, s: String, pos: Vector2, size: int, col := Color.WHITE, align := HORIZONTAL_ALIGNMENT_LEFT, width := -1.0, outline := 4) -> void:
	var f := UiArt.font()
	if outline > 0:
		ci.draw_string_outline(f, pos, s, align, width, size, outline, UiArt.OUTLINE)
	ci.draw_string(f, pos, s, align, width, size, col)


## Text centred on `c`.
static func dtext_c(ci: CanvasItem, s: String, c: Vector2, size: int, col := Color.WHITE, outline := 4) -> void:
	dtext(ci, s, Vector2(c.x - 200.0, c.y + size * 0.34), size, col, HORIZONTAL_ALIGNMENT_CENTER, 400.0, outline)


static func dpie(ci: CanvasItem, c: Vector2, r: float, frac: float, col: Color) -> void:
	## Filled pie from 12 o'clock, clockwise, covering `frac` of the circle.
	if frac <= 0.0:
		return
	var pts := PackedVector2Array([c])
	var n := int(ceil(48.0 * clampf(frac, 0.0, 1.0))) + 1
	for i in range(n + 1):
		var a := -PI / 2.0 + TAU * clampf(frac, 0.0, 1.0) * float(i) / float(n)
		pts.append(c + Vector2(cos(a), sin(a)) * r)
	ci.draw_colored_polygon(pts, col)


static func round_tex(red: bool, pressed: bool) -> Texture2D:
	return UiArt.load_tex(UiArt.FREE + "Buttons/Small%sRoundButton_%s.png" % ["Red" if red else "Blue", "Pressed" if pressed else "Regular"])


## Draws a Tiny Swords round button with visible diameter `d` centred at `c`.
static func draw_round(ci: CanvasItem, c: Vector2, d: float, red: bool, pressed: bool, mod := Color.WHITE) -> void:
	var t := round_tex(red, pressed)
	if t == null:
		return
	var s := d / 88.0
	var ctr := Vector2(63.5, 62.0 if pressed else 58.5)
	ci.draw_texture_rect(t, Rect2(c - ctr * s, Vector2(128, 128) * s), false, mod)


## Display size for a unit icon so that relative unit sizes read correctly inside a square `box`.
static func unit_icon_size(unit_id: String, box: float) -> Vector2:
	var t := unit_icon(unit_id)
	if t == null:
		return Vector2(box, box)
	var def: Dictionary = V.UNITS.get(unit_id, V.UNITS["swordsman"])
	var native := Vector2(t.get_width(), t.get_height())
	var s: float = 0.62 * float(def.get("scale", 1.0))
	if def.get("frame", Vector2i(192, 192)).x > 200:
		s *= 1.0
	var sz := native * s
	var fit := box / maxf(sz.x, sz.y)
	if fit < 1.0:
		sz *= fit
	return sz


## Portrait for the hero gallery / picker: a colour per hero (within its role) so the 20 heroes look distinct.
static func gallery_portrait(hero_id: String) -> Texture2D:
	var hd := HeroesData.by_id(hero_id)
	var n := 0
	for h in HeroesData.HEROES:
		if h.role == hd.get("role", ""):
			if h.id == hero_id:
				break
			n += 1
	var colors := ["blue", "red", "yellow", "purple", "black"]
	return hero_portrait(hero_id, colors[n % colors.size()])
