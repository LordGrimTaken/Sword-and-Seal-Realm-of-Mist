// JIUZHOU models: procedural stylised avatars with toon shading + ink outlines.
import type { ClassId, MobType } from "../../../shared/protocol";
import { buildClass, buildNpc } from "./humanoid";
import { buildMob } from "./mobs";
import type { Avatar } from "./common";

export type { Avatar };

/** Player character. Origin at feet, facing +z. */
export function createCharacterModel(cls: ClassId): Avatar { return buildClass(cls); }
/** Mob model (bamboo_spirit / fox_spirit / stone_guardian / jade_serpent). */
export function createMobModel(type: MobType): Avatar { return buildMob(type); }
/** NPC model. "elder" (default): staff and beard; "keeper": the Notice Board Keeper, jade-and-ink robe with a scroll. */
export function createNpcModel(variant: "elder" | "keeper" = "elder"): Avatar { return buildNpc(variant); }
