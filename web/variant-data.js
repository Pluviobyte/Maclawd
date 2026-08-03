/* 由 scripts/build-variants.mjs 生成，请勿直接编辑。 */
window.MaclawdVariants = {
  "axes": [
    {
      "id": "base",
      "label": "基准",
      "note": "当前实现，作对照"
    },
    {
      "id": "bold",
      "label": "幅度加倍",
      "note": "所有位移 ×2（取整），节奏不变"
    },
    {
      "id": "brisk",
      "label": "节奏加快",
      "note": "时长 ×0.7，幅度不变"
    },
    {
      "id": "languid",
      "label": "舒缓",
      "note": "时长 ×1.4，幅度减半"
    },
    {
      "id": "staccato",
      "label": "顿挫",
      "note": "极端姿势停更久、过渡更快——缓动更重"
    }
  ],
  "actions": [
    {
      "id": "idle",
      "name": "Quiet Watch",
      "group": "primary",
      "state": "idle",
      "source": "src/animations/calm-calibration.svg",
      "durationMs": 5600,
      "isMini": false
    },
    {
      "id": "idle.grooming",
      "name": "Claw Groom",
      "group": "lifecycle",
      "state": "idle-grooming",
      "source": "src/animations/idle-claw-groom.svg",
      "durationMs": 5200,
      "isMini": false
    },
    {
      "id": "idle.leg_shuffle",
      "name": "Leg Shuffle",
      "group": "lifecycle",
      "state": "idle-leg-shuffle",
      "source": "src/animations/idle-leg-shuffle.svg",
      "durationMs": 4800,
      "isMini": false
    },
    {
      "id": "idle.drowsy",
      "name": "Drowsy Nod",
      "group": "lifecycle",
      "state": "idle-drowsy",
      "source": "src/animations/idle-drowsy-nod.svg",
      "durationMs": 6000,
      "isMini": false
    },
    {
      "id": "working",
      "name": "Tile Feed",
      "group": "primary",
      "state": "working",
      "source": "src/animations/token-knitting.svg",
      "durationMs": 3400,
      "isMini": false
    },
    {
      "id": "thinking",
      "name": "Puzzle Turn",
      "group": "primary",
      "state": "thinking",
      "source": "src/animations/shell-shuffle.svg",
      "durationMs": 4600,
      "isMini": false
    },
    {
      "id": "delegating",
      "name": "Parcel Stack",
      "group": "primary",
      "state": "delegating",
      "source": "src/animations/hatchling-parade.svg",
      "durationMs": 5000,
      "isMini": false
    },
    {
      "id": "compacting",
      "name": "Suitcase Fold",
      "group": "primary",
      "state": "compacting",
      "source": "src/animations/accordion-fold.svg",
      "durationMs": 4800,
      "isMini": false
    },
    {
      "id": "needs_owner",
      "name": "Stuck Jar",
      "group": "primary",
      "state": "needs-owner",
      "source": "src/animations/stuck-jar.svg",
      "durationMs": 4800,
      "isMini": false
    },
    {
      "id": "success",
      "name": "Self High-five",
      "group": "primary",
      "state": "success",
      "source": "src/animations/self-high-five.svg",
      "durationMs": 2900,
      "isMini": false
    },
    {
      "id": "error",
      "name": "Basket Rescue",
      "group": "primary",
      "state": "error",
      "source": "src/animations/yarn-tangle.svg",
      "durationMs": 4800,
      "isMini": false
    },
    {
      "id": "away",
      "name": "Blanket Tug",
      "group": "primary",
      "state": "away",
      "source": "src/animations/blanket-drag.svg",
      "durationMs": 3800,
      "isMini": false
    },
    {
      "id": "sleeping",
      "name": "Top-down Sleep",
      "group": "primary",
      "state": "sleeping",
      "source": "src/animations/blanket-burrito.svg",
      "durationMs": 6400,
      "isMini": false
    },
    {
      "id": "waking",
      "name": "Morning Stretch",
      "group": "primary",
      "state": "waking",
      "source": "src/animations/blanket-pop.svg",
      "durationMs": 2600,
      "isMini": false
    },
    {
      "id": "working.building",
      "name": "Block Stack",
      "group": "modifier",
      "state": "building",
      "source": "src/animations/block-tower.svg",
      "durationMs": 5000,
      "isMini": false
    },
    {
      "id": "working.testing",
      "name": "Toy Check",
      "group": "modifier",
      "state": "testing",
      "source": "src/animations/wobble-test.svg",
      "durationMs": 4800,
      "isMini": false
    },
    {
      "id": "interaction.click",
      "name": "Poke Squish",
      "group": "interaction",
      "state": "click",
      "source": "src/animations/click-flinch.svg",
      "durationMs": 2200,
      "isMini": false
    },
    {
      "id": "interaction.double_click",
      "name": "Surprised Hop",
      "group": "interaction",
      "state": "double-click",
      "source": "src/animations/surprised-hop.svg",
      "durationMs": 2400,
      "isMini": false
    },
    {
      "id": "interaction.drag",
      "name": "Hanging Loop",
      "group": "interaction",
      "state": "drag",
      "source": "src/animations/drag-cling.svg",
      "durationMs": 3200,
      "isMini": false
    },
    {
      "id": "interaction.drop",
      "name": "Drop Wobble",
      "group": "interaction",
      "state": "drop",
      "source": "src/animations/drop-wobble.svg",
      "durationMs": 2600,
      "isMini": false
    },
    {
      "id": "interaction.hover",
      "name": "Cursor Gaze",
      "group": "lifecycle",
      "state": "hover",
      "source": "src/animations/hover-gaze.svg",
      "durationMs": 3000,
      "isMini": false
    },
    {
      "id": "ambient.edge",
      "name": "Curtain Peek",
      "group": "interaction",
      "state": "edge",
      "source": "src/animations/edge-peek.svg",
      "durationMs": 4600,
      "isMini": false
    },
    {
      "id": "ambient.low_battery",
      "name": "Low Battery Droop",
      "group": "interaction",
      "state": "low-battery",
      "source": "src/animations/low-battery-droop.svg",
      "durationMs": 6200,
      "isMini": false
    },
    {
      "id": "ambient.offline",
      "name": "Signal Listen",
      "group": "lifecycle",
      "state": "offline",
      "source": "src/animations/signal-listen.svg",
      "durationMs": 5200,
      "isMini": false
    },
    {
      "id": "launching",
      "name": "Hello Unfold",
      "group": "lifecycle",
      "state": "launching",
      "source": "src/animations/hello-unfold.svg",
      "durationMs": 2800,
      "isMini": false
    },
    {
      "id": "quitting",
      "name": "Goodbye Tuck",
      "group": "lifecycle",
      "state": "quitting",
      "source": "src/animations/goodbye-tuck.svg",
      "durationMs": 2800,
      "isMini": false
    },
    {
      "id": "waiting",
      "name": "Claw Tap Wait",
      "group": "lifecycle",
      "state": "waiting",
      "source": "src/animations/claw-tap-wait.svg",
      "durationMs": 4200,
      "isMini": false
    },
    {
      "id": "paused",
      "name": "Statue Pause",
      "group": "lifecycle",
      "state": "paused",
      "source": "src/animations/statue-pause.svg",
      "durationMs": 6000,
      "isMini": false
    },
    {
      "id": "owner_resolved",
      "name": "Jar Click",
      "group": "lifecycle",
      "state": "owner-resolved",
      "source": "src/animations/jar-click.svg",
      "durationMs": 3200,
      "isMini": false
    },
    {
      "id": "recovering",
      "name": "Basket Breakout",
      "group": "lifecycle",
      "state": "recovering",
      "source": "src/animations/basket-breakout.svg",
      "durationMs": 3400,
      "isMini": false
    },
    {
      "id": "working.retrying",
      "name": "Retry Grip",
      "group": "modifier",
      "state": "working-retrying",
      "source": "src/animations/work-retry.svg",
      "durationMs": 3400,
      "isMini": false
    },
    {
      "id": "working.long",
      "name": "Deep Work",
      "group": "modifier",
      "state": "working-long",
      "source": "src/animations/work-long.svg",
      "durationMs": 5000,
      "isMini": false
    },
    {
      "id": "drowsing",
      "name": "Fading Watch",
      "group": "primary",
      "state": "drowsing",
      "source": "src/animations/fading-watch.svg",
      "durationMs": 4200,
      "isMini": false
    },
    {
      "id": "collapsing",
      "name": "Blanket Fold",
      "group": "primary",
      "state": "collapsing",
      "source": "src/animations/blanket-fold.svg",
      "durationMs": 3000,
      "isMini": false
    },
    {
      "id": "self.stretch",
      "name": "Long Stretch",
      "group": "lifecycle",
      "state": "self-stretch",
      "source": "src/animations/self-stretch.svg",
      "durationMs": 3200,
      "isMini": false
    },
    {
      "id": "self.peek",
      "name": "Upward Peek",
      "group": "lifecycle",
      "state": "self-peek",
      "source": "src/animations/self-peek.svg",
      "durationMs": 2800,
      "isMini": false
    },
    {
      "id": "self.roam",
      "name": "Little Wander",
      "group": "lifecycle",
      "state": "self-roam",
      "source": "src/animations/self-roam.svg",
      "durationMs": 4600,
      "isMini": false
    },
    {
      "id": "mini.walk",
      "name": "Edge Shuffle",
      "group": "mini",
      "state": "mini-walk",
      "source": "src/animations/mini-walk.svg",
      "durationMs": 3800,
      "isMini": true
    },
    {
      "id": "mini.sleep",
      "name": "Edge Sleep",
      "group": "mini",
      "state": "mini-sleep",
      "source": "src/animations/mini-sleep.svg",
      "durationMs": 6000,
      "isMini": true
    },
    {
      "id": "mini.idle",
      "name": "Edge Doze",
      "group": "mini",
      "state": "mini-idle",
      "source": "src/animations/mini-idle.svg",
      "durationMs": 5200,
      "isMini": true
    },
    {
      "id": "mini.busy",
      "name": "Edge Bob",
      "group": "mini",
      "state": "mini-busy",
      "source": "src/animations/mini-busy.svg",
      "durationMs": 3200,
      "isMini": true
    },
    {
      "id": "mini.peek",
      "name": "Edge Peek",
      "group": "mini",
      "state": "mini-peek",
      "source": "src/animations/mini-peek.svg",
      "durationMs": 3600,
      "isMini": true
    },
    {
      "id": "mini.alert",
      "name": "Edge Tap",
      "group": "mini",
      "state": "mini-alert",
      "source": "src/animations/mini-alert.svg",
      "durationMs": 2400,
      "isMini": true
    },
    {
      "id": "mini.error",
      "name": "Edge Slump",
      "group": "mini",
      "state": "mini-error",
      "source": "src/animations/mini-error.svg",
      "durationMs": 4400,
      "isMini": true
    },
    {
      "id": "mini.happy",
      "name": "Edge Bounce",
      "group": "mini",
      "state": "mini-happy",
      "source": "src/animations/mini-happy.svg",
      "durationMs": 2400,
      "isMini": true
    },
    {
      "id": "mini.enter",
      "name": "Tuck In",
      "group": "mini",
      "state": "mini-enter",
      "source": "src/animations/mini-enter.svg",
      "durationMs": 1600,
      "isMini": true
    },
    {
      "id": "mini.exit",
      "name": "Pop Out",
      "group": "mini",
      "state": "mini-exit",
      "source": "src/animations/mini-exit.svg",
      "durationMs": 1600,
      "isMini": true
    }
  ]
};
