extends RefCounted
## Art mapping: which Tiny Swords sprites draw each Frontline unit, hero, building and effect.
## FREE = "Tiny Swords (Free Pack)" (fetched by tools/fetch-tinyswords.mjs, not in git).
## CC0  = "Tiny Swords (Update 010)" (committed under assets/tinyswords).

const FREE := "res://assets/tinyswords_free/"
const CC0 := "res://assets/tinyswords/"
const U := FREE + "Units/{C} Units/"
const GOB := CC0 + "Factions/Goblins/Troops/"

## Sim world units -> pixels. One 64px tile = 2 world units.
const PX := 32.0

const F192 := Vector2i(192, 192)
const F320 := Vector2i(320, 320)

## Each unit: default sheet/frame, animations {name: {sheet?, row?, count, fps?, loop?}}, scale, y offset (feet).
const UNITS := {
	"miner": {
		"sheet": U + "Pawn/Pawn_Idle.png", "frame": F192, "scale": 0.8, "feet": 30,
		"anims": {
			"idle": {"sheet": U + "Pawn/Pawn_Idle Pickaxe.png", "count": 8},
			"run": {"sheet": U + "Pawn/Pawn_Run Pickaxe.png", "count": 6, "fps": 12},
			"carry_idle": {"sheet": U + "Pawn/Pawn_Idle Gold.png", "count": 8},
			"carry_run": {"sheet": U + "Pawn/Pawn_Run Gold.png", "count": 6, "fps": 12},
			"attack": {"sheet": U + "Pawn/Pawn_Interact Pickaxe.png", "count": 6, "fps": 12, "loop": false},
		},
	},
	"swordsman": {
		"sheet": U + "Warrior/Warrior_Idle.png", "frame": F192, "scale": 0.85, "feet": 30,
		"anims": {
			"idle": {"count": 8},
			"run": {"sheet": U + "Warrior/Warrior_Run.png", "count": 6, "fps": 12},
			"attack": {"sheet": U + "Warrior/Warrior_Attack1.png", "count": 4, "fps": 12, "loop": false},
			"attack2": {"sheet": U + "Warrior/Warrior_Attack2.png", "count": 4, "fps": 12, "loop": false},
			"guard": {"sheet": U + "Warrior/Warrior_Guard.png", "count": 6},
		},
	},
	"archer": {
		"sheet": U + "Archer/Archer_Idle.png", "frame": F192, "scale": 0.85, "feet": 30,
		"anims": {
			"idle": {"count": 6},
			"run": {"sheet": U + "Archer/Archer_Run.png", "count": 4, "fps": 10},
			"attack": {"sheet": U + "Archer/Archer_Shoot.png", "count": 8, "fps": 14, "loop": false},
		},
	},
	"shieldbearer": {
		"sheet": U + "Lancer/Lancer_Idle.png", "frame": F320, "scale": 0.62, "feet": 62,
		"anims": {
			"idle": {"count": 12},
			"run": {"sheet": U + "Lancer/Lancer_Run.png", "count": 6, "fps": 12},
			"attack": {"sheet": U + "Lancer/Lancer_Right_Attack.png", "count": 3, "fps": 8, "loop": false},
			"guard": {"sheet": U + "Lancer/Lancer_Right_Defence.png", "count": 6},
		},
	},
	"assassin": {
		"sheet": GOB + "Torch/{C}/Torch_{C}.png", "frame": F192, "scale": 0.85, "feet": 30,
		"anims": {
			"idle": {"row": 0, "count": 7},
			"run": {"row": 1, "count": 6, "fps": 14},
			"attack": {"row": 2, "count": 6, "fps": 14, "loop": false},
		},
	},
	"battlemage": {
		"sheet": GOB + "TNT/{C}/TNT_{C}.png", "frame": F192, "scale": 0.85, "feet": 30,
		"anims": {
			"idle": {"row": 0, "count": 6},
			"run": {"row": 1, "count": 6, "fps": 12},
			"attack": {"row": 2, "count": 7, "fps": 12, "loop": false},
		},
	},
	"healer": {
		"sheet": U + "Monk/Idle.png", "frame": F192, "scale": 0.85, "feet": 30,
		"anims": {
			"idle": {"count": 6},
			"run": {"sheet": U + "Monk/Run.png", "count": 4, "fps": 10},
			"attack": {"sheet": U + "Monk/Heal.png", "count": 11, "fps": 16, "loop": false},
		},
	},
	"giant": {
		"sheet": U + "Warrior/Warrior_Idle.png", "frame": F192, "scale": 1.7, "feet": 30,
		"anims": {
			"idle": {"count": 8, "fps": 7},
			"run": {"sheet": U + "Warrior/Warrior_Run.png", "count": 6, "fps": 8},
			"attack": {"sheet": U + "Warrior/Warrior_Attack2.png", "count": 4, "fps": 8, "loop": false},
		},
	},
}

## Baked characters (tools/bake-sprites.ts): the KayKit CC0 3D models rendered to pixel sprite sheets. Units
## have one sheet per player colour, heroes one sheet each in their identity colour. Every sheet has the same
## rows in 192 x 128 frames: idle 8, run 8, attack 6, death 6. All frames share one ground line, 12 px above the
## frame bottom. `feet` is how far the frame centre sits above the ground (it becomes the sprite offset): the
## Tiny Swords frames put their centre 36 px above the feet and use 30, so baked ones use 64 - 12 - 6 = 46.
const BAKED := "res://assets/baked/"
const BAKED_FRAME := Vector2i(192, 128)
const BAKED_FEET := 46
const BAKED_SCALE := {"miner": 0.66, "giant": 1.35}  # others 0.72: the same on-screen height as Tiny Swords units


static func baked_def(sheet: String, scale: float) -> Dictionary:
	var run := {"row": 1, "count": 8, "fps": 12}
	return {
		"sheet": sheet, "frame": BAKED_FRAME, "scale": scale, "feet": BAKED_FEET,
		"anims": {
			"idle": {"row": 0, "count": 8, "fps": 8},
			"run": run,
			"attack": {"row": 2, "count": 6, "fps": 12, "loop": false},
			"death": {"row": 3, "count": 6, "fps": 10, "loop": false},
			"carry_idle": {"row": 0, "count": 8, "fps": 8},
			"carry_run": run,
		},
	}


## "baked" (default) or "classic" (Tiny Swords sprites). Settings saves it; `--chars=` on the command line
## overrides it for one run (tests).
static func chars_mode() -> String:
	for a in OS.get_cmdline_user_args():
		if a.begins_with("--chars="):
			return a.trim_prefix("--chars=")
	return Prefs.get_value("chars", "baked")


## Sprite definition for a body id: a unit type ("swordsman") or, in baked mode, a hero ("hero:aldric").
static func unit_def(id: String) -> Dictionary:
	if chars_mode() == "baked":
		if id.begins_with("hero:"):
			return baked_def(BAKED + "heroes/" + id.trim_prefix("hero:") + ".png", 0.72)
		if UNITS.has(id):
			return baked_def(BAKED + "units/{c}/" + id + ".png", BAKED_SCALE.get(id, 0.72))
	if id.begins_with("hero:"):
		id = "swordsman"
	return UNITS.get(id, UNITS["swordsman"])


## Hero body by role (classic mode: the 20 heroes reuse the elite unit sprites, bigger and glowing).
const HERO_BODY := {
	"Tank": "shieldbearer", "Fighter": "swordsman", "Assassin": "assassin",
	"Mage": "battlemage", "Marksman": "archer", "Support": "healer",
}
const HERO_SCALE := 1.3

const EFFECTS := {
	"explosion": {"sheet": FREE + "Particle FX/Explosion_01.png", "frame": F192, "count": 8, "fps": 16},
	"explosion_big": {"sheet": CC0 + "Effects/Explosion/Explosions.png", "frame": F192, "count": 9, "fps": 16},
	"fire": {"sheet": CC0 + "Effects/Fire/Fire.png", "frame": Vector2i(128, 128), "count": 7, "fps": 12, "loop": true},
	"dust": {"sheet": FREE + "Particle FX/Dust_01.png", "frame": Vector2i(64, 64), "count": 8, "fps": 16},
	"heal": {"sheet": FREE + "Units/Blue Units/Monk/Heal_Effect.png", "frame": F192, "count": 11, "fps": 18},
	"dead": {"sheet": CC0 + "Factions/Knights/Troops/Dead/Dead.png", "frame": Vector2i(128, 128), "count": 7, "fps": 10},
	"gold_spawn": {"sheet": CC0 + "Resources/Resources/G_Spawn.png", "frame": Vector2i(128, 128), "count": 7, "fps": 14},
}

const B := FREE + "Buildings/{C} Buildings/"
## Frontline building id -> sprite (bottom-centre anchored). Construction / ruin sprites are CC0.
const BUILDINGS := {
	"castle": {"sheet": B + "Castle.png", "construction": CC0 + "Factions/Knights/Buildings/Castle/Castle_Construction.png", "ruin": CC0 + "Factions/Knights/Buildings/Castle/Castle_Destroyed.png", "scale": 1.25},
	"house": {"sheet": B + "House1.png", "construction": CC0 + "Factions/Knights/Buildings/House/House_Construction.png", "ruin": CC0 + "Factions/Knights/Buildings/House/House_Destroyed.png", "scale": 1.0},
	"barracks": {"sheet": B + "Barracks.png", "construction": CC0 + "Factions/Knights/Buildings/House/House_Construction.png", "ruin": CC0 + "Factions/Knights/Buildings/House/House_Destroyed.png", "scale": 1.0},
	"archery": {"sheet": B + "Archery.png", "construction": CC0 + "Factions/Knights/Buildings/House/House_Construction.png", "ruin": CC0 + "Factions/Knights/Buildings/House/House_Destroyed.png", "scale": 1.0},
	"sanctum": {"sheet": B + "Monastery.png", "construction": CC0 + "Factions/Knights/Buildings/Tower/Tower_Construction.png", "ruin": CC0 + "Factions/Knights/Buildings/Tower/Tower_Destroyed.png", "scale": 1.0},
	"giantpit": {"sheet": CC0 + "Factions/Goblins/Buildings/Wood_Tower/Wood_Tower_{C}.png", "construction": CC0 + "Factions/Goblins/Buildings/Wood_Tower/Wood_Tower_InConstruction.png", "ruin": CC0 + "Factions/Goblins/Buildings/Wood_Tower/Wood_Tower_Destroyed.png", "scale": 1.0, "hframes": 4},
	"forge": {"sheet": B + "House2.png", "construction": CC0 + "Factions/Knights/Buildings/House/House_Construction.png", "ruin": CC0 + "Factions/Knights/Buildings/House/House_Destroyed.png", "scale": 1.0},
	"mineshaft": {"sheet": B + "House3.png", "construction": CC0 + "Factions/Knights/Buildings/House/House_Construction.png", "ruin": CC0 + "Factions/Knights/Buildings/House/House_Destroyed.png", "scale": 1.0},
	"watchtower": {"sheet": B + "Tower.png", "construction": CC0 + "Factions/Knights/Buildings/Tower/Tower_Construction.png", "ruin": CC0 + "Factions/Knights/Buildings/Tower/Tower_Destroyed.png", "scale": 1.0},
	"market": {"sheet": CC0 + "Factions/Goblins/Buildings/Wood_House/Goblin_House.png", "construction": CC0 + "Factions/Goblins/Buildings/Wood_House/Goblin_House.png", "ruin": CC0 + "Factions/Goblins/Buildings/Wood_House/Goblin_House_Destroyed.png", "scale": 1.0},
}

const PLAYER_COLORS := {"blue": Color("3d8bfd"), "purple": Color("9b5de5"), "red": Color("e5484d"), "yellow": Color("e8b923")}
const TEAM_COLORS := [Color("3d8bfd"), Color("e5484d")]


## Frontline unit type from a vis key like "f:archer:blue" -> ["archer", "blue"].
static func parse_vis(vis: String) -> Array:
	var parts := vis.split(":")
	if parts.size() >= 3 and parts[0] == "f":
		return [parts[1], parts[2]]
	return ["", ""]


static func to_px(x: float, z: float) -> Vector2:
	return Vector2(x * PX, z * PX)
