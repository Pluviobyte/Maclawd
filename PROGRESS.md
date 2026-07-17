# Maclawd development progress

Last updated: 2026-07-17

## Current checkpoint

Maclawd is a new standalone project with an independent repository and Git
history. The twelve primary state actions now have a shared visual language and
implementation contract. The `idle`, `thinking`, and `working.default` states
now have animated SVG implementations; application integration and macOS
packaging have not started.

## Completed

- Chosen the **Maclawd** product name.
- Defined the target as a complete Mac desktop application.
- Locked the character body and eye geometry/color contract.
- Established the rule that every state receives a distinct Maclawd motion
  treatment, with accessories added only when they improve readability.
- Designed and implemented the first **Reasoning Gearbox** action group.
- Produced a CSS-only animated SVG with a 2.8-second loop.
- Produced a 1000×1000, 42-frame GIF preview and four-phase contact sheet.
- Validated the SVG syntax and locked character values.
- Reviewed the first concept against the reference action library to avoid exact
  duplication while retaining useful state semantics.
- Defined all 12 primary state actions, their accessories, timing, transitions,
  reduced-motion behavior, and visual acceptance criteria.
- Assigned Reasoning Gearbox to `working.default`.
- Implemented **Calm Calibration** for `idle` with grounded breathing, a small
  glance, and one blink during a 5.6-second loop.
- Implemented **Inference Dial** for `thinking` with three physical selector
  positions, synchronized gaze, and a 2.4-second loop.
- Added reduced-motion behavior to both new animation sources.
- Expanded the browser motion lab to compare `idle`, `thinking`, and
  `working.default` side by side.
- Produced 1000×1000 GIF previews, four-phase contact sheets, and a shared
  96px identity check for the new motion baseline.
- Standardized all implemented states on the same 45×45 view box so state
  changes preserve character scale.

## Locked character contract

| Part | Geometry/color |
| --- | --- |
| Torso | `x=2 y=6 width=11 height=7` |
| Claws | `x=0/13 y=9 width=2 height=2` |
| Legs | `x=3/5/9/11 y=13 width=1 height=2` |
| Eyes | `x=4/10 y=8 width=1 height=2` |
| Body color | `#DE886D` |
| Eye color | `#000000` |

## Full-build roadmap

### 1. Motion language

- Approve or revise the Reasoning Gearbox.
- Review and freeze the 12-state action bible.
- Implement and visually validate each approved primary state.
- Establish shared pixel-grid, timing, easing, and reduced-motion rules.

### 2. Mac application

- Build the desktop pet window and transparent interaction region.
- Add drag, click, wake, sleep, and screen-edge behavior.
- Build the menu bar controller, preferences, and notification layer.
- Connect AI-agent events to the Maclawd state system.

### 3. Product identity

- Create the Maclawd app icon and visual identity.
- Define product identifiers, local storage, and update channels.
- Complete accessibility, localization, and onboarding.

### 4. Distribution

- Produce a universal Apple Silicon and Intel build.
- Test installation, launch, permissions, updates, and uninstall behavior.
- Add hardened runtime, Developer ID signing, and notarization.
- Publish the first `.dmg` release.

## Not implemented yet

- No running Maclawd application exists yet.
- The animation SVGs are not connected to an application runtime yet.
- Nine primary action groups remain design-only and have no SVG implementation.
- No application icon, signed binary, notarized build, or `.dmg` exists yet.

The public repository is a progress checkpoint, not a release claim.
