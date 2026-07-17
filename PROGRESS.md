# Maclawd development progress

Last updated: 2026-07-17

## Current checkpoint

Maclawd is a standalone project with an independent repository and Git history.
Its first complete scene-first motion-design system is now implemented:

- 12 primary states
- 5 optional `working` activity modifiers
- 6 interaction and ambient actions
- 23 active CSS/SVG animations in total

The body, claws, legs, eyes, colors, and source coordinates are identical across
the full set. Every action now places Clawd inside one recognizable mini-scene
instead of surrounding it with technical status objects. The macOS application
runtime and event integration have not started.

## Completed

- Chosen the **Maclawd** product name and defined it as a complete Mac desktop
  companion rather than an extension of another repository.
- Locked the character geometry/color contract and a shared 45×45 view box.
- Studied the reference project's useful design principles: turn technical
  states into everyday metaphors, give every loop a setup/action/reaction, and
  keep the character more important than its prop.
- Preserved earlier static concepts and mechanical prototypes in Git history.
- Rebuilt the primary set around scene-readable actions: **Cushion Watch**,
  **Bedtime Pull**, **Top-down Sleep**, **Morning Stretch**, **Puzzle Pause**,
  **Desk Shuffle**, **Parcel Parade**, **Picnic Jar**, **Suitcase Fold**, **Mat
  Move-in**, **Cushion Cheer**, and **Basket Rescue**.
- Made `away → sleeping → waking` a continuous story using the same blanket
  colors, patch, and fold language across all three actions.
- Rebuilt `sleeping` as a direct overhead bed composition: Clawd lies flat on a
  pillow, keeps both closed eyes and claws visible, breathes under the blanket,
  and emits a user-approved three-step pixel `Zzz` sequence.
- Replaced the working modifier set with five complete activity scenes: **Floor
  Book**, **Letter Desk**, **Block Garden**, **Toy Check**, and **Clothesline
  Relay**. `working.command` now aliases generic **Desk Shuffle**.
- Added six desktop/system scenes: **Cushion Poke**, **Cushion Hop**, **Hanging
  Cling**, **Cushion Bounce**, **Curtain Peek**, and **Cushion Curl**.
- Defined conservative Hook behavior: detailed working modifiers require a
  reliable external event; otherwise the system falls back to generic working.
- Added machine-readable contracts for primary states, modifiers, and
  interactions.
- Rebuilt the browser motion lab to display all 23 actions directly from their
  production SVG sources.
- Rendered every active action into a deterministic V5 GIF preview and generated
  new 64px and 96px complete-set boards.
- Fixed the deterministic preview renderer to resize the SVG root before
  pet-size capture; all 18 GIF previews now contain real animated content.
- Verified all 26 SVG sources parse and preserve the locked source rectangles:
  23 current actions, one historical command entry, and two mechanical prototypes.
- Produced browser-rendered 64px and 96px boards covering all 23 active actions.
- Added shared reduced-motion behavior: props and body motion stop, with only a
  low-frequency blink permitted.

## Locked character contract

| Part | Geometry/color |
| --- | --- |
| Torso | `x=2 y=6 width=11 height=7` |
| Claws | `x=0/13 y=9 width=2 height=2` |
| Legs | `x=3/5/9/11 y=13 width=1 height=2` |
| Eyes | `x=4/10 y=8 width=1 height=2` |
| Body color | `#DE886D` |
| Eye color | `#000000` |

## Next build phases

### 1. Runtime state engine

- Implement state priority, interruption, transition, and fallback rules.
- Define the public event adapter and map reliable Codex/Claude/tool events.
- Keep opaque Agent work on generic `thinking` or `working`; never fabricate a
  detailed task status.
- Add a local animation harness that can replay real event traces.

### 2. Mac application

- Build the transparent desktop-pet window and click-through regions.
- Add drag, click, drop, wake, sleep, screen-edge, and low-battery behavior.
- Build the menu bar controller, preferences, and notification layer.
- Connect the event adapter to the Maclawd state system.

### 3. Product identity

- Create the Maclawd app icon and visual identity.
- Define bundle identifiers, local storage, privacy controls, and updates.
- Complete accessibility, localization, onboarding, and reduced-motion settings.

### 4. Distribution

- Produce a universal Apple Silicon and Intel build.
- Test installation, launch, permissions, updates, and uninstall behavior.
- Add hardened runtime, Developer ID signing, and notarization.
- Publish the first `.dmg` release.

## Not implemented yet

- No running Maclawd application exists yet.
- SVG animations are not connected to a runtime state engine yet.
- No Agent event adapter or real event trace playback exists yet.
- No application icon, signed binary, notarized build, or `.dmg` exists yet.

The public repository is a validated motion-system checkpoint, not a release claim.
