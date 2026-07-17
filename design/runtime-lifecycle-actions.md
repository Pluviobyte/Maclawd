# Runtime lifecycle and ambient action contract

This V5.4 layer completes the visible runtime vocabulary without pretending that
Maclawd can inspect an Agent's private chain of thought. Every state requires a
reliable app, owner, system, or event-adapter signal; unknown work remains
`thinking` or generic `working`.

## Runtime lifecycle

| State | Motion | Reliable trigger | Exit |
| --- | --- | --- | --- |
| `launching` | **Hello Unfold** | Pet window becomes ready | `idle` |
| `quitting` | **Goodbye Tuck** | Graceful termination starts | hidden |
| `moving` | **Sideways Scuttle** | The pet changes desktop position | previous stable state |
| `waiting` | **Claw Tap Wait** | An adapter reports a real external wait | event-driven |
| `paused` | **Statue Pause** | Owner/runtime explicitly pauses | event-driven |
| `cancelled` | **Tiny Shrug** | A cancellation event arrives | `idle` |
| `owner_resolved` | **Jar Click** | Owner answers a pending request | previous stable state |
| `recovering` | **Basket Breakout** | Recovery begins after `error` | `working` or `idle` |

`Jar Click` closes the visual story begun by `Stuck Jar`. `Basket Breakout`
closes the story begun by `Basket Rescue`. They reuse the same prop families but
perform a new action instead of replaying the previous state.

## Idle and environment

| State | Motion | Role |
| --- | --- | --- |
| `idle.grooming` | **Claw Groom** | Quiet self-care variation |
| `idle.leg_shuffle` | **Leg Shuffle** | Four-leg resettling variation |
| `idle.drowsy` | **Drowsy Nod** | Long-idle variation before, but not during, the sleep chain |
| `interaction.hover` | **Cursor Gaze** | Follows an implied pointer without drawing one |
| `ambient.notification` | **Attention Turn** | Reacts to a Maclawd-owned notification |
| `ambient.offline` | **Signal Listen** | Listens in both directions without a network icon |
| `ambient.reconnecting` | **Ready Wiggle** | Celebrates a restored configured connection |

`ambient.power_connected` deliberately aliases the existing **Morning Stretch**
source. Restored energy is already legible in that body action, so a charger,
cable, or battery badge would only add another technical prop.

## Scheduling rules

- One-shot lifecycle transitions interrupt loops and return to their declared
  exit state after their final frame.
- `moving` temporarily overlays the prior stable state and can mirror for
  screen-left travel without changing frame order.
- Idle variants are weighted, infrequent loops; **Quiet Watch** remains the
  default idle and always appears between variants.
- Interaction reactions override everything briefly. Graceful `quitting` is the
  only terminal transition and cannot be interrupted.
- No lifecycle action is selected from guessed tool names, language names,
  progress percentages, or invisible reasoning steps.

The machine-readable version is
[`runtime-lifecycle-actions.json`](runtime-lifecycle-actions.json).
