# JIUZHOU — Design Bible (v0.3)

Desktop MMO RPG. Xianxia / wuxia world of the Nine Provinces. **All player-facing text is English** (no Chinese characters anywhere the player sees). The Chinese identity is carried by aesthetics only: ink-wash visuals, vermilion seals, brush lettering, paper scrolls and pictograms. Server-authoritative; client is replaceable.

## Visual identity: "Ink and Vermilion"
Shuimo ink-wash landscape meets stylized 3D. Think misty mountains, bamboo, pagodas, paper lanterns, seal stamps. Soft, painterly, low-saturation world with sparing vermilion and gold accents. NOT neon, NOT generic fantasy.

### Palette (use these exact tokens)
| Token | Hex | Use |
|---|---|---|
| ink | #1a1a1f | text on paper, outlines, UI frames |
| ink-soft | #3a3a44 | secondary lines, shadows |
| paper | #f2ead8 | UI panels, parchment surfaces |
| paper-dark | #d9cdb0 | panel borders, inactive |
| vermilion | #c8372d | seals, HP, danger, key accents |
| jade | #4fa58b | mana/qi, nature, heal, friendly |
| gold | #c9a227 | rewards, level-ups, rare |
| mist | #8fa3ad | fog, distant mountains, sky |
| mist-light | #cfd9dc | horizon haze |

### World rendering rules
- Toon/cel shading with 2–3 tone bands, dark ink outline on characters and props.
- Heavy layered depth fog tinted mist/mist-light; distant mountain silhouettes in 3–4 receding grey-blue layers.
- Palette-locked materials; no pure white/black. Paper-grain feel in sky/UI.
- All models procedural (primitives, lathe, extrude) — no external assets required.
- Ambient life: drifting mist particles, falling petals/leaves, lantern glow, water ripples, bamboo sway.

### UI rules
- Panels look like paper scrolls / lacquered wood with vermilion seal-stamp corners.
- **English with a Chinese aesthetic (rule):** no hanzi in UI, world signage, VFX, server strings, docs or tests. `npm run check:english` (client) fails on any CJK character. Names are natural English with light wuxia flavour ("Heaven-Splitting Strike", "Elder Lin"). Protocol `*Zh` fields exist but are sent empty and never rendered.
- **Fonts (decided):** display / headings / logo / banners = **Ma Shan Zheng** (its Latin glyphs are a brush script; only the Latin subset is bundled). Body / HUD / chat / tooltips = **Noto Serif** (Latin 400, 600, 700) for legibility. Bundled locally (no CDN) via @fontsource; CSS variables `--font-display` and `--font-body`. Brush script is used at 18 px and up; small text is Noto Serif, often small-caps / letter-spaced uppercase for section labels. Fonts are awaited (`document.fonts.load`) before the login screen and in-world signage canvases need them.
- HP bar vermilion on ink, Qi bar jade, XP bar gold thin line. Skill and item icons are hand-drawn vector brush pictograms (`client/src/ui/icons.ts`: slash arc, sword-qi wave, blade, qi shield, fire talisman, bolt, snowflake, wind swirl, needle, rain, light burst, pulse rings; fibre bundle, fox tail, rune core, scale, vial, lantern, gourd, jade disc, stamp, pouch) on a vermilion seal square. No letters in icons.
- Damage numbers: ink-brush style; crits are paper-white on a vermilion ink-splash with a small CRIT label; heals in jade. Level-up shows "Level Up" in gold brush lettering; quest completion stamps a vermilion COMPLETE seal.
- Chat is a scroll panel bottom-left. Minimap is a round ink-wash disc top-right.

## Starter zone: Cloudmist Valley
Spawn plaza with a paifang gate, a pagoda, lantern-lined stone path, stone bridge over a lotus pond, bamboo grove (Bamboo Spirits lv1–3), fox-spirit hills (Fox Spirits lv3–6), ruined shrine on a hill with a boss Stone Guardian (lv8). Zone is 200×200 units, centered at 0,0, spawn near (0,-80).

## Classes
- Sword Cultivator — melee. Skills: 1 Flowing Slash, 2 Sword Qi Wave, 3 Heaven-Splitting Strike, 4 Qi Guard.
- Talisman Master — ranged. Skills: 1 Fire Talisman, 2 Thunder Talisman (AoE), 3 Frost Seal, 4 Wind Step.
- Physician — support. Skills: 1 Jade Needle, 2 Spring Rain (heal), 3 Purifying Light, 4 Meridian Surge.
Server owns exact numbers; keep them data-driven in one file.

## MVP loop (vertical slice)
Login → pick name + class → spawn in valley → move with WASD/click → fight mobs with hotbar 1–4 → XP/level → loot messages → chat with other connected players → defeat boss. Multiple players visible in same zone.

## Out of scope for this slice
Trading, guilds, housing, crafting, PvP, multiple zones, accounts/passwords, anti-cheat, payments.
