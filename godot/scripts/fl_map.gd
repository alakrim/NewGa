extends RefCounted
## Static Frontline map features, mirrored from src/shared/frontline/data.ts (keep in sync).

const MIN_X := -96.0
const MAX_X := 96.0
const LANE_MIN_Z := -8.0
const LANE_MAX_Z := 9.0
const FORTRESS_X := 86.0
const FORTRESS_Z := -3.0
const DROP_X := 78.0

## Gold veins: [x, z, rich]
const NODES := [
	[-68, 11, false], [-60, 11, false], [-52, 11, false], [-44, 11, false],
	[68, 11, false], [60, 11, false], [52, 11, false], [44, 11, false],
	[-14, 11, true], [14, 11, true],
]

## Lane banners (outposts): [key, name, x, z]
const BANNERS := [["west", "Dawn Outpost", -34, -5], ["heart", "Heart Banner", 0, -5], ["east", "Dusk Outpost", 34, -5]]
const BANNER_RADIUS := 4.5


## Building plots in the same order as FL_PLOTS: team 0 slot 0, team 0 slot 1, team 1 slot 0, team 1 slot 1; 7 each.
static func plots() -> Array:
	var out := []
	for team in [0, 1]:
		for slot in [0, 1]:
			for x in [80, 74, 68, 62, 56, 50, 44]:
				out.append({"team": team, "slot": slot, "x": -x if team == 0 else x, "z": -15 if slot == 0 else -21})
	return out
