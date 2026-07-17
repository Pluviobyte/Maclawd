# Maclawd development progress

Last updated: 2026-07-17

## Current checkpoint

Maclawd is a standalone project with an independent repository and Git history.
Its first complete body-first motion-design system is now implemented:

- 12 primary states
- 5 optional `working` activity modifiers
- 6 interaction and ambient actions
- 23 active CSS/SVG animations in total

The body, claws, legs, eyes, colors, and source coordinates are identical across
the full set. V5.3 removes repeated horizontal stages: only top-down sleeping
keeps a full scene, while every other prop overlaps the body, sits to one side,
or stacks vertically. The macOS application runtime and event integration have
not started.

## Completed

- Chosen the **Maclawd** product name and defined it as a complete Mac desktop
  companion rather than an extension of another repository.
- Locked the character geometry/color contract and a shared 45×45 view box.
- Studied the reference project's useful design principles: turn technical
  states into everyday metaphors, give every loop a setup/action/reaction, and
  keep the character more important than its prop.
- Preserved earlier static concepts and mechanical prototypes in Git history.
- Rebuilt the primary set around body-readable actions: **Quiet Watch**,
  **Blanket Tug**, **Top-down Sleep**, **Morning Stretch**, **Puzzle Turn**,
  **Tile Stack**, **Parcel Stack**, **Stuck Jar**, **Suitcase Fold**, **Workspace
  Folder**, **Self High-five**, and **Basket Rescue**.
- Made `away → sleeping → waking` a continuous story using the same blanket
  colors, patch, and fold language across all three actions.
- Rebuilt `sleeping` as a direct overhead bed composition: Clawd lies flat on a
  pillow, keeps both closed eyes and claws visible, breathes under the blanket,
  and emits a user-approved three-step pixel `Zzz` sequence.
- Replaced the working modifier set with five compact actions: **Pocket Book**,
  **Letter Note**, **Block Stack**, **Toy Check**, and **Spool Sync**.
  `working.command` now aliases generic **Tile Stack**.
- Added six desktop/system actions: **Poke Squish**, **Surprised Hop**, **Hanging
  Loop**, **Drop Wobble**, **Curtain Peek**, and **Low Battery Droop**.
- Defined conservative Hook behavior: detailed working modifiers require a
  reliable external event; otherwise the system falls back to generic working.
- Added machine-readable contracts for primary states, modifiers, and
  interactions.
- Rebuilt the browser motion lab to display all 23 actions directly from their
  production SVG sources.
- Rendered every active action into a deterministic V5 GIF preview and generated
  new 64px and 96px complete-set boards.
- Removed 14 repeated horizontal base constructions: rugs, desks, paths,
  cushions, floor strips, the clothesline, and the hanging bar. The current
  23-action set stays within 16–48px horizontally at the 96px QA size.
- Fixed the deterministic preview renderer to resize the SVG root before
  pet-size capture; all 23 GIF previews now contain real animated content.
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
