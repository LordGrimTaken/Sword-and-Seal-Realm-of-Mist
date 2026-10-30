# Sword and Seal: Realm of Mist — Master Idea Roadmap

2,000 specific, actionable ideas to add, improve, or work on, generated from the project's own design bible (`docs/DESIGN.md`), grading rubric (`docs/RUBRIC.md`), the current codebase, and its known limitations.

Each of the 25 files below holds **80 ideas** (one per numbered line: a bold imperative title followed by a concrete WHAT/WHY that references the game's real systems — classes, mobs, zones, Qi, gear, quests, the protocol, and the Ink-and-Vermilion art rules).

## Gameplay & Content

| # | File | Focus |
|---|---|---|
| 01 | [combat-classes](01-combat-classes.md) | New classes & skills, talents, status effects, Qi/combos |
| 02 | [enemies-ai](02-enemies-ai.md) | Mob families, behaviors, elites, spawn/aggro logic |
| 03 | [bosses](03-bosses.md) | Regional/raid/world bosses, mechanics, phases, loot |
| 04 | [quests-story](04-quests-story.md) | Main/side/daily quests, events, choices, lore |
| 05 | [npcs-dialogue](05-npcs-dialogue.md) | NPCs, dialogue trees, reputation, vendors |
| 06 | [world-zones](06-world-zones.md) | New zones, dungeons, traversal, weather, secrets |
| 07 | [cultivation](07-cultivation.md) | Realms, breakthroughs, talents, prestige, level cap |
| 08 | [gear](08-gear.md) | Slots, sets, enchanting, legendaries, transmog |
| 09 | [crafting](09-crafting.md) | Professions, recipes, gathering, quality tiers |
| 10 | [economy](10-economy.md) | Auction house, trading, shops, currency sinks |
| 11 | [inventory](11-inventory.md) | Bank, collections, sorting, loadouts, mail |
| 12 | [social](12-social.md) | Parties, guilds/sects, chat, friends, LFG |
| 13 | [pvp](13-pvp.md) | Arena, battlegrounds, duels, open-world PvP |
| 14 | [pets-mounts](14-pets-mounts.md) | Spirit beasts, mounts, flying swords, breeding |
| 15 | [housing](15-housing.md) | Sect hall/cave abode, decoration, farming |
| 16 | [collections](16-collections.md) | Codex, bestiary, achievements, titles, transmog |
| 17 | [events](17-events.md) | Seasonal festivals, world events, battle pass |

## Presentation

| # | File | Focus |
|---|---|---|
| 18 | [art-vfx](18-art-vfx.md) | VFX, costumes, environments, weather, animation |
| 19 | [audio](19-audio.md) | Soundtrack, dynamic music, SFX, voice, spatial audio |
| 20 | [ui-ux](20-ui-ux.md) | HUD, settings, localization, accessibility, onboarding |

## Technical

| # | File | Focus |
|---|---|---|
| 21 | [networking](21-networking.md) | Protocol, anti-cheat, sharding, interest mgmt, collision |
| 22 | [performance](22-performance.md) | Draw calls, LOD, WebGPU, memory, 60 fps |
| 23 | [security-persistence](23-security-persistence.md) | Accounts, TLS, cloud saves, backups, GDPR |
| 24 | [testing-tooling](24-testing-tooling.md) | Test coverage, CI/CD, dev tools, observability |

## Product

| # | File | Focus |
|---|---|---|
| 25 | [product](25-product.md) | Cosmetics, monetization, leaderboards, docs, marketing |

---

**How to use it:** pick a category, skim the 80 items, and turn any line into a ticket. Items are ordered roughly by "foundational → polish" within each file. Most are additive and respect the current single-zone vertical slice; the "out of scope" list from `docs/DESIGN.md` (guilds, housing, trading, PvP, zones, accounts, anti-cheat, payments) is deliberately covered here as future work.
