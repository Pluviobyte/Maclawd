<p align="center">
  <img src="previews/all-actions-v5-96px.png" width="1000" alt="Maclawd V5.3 body-first motion set at pet size">
</p>

<h1 align="center">Maclawd</h1>

<p align="center"><strong>Clawd has moved into your Mac.</strong></p>

<p align="center">
  An original Mac desktop companion built around new accessories, actions,
  interactions, and system behavior.
</p>

> [!IMPORTANT]
> Maclawd has completed its first full motion-design checkpoint. There is no downloadable macOS
> application yet. The current V5.3 checkpoint is a complete body-first motion design system.

## What we are building

Maclawd is planned as a complete Mac product:

- original animated actions for work, rest, attention, success, and errors
- contextual props only when they make the character's action more expressive
- live reactions to AI-agent activity
- Mac desktop, menu bar, notification, and settings behavior
- independent product identity, icon, packaging, update flow, and release system
- a signed and notarized universal macOS application

## Complete 23-action motion set

The first full SVG/CSS action system is implemented. The body, claws, legs,
eyes, coordinates, and base colors remain identical in every file; only poses,
temporary props, and discrete animation change.

| Layer | Count | Purpose |
| --- | ---: | --- |
| Primary states | 12 | Rest, Agent activity, owner attention, system feedback |
| Working modifiers | 5 | Reading, writing, building, testing, syncing |
| Interactions and ambient actions | 6 | Click, double click, drag, drop, edge peek, low battery |

[Open the live motion lab](index.html) ·
[View the complete 96px check](previews/all-actions-v5-96px.png) ·
[View the 64px check](previews/all-actions-v5-64px.png) ·
[Read the primary-state contract](design/main-state-actions.md) ·
[Read working modifiers](design/activity-modifiers.md) ·
[Read interactions](design/interaction-actions.md) ·
[Read animation QA](design/animation-qa.md)

### Primary states

| `away` | `sleeping` | `waking` | `success` |
| --- | --- | --- | --- |
| <img src="previews/blanket-drag-v5.gif" width="180" alt="Maclawd Blanket Tug animation"> | <img src="previews/blanket-burrito-v5.gif" width="180" alt="Maclawd Top-down Sleep animation"> | <img src="previews/blanket-pop-v5.gif" width="180" alt="Maclawd Morning Stretch animation"> | <img src="previews/self-high-five-v5.gif" width="180" alt="Maclawd Self High-five animation"> |
| Blanket Tug | Top-down Sleep | Morning Stretch | Self High-five |

The sleep chain deliberately reuses one blanket, so `away → sleeping → waking`
reads as a continuous story. The sleep loop uses a top-down pillow, blanket,
closed-eye, and pixel-Zzz composition with no mattress or bottom pad. V5.3 is
body-first throughout: no rugs, desks, paths, cushions, floor strips, hanging
bars, mattresses, or full-scene bases. Small props overlap the body, attach to
one side, or stack vertically in **Puzzle Turn**, **Tile Stack**, **Parcel Stack**,
**Stuck Jar**, **Suitcase Fold**, **Workspace Folder**, and **Basket Rescue**.

### Working modifiers and interactions

Detailed activities are only shown when an external event can classify them
reliably. Generic busy activity always falls back to **Tile Stack**; `command`
is an alias of that generic state rather than a sixth prop animation. The pet
never invents a task from an opaque Agent state. Interaction actions are driven
by the Mac app's own input and system events and do not require Agent internals.

## Earlier executable motion baseline

These previews remain available for design history. The old accessory-free idle,
Inference Dial, and Reasoning Gearbox have all been superseded by V5:

- `idle` — **Calm Calibration**, a 5.6-second accessory-free breathing loop
- `thinking` — **Inference Dial**, a 2.4-second three-position selector loop
- `working.default` — **Reasoning Gearbox**, a 2.8-second clutch-and-crank loop

| `idle` | `thinking` | `working.default` |
| --- | --- | --- |
| <img src="previews/calm-calibration.gif" width="220" alt="Maclawd Calm Calibration animation"> | <img src="previews/inference-dial.gif" width="220" alt="Maclawd Inference Dial animation"> | <img src="previews/reasoning-gearbox.gif" width="220" alt="Maclawd Reasoning Gearbox animation"> |

[Open current Quiet Watch](src/animations/calm-calibration.svg) ·
[Open Thinking](src/animations/inference-dial.svg) ·
[Open Working](src/animations/reasoning-gearbox.svg) ·
[Read the design contract](design/reasoning-gearbox.md) ·
[View the 96px identity check](previews/primary-motion-96px.png)

The complete twelve-state motion system is specified in
[`design/main-state-actions.md`](design/main-state-actions.md), with a matching
machine-readable contract in
[`design/main-state-actions.json`](design/main-state-actions.json).

## Repository status

This repository has an independent Git history and contains only Maclawd work.
The current checkpoint includes 23 active animations, one historical command
compatibility entry, two retained mechanical prototypes, individual GIF previews,
64px and 96px review boards,
machine-readable state maps, the browser motion lab, and the development roadmap.

See [`PROGRESS.md`](PROGRESS.md) for completed work and the full build sequence.

## Preview locally

Open [`index.html`](index.html) in a browser. The preview has no build step and
loads the production SVG directly.

## Character notice

Clawd is the property of [Anthropic](https://www.anthropic.com). Maclawd is an
unofficial fan project and is not affiliated with or endorsed by Anthropic.

Unless stated otherwise, Maclawd project files are all rights reserved. See
[`LICENSE`](LICENSE).
