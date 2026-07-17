# Maclawd playful motion direction v3

Status: approved direction with the first four production animation candidates
implemented. The mechanical v2 set remains available as design history. This
document reframes the state system around character acting, everyday metaphors,
and short visual stories.

## What the reference project gets right

The reference project does not render agent events as literal interface states.
It translates them into small performances: compaction becomes sweeping,
worktree creation becomes carrying, parallel work becomes juggling, and idle
time sometimes becomes reading. Its personality comes from the mismatch between
a serious technical event and a tiny pet earnestly doing a familiar activity.

Three structural ideas are worth keeping without copying its actions:

1. **Act first, prop second.** A readable pose and emotional reaction carry the
   state; the prop only completes the joke.
2. **One loop is a tiny story.** Set up, attempt, react, recover. A fixed machine
   that merely blinks is not a story.
3. **Variety creates life.** Idle variants, session-count variants, transitions,
   and click reactions prevent the pet from becoming a status icon.

## Maclawd v3 rules

- Keep the locked body and eye source rectangles and the shared 45×45 view box.
- Prefer soft, domestic, craft, toy, and snack metaphors over control panels,
  gears, warning lamps, and industrial frames.
- Aim for roughly 70% character pose, 20% temporary prop, and 10% signal color.
- Props enter for the action and leave afterward; they are not permanent body
  upgrades.
- Use asymmetry, anticipation, effort, surprise, and recovery to create charm.
- Give important states a two-beat or three-beat gag that still reads at 96px.
- Preserve the reference project's liveliness, not its exact accessories,
  choreography, or silhouettes.

## New metaphor set

| State | v3 action idea | Tiny story |
| --- | --- | --- |
| `idle` | Pocket Fidget | Looks around, taps one claw, settles again; occasional rare variant picks up a tiny shell. |
| `away` | Blanket Drag | Yawns, finds a blanket, and slowly drags it into place. |
| `sleeping` | Blanket Burrito | Pulls the blanket over itself and gently squashes with each breath. |
| `waking` | Blanket Pop | The blanket tents upward, Maclawd pops out, then kicks it aside. |
| `thinking` | Shell Shuffle | Compares three colorful shells, swaps them twice, then carefully chooses one. |
| `working` | Token Knitting | Knits a short striped ribbon; it grows, curls, and is proudly inspected. |
| `delegating` | Hatchling Parade | Winds up tiny helper crabs and sends them off in a wobbly follow-the-leader line. |
| `needs_owner` | Stuck Jar | Tries twice to open a tiny jar, fails, then pushes it toward the owner. |
| `compacting` | Accordion Fold | Wrestles a long paper strip into a pocket-sized accordion bundle. |
| `workspace` | Pop-up Studio | Unfolds a flat paper packet into a tiny freestanding work nook. |
| `success` | Self High-five | Both claws miss once, connect on the second try, and the body hops with pride. |
| `error` | Yarn Tangle | The working yarn knots around one claw; Maclawd pulls, tumbles, and peeks up. |

## First implemented motion group

The first four v3 states now have CSS/SVG loops, GIF previews, contact sheets,
reduced-motion behavior, and a shared 96px motion check:

- `thinking` — Shell Shuffle
- `working` — Token Knitting
- `delegating` — Hatchling Parade
- `needs_owner` — Stuck Jar

The remaining states should be redrawn in this language before their animation
timing is implemented.
