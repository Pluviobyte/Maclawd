# Maclawd development progress

Last updated: 2026-07-17

## Current checkpoint

Maclawd is a standalone project with an independent repository and Git history.
Its first complete motion-design system is now implemented:

- 12 primary states
- 6 optional `working` activity modifiers
- 6 interaction and ambient actions
- 24 active CSS/SVG animations in total

The body, claws, legs, eyes, colors, and source coordinates are identical across
the full set. Props are temporary story objects rather than permanent functional
hardware. The macOS application runtime and event integration have not started.

## Completed

- Chosen the **Maclawd** product name and defined it as a complete Mac desktop
  companion rather than an extension of another repository.
- Locked the character geometry/color contract and a shared 45×45 view box.
- Studied the reference project's useful design principles: turn technical
  states into everyday metaphors, give every loop a setup/action/reaction, and
  keep the character more important than its prop.
- Preserved all earlier static concepts and mechanical prototypes as design
  history instead of deleting them.
- Implemented the first active group: **Calm Calibration**, **Shell Shuffle**,
  **Token Knitting**, **Hatchling Parade**, and **Stuck Jar**.
- Replaced the seven remaining mechanical candidates with playful actions:
  **Blanket Drag**, **Blanket Burrito**, **Blanket Pop**, **Accordion Fold**,
  **Pop-up Studio**, **Self High-five**, and **Yarn Tangle**.
- Made `away → sleeping → waking` a continuous story using the same blanket
  colors, patch, and fold language across all three actions.
- Added six working modifiers: **Card Browsing**, **Note Stitching**, **Wind-up
  Command**, **Block Tower**, **Wobble Test**, and **Relay Bead**.
- Added six desktop/system actions: **Click Flinch**, **Surprised Hop**, **Drag
  Cling**, **Drop Wobble**, **Edge Peek**, and **Low Battery Droop**.
- Defined conservative Hook behavior: detailed working modifiers require a
  reliable external event; otherwise the system falls back to generic working.
- Added machine-readable contracts for primary states, modifiers, and
  interactions.
- Rebuilt the browser motion lab to display all 24 actions directly from their
  production SVG sources.
- Rendered 742 new frames at 10 fps and generated 19 new GIF previews plus 19
  four-phase contact sheets.
- Verified all 19 new SVG files parse, preserve the locked source rectangles,
  contain visible multi-frame motion, and remain inside the render bounds.
- Verified all 12 loop actions in the new set return byte-for-byte to their
  first rendered frame; reaction/transition actions are reviewed as one cycles.
- Produced a browser-rendered 96px board covering all 24 actions.
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
