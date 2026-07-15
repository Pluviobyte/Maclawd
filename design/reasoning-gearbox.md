# Reasoning Gearbox

Status: first visual prototype; not connected to an application state.

## Character invariants

The animation must preserve the following body and eye values:

- torso: `x=2 y=6 width=11 height=7`
- claws: `x=0/13 y=9 width=2 height=2`
- legs: `x=3/5/9/11 y=13 width=1 height=2`
- eyes: `x=4/10 y=8 width=1 height=2`
- body color: `#DE886D`
- eye color: `#000000`

Body parts remain crisp integer-grid rectangles without outlines, gradients,
soft shading, or replacement eye shapes.

## Accessory

Reasoning Gearbox is a shoulder-mounted mechanical rig. Three interlocking pixel
gears connect to a clutch and ratchet on the left and a crank on the right.

The group excludes the legacy prop vocabulary: screens, keyboards, headphones,
construction tools, books, boxes, batons, brooms, bubbles, juggling objects, and
moving data blocks.

## Action

- the screen-right claw pumps a four-position crank
- the screen-left claw toggles a mechanical clutch
- three attached gears rotate in opposing stepped directions
- the ratchet advances one pixel during each drive phase
- the body makes a restrained mechanical recoil
- the eyes stay centered and perform one short blink

Loop duration: 2.8 seconds. Animation technology: CSS keyframes only.
