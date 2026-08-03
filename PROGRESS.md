# Maclawd development progress

Last updated: 2026-07-17

## Current checkpoint

Maclawd is a standalone project with an independent repository and Git history.
Its first complete body-first motion-design system is now implemented:

- 12 primary states
- 5 optional `working` activity modifiers
- 6 interaction and ambient actions
- 8 runtime lifecycle actions
- 3 idle variants and 4 additional interaction/environment actions
- 38 active CSS/SVG animations in total, plus one deliberate power-connected alias

The body, claws, legs, eyes, colors, and source coordinates are identical across
the full set. V5.4 keeps the V5.3 body-first rule that removes every horizontal stage, including the sleeping
mattress. Props overlap the body, sit to one side, or stack vertically. The
macOS application runtime and event integration have
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
- Rebuilt `sleeping` as a direct overhead pose without a mattress or bottom pad:
  Clawd lies flat on a pillow, keeps both closed eyes and claws visible, breathes
  under the blanket, and emits a user-approved three-step pixel `Zzz` sequence.
- Replaced the working modifier set with five compact actions: **Pocket Book**,
  **Letter Note**, **Block Stack**, **Toy Check**, and **Spool Sync**.
  `working.command` now aliases generic **Tile Stack**.
- Added six desktop/system actions: **Poke Squish**, **Surprised Hop**, **Hanging
  Loop**, **Drop Wobble**, **Curtain Peek**, and **Low Battery Droop**.
- Added eight runtime lifecycle actions: **Hello Unfold**, **Goodbye Tuck**,
  **Sideways Scuttle**, **Claw Tap Wait**, **Statue Pause**, **Tiny Shrug**,
  **Jar Click**, and **Basket Breakout**.
- Closed two incomplete state stories: `needs_owner → owner_resolved` keeps the
  same jar family, while `error → recovering` keeps the same basket family.
- Added three weighted idle variants—**Claw Groom**, **Leg Shuffle**, and
  **Drowsy Nod**—while keeping **Quiet Watch** as the required default between
  variants.
- Added four observable environment reactions: **Cursor Gaze**, **Attention
  Turn**, **Signal Listen**, and **Ready Wiggle**. Power connected deliberately
  aliases **Morning Stretch** instead of adding a charger or battery prop.
- Defined conservative Hook behavior: detailed working modifiers require a
  reliable external event; otherwise the system falls back to generic working.
- Added machine-readable contracts for primary states, modifiers, and
  interactions.
- Rebuilt the browser motion lab to display all 38 actions directly from their
  production SVG sources.
- Rendered every active action into a deterministic V5 GIF preview and generated
  new 64px and 96px complete-set boards.
- Removed 15 horizontal base constructions: rugs, desks, paths, cushions,
  floor strips, the clothesline, the hanging bar, and the sleeping mattress. The current
  38-action set stays within the compact pet-size envelope at the 96px QA size.
- Fixed the deterministic preview renderer to resize the SVG root before
  pet-size capture; all 38 GIF previews now contain real animated content.
- Verified all 41 SVG sources parse and preserve the locked source rectangles:
  38 current actions, one historical command entry, and two mechanical prototypes.
- Produced browser-rendered 64px and 96px boards covering all 38 active actions.
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

## Implemented since that checkpoint

- **Runtime.** `src/runtime/` — token scanner across 21 AI coding tools, rollup with
  `model × project × source` cells, pricing, LAN mirror, permission broker, probe.
  Node 20+, pure ESM, zero npm dependencies.
- **State engine.** `src/runtime/state-engine.js` — priority arbitration across
  concurrent sessions, minimum dwell, one-shot insertion, energy model, fallback
  chain. Drives 31 main-form actions plus 8 tucked-edge `mini` actions.
- **Agent event adapter.** `hooks/maclawd-hook.js` registers 14 Claude Code hook
  events. Bash commands are classified in-process — the raw command never crosses
  the boundary.
- **macOS shell.** `mac/Sources/Maclawd/` — Swift 6 / SwiftPM, transparent
  borderless `NSWindow` rendering the CSS-animated SVGs in `WKWebView` (zero asset
  conversion), menu-bar mark, login item, drag / click / hover / edge-dock input.
- **Packaging.** `mac/package.sh` builds `Maclawd.app` with a **self-contained Node
  runtime bundled inside** (`Contents/Resources/node`, fetched and SHA256-verified
  by `mac/vendor-node.sh`). App ~117 MB, DMG ~44 MB. Programmatic app icon.
- **Tests.** 270, covering token-accounting invariants, state arbitration, redaction,
  motion quality (pose density, easing, pixel grid), and demo-site data hygiene.

## Still not done

- **No Developer ID signing or notarization.** `package.sh` produces an ad-hoc
  signature, which `spctl --assess` **rejects**. The app runs fine on the machine
  that built it, but anyone who downloads the DMG hits Gatekeeper and must
  right-click → Open (or `xattr -d com.apple.quarantine`). Real distribution needs
  a paid Apple Developer account; set `MACLAWD_SIGN_ID` and the script takes the
  Developer ID path instead.
- ~~Apple Silicon only.~~ **Fixed.** `MACLAWD_UNIVERSAL=1 ./package.sh` (implied by
  `MACLAWD_DMG=1`) produces a universal binary — `lipo`-joined arm64 + x86_64 Swift
  slices, plus both Node runtimes selected per-slice at build time. The DMG path
  forces it, so a single-architecture build can never be handed to anyone.
  Cost: the app goes 117 MB → 235 MB, because it carries two full Node runtimes.
- **14 of 21 tool parsers have never seen real data.** All 21 have synthetic
  fixtures, so a regression breaks a test — but a fixture only proves the parser
  matches *our reading* of the format, not the format itself. The seven that have
  been run against real logs on a live machine (Claude Code, Codex, Kimi Code,
  Qwen Code, Grok, OpenClaw, WorkBuddy) all pass every invariant. The rest need the
  corresponding tool installed; there is no way to close this from here.
- **Never dogfooded for a full working day.** Everything above is verified by tests
  and by launching the app, not by living with it. This is the largest remaining
  unknown: every time this project *was* run for real, it immediately surfaced a
  defect that no test had caught — `PostToolUse` erasing work modifiers, the drag
  pose never appearing, the pet grabbable from 93 px of empty space.
- **The `working` action is unresolved.** Sixteen candidates are built and deployed
  at `/working-candidates`; none is selected. `working` currently plays Tile Feed.

## Interaction

Drag, click, double-click, hover and edge-dock all route through the state engine.
Two things worth knowing because they are easy to get wrong and were:

- **A click is only a click if no drag happened.** Reporting it on mouse-down makes
  every drag start by playing the 2.2 s poke reaction.
- **The window is 135×135 but the character occupies 6.7 % of it.** Hit testing is
  clamped to the character's bounding box (derived from `characterContract`, asserted
  by a test) and the remaining 88 % passes clicks through to whatever is underneath.

Window position survives restart, and is discarded if the screen it was saved on is
gone — otherwise the pet reappears somewhere invisible and reads as "didn't launch".

---

The public repository is a working application plus a validated motion system —
but it is not a signed release, and installing it still requires a Gatekeeper bypass.
