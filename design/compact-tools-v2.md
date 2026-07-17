# Compact tools v2 — static review candidates

Status: visual review only. These files do not replace the current animated
`thinking` or `working.default` sources.

## Shared correction

- Keep the original 45×45 view box and locked body/eye rectangles.
- Keep the face and torso as the first visual center.
- Use one connected tool per state.
- Remove surrounding rails, overhead machinery, and detached focal points.
- Limit the accessory palette to structure gray plus amber/cyan signals.

## Static QA

- `thinking` total silhouette width: 19 units versus the 15-unit claw-to-claw
  body width (`1.27×`). The dial itself is only 6 units wide.
- `working` remains inside the original claw-to-claw width; no accessory extends
  beyond `x=0…15`.
- Both concepts use the same `viewBox="-15 -25 45 45"` as the implemented
  states, so the body scale is directly comparable.
- A 96px comparison is available at
  [`../previews/compact-tools-v2-96px.png`](../previews/compact-tools-v2-96px.png).

## `thinking` candidate — Compact Dial

The old shoulder frame is replaced by one six-pixel-wide three-position dial
touching the left shoulder. The left claw operates the selector directly; the
right claw remains relaxed. A future animation would rotate only the pointer,
change the selected stop, shift the eyes, and add a restrained body response.

Source: [`concepts/thinking-compact-dial-v2.svg`](concepts/thinking-compact-dial-v2.svg)

## `working` candidate — Twin Drive Core

The overhead gearbox and side cranks are replaced by one chest-height core held
between both claws. One amber main gear drives one smaller cyan gear. A future
animation would rotate the two gears in opposition while the claws alternate a
one-pixel push, keeping the body and face visually dominant.

Source: [`concepts/working-twin-drive-core-v2.svg`](concepts/working-twin-drive-core-v2.svg)

## Review rule

Do not replace `src/animations/inference-dial.svg` or
`src/animations/reasoning-gearbox.svg` until these static silhouettes are
explicitly approved.
