# Maclawd primary-state static concepts

Status: complete static review set. These concepts define pose, silhouette, and
accessory placement; only `idle` currently points to an approved production
animation. The retained `thinking` and `working` v2 concepts and the other nine
states remain unanimated review candidates.

## Design rule

- The locked body and eye source rectangles are preserved in every SVG.
- Every concept uses the same `viewBox="-15 -25 45 45"`.
- The face and torso remain the first visual center.
- Props must touch a claw, shoulder mount, or ground base.
- Each state has one connected action system, without floating symbols,
  surrounding cages, overhead hero machinery, or detached effects.

## State set

| State | Static action | Main visual cue |
| --- | --- | --- |
| `idle` | Calm Calibration | No accessory; neutral scale reference |
| `away` | Power-down Stretch | Extended claws and tired eyes |
| `sleeping` | Dock Nest | Body settled into shared dock |
| `waking` | Dock Eject | Body lifted above the same dock |
| `thinking` | Compact Dial | Small three-position shoulder selector |
| `working` | Twin Drive Core | Compact two-claw processing core |
| `delegating` | Parallel Armature | Three short arms from one allocator |
| `needs_owner` | Decision Gate | Right-side choice panel with untouched controls |
| `compacting` | Memory Press | Segmented ribbon, rollers, and cartridge |
| `workspace` | Foldout Bench | Two deployed work-surface wings |
| `success` | Completion Stamp | Pressed lever and attached green plate |
| `error` | Jam Recovery | Red jammed drive and reverse lever |

## Review artifacts

- [`concepts/all-primary-states.html`](concepts/all-primary-states.html) — local
  browser review page.
- [`../previews/all-primary-states.png`](../previews/all-primary-states.png) —
  full overview.
- [`../previews/all-primary-states-96px.png`](../previews/all-primary-states-96px.png)
  — semantic check at pet size.

Approval of this sheet freezes the accessory silhouettes before CSS animation
work begins.
