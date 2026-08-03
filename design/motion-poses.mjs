/**
 * 重做过的动作的姿态谱。
 *
 * 为什么用数据 + 生成器，而不是继续手写 CSS：
 *
 * 1. **缓动是算出来的，不是手排的。** 定格动画的缓动靠不均匀的保持时长
 *    （极端姿势多停、中间姿势快过）。手排百分比时人会不自觉地等分——
 *    实测旧动作 36 条里 31 条的变异系数低于 0.35，`moving-body` 干脆是
 *    [20,20,20,20,20]。这里只写「权重」，百分比由生成器算，等分不可能发生。
 *
 * 2. **每个图层可以有自己的周期。** 旧架构里所有图层共享 --duration，
 *    整套动作每 N 秒精确重复一次，人眼会认出这个周期。身体、爪、腿、眼睛
 *    各走不同周期后，合成图案的重复周期变成最小公倍数——读作「活的」
 *    而不是「在循环」。这是让待机动作耐看的关键，成本几乎为零。
 *
 * 3. **位移一律取整数单位。** 主形态 135px ÷ 45 单位 = 3px/单位，
 *    整数位移才落在设备像素边界上。非整数会让矩形边缘忽宽忽窄。
 *
 * 姿态权重约定：极端姿势 2–3，中间过渡姿势 1。
 */

/** 缩写：造一串姿态，[transform, 权重]。权重省略时为 1。 */
const p = (transform, weight = 1) => [transform, weight];

export const ANIMATIONS = [
  // ---------------------------------------------------------------- idle
  {
    state: 'idle',
    svg: {
      file: 'calm-calibration.svg',
      title: 'Quiet Watch',
      desc: 'With no stage prop, Maclawd breathes, shifts weight, glances around, and blinks.',
    },
    duration: 5600,
    comment: '安静观察。桌宠绝大部分时间停在这里，所以它值得最多的层次：\n'
      + '   呼吸、重心、爪、腿、视线、眨眼各走各的周期。',
    layers: [
      {
        sel: '.actor',
        name: 'idle-body',
        // 呼吸：吸气快、屏住久、呼气慢。整数单位，只有 1 格幅度——
        // 幅度不是重点，节奏才是。
        poses: [
          p('translateY(0)', 3), p('translateY(-1px)', 1), p('translateY(-1px)', 3),
          p('translateY(0)', 1), p('translateY(0)', 2), p('translateY(1px)', 1),
          p('translateY(0)', 2),
        ],
      },
      {
        sel: '.left-claw',
        name: 'idle-left',
        period: 4200, // 与呼吸不同周期，两者合成后不重复
        poses: [
          p('translate(0,0)', 3), p('translate(0,-1px)', 1), p('translate(1px,-1px)', 2),
          p('translate(1px,0)', 1), p('translate(0,0)', 3),
        ],
      },
      {
        sel: '.right-claw',
        name: 'idle-right',
        period: 3400,
        poses: [
          p('translate(0,0)', 4), p('translate(0,-1px)', 1), p('translate(-1px,0)', 2),
          p('translate(0,0)', 1),
        ],
      },
      {
        sel: '.eyes',
        name: 'idle-eyes',
        period: 3100, // 视线移动与眨眼分开，眨眼在下面
        poses: [
          p('translate(0,0)', 4), p('translate(1px,0)', 2), p('translate(1px,0)', 1),
          p('translate(0,0)', 3), p('translate(-1px,0)', 2), p('translate(0,0)', 4),
        ],
      },
      {
        sel: '.blink',
        name: 'idle-blink',
        period: 6700, // 质数化的周期，避免和视线对齐成规律
        poses: [
          p('scaleY(1)', 12), p('scaleY(.15)', 1), p('scaleY(1)', 6),
          p('scaleY(.15)', 1), p('scaleY(1)', 3),
        ],
      },
    ],
  },

  // ------------------------------------------------------- idle.grooming
  {
    state: 'idle-grooming',
    svg: {
      file: 'idle-claw-groom.svg',
      title: 'Claw Groom',
      desc: 'Maclawd leans down and scrubs one claw against the other.',
    },
    duration: 5200,
    comment: '低头擦爪。动作核心是「擦」这个往复，所以擦的那几拍要密。',
    layers: [
      {
        sel: '.actor',
        name: 'groom-body',
        poses: [
          p('translate(0,0)', 3), p('translate(0,1px)', 1), p('translate(0,2px)', 4),
          p('translate(0,2px)', 3), p('translate(0,1px)', 1), p('translate(0,0)', 3),
        ],
      },
      {
        sel: '.left-claw',
        name: 'groom-left',
        // 擦：快速往复六下，中间不停顿——这是全动作的重点
        poses: [
          p('translate(0,0)', 3), p('translate(2px,1px)', 1), p('translate(3px,2px)', 2),
          p('translate(2px,2px)', 1), p('translate(3px,2px)', 1), p('translate(2px,2px)', 1),
          p('translate(3px,2px)', 1), p('translate(2px,2px)', 1), p('translate(3px,2px)', 1),
          p('translate(2px,1px)', 1), p('translate(0,0)', 3),
        ],
      },
      {
        sel: '.right-claw',
        name: 'groom-right',
        poses: [
          p('translate(0,0)', 4), p('translate(-1px,1px)', 1), p('translate(-1px,2px)', 6),
          p('translate(-1px,1px)', 1), p('translate(0,0)', 3),
        ],
      },
      {
        sel: '.eyes',
        name: 'groom-eyes',
        poses: [
          p('translate(0,0)', 3), p('translate(0,1px)', 1), p('translate(1px,1px)', 7),
          p('translate(0,1px)', 1), p('translate(0,0)', 3),
        ],
      },
      {
        sel: '.blink',
        name: 'groom-blink',
        period: 5900,
        poses: [p('scaleY(1)', 9), p('scaleY(.15)', 1), p('scaleY(1)', 5)],
      },
    ],
  },

  // --------------------------------------------------- idle.leg_shuffle
  {
    state: 'idle-leg-shuffle',
    svg: {
      file: 'idle-leg-shuffle.svg',
      title: 'Leg Shuffle',
      desc: 'Maclawd lifts each of the four legs in turn to find a comfortable stance.',
      splitLegs: true,
    },
    duration: 4800,
    comment: '四条腿依次挪动重新找站姿。四条腿必须错开，同时抬会读成跳。',
    layers: [
      {
        sel: '.actor',
        name: 'shuffle-body',
        poses: [
          p('translate(0,0)', 3), p('translate(-1px,0)', 2), p('translate(-1px,-1px)', 1),
          p('translate(-1px,0)', 2), p('translate(0,0)', 1), p('translate(1px,0)', 2),
          p('translate(1px,-1px)', 1), p('translate(1px,0)', 2), p('translate(0,0)', 3),
        ],
      },
      { sel: '.leg-a', name: 'shuffle-leg-a', period: 4800,
        poses: [p('translateY(0)', 5), p('translateY(-1px)', 1), p('translateY(0)', 10)] },
      { sel: '.leg-b', name: 'shuffle-leg-b', period: 4800,
        poses: [p('translateY(0)', 8), p('translateY(-1px)', 1), p('translateY(0)', 7)] },
      { sel: '.leg-c', name: 'shuffle-leg-c', period: 4800,
        poses: [p('translateY(0)', 11), p('translateY(-1px)', 1), p('translateY(0)', 4)] },
      { sel: '.leg-d', name: 'shuffle-leg-d', period: 4800,
        poses: [p('translateY(0)', 2), p('translateY(-1px)', 1), p('translateY(0)', 13)] },
      {
        sel: '.eyes',
        name: 'shuffle-eyes',
        period: 3300,
        poses: [
          p('translate(0,0)', 3), p('translate(-1px,0)', 2), p('translate(0,0)', 2),
          p('translate(1px,0)', 2), p('translate(0,0)', 3),
        ],
      },
      {
        sel: '.blink',
        name: 'shuffle-blink',
        period: 6100,
        poses: [p('scaleY(1)', 10), p('scaleY(.15)', 1), p('scaleY(1)', 4)],
      },
    ],
  },

  // ----------------------------------------------------- idle.drowsy
  {
    state: 'idle-drowsy',
    svg: {
      file: 'idle-drowsy-nod.svg',
      title: 'Drowsy Nod',
      desc: 'Maclawd nods off, sinks low, then snaps awake in a single beat.',
    },
    duration: 6000,
    comment: '打瞌睡再惊醒。关键是「点头下沉」要慢、「惊醒」要在一拍内完成——\n'
      + '   这个对比就是缓动本身，等分排百分比会把它彻底毁掉。',
    layers: [
      {
        sel: '.actor',
        name: 'drowsy-body',
        poses: [
          p('translate(0,0)', 3), p('translate(0,1px)', 2), p('translate(0,1px)', 1),
          p('translate(0,2px)', 2), p('translate(0,2px)', 1), p('translate(0,3px)', 2),
          p('translate(0,3px)', 4), // 沉到底，停最久
          p('translate(0,-2px)', 1), // 惊醒：一拍弹起，还要过冲
          p('translate(0,1px)', 1), p('translate(0,-1px)', 1), p('translate(0,0)', 1),
          p('translate(0,0)', 2),
        ],
      },
      {
        sel: '.left-claw',
        name: 'drowsy-left',
        poses: [
          p('translate(0,0)', 3), p('translate(0,1px)', 2), p('translate(0,3px)', 8),
          p('translate(0,-1px)', 1), p('translate(0,0)', 4),
        ],
      },
      {
        sel: '.right-claw',
        name: 'drowsy-right',
        poses: [
          p('translate(0,0)', 3), p('translate(0,1px)', 2), p('translate(0,3px)', 8),
          p('translate(0,-1px)', 1), p('translate(0,0)', 4),
        ],
      },
      {
        sel: '.eyes',
        name: 'drowsy-eyes',
        poses: [
          p('translate(0,0)', 3), p('translate(0,1px)', 2), p('translate(0,3px)', 8),
          p('translate(0,-1px)', 1), p('translate(0,0)', 4),
        ],
      },
      {
        sel: '.blink',
        name: 'drowsy-blink',
        // 越来越困：眼睛闭得越来越久，惊醒时猛地睁大
        poses: [
          p('scaleY(1)', 3), p('scaleY(.5)', 2), p('scaleY(1)', 1), p('scaleY(.35)', 3),
          p('scaleY(.15)', 6), p('scaleY(1)', 5),
        ],
      },
    ],
  },

  // ------------------------------------------------------------- working
  {
    state: 'working',
    svg: {
      file: 'token-knitting.svg',
      title: 'Tile Feed',
      desc: 'Work tiles arrive from below in an unbroken stream; Maclawd receives each '
        + 'with one claw and passes it up with the other, never returning to rest.',
      // 道具在**身前**：接在手里的东西画在身后会被躯干挡掉一半。
      // 两块牌同一个起始位置，靠半个周期的相位差错开，所以永远
      // 一块在下方进场、一块在上方离场——画面上不存在「没有牌」的瞬间。
      propsAfter: '<g class="work-tile-a motion"><rect x="5" y="11" width="5" height="4" fill="#7BC8C4"/>'
        + '<rect x="6" y="12" width="3" height="1" fill="#BDE7E4"/></g>'
        + '<g class="work-tile-b motion"><rect x="5" y="11" width="5" height="4" fill="#B9A1D9"/>'
        + '<rect x="6" y="12" width="3" height="1" fill="#E7DCF2"/></g>',
    },
    duration: 3400,
    comment: '工作牌不断从下方流入，一只爪接住、另一只送上去，循环不停。\n'
      + '\n'
      + '   **重做的原因**：旧版首尾两个姿态都是 translate(0,0)，加起来 43% 的\n'
      + '   循环停在原位；而且首尾同为原位，跨过循环接缝后是连续 1.5 秒的静止。\n'
      + '   于是它读作「干一下、停一下」，不是持续在工作。\n'
      + '\n'
      + '   所以这一版有三条硬约束：\n'
      + '   1. **没有任何静止姿态**——身体永远带着位移，最「静」的姿态也偏 1 格。\n'
      + '   2. **接缝必须无痕**——末帧与首帧刻意不同，且相差恰好一格，接得上。\n'
      + '   3. **材料必须在推进**——牌的位置单调上行并首尾淡出，这才是「在干活」\n'
      + '      而不是「在原地摆弄」。旧版的牌只是上下抖 1 格，没有去向。',
    layers: [
      {
        sel: '.actor',
        name: 'work-body',
        // 两拍：左爪接的时候重心左沉，右爪送的时候重心右沉。
        // 全程没有 translate(0,0)。
        poses: [
          p('translate(0,-1px)', 2), p('translate(-1px,0)', 1), p('translate(-1px,1px)', 2),
          p('translate(-1px,0)', 1), p('translate(0,-1px)', 2), p('translate(1px,0)', 1),
          p('translate(1px,1px)', 2), p('translate(1px,0)', 1),
        ],
      },
      {
        sel: '.left-claw',
        name: 'work-left',
        // 周期是身体的一半：每一拍都要接一次，节奏才不断。
        period: 1700,
        poses: [
          p('translate(4px,3px)', 2), p('translate(4px,1px)', 1), p('translate(3px,-1px)', 2),
          p('translate(3px,0)', 1), p('translate(4px,2px)', 1),
        ],
      },
      {
        sel: '.right-claw',
        name: 'work-right',
        // 与左爪反相：左爪往上交的时候，右爪正好在上面等着接。
        period: 1700,
        poses: [
          p('translate(-3px,0)', 2), p('translate(-3px,-2px)', 1), p('translate(-4px,-3px)', 2),
          p('translate(-4px,-1px)', 1), p('translate(-3px,1px)', 1),
        ],
      },
      {
        sel: '.work-tile-a',
        name: 'work-tile-a',
        // 从画面下方进来、在上方淡出。单调上行，不折返。
        // 行程上限压在眼睛以下：牌升到脸的高度会和眼睛抢位置，
        // 而脸是桌宠的身份。牌在胸口被「收下」并淡出，语义上也更对——
        // 是处理掉了，不是飞走了。
        poses: [
          p('opacity:0;transform:translateY(8px)', 1), p('opacity:1;transform:translateY(6px)', 2),
          p('opacity:1;transform:translateY(4px)', 2), p('opacity:1;transform:translateY(2px)', 2),
          p('opacity:1;transform:translateY(1px)', 2), p('opacity:1;transform:translateY(0)', 2),
          p('opacity:0;transform:translateY(-2px)', 1),
        ],
      },
      {
        sel: '.work-tile-b',
        name: 'work-tile-b',
        // 与 a 相差半个周期：同一串姿态，从中间接着写。
        poses: [
          p('opacity:1;transform:translateY(1px)', 2), p('opacity:1;transform:translateY(0)', 2),
          p('opacity:0;transform:translateY(-2px)', 1), p('opacity:0;transform:translateY(8px)', 1),
          p('opacity:1;transform:translateY(6px)', 2), p('opacity:1;transform:translateY(4px)', 2),
          p('opacity:1;transform:translateY(2px)', 2),
        ],
      },
      {
        sel: '.eyes',
        name: 'work-eyes',
        // 视线跟着上行的牌走，但周期与身体不同——目光不该踩在手的节拍上。
        period: 2900,
        poses: [
          p('translate(0,1px)', 3), p('translate(0,0)', 2), p('translate(0,-1px)', 2),
          p('translate(0,0)', 2), p('translate(0,1px)', 2),
        ],
      },
      {
        sel: '.blink',
        name: 'work-blink',
        period: 4700,
        poses: [p('scaleY(1)', 11), p('scaleY(.15)', 1), p('scaleY(1)', 4)],
      },
    ],
  },
];

// ============================================================================
// 第二批：主状态与工作链
//
// 时长一律沿用契约里的原值——状态机的最小驻留与插播时序都依赖它。
// 每个动作的语义也照原样保留，改的只是姿态密度与节奏。
// ============================================================================

ANIMATIONS.push(
  {
    state: 'thinking',
    duration: 4600,
    comment: '双爪间转动拼图、比对两面、停顿。「停顿」那一拍要最长——\n'
      + '   思考的读感来自停顿，不来自转动。',
    layers: [
      // 停顿是**保持一个姿势**，不是回到原点：held 的姿势读作「在想」，
      // 回中立读作「停了」。首尾也刻意不同，避免跨接缝把停顿加倍。
      { sel: '.actor', name: 'think-body', poses: [
        p('translate(0,-1px)', 2), p('translate(-1px,-1px)', 1), p('translate(-1px,-2px)', 2),
        p('translate(0,-1px)', 1), p('translate(1px,-2px)', 2), p('translate(1px,-1px)', 1),
        p('translate(0,-2px)', 4), p('translate(0,-1px)', 1), p('translate(-1px,-1px)', 1) ] },
      { sel: '.left-claw', name: 'think-left', poses: [
        p('translate(0,0)', 2), p('translate(2px,-1px)', 1), p('translate(3px,-1px)', 2),
        p('translate(4px,-2px)', 1), p('translate(5px,-2px)', 2), p('translate(4px,-3px)', 1),
        p('translate(4px,-4px)', 4), p('translate(0,0)', 2) ] },
      { sel: '.right-claw', name: 'think-right', poses: [
        p('translate(0,0)', 2), p('translate(-3px,-1px)', 1), p('translate(-5px,-2px)', 2),
        p('translate(-4px,-1px)', 1), p('translate(-3px,-1px)', 2), p('translate(-4px,-3px)', 1),
        p('translate(-4px,-4px)', 4), p('translate(0,0)', 2) ] },
      { sel: '.puzzle-piece', name: 'think-piece', origin: '8px 16px', poses: [
        p('translate(0,0) rotate(0)', 2), p('translate(-1px,-1px) rotate(-4deg)', 1),
        p('translate(-2px,-1px) rotate(-7deg)', 2), p('translate(0,-1px) rotate(0)', 1),
        p('translate(2px,-1px) rotate(7deg)', 2), p('translate(1px,-2px) rotate(4deg)', 1),
        p('translate(0,-2px) rotate(0)', 4), p('translate(0,0) rotate(0)', 2) ] },
      { sel: '.eyes', name: 'think-eyes', period: 3700, poses: [
        p('translate(-1px,0)', 3), p('translate(0,0)', 1), p('translate(1px,0)', 3),
        p('translate(0,-1px)', 2), p('translate(0,0)', 3) ] },
      { sel: '.blink', name: 'think-blink', period: 5300, poses: [
        p('scaleY(1)', 10), p('scaleY(.15)', 1), p('scaleY(1)', 5) ] },
    ],
  },

  {
    state: 'delegating',
    duration: 5000,
    comment: '把包裹递给身侧接力的助手。递出去那一下要快，等待接手要慢。',
    layers: [
      { sel: '.actor', name: 'delegate-body', poses: [
        p('translate(0,-1px)', 3), p('translate(-1px,-2px)', 1), p('translate(-1px,-2px)', 3),
        p('translate(0,-2px)', 1), p('translate(1px,-2px)', 3), p('translate(0,-1px)', 1),
        p('translate(-1px,-1px)', 3) ] },
      { sel: '.left-claw', name: 'delegate-left', poses: [
        p('translate(0,0)', 3), p('translate(-2px,0)', 1), p('translate(-4px,1px)', 3),
        p('translate(0,-1px)', 1), p('translate(3px,-2px)', 3), p('translate(2px,-1px)', 1),
        p('translate(0,0)', 3) ] },
      { sel: '.right-claw', name: 'delegate-right', poses: [
        p('translate(0,0)', 3), p('translate(-2px,-1px)', 1), p('translate(-3px,-2px)', 3),
        p('translate(1px,-1px)', 1), p('translate(4px,1px)', 3), p('translate(3px,-1px)', 1),
        p('translate(0,0)', 3) ] },
      { sel: '.parcel', name: 'delegate-parcel', origin: '7px 14px', poses: [
        p('translate(0,0)', 3), p('translate(-2px,-1px)', 1), p('translate(-4px,0)', 3),
        p('translate(0,-2px)', 1), p('translate(4px,0)', 3), p('translate(2px,-1px)', 1),
        p('translate(0,0)', 3) ] },
      { sel: '.helper-a', name: 'helper-a', origin: '-4px 15px', poses: [
        p('opacity:0;transform:translate(-1px,1px)', 3), p('translate(-1px,0)', 1),
        p('translate(0,0)', 3), p('translate(1px,1px)', 3), p('translate(2px,0)', 3),
        p('translate(3px,1px)', 3) ] },
      { sel: '.helper-b', name: 'helper-b', origin: '18px 15px', poses: [
        p('translate(-3px,1px)', 5), p('translate(-2px,0)', 3), p('translate(-1px,1px)', 3),
        p('translate(0,0)', 3), p('translate(1px,1px)', 2) ] },
      { sel: '.eyes', name: 'delegate-eyes', period: 3900, poses: [
        p('translate(-1px,1px)', 3), p('translate(-2px,1px)', 2), p('translate(0,1px)', 1),
        p('translate(1px,1px)', 3), p('translate(0,1px)', 2) ] },
      { sel: '.blink', name: 'delegate-blink', period: 6300, poses: [
        p('scaleY(1)', 11), p('scaleY(.15)', 1), p('scaleY(1)', 4) ] },
    ],
  },

  {
    state: 'compacting',
    duration: 4800,
    comment: '把条纹布逐折塞进行李箱。每一折是一次「压」——压下去要快、\n'
      + '   松手回弹要有一拍，这样才有材料的手感。',
    layers: [
      { sel: '.actor', name: 'fold-body', poses: [
        p('translate(0,-1px)', 2), p('translate(0,1px)', 1), p('translate(0,2px)', 2),
        p('translate(0,1px)', 1), p('translate(-1px,-1px)', 1), p('translate(0,1px)', 1),
        p('translate(0,2px)', 2), p('translate(0,1px)', 1), p('translate(1px,-1px)', 1),
        p('translate(0,1px)', 1), p('translate(0,2px)', 2), p('translate(0,1px)', 1),
        p('translate(1px,0)', 2) ] },
      { sel: '.left-claw', name: 'fold-left', poses: [
        p('translate(0,0)', 2), p('translate(2px,1px)', 1), p('translate(3px,3px)', 2),
        p('translate(2px,1px)', 1), p('translate(1px,0)', 1), p('translate(2px,1px)', 1),
        p('translate(3px,3px)', 2), p('translate(2px,1px)', 1), p('translate(1px,0)', 1),
        p('translate(2px,1px)', 1), p('translate(3px,3px)', 2), p('translate(2px,1px)', 1),
        p('translate(0,0)', 2) ] },
      { sel: '.right-claw', name: 'fold-right', poses: [
        p('translate(0,0)', 2), p('translate(-2px,1px)', 1), p('translate(-3px,3px)', 2),
        p('translate(-2px,1px)', 1), p('translate(-1px,0)', 1), p('translate(-2px,1px)', 1),
        p('translate(-3px,3px)', 2), p('translate(-2px,1px)', 1), p('translate(-1px,0)', 1),
        p('translate(-2px,1px)', 1), p('translate(-3px,3px)', 2), p('translate(-2px,1px)', 1),
        p('translate(0,0)', 2) ] },
      { sel: '.accordion', name: 'fold-accordion', origin: '7.5px 14px', poses: [
        p('scaleY(1)', 2), p('scaleY(.9)', 1), p('scaleY(.8)', 2), p('scaleY(.84)', 1),
        p('scaleY(.8)', 1), p('scaleY(.7)', 1), p('scaleY(.6)', 2), p('scaleY(.64)', 1),
        p('scaleY(.6)', 1), p('scaleY(.5)', 1), p('scaleY(.4)', 2), p('scaleY(.44)', 1),
        p('scaleY(1)', 2) ] },
      { sel: '.eyes', name: 'fold-eyes', period: 3500, poses: [
        p('translate(0,1px)', 4), p('translate(0,2px)', 2), p('translate(0,1px)', 3) ] },
      { sel: '.blink', name: 'fold-blink', period: 5700, poses: [
        p('scaleY(1)', 9), p('scaleY(.15)', 1), p('scaleY(1)', 5) ] },
    ],
  },

  {
    state: 'needs-owner',
    duration: 4800,
    comment: '拧两次拧不开，使劲，然后把罐子推给主人。「使劲」那一拍要最长，\n'
      + '   推出去要在一拍内完成——这个对比就是「放弃」的读法。',
    layers: [
      { sel: '.actor', name: 'jar-body', poses: [
        p('translate(0,0)', 2), p('translate(-1px,0)', 1), p('translate(1px,0)', 1),
        p('translate(-1px,0)', 1), p('translate(1px,0)', 1), p('translate(0,-1px)', 4),
        p('translate(2px,0)', 1), p('translate(1px,0)', 3) ] },
      { sel: '.left-claw', name: 'jar-left', poses: [
        p('translate(0,0)', 2), p('translate(-2px,-1px)', 1), p('translate(-1px,-2px)', 1),
        p('translate(-2px,-1px)', 1), p('translate(-1px,-2px)', 1), p('translate(-2px,-2px)', 4),
        p('translate(1px,0)', 1), p('translate(0,0)', 3) ] },
      { sel: '.right-claw', name: 'jar-right', poses: [
        p('translate(0,0)', 2), p('translate(-1px,-1px)', 1), p('translate(-2px,-2px)', 1),
        p('translate(-1px,-1px)', 1), p('translate(-2px,-2px)', 1), p('translate(-2px,-3px)', 4),
        p('translate(2px,0)', 1), p('translate(1px,0)', 3) ] },
      { sel: '.jar', name: 'jar-prop', origin: '-4px 16px', poses: [
        p('translate(0,0) rotate(0)', 2), p('rotate(-3deg)', 1), p('rotate(3deg)', 1),
        p('rotate(-3deg)', 1), p('rotate(3deg)', 1), p('rotate(0)', 4),
        p('translate(3px,0) rotate(6deg)', 1), p('translate(4px,0) rotate(4deg)', 3) ] },
      { sel: '.lid', name: 'jar-lid', origin: '-4px 8px', poses: [
        p('rotate(0)', 2), p('rotate(-5deg)', 1), p('rotate(5deg)', 1), p('rotate(-5deg)', 1),
        p('rotate(5deg)', 1), p('rotate(0)', 4), p('translate(3px,0)', 1),
        p('translate(4px,0)', 3) ] },
      { sel: '.eyes', name: 'jar-eyes', period: 3300, poses: [
        p('translate(-1px,0)', 3), p('translate(-1px,1px)', 3), p('translate(0,0)', 2),
        p('translate(1px,0)', 3) ] },
      { sel: '.blink', name: 'jar-blink', period: 5500, poses: [
        p('scaleY(1)', 8), p('scaleY(.15)', 1), p('scaleY(1)', 4) ] },
    ],
  },

  {
    state: 'success',
    duration: 2900,
    comment: '起跳，双爪在头顶碰到，落回。跳的顶点要停住一拍——\n'
      + '   没有滞空的跳跃读不出兴奋。',
    layers: [
      { sel: '.actor', name: 'highfive-body', poses: [
        p('translate(0,0)', 2), p('translate(0,-2px)', 1), p('translate(0,-5px)', 3),
        p('translate(0,-4px)', 1), p('translate(0,-1px)', 1), p('translate(0,1px)', 2),
        p('translate(0,0)', 1), p('translate(0,0)', 2) ] },
      { sel: '.left-claw', name: 'highfive-left', poses: [
        p('translate(0,0)', 2), p('translate(3px,-3px)', 1), p('translate(5px,-6px)', 3),
        p('translate(4px,-5px)', 1), p('translate(2px,-2px)', 1), p('translate(0,1px)', 2),
        p('translate(0,0)', 3) ] },
      { sel: '.right-claw', name: 'highfive-right', poses: [
        p('translate(0,0)', 2), p('translate(-3px,-3px)', 1), p('translate(-5px,-6px)', 3),
        p('translate(-4px,-5px)', 1), p('translate(-2px,-2px)', 1), p('translate(0,1px)', 2),
        p('translate(0,0)', 3) ] },
      { sel: '.eyes', name: 'highfive-eyes', poses: [
        p('translate(0,0)', 2), p('translate(0,-1px)', 1), p('translate(0,-1px)', 4),
        p('translate(0,1px)', 2), p('translate(0,0)', 3) ] },
      { sel: '.blink', name: 'highfive-blink', period: 2900, poses: [
        p('scaleY(1)', 7), p('scaleY(.15)', 1), p('scaleY(1)', 4) ] },
    ],
  },

  {
    state: 'error',
    duration: 4800,
    comment: '被篮子扣住、挣脱、站稳、又被碰倒。挣扎要密集，被碰倒要突然。',
    layers: [
      { sel: '.actor', name: 'fail-body', poses: [
        p('translate(0,2px)', 3), p('translate(-1px,2px)', 1), p('translate(1px,1px)', 1),
        p('translate(-1px,1px)', 1), p('translate(1px,0)', 1), p('translate(0,0)', 3),
        p('translate(0,-1px)', 1), p('translate(1px,1px)', 1), p('translate(0,2px)', 2) ] },
      { sel: '.left-claw', name: 'fail-left', poses: [
        p('translate(1px,1px)', 3), p('translate(-1px,0)', 1), p('translate(1px,-1px)', 1),
        p('translate(-1px,0)', 1), p('translate(0,-1px)', 1), p('translate(0,0)', 3),
        p('translate(1px,0)', 1), p('translate(1px,1px)', 3) ] },
      { sel: '.right-claw', name: 'fail-right', poses: [
        p('translate(-1px,1px)', 3), p('translate(1px,0)', 1), p('translate(-1px,-1px)', 1),
        p('translate(1px,0)', 1), p('translate(0,-1px)', 1), p('translate(0,0)', 3),
        p('translate(-1px,0)', 1), p('translate(-1px,1px)', 3) ] },
      { sel: '.basket', name: 'fail-basket', origin: '8px 18px', poses: [
        p('translate(0,0) rotate(0)', 3), p('rotate(-4deg)', 1), p('rotate(4deg)', 1),
        p('rotate(-4deg)', 1), p('translate(0,-3px) rotate(8deg)', 1),
        p('translate(1px,-6px) rotate(14deg)', 3), p('translate(1px,-4px) rotate(10deg)', 1),
        p('translate(0,-1px) rotate(4deg)', 1), p('translate(0,0) rotate(0)', 2) ] },
      { sel: '.eyes', name: 'fail-eyes', period: 3100, poses: [
        p('translate(0,1px)', 3), p('translate(-1px,1px)', 2), p('translate(1px,1px)', 2),
        p('translate(0,0)', 3) ] },
      { sel: '.blink', name: 'fail-blink', period: 4300, poses: [
        p('scaleY(1)', 6), p('scaleY(.15)', 1), p('scaleY(1)', 3) ] },
    ],
  },
);

// ============================================================================
// 第三批：睡眠链、互动、生命周期与环境
//
// 睡眠链是用户明确要求保留的，所以它值得和待机同等的层次密度。
// 互动类是**反应**：起手要快、回位要慢，跟待机的匀速呼吸是相反的节奏。
// ============================================================================

ANIMATIONS.push(
  {
    state: 'away',
    duration: 3800,
    comment: '犯困，把小毛毯拉到身边。拉的动作要有阻力感：起拉快、拖行慢。',
    layers: [
      { sel: '.actor', name: 'away-body', poses: [
        p('translate(0,0)', 2), p('translate(-1px,0)', 1), p('translate(-2px,-1px)', 2),
        p('translate(-1px,-1px)', 1), p('translate(0,-1px)', 1), p('translate(1px,-1px)', 2),
        p('translate(0,0)', 1), p('translate(0,1px)', 3), p('translate(0,0)', 2) ] },
      { sel: '.left-claw', name: 'away-left', poses: [
        p('translate(0,0)', 2), p('translate(-3px,0)', 1), p('translate(-5px,1px)', 2),
        p('translate(-4px,1px)', 1), p('translate(-2px,1px)', 1), p('translate(-1px,0)', 2),
        p('translate(0,1px)', 1), p('translate(0,2px)', 3), p('translate(0,0)', 2) ] },
      { sel: '.right-claw', name: 'away-right', poses: [
        p('translate(0,0)', 2), p('translate(1px,0)', 1), p('translate(2px,1px)', 2),
        p('translate(1px,1px)', 1), p('translate(0,1px)', 1), p('translate(-1px,1px)', 2),
        p('translate(0,2px)', 1), p('translate(0,2px)', 3), p('translate(0,0)', 2) ] },
      { sel: '.blanket', name: 'away-blanket', origin: '-5px 16px', poses: [
        p('translate(0,0) rotate(0)', 2), p('translate(1px,0) rotate(-3deg)', 1),
        p('translate(3px,0) rotate(-8deg)', 2), p('translate(4px,0) rotate(-6deg)', 1),
        p('translate(5px,0) rotate(-4deg)', 1), p('translate(6px,1px) rotate(-2deg)', 2),
        p('translate(6px,1px) rotate(0)', 4), p('translate(6px,1px) rotate(0)', 2) ] },
      { sel: '.eyes', name: 'away-eyes', period: 2900, poses: [
        p('scaleY(1)', 4), p('translateY(1px) scaleY(.5)', 2), p('scaleY(1)', 2),
        p('translateY(1px) scaleY(.35)', 3) ] },
      { sel: '.blink', name: 'away-blink', period: 4700, poses: [
        p('scaleY(1)', 7), p('scaleY(.15)', 1), p('scaleY(1)', 3) ] },
    ],
  },

  {
    state: 'sleeping',
    duration: 6400,
    comment: '俯视平躺盖被呼吸，三个 Zzz 依次升起。呼吸是全动作唯一的节拍，\n'
      + '   所以它必须是**慢的深呼吸**——吸 2 拍、屏 1 拍、呼 3 拍。\n'
      + '   三个 Z 各走自己的周期，否则会读成一个整体在闪。',
    layers: [
      { sel: '.actor', name: 'sleep-body', origin: '7.5px 10px', poses: [
        p('scaleY(1)', 3), p('scaleY(1.03)', 1), p('scaleY(1.06)', 2), p('scaleY(1.06)', 1),
        p('scaleY(1.04)', 1), p('scaleY(1.02)', 1), p('scaleY(1)', 3) ] },
      { sel: '.sleep-claws', name: 'sleep-claws', origin: '7.5px 12px', poses: [
        p('translate(0,0)', 3), p('translate(0,-1px)', 2), p('translate(0,-1px)', 2),
        p('translate(0,0)', 1), p('translate(0,0)', 4) ] },
      { sel: '.pillow', name: 'sleep-pillow', origin: '7.5px 7px', poses: [
        p('scaleY(1)', 4), p('scaleY(.98)', 3), p('scaleY(1)', 5) ] },
      { sel: '.blanket', name: 'sleep-blanket', origin: '7.5px 19px', poses: [
        p('scaleY(1)', 3), p('scaleY(1.02)', 1), p('scaleY(1.05)', 2), p('scaleY(1.05)', 1),
        p('scaleY(1.03)', 1), p('scaleY(1.01)', 1), p('scaleY(1)', 3) ] },
      { sel: '.z-one', name: 'sleep-z-one', period: 6400, poses: [
        p('opacity:0;transform:translate(0,0)', 3), p('opacity:1;transform:translate(0,-1px)', 1),
        p('opacity:1;transform:translate(1px,-3px)', 2), p('opacity:1;transform:translate(1px,-5px)', 2),
        p('opacity:0;transform:translate(2px,-7px)', 4) ] },
      { sel: '.z-two', name: 'sleep-z-two', period: 6400, poses: [
        p('opacity:0;transform:translate(0,0)', 6), p('opacity:1;transform:translate(0,-1px)', 1),
        p('opacity:1;transform:translate(1px,-3px)', 2), p('opacity:1;transform:translate(1px,-5px)', 2),
        p('opacity:0;transform:translate(2px,-7px)', 3) ] },
      { sel: '.z-three', name: 'sleep-z-three', period: 6400, poses: [
        p('opacity:0;transform:translate(0,0)', 9), p('opacity:1;transform:translate(0,-1px)', 1),
        p('opacity:1;transform:translate(1px,-3px)', 2), p('opacity:1;transform:translate(1px,-5px)', 2),
        p('opacity:0;transform:translate(2px,-7px)', 2) ] },
    ],
  },

  {
    state: 'waking',
    duration: 2600,
    comment: '起身伸展，毛毯滑落。伸展的顶点要停住——没有顶点的伸展读不出「舒服」。',
    layers: [
      { sel: '.actor', name: 'wake-body', poses: [
        p('translateY(2px) scaleY(.84)', 2), p('translateY(0) scaleY(.96)', 1),
        p('translateY(-3px) scaleY(1.1)', 3), p('translateY(-2px) scaleY(1.06)', 1),
        p('translateY(-1px)', 1), p('translateY(1px) scaleY(.95)', 2), p('translateY(0)', 3) ] },
      { sel: '.left-claw', name: 'wake-left', poses: [
        p('translate(2px,1px)', 2), p('translate(-1px,-1px)', 1), p('translate(-4px,-3px)', 3),
        p('translate(-3px,-2px)', 1), p('translate(-3px,-1px)', 1), p('translate(-1px,0)', 2),
        p('translate(0,0)', 3) ] },
      { sel: '.right-claw', name: 'wake-right', poses: [
        p('translate(-2px,1px)', 2), p('translate(1px,-1px)', 1), p('translate(4px,-3px)', 3),
        p('translate(3px,-2px)', 1), p('translate(3px,-1px)', 1), p('translate(1px,0)', 2),
        p('translate(0,0)', 3) ] },
      { sel: '.blanket', name: 'wake-blanket', origin: '2px 16px', poses: [
        p('translate(2px,-3px) rotate(0)', 2), p('translate(1px,-4px) rotate(-3deg)', 1),
        p('translate(0,-4px) rotate(-6deg)', 3), p('translate(-1px,-3px) rotate(-8deg)', 1),
        p('translate(-2px,-1px) rotate(-10deg)', 1), p('translate(-3px,0) rotate(-12deg)', 2),
        p('translate(-3px,1px) rotate(-12deg)', 3) ] },
      { sel: '.eyes', name: 'wake-eyes', poses: [
        p('translateY(1px)', 2), p('translateY(0)', 1), p('translateY(-1px)', 4),
        p('translateY(0)', 2), p('translateY(0)', 4) ] },
      { sel: '.blink', name: 'wake-blink', poses: [
        p('scaleY(.15)', 2), p('scaleY(1)', 5), p('scaleY(.15)', 1), p('scaleY(1)', 5) ] },
    ],
  },

  {
    state: 'building',
    duration: 5000,
    comment: '在身侧纵向叠积木。放下去那一刻要「顿」一拍，才有重量。',
    layers: [
      { sel: '.actor', name: 'build-body', poses: [
        p('translate(0,-1px)', 3), p('translate(-1px,0)', 1), p('translate(-1px,-1px)', 3),
        p('translate(0,-1px)', 1), p('translate(0,1px)', 4), p('translate(1px,1px)', 1),
        p('translate(1px,0)', 1), p('translate(-1px,0)', 1), p('translate(-1px,1px)', 3) ] },
      { sel: '.left-claw', name: 'build-left', poses: [
        p('translate(0,0)', 2), p('translate(-2px,-2px)', 1), p('translate(-4px,-4px)', 2),
        p('translate(-4px,-2px)', 1), p('translate(-4px,0)', 2), p('translate(-2px,1px)', 1),
        p('translate(0,0)', 2), p('translate(-1px,-1px)', 1), p('translate(0,0)', 2) ] },
      { sel: '.right-claw', name: 'build-right', poses: [
        p('translate(0,0)', 3), p('translate(-1px,1px)', 1), p('translate(-2px,1px)', 3),
        p('translate(-1px,0)', 1), p('translate(0,0)', 3), p('translate(0,1px)', 1),
        p('translate(0,0)', 2) ] },
      { sel: '.block-top', name: 'build-block', origin: '-3px 15px', poses: [
        p('translate(0,0)', 2), p('translate(0,-2px)', 1), p('translate(0,-4px)', 2),
        p('translate(0,-2px)', 1), p('translate(0,0)', 4), p('translate(0,0)', 1),
        p('translate(0,-1px)', 1), p('translate(0,0)', 2) ] },
      { sel: '.eyes', name: 'build-eyes', period: 3700, poses: [
        p('translate(-1px,0)', 4), p('translate(-1px,-1px)', 2), p('translate(0,0)', 3) ] },
      { sel: '.blink', name: 'build-blink', period: 5900, poses: [
        p('scaleY(1)', 9), p('scaleY(.15)', 1), p('scaleY(1)', 5) ] },
    ],
  },

  {
    state: 'testing',
    duration: 4800,
    comment: '轻推不倒翁并观察回正。回正的摆幅要逐次变小——等幅摆动读作机械。',
    layers: [
      // 「观察不倒翁回正」不是站着不动：保持一个前倾盯着看的姿势，
      // 中间还要跟着它摆两下——不然 4.8 秒里有 3 秒多是静止图。
      { sel: '.actor', name: 'test-body', poses: [
        p('translate(0,-1px)', 2), p('translate(-1px,0)', 1), p('translate(-2px,0)', 2),
        p('translate(-1px,0)', 1), p('translate(-1px,-1px)', 3), p('translate(0,-1px)', 1),
        p('translate(-1px,-1px)', 2), p('translate(0,-1px)', 1), p('translate(-1px,-1px)', 2),
        p('translate(-1px,0)', 1), p('translate(0,-2px)', 1) ] },
      { sel: '.left-claw', name: 'test-left', poses: [
        p('translate(0,0)', 3), p('translate(-3px,0)', 1), p('translate(-5px,1px)', 2),
        p('translate(-3px,0)', 1), p('translate(-1px,0)', 5), p('translate(0,-1px)', 1),
        p('translate(0,0)', 3) ] },
      { sel: '.right-claw', name: 'test-right', poses: [
        p('translate(0,0)', 4), p('translate(-1px,0)', 2), p('translate(0,0)', 6),
        p('translate(0,-1px)', 1), p('translate(0,0)', 3) ] },
      { sel: '.toy', name: 'test-toy', origin: '-4px 17px', poses: [
        p('rotate(0)', 3), p('rotate(-6deg)', 1), p('rotate(-14deg)', 2), p('rotate(-6deg)', 1),
        p('rotate(6deg)', 1), p('rotate(10deg)', 1), p('rotate(2deg)', 1), p('rotate(-6deg)', 1),
        p('rotate(-2deg)', 1), p('rotate(3deg)', 1), p('rotate(0)', 3) ] },
      { sel: '.eyes', name: 'test-eyes', period: 3300, poses: [
        p('translate(-1px,0)', 4), p('translate(-1px,1px)', 2), p('translate(0,0)', 3) ] },
      { sel: '.blink', name: 'test-blink', period: 5100, poses: [
        p('scaleY(1)', 8), p('scaleY(.15)', 1), p('scaleY(1)', 4) ] },
    ],
  },
);

// ============================================================================
// 第四批：互动、生命周期与环境
//
// 互动类是**反应**，节奏和待机相反：起手在一拍内完成、回位慢慢来。
// 把反应做成匀速会让桌宠显得迟钝——被戳了要立刻有反应，
// 但恢复要慢，那个「慢慢缓过来」才是可爱的部分。
// ============================================================================

ANIMATIONS.push(
  {
    state: 'click',
    duration: 2200,
    comment: '被轻点后侧向压扁再回望。压扁必须在一拍内到位，回弹分三段。',
    layers: [
      { sel: '.actor', name: 'click-body', poses: [
        p('translate(0,0)', 1), p('translate(1px,1px) scaleY(.8)', 1),
        p('translate(2px,1px) scaleY(.72)', 2), p('translate(1px,0) scaleY(.9)', 1),
        p('translate(0,-1px) scaleY(1.04)', 1), p('translate(0,0) scaleY(1)', 2),
        p('translate(0,0)', 4) ] },
      { sel: '.left-claw', name: 'click-left', poses: [
        p('translate(0,0)', 1), p('translate(2px,1px)', 1), p('translate(3px,2px)', 2),
        p('translate(2px,1px)', 1), p('translate(0,-1px)', 1), p('translate(0,0)', 6) ] },
      { sel: '.eyes', name: 'click-eyes', poses: [
        p('translate(0,0)', 1), p('translate(1px,1px)', 1), p('translate(2px,1px)', 2),
        p('translate(1px,0)', 1), p('translate(-1px,0)', 3), p('translate(0,0)', 4) ] },
      { sel: '.blink', name: 'click-blink', poses: [
        p('scaleY(1)', 1), p('scaleY(.15)', 1), p('scaleY(1)', 10) ] },
    ],
  },

  {
    state: 'double-click',
    duration: 2400,
    comment: '连点后惊跳。惊跳没有预备动作——直接起，落地才有缓冲。',
    layers: [
      { sel: '.actor', name: 'double-body', poses: [
        p('translate(0,0)', 1), p('translate(0,-5px)', 2), p('translate(0,-6px)', 2),
        p('translate(0,-3px)', 1), p('translate(0,1px) scaleY(.82)', 1),
        p('translate(0,0) scaleY(1.04)', 1), p('translate(0,0)', 2), p('translate(0,0)', 3) ] },
      { sel: '.left-claw', name: 'double-left', poses: [
        p('translate(0,0)', 1), p('translate(-2px,-3px)', 2), p('translate(-3px,-4px)', 2),
        p('translate(-2px,-1px)', 1), p('translate(0,2px)', 1), p('translate(0,0)', 6) ] },
      { sel: '.right-claw', name: 'double-right', poses: [
        p('translate(0,0)', 1), p('translate(2px,-3px)', 2), p('translate(3px,-4px)', 2),
        p('translate(2px,-1px)', 1), p('translate(0,2px)', 1), p('translate(0,0)', 6) ] },
    ],
  },

  {
    state: 'drag',
    duration: 3200,
    comment: '被拖动时抓住吊环。这是 held 循环，所以是持续的摆荡而不是一次反应。',
    layers: [
      { sel: '.actor', name: 'drag-body', poses: [
        p('translate(0,1px)', 2), p('translate(-1px,1px)', 1), p('translate(-2px,2px)', 2),
        p('translate(-1px,1px)', 1), p('translate(0,1px)', 1), p('translate(1px,1px)', 1),
        p('translate(2px,2px)', 2), p('translate(1px,1px)', 1), p('translate(0,2px)', 1) ] },
      { sel: '.left-claw', name: 'drag-left', poses: [
        p('translate(2px,-3px)', 3), p('translate(2px,-4px)', 2), p('translate(2px,-3px)', 3),
        p('translate(2px,-4px)', 2), p('translate(2px,-3px)', 2) ] },
      { sel: '.right-claw', name: 'drag-right', poses: [
        p('translate(-2px,-3px)', 3), p('translate(-2px,-4px)', 2), p('translate(-2px,-3px)', 3),
        p('translate(-2px,-4px)', 2), p('translate(-2px,-3px)', 2) ] },
      { sel: '.eyes', name: 'drag-eyes', period: 2300, poses: [
        p('translate(0,1px)', 3), p('translate(-1px,1px)', 2), p('translate(1px,1px)', 2),
        p('translate(0,1px)', 2) ] },
      { sel: '.blink', name: 'drag-blink', period: 3700, poses: [
        p('scaleY(1)', 6), p('scaleY(.15)', 1), p('scaleY(1)', 3) ] },
    ],
  },

  {
    state: 'drop',
    duration: 2600,
    comment: '落地压扁、回弹、站稳。三次回弹要一次比一次小。',
    layers: [
      { sel: '.actor', name: 'drop-body', poses: [
        p('translate(0,-4px)', 1), p('translate(0,1px) scaleY(.7)', 1),
        p('translate(0,0) scaleY(1.12)', 1), p('translate(0,-2px) scaleY(1.04)', 1),
        p('translate(0,1px) scaleY(.88)', 1), p('translate(0,0) scaleY(1.04)', 1),
        p('translate(0,0) scaleY(.96)', 1), p('translate(0,0)', 5) ] },
      { sel: '.left-claw', name: 'drop-left', poses: [
        p('translate(0,-3px)', 1), p('translate(-2px,2px)', 1), p('translate(-3px,0)', 1),
        p('translate(-2px,-1px)', 1), p('translate(-1px,1px)', 1), p('translate(0,0)', 6) ] },
      { sel: '.right-claw', name: 'drop-right', poses: [
        p('translate(0,-3px)', 1), p('translate(2px,2px)', 1), p('translate(3px,0)', 1),
        p('translate(2px,-1px)', 1), p('translate(1px,1px)', 1), p('translate(0,0)', 6) ] },
      { sel: '.eyes', name: 'drop-eyes', poses: [
        p('translate(0,-1px)', 1), p('translate(0,2px)', 1), p('translate(0,0)', 1),
        p('translate(0,1px)', 1), p('translate(0,0)', 7) ] },
      { sel: '.blink', name: 'drop-blink', poses: [
        p('scaleY(1)', 1), p('scaleY(.15)', 2), p('scaleY(1)', 8) ] },
    ],
  },

  {
    state: 'hover',
    duration: 3000,
    comment: '不画光标，只用眼神与重心跟随。这是 held：必须能无限循环而不腻。',
    layers: [
      // 「注视」不是站住不动：身体始终朝光标方向保持一点前倾，
      // 重心在小范围里持续调整。回到中立姿势读作「不看了」。
      { sel: '.actor', name: 'hover-body', poses: [
        p('translate(1px,-1px)', 3), p('translate(1px,0)', 1), p('translate(2px,-1px)', 2),
        p('translate(1px,-1px)', 1), p('translate(0,-1px)', 2), p('translate(1px,-1px)', 1),
        p('translate(1px,0)', 2) ] },
      { sel: '.left-claw', name: 'hover-left', period: 2300, poses: [
        p('translate(0,0)', 3), p('translate(1px,-2px)', 2), p('translate(1px,-1px)', 2),
        p('translate(0,0)', 3) ] },
      { sel: '.right-claw', name: 'hover-right', period: 2700, poses: [
        p('translate(0,0)', 4), p('translate(-1px,-1px)', 2), p('translate(0,0)', 3) ] },
      { sel: '.eyes', name: 'hover-eyes', period: 1900, poses: [
        p('translate(1px,-1px)', 3), p('translate(1px,0)', 2), p('translate(0,-1px)', 2),
        p('translate(1px,-1px)', 3) ] },
      { sel: '.blink', name: 'hover-blink', period: 4300, poses: [
        p('scaleY(1)', 8), p('scaleY(.15)', 1), p('scaleY(1)', 4) ] },
    ],
  },

  {
    state: 'edge',
    duration: 4600,
    comment: '从帘幕后偷看再躲回去。探头要慢（试探），缩回要快（被发现了）。',
    layers: [
      { sel: '.actor', name: 'edge-body', poses: [
        p('translate(6px,0)', 3), p('translate(4px,0)', 1), p('translate(2px,0)', 2),
        p('translate(1px,0)', 1), p('translate(0,0)', 4), p('translate(2px,0)', 1),
        p('translate(6px,0)', 2) ] },
      { sel: '.left-claw', name: 'edge-left', poses: [
        p('translate(1px,0)', 3), p('translate(1px,-1px)', 1), p('translate(0,-1px)', 2),
        p('translate(0,0)', 1), p('translate(-1px,0)', 4), p('translate(0,0)', 1),
        p('translate(1px,0)', 2) ] },
      { sel: '.eyes', name: 'edge-eyes', period: 3100, poses: [
        p('translate(-1px,0)', 3), p('translate(0,0)', 2), p('translate(1px,0)', 3),
        p('translate(0,0)', 2) ] },
      { sel: '.blink', name: 'edge-blink', period: 5300, poses: [
        p('scaleY(1)', 9), p('scaleY(.15)', 1), p('scaleY(1)', 4) ] },
    ],
  },

  {
    state: 'low-battery',
    duration: 6200,
    comment: '身体下沉、双爪内卷、半闭眼。间或有一次「撑一下又垮下去」——\n'
      + '   纯粹的单调下沉读作静止图，那次徒劳的挣扎才让它是活的。',
    layers: [
      { sel: '.actor', name: 'battery-body', poses: [
        p('translate(0,1px) scaleY(.94)', 3), p('translate(0,2px) scaleY(.9)', 2),
        p('translate(0,2px) scaleY(.88)', 3), p('translate(0,0) scaleY(1)', 1),
        p('translate(0,1px) scaleY(.94)', 1), p('translate(0,2px) scaleY(.88)', 3),
        p('translate(0,3px) scaleY(.84)', 4) ] },
      { sel: '.left-claw', name: 'battery-left', poses: [
        p('translate(1px,1px)', 3), p('translate(2px,2px)', 2), p('translate(2px,3px)', 3),
        p('translate(0,0)', 1), p('translate(1px,1px)', 1), p('translate(2px,3px)', 3),
        p('translate(2px,4px)', 4) ] },
      { sel: '.right-claw', name: 'battery-right', poses: [
        p('translate(-1px,1px)', 3), p('translate(-2px,2px)', 2), p('translate(-2px,3px)', 3),
        p('translate(0,0)', 1), p('translate(-1px,1px)', 1), p('translate(-2px,3px)', 3),
        p('translate(-2px,4px)', 4) ] },
      { sel: '.eyes', name: 'battery-eyes', poses: [
        p('translate(0,1px)', 3), p('translate(0,2px)', 5), p('translate(0,0)', 1),
        p('translate(0,2px)', 4), p('translate(0,3px)', 4) ] },
      { sel: '.blink', name: 'battery-blink', period: 4100, poses: [
        p('scaleY(.5)', 5), p('scaleY(.15)', 3), p('scaleY(.5)', 2), p('scaleY(.35)', 4) ] },
    ],
  },

  {
    state: 'offline',
    duration: 5200,
    comment: '停下来向左右仔细听。「听」的读感来自**静止的长停顿**加上突然转向，\n'
      + '   所以这个动作刻意保留大段不动，只在转向那几拍密集。',
    layers: [
      { sel: '.actor', name: 'offline-body', poses: [
        p('translate(0,0)', 4), p('translate(-1px,0)', 1), p('translate(-2px,0)', 4),
        p('translate(-1px,0)', 1), p('translate(0,0)', 1), p('translate(1px,0)', 1),
        p('translate(2px,0)', 4), p('translate(1px,0)', 1), p('translate(0,0)', 3) ] },
      { sel: '.left-claw', name: 'offline-left', poses: [
        p('translate(0,0)', 4), p('translate(-1px,-1px)', 1), p('translate(-1px,-2px)', 4),
        p('translate(-1px,-1px)', 1), p('translate(0,0)', 1), p('translate(1px,0)', 1),
        p('translate(1px,-1px)', 4), p('translate(0,0)', 4) ] },
      { sel: '.right-claw', name: 'offline-right', poses: [
        p('translate(0,0)', 4), p('translate(-1px,0)', 1), p('translate(-1px,-1px)', 4),
        p('translate(0,0)', 3), p('translate(1px,-2px)', 4), p('translate(0,0)', 4) ] },
      { sel: '.eyes', name: 'offline-eyes', poses: [
        p('translate(0,0)', 4), p('translate(-1px,0)', 5), p('translate(0,0)', 2),
        p('translate(1px,0)', 5), p('translate(0,0)', 3) ] },
      { sel: '.blink', name: 'offline-blink', period: 3700, poses: [
        p('scaleY(1)', 7), p('scaleY(.15)', 1), p('scaleY(1)', 3) ] },
    ],
  },

  {
    state: 'launching',
    duration: 2800,
    comment: '从压扁小团展开、双爪打开、站稳。展开要有过冲，否则像充气。',
    layers: [
      { sel: '.actor', name: 'launch-body', poses: [
        p('translateY(4px) scaleY(.3)', 1), p('translateY(2px) scaleY(.66)', 1),
        p('translateY(-1px) scaleY(1.14)', 2), p('translateY(0) scaleY(1.06)', 1),
        p('translateY(1px) scaleY(.94)', 1), p('translateY(0) scaleY(1.02)', 1),
        p('translateY(0) scaleY(1)', 2), p('translateY(0)', 3) ] },
      { sel: '.launch-legs', name: 'launch-legs', origin: '7.5px 14px', poses: [
        p('scaleY(0)', 1), p('scaleY(.4)', 1), p('scaleY(1.2)', 2), p('scaleY(1)', 1),
        p('scaleY(1.06)', 1), p('scaleY(1)', 6) ] },
      { sel: '.left-claw', name: 'launch-left', poses: [
        p('translate(3px,3px)', 1), p('translate(1px,1px)', 1), p('translate(-2px,-2px)', 2),
        p('translate(-1px,-1px)', 1), p('translate(0,1px)', 1), p('translate(0,0)', 6) ] },
      { sel: '.right-claw', name: 'launch-right', poses: [
        p('translate(-3px,3px)', 1), p('translate(-1px,1px)', 1), p('translate(2px,-2px)', 2),
        p('translate(1px,-1px)', 1), p('translate(0,1px)', 1), p('translate(0,0)', 6) ] },
      { sel: '.eyes', name: 'launch-eyes', poses: [
        p('translateY(2px)', 1), p('translateY(1px)', 1), p('translateY(-1px)', 3),
        p('translateY(0)', 7) ] },
      { sel: '.blink', name: 'launch-blink', poses: [
        p('scaleY(.15)', 2), p('scaleY(1)', 6), p('scaleY(.15)', 1), p('scaleY(1)', 4) ] },
    ],
  },

  {
    state: 'quitting',
    duration: 2800,
    comment: '挥一次小爪、闭眼、收回小团。挥手要有两下，一下读作抬手不是告别。',
    layers: [
      { sel: '.actor', name: 'quit-body', poses: [
        p('translateY(0)', 2), p('translateY(-1px)', 1), p('translateY(0)', 1),
        p('translateY(-1px)', 1), p('translateY(0)', 1), p('translateY(1px) scaleY(.9)', 1),
        p('translateY(3px) scaleY(.6)', 1), p('translateY(4px) scaleY(.3)', 3) ] },
      { sel: '.quit-legs', name: 'quit-legs', origin: '7.5px 14px', poses: [
        p('scaleY(1)', 6), p('scaleY(.8)', 1), p('scaleY(.4)', 1), p('scaleY(0)', 3) ] },
      { sel: '.left-claw', name: 'quit-left', poses: [
        p('translate(0,0)', 2), p('translate(-2px,-3px)', 1), p('translate(-1px,-4px)', 1),
        p('translate(-3px,-3px)', 1), p('translate(-1px,-4px)', 1), p('translate(0,-1px)', 1),
        p('translate(1px,2px)', 1), p('translate(2px,3px)', 3) ] },
      { sel: '.right-claw', name: 'quit-right', poses: [
        p('translate(0,0)', 6), p('translate(0,1px)', 1), p('translate(-1px,2px)', 1),
        p('translate(-2px,3px)', 3) ] },
      { sel: '.eyes', name: 'quit-eyes', poses: [
        p('translate(0,0)', 5), p('translate(0,1px)', 2), p('translate(0,2px)', 4) ] },
      { sel: '.blink', name: 'quit-blink', poses: [
        p('scaleY(1)', 4), p('scaleY(.15)', 1), p('scaleY(1)', 2), p('scaleY(.15)', 5) ] },
    ],
  },

  {
    state: 'waiting',
    duration: 4200,
    comment: '身体不动，一只爪连续轻点三次。点击要密、间隔要长——\n'
      + '   「等」的焦躁感全在那个长间隔里。',
    layers: [
      { sel: '.actor', name: 'waiting-body', poses: [
        p('translate(0,0)', 3), p('translate(0,-1px)', 1), p('translate(0,0)', 1),
        p('translate(0,-1px)', 1), p('translate(0,0)', 1), p('translate(0,-1px)', 1),
        p('translate(0,0)', 8) ] },
      { sel: '.left-claw', name: 'waiting-left', poses: [
        p('translate(0,0)', 3), p('translate(0,2px)', 1), p('translate(0,0)', 1),
        p('translate(0,2px)', 1), p('translate(0,0)', 1), p('translate(0,2px)', 1),
        p('translate(0,0)', 8) ] },
      { sel: '.right-claw', name: 'waiting-right', period: 3300, poses: [
        p('translate(0,0)', 6), p('translate(0,-1px)', 1), p('translate(0,0)', 5) ] },
      { sel: '.eyes', name: 'waiting-eyes', period: 2700, poses: [
        p('translate(0,0)', 4), p('translate(-1px,0)', 2), p('translate(0,0)', 2),
        p('translate(1px,0)', 2) ] },
      { sel: '.blink', name: 'waiting-blink', period: 4700, poses: [
        p('scaleY(1)', 8), p('scaleY(.15)', 1), p('scaleY(1)', 4) ] },
    ],
  },

  {
    state: 'paused',
    duration: 6000,
    comment: '几乎静止，只留慢呼吸和眨眼。这是全套最安静的动作——\n'
      + '   但「几乎静止」不等于「静止图」，旧版 6 秒只有 2 个姿态，\n'
      + '   那是真的一动不动。眼睛与呼吸各走各的周期就够了。',
    layers: [
      { sel: '.actor', name: 'paused-body', poses: [
        p('translateY(0) scaleY(1)', 7), p('translateY(0) scaleY(1.02)', 1),
        p('translateY(0) scaleY(1.03)', 4), p('translateY(0) scaleY(1.01)', 1),
        p('translateY(0) scaleY(1)', 6) ] },
      { sel: '.left-claw', name: 'paused-left', period: 4300, poses: [
        p('translate(1px,0)', 5), p('translate(1px,-1px)', 2), p('translate(1px,0)', 4) ] },
      { sel: '.right-claw', name: 'paused-right', period: 5100, poses: [
        p('translate(-1px,0)', 5), p('translate(-1px,-1px)', 2), p('translate(-1px,0)', 4) ] },
      { sel: '.eyes', name: 'paused-eyes', period: 3700, poses: [
        p('translate(0,0)', 6), p('translate(1px,0)', 2), p('translate(0,0)', 5) ] },
      { sel: '.blink', name: 'paused-blink', period: 5300, poses: [
        p('scaleY(1)', 10), p('scaleY(.15)', 1), p('scaleY(1)', 5) ] },
    ],
  },

  {
    state: 'owner-resolved',
    duration: 3200,
    comment: '罐盖咔哒松开、扶稳罐子、放心眨眼。「咔哒」必须是单独一拍的突变。',
    layers: [
      { sel: '.actor', name: 'resolved-body', poses: [
        p('translate(0,0)', 3), p('translate(0,-1px)', 1), p('translate(0,-2px)', 1),
        p('translate(0,0)', 1), p('translate(0,1px)', 1), p('translate(0,0)', 2),
        p('translate(0,0)', 3) ] },
      { sel: '.left-claw', name: 'resolved-left', poses: [
        p('translate(-2px,-1px)', 3), p('translate(-2px,-2px)', 1), p('translate(-1px,-3px)', 1),
        p('translate(-1px,-1px)', 1), p('translate(-1px,0)', 1), p('translate(0,0)', 5) ] },
      { sel: '.right-claw', name: 'resolved-right', poses: [
        p('translate(-1px,-1px)', 3), p('translate(-1px,-2px)', 1), p('translate(0,-3px)', 1),
        p('translate(0,-1px)', 1), p('translate(0,0)', 6) ] },
      { sel: '.jar', name: 'resolved-jar', origin: '-2px 17px', poses: [
        p('rotate(-4deg)', 3), p('rotate(-2deg)', 1), p('rotate(0)', 1), p('rotate(1deg)', 1),
        p('rotate(0)', 6) ] },
      { sel: '.lid', name: 'resolved-lid', origin: '-2px 9px', poses: [
        p('translate(0,0) rotate(0)', 3), p('translate(0,-1px) rotate(-8deg)', 1),
        p('translate(-1px,-3px) rotate(-18deg)', 1), p('translate(-1px,-2px) rotate(-14deg)', 1),
        p('translate(-1px,-2px) rotate(-16deg)', 6) ] },
      { sel: '.eyes', name: 'resolved-eyes', poses: [
        p('translate(-1px,0)', 3), p('translate(-1px,-1px)', 2), p('translate(0,0)', 7) ] },
      { sel: '.blink', name: 'resolved-blink', poses: [
        p('scaleY(1)', 6), p('scaleY(.15)', 1), p('scaleY(1)', 2), p('scaleY(.15)', 1),
        p('scaleY(1)', 3) ] },
    ],
  },

  {
    state: 'recovering',
    duration: 3400,
    comment: '把篮子推开、抖一抖、重新站稳。抖动要逐次衰减。',
    layers: [
      { sel: '.actor', name: 'recovering-body', poses: [
        p('translateY(3px) scaleY(.7)', 2), p('translate(-1px,1px) scaleY(.84)', 1),
        p('translate(1px,-1px) scaleY(1.04)', 2), p('translate(-1px,0)', 1),
        p('translate(1px,0)', 1), p('translate(-1px,0)', 1), p('translate(0,0)', 1),
        p('translate(0,0)', 3) ] },
      { sel: '.left-claw', name: 'recovering-left', poses: [
        p('translate(2px,2px)', 2), p('translate(-1px,-2px)', 1), p('translate(-4px,-3px)', 2),
        p('translate(-2px,-1px)', 1), p('translate(-1px,-1px)', 1), p('translate(0,0)', 1),
        p('translate(0,0)', 4) ] },
      { sel: '.right-claw', name: 'recovering-right', poses: [
        p('translate(-2px,2px)', 2), p('translate(1px,-2px)', 1), p('translate(4px,-3px)', 2),
        p('translate(2px,-1px)', 1), p('translate(1px,-1px)', 1), p('translate(0,0)', 1),
        p('translate(0,0)', 4) ] },
      { sel: '.basket', name: 'recovering-basket', origin: '8px 16px', poses: [
        p('translate(0,0) rotate(0)', 2), p('translate(1px,-2px) rotate(10deg)', 1),
        p('translate(4px,-4px) rotate(26deg)', 2), p('translate(6px,-2px) rotate(38deg)', 1),
        p('translate(7px,0) rotate(44deg)', 1), p('translate(7px,1px) rotate(46deg)', 5) ] },
      { sel: '.eyes', name: 'recovering-eyes', poses: [
        p('translate(0,2px)', 2), p('translate(0,0)', 1), p('translate(0,-1px)', 2),
        p('translate(0,0)', 7) ] },
      { sel: '.blink', name: 'recovering-blink', poses: [
        p('scaleY(.35)', 2), p('scaleY(1)', 6), p('scaleY(.15)', 1), p('scaleY(1)', 3) ] },
    ],
  },
);

// ============================================================================
// working 的候选方案（供挑选，选定后删掉落选的）
//
// 四个走**不同的运动语汇**，不是同一个东西换皮：
//   A 流动 — 材料进场、被处理、离场（当前的 Tile Feed）
//   B 往复 — 双爪对称往复，没有材料运输，靠节奏本身表意
//   C 累积 — 身侧的成果一层层长高，进度可见
//   D 用力 — 单一材料被反复压揉，靠压扁回弹表达力气
//
// 四个都守同一组约束：循环内无静止姿态、首尾姿态不同、道具不遮脸。
// ============================================================================

ANIMATIONS.push(
  {
    state: 'work-b',
    svg: {
      file: 'work-b-stitch.svg',
      title: 'Stitch Pair',
      desc: 'Two needles dip alternately into the yarn below; the work never pauses.',
      // 针与线团都在眼睛以下，脸全程不被遮
      // 针要 2 单位宽才看得见（1 单位 = 3px，小尺寸下等于没有），
      // 而且不能悬在眼睛正下方——那读起来像流口水。
      propsAfter: '<g class="needle-l motion"><rect x="2" y="12" width="2" height="5" fill="#E7DCF2"/>'
        + '<rect x="2" y="12" width="2" height="1" fill="#B9A1D9"/></g>'
        + '<g class="needle-r motion"><rect x="11" y="12" width="2" height="5" fill="#E7DCF2"/>'
        + '<rect x="11" y="12" width="2" height="1" fill="#B9A1D9"/></g>'
        + '<g class="yarn motion"><rect x="4" y="16" width="7" height="4" fill="#F6C85F"/>'
        + '<rect x="5" y="17" width="5" height="1" fill="#FFE3A3"/></g>',
    },
    duration: 3400,
    comment: '织。双爪各持一针交替下扎，线团随节奏被带动。\n'
      + '   往复本身就是无限的，不需要材料进出场——这是与 A 最本质的区别。',
    layers: [
      // 权重差要拉开：扎下去的那一拍停久（着力），抬起来快速掠过。
      { sel: '.actor', name: 'stitch-body', poses: [
        p('translate(0,-1px)', 4), p('translate(-1px,0)', 2), p('translate(-1px,-1px)', 1),
        p('translate(0,-1px)', 4), p('translate(1px,0)', 2), p('translate(1px,-1px)', 1) ] },
      { sel: '.left-claw', name: 'stitch-left', period: 1700, poses: [
        p('translate(3px,0)', 2), p('translate(3px,2px)', 2), p('translate(3px,1px)', 1),
        p('translate(3px,-1px)', 2), p('translate(3px,-2px)', 1) ] },
      { sel: '.right-claw', name: 'stitch-right', period: 1700, poses: [
        p('translate(-3px,-1px)', 2), p('translate(-3px,-2px)', 1), p('translate(-3px,0)', 2),
        p('translate(-3px,2px)', 2), p('translate(-3px,1px)', 1) ] },
      { sel: '.needle-l', name: 'stitch-needle-l', period: 1700, poses: [
        p('translateY(0)', 2), p('translateY(2px)', 2), p('translateY(1px)', 1),
        p('translateY(-1px)', 2), p('translateY(-2px)', 1) ] },
      { sel: '.needle-r', name: 'stitch-needle-r', period: 1700, poses: [
        p('translateY(-1px)', 2), p('translateY(-2px)', 1), p('translateY(0)', 2),
        p('translateY(2px)', 2), p('translateY(1px)', 1) ] },
      { sel: '.yarn', name: 'stitch-yarn', period: 1700,
        origin: '7.5px 20px', poses: [
          p('scaleY(1)', 2), p('scaleY(.82)', 2), p('scaleY(1.08)', 1), p('scaleY(1)', 3) ] },
      { sel: '.eyes', name: 'stitch-eyes', period: 2900, poses: [
        p('translate(0,1px)', 3), p('translate(0,0)', 2), p('translate(0,1px)', 2),
        p('translate(-1px,1px)', 2) ] },
      { sel: '.blink', name: 'stitch-blink', period: 4700, poses: [
        p('scaleY(1)', 11), p('scaleY(.15)', 1), p('scaleY(1)', 4) ] },
    ],
  },

  {
    state: 'work-c',
    svg: {
      file: 'work-c-stack.svg',
      title: 'Stack Up',
      desc: 'Finished pieces pile up beside the body until the stack is carried off and a new one begins.',
      propsAfter: '<g class="piece motion"><rect x="5" y="11" width="4" height="3" fill="#7BC8C4"/>'
        + '<rect x="6" y="12" width="2" height="1" fill="#BDE7E4"/></g>'
        + '<g class="pile motion"><rect x="14" y="9" width="5" height="6" fill="#B9A1D9"/>'
        + '<rect x="15" y="10" width="3" height="1" fill="#E7DCF2"/></g>',
    },
    duration: 3400,
    comment: '累积。做好一块就搁到身侧，那一摞一层层长高，满了整摞搬走再来。\n'
      + '   与 A、B 的区别是**进度可见**——你能看出它已经干了多少。',
    layers: [
      { sel: '.actor', name: 'stack-body', poses: [
        p('translate(0,-1px)', 4), p('translate(-1px,1px)', 1), p('translate(0,-1px)', 2),
        p('translate(1px,0)', 3), p('translate(1px,-1px)', 1), p('translate(0,1px)', 2),
        p('translate(-1px,0)', 1) ] },
      { sel: '.left-claw', name: 'stack-left', period: 1700, poses: [
        p('translate(3px,1px)', 2), p('translate(3px,2px)', 2), p('translate(2px,0)', 1),
        p('translate(2px,-1px)', 2), p('translate(3px,0)', 1) ] },
      { sel: '.right-claw', name: 'stack-right', period: 1700, poses: [
        p('translate(-2px,-1px)', 2), p('translate(-1px,-2px)', 1), p('translate(1px,-2px)', 2),
        p('translate(0,0)', 2), p('translate(-2px,0)', 1) ] },
      { sel: '.piece', name: 'stack-piece', period: 1700, poses: [
        p('opacity:0;transform:translateY(4px)', 1), p('opacity:1;transform:translateY(2px)', 2),
        p('opacity:1;transform:translateY(0)', 2), p('opacity:1;transform:translate(3px,-1px)', 2),
        p('opacity:0;transform:translate(6px,0)', 1) ] },
      // 摞：从一层长到四层，满了整摞淡出重来
      // 起点不能太矮：scaleY(.25) 下这摞只剩 1.5 单位，看着像根线不像一摞。
      { sel: '.pile', name: 'stack-pile', origin: '16.5px 15px', poses: [
        p('opacity:1;transform:scaleY(.5)', 3), p('opacity:1;transform:scaleY(.67)', 3),
        p('opacity:1;transform:scaleY(.84)', 3), p('opacity:1;transform:scaleY(1)', 3),
        p('opacity:0;transform:scaleY(1) translateY(-3px)', 1) ] },
      { sel: '.eyes', name: 'stack-eyes', period: 2900, poses: [
        p('translate(0,1px)', 3), p('translate(1px,0)', 2), p('translate(1px,1px)', 2),
        p('translate(0,0)', 2) ] },
      { sel: '.blink', name: 'stack-blink', period: 4700, poses: [
        p('scaleY(1)', 11), p('scaleY(.15)', 1), p('scaleY(1)', 4) ] },
    ],
  },

  {
    state: 'work-d',
    svg: {
      file: 'work-d-knead.svg',
      title: 'Knead',
      desc: 'Both claws press a single lump in turn; it squashes and springs back without pause.',
      propsAfter: '<g class="lump motion"><rect x="4" y="12" width="7" height="4" fill="#F6C85F"/>'
        + '<rect x="5" y="13" width="5" height="1" fill="#FFE3A3"/></g>',
    },
    duration: 3400,
    comment: '揉。双爪交替下压同一团材料，压扁、回弹、再压。\n'
      + '   道具最少、幅度最大——压扁回弹是小尺寸下最容易读懂的动画原理，\n'
      + '   也是四个里体力感最强的一个。',
    layers: [
      // 压下去停久、弹回来快——这个对比就是「用力」的读感。
      { sel: '.actor', name: 'knead-body', poses: [
        p('translate(0,-1px)', 2), p('translate(-1px,1px)', 4), p('translate(-1px,0)', 1),
        p('translate(0,-1px)', 2), p('translate(1px,1px)', 4), p('translate(1px,0)', 1) ] },
      { sel: '.left-claw', name: 'knead-left', period: 1700, poses: [
        p('translate(3px,-1px)', 2), p('translate(3px,2px)', 2), p('translate(3px,3px)', 1),
        p('translate(3px,1px)', 2), p('translate(3px,-1px)', 1) ] },
      { sel: '.right-claw', name: 'knead-right', period: 1700, poses: [
        p('translate(-3px,3px)', 1), p('translate(-3px,1px)', 2), p('translate(-3px,-1px)', 2),
        p('translate(-3px,2px)', 2), p('translate(-3px,3px)', 1) ] },
      { sel: '.lump', name: 'knead-lump', period: 1700, origin: '7.5px 16px', poses: [
        p('scaleY(1) scaleX(1)', 2), p('scaleY(.6) scaleX(1.2)', 2),
        p('scaleY(1.2) scaleX(.9)', 1), p('scaleY(.95) scaleX(1.05)', 2),
        p('scaleY(1.05) scaleX(1)', 1) ] },
      { sel: '.eyes', name: 'knead-eyes', period: 2900, poses: [
        p('translate(0,1px)', 3), p('translate(0,2px)', 2), p('translate(0,1px)', 2),
        p('translate(0,0)', 2) ] },
      { sel: '.blink', name: 'knead-blink', period: 4700, poses: [
        p('scaleY(1)', 11), p('scaleY(.15)', 1), p('scaleY(1)', 4) ] },
    ],
  },
);

// ============================================================================
// working 候选第二批
//
// 第一批（A–D）的问题：只换了道具，**姿态语汇是同一套**——
// 都是站着、正面、双爪在身前对称交替。变的是拿什么，没变的是怎么站。
//
// 这一批换掉真正没变过的轴：
//   E 无道具，全身发力，**腿是主角**
//   F 道具**比角色大**，角色被活儿淹没，只露上半身
//   G 道具在**头顶**（前四个全在下方），全身在做平衡
//   H **多个**小件从天而降，双爪高频应对，节奏是急的
// ============================================================================

ANIMATIONS.push(
  {
    state: 'work-e',
    svg: {
      file: 'work-e-haul.svg',
      title: 'Full Haul',
      desc: 'No prop at all: the whole body leans into an unseen load, four legs driving in turn.',
      splitLegs: true,
    },
    duration: 3400,
    comment: '全身拉拽。**一个道具都没有**——发力感全靠身体拱动与四条腿交替蹬地。\n'
      + '   前四个候选里腿是完全不动的，这里腿是主角。',
    layers: [
      // 无道具时「在使劲」全靠姿态：压低 + 前倾 + 回弹。
      // 幅度必须够大，scaleY .82 到 1.06 之间来回，小了就读成原地扭动。
      { sel: '.actor', name: 'haul-body', poses: [
        p('translate(-2px,2px) scaleY(.82)', 4), p('translate(-1px,1px) scaleY(.9)', 1),
        p('translate(1px,-1px) scaleY(1.06)', 2), p('translate(1px,0) scaleY(1)', 1),
        p('translate(0,1px) scaleY(.9)', 3), p('translate(-1px,2px) scaleY(.84)', 1),
        p('translate(-2px,1px) scaleY(.88)', 2) ] },
      // 向左位移会让爪子和躯干拉开一条缝。有道具时那读作「伸手去够」，
      // 这个动作没有道具可够，离体的爪子只会读成断肢——只能向前下方撑。
      { sel: '.left-claw', name: 'haul-left', poses: [
        p('translate(2px,4px)', 4), p('translate(2px,2px)', 1), p('translate(1px,-1px)', 2),
        p('translate(1px,0)', 1), p('translate(2px,3px)', 3), p('translate(2px,4px)', 1),
        p('translate(2px,3px)', 2) ] },
      { sel: '.right-claw', name: 'haul-right', poses: [
        p('translate(-2px,4px)', 4), p('translate(-2px,2px)', 1), p('translate(-1px,-1px)', 2),
        p('translate(-1px,0)', 1), p('translate(-2px,3px)', 3), p('translate(-2px,4px)', 1),
        p('translate(-2px,3px)', 2) ] },
      // 四条腿依次蹬地，相位各差四分之一拍——同时动会读成跳
      { sel: '.leg-a', name: 'haul-leg-a', period: 1700, poses: [
        p('translate(0,0)', 3), p('translate(1px,-1px)', 1), p('translate(1px,0)', 1),
        p('translate(0,0)', 3) ] },
      { sel: '.leg-b', name: 'haul-leg-b', period: 1700, poses: [
        p('translate(0,0)', 5), p('translate(1px,-1px)', 1), p('translate(1px,0)', 1),
        p('translate(0,0)', 1) ] },
      { sel: '.leg-c', name: 'haul-leg-c', period: 1700, poses: [
        p('translate(1px,0)', 1), p('translate(0,0)', 4), p('translate(1px,-1px)', 1),
        p('translate(1px,0)', 2) ] },
      { sel: '.leg-d', name: 'haul-leg-d', period: 1700, poses: [
        p('translate(1px,-1px)', 1), p('translate(1px,0)', 2), p('translate(0,0)', 4),
        p('translate(0,-1px)', 1) ] },
      { sel: '.eyes', name: 'haul-eyes', poses: [
        p('translateY(1px) scaleY(.5)', 5), p('translateY(1px) scaleY(.35)', 3),
        p('translateY(0) scaleY(.6)', 2), p('translateY(1px) scaleY(.5)', 4) ] },
      { sel: '.blink', name: 'haul-blink', period: 4700, poses: [
        p('scaleY(1)', 11), p('scaleY(.15)', 1), p('scaleY(1)', 4) ] },
    ],
  },

  {
    state: 'work-f',
    svg: {
      file: 'work-f-buried.svg',
      title: 'Buried',
      desc: 'A pile of work larger than the character swallows the lower body; only the head and one digging claw stay above it.',
      // 道具画在角色**之后**才能盖住下半身。这是四批候选里唯一
      // 角色不是画面主体的构图——活儿比它大。
      propsAfter: '<g class="heap motion">'
        + '<rect x="-3" y="14" width="21" height="6" fill="#B9A1D9"/>'
        + '<rect x="-1" y="12" width="6" height="2" fill="#B9A1D9"/>'
        + '<rect x="10" y="12" width="7" height="2" fill="#B9A1D9"/>'
        + '<rect x="0" y="14" width="4" height="1" fill="#E7DCF2"/>'
        + '<rect x="7" y="16" width="5" height="1" fill="#E7DCF2"/>'
        + '<rect x="13" y="13" width="3" height="1" fill="#E7DCF2"/></g>'
        + '<g class="dig-claw motion"><rect x="0" y="7" width="3" height="3" fill="#DE886D"/></g>',
    },
    duration: 3400,
    comment: '埋在活里。道具比角色还大，把下半身整个吞掉，只露出头和一只扒拉的爪。\n'
      + '   这是唯一一个**角色不是画面主体**的构图——活儿才是。',
    layers: [
      { sel: '.actor', name: 'buried-body', poses: [
        p('translate(0,-1px)', 3), p('translate(-1px,0)', 1), p('translate(-1px,1px)', 2),
        p('translate(0,0)', 1), p('translate(1px,-1px)', 3), p('translate(1px,0)', 1),
        p('translate(0,1px)', 2) ] },
      { sel: '.dig-claw', name: 'buried-dig', period: 1130, poses: [
        p('translate(0,0)', 3), p('translate(1px,2px)', 1), p('translate(2px,4px)', 2),
        p('translate(1px,2px)', 1), p('translate(0,-1px)', 1) ] },
      { sel: '.heap', name: 'buried-heap', period: 1700, origin: '7.5px 20px', poses: [
        p('scaleY(1)', 3), p('scaleY(1.04) translateX(-1px)', 1), p('scaleY(.96)', 2),
        p('scaleY(1.02) translateX(1px)', 1), p('scaleY(1)', 2) ] },
      { sel: '.eyes', name: 'buried-eyes', period: 2900, poses: [
        p('translate(0,0)', 3), p('translate(-1px,1px)', 2), p('translate(0,1px)', 2),
        p('translate(1px,0)', 2) ] },
      { sel: '.blink', name: 'buried-blink', period: 4300, poses: [
        p('scaleY(1)', 9), p('scaleY(.15)', 1), p('scaleY(1)', 4) ] },
    ],
  },

  {
    state: 'work-g',
    svg: {
      file: 'work-g-carry.svg',
      title: 'Head Carry',
      desc: 'A stack rides on top of the head; the whole body works to keep it balanced while the legs take small steps.',
      splitLegs: true,
      // 道具在**头顶**——前四个候选全在身体下方。
      // 这块空间本来一直是空的（取景上方 69% 从没用过）。
      propsAfter: '<g class="load motion">'
        + '<rect x="3" y="3" width="9" height="3" fill="#7BC8C4"/>'
        + '<rect x="4" y="4" width="3" height="1" fill="#BDE7E4"/>'
        + '<rect x="4" y="0" width="7" height="3" fill="#F6C85F"/>'
        + '<rect x="5" y="1" width="3" height="1" fill="#FFE3A3"/>'
        + '<rect x="5" y="-3" width="5" height="3" fill="#B9A1D9"/>'
        + '<rect x="6" y="-2" width="2" height="1" fill="#E7DCF2"/></g>',
    },
    duration: 3400,
    comment: '顶运。头顶一摞东西，全身在做持续的平衡补偿，腿在小步挪。\n'
      + '   摞的倾斜与身体的补偿**方向相反**——那个反向才是「在稳住」的读感。\n'
      + '   顺带用上了取景上方那 69% 一直空着的空间。',
    layers: [
      { sel: '.actor', name: 'carry-body', poses: [
        p('translate(2px,0)', 3), p('translate(1px,-1px)', 1), p('translate(0,-1px)', 2),
        p('translate(-2px,0)', 3), p('translate(-1px,-1px)', 1), p('translate(0,-1px)', 2),
        p('translate(1px,-1px)', 1) ] },
      // 摞往左倒，身体就往右挪去接住——反相是这个动作全部的意思
      // ±4° 在 135px 下几乎看不出来，读成戴了顶不动的帽子。加到 ±11°。
      { sel: '.load', name: 'carry-load', origin: '7.5px 6px', poses: [
        p('rotate(-11deg) translateX(-1px)', 3), p('rotate(-5deg)', 1), p('rotate(0)', 2),
        p('rotate(11deg) translateX(1px)', 3), p('rotate(5deg)', 1), p('rotate(0)', 2),
        p('rotate(-5deg)', 1) ] },
      { sel: '.left-claw', name: 'carry-left', period: 1700, poses: [
        p('translate(0,-2px)', 3), p('translate(-1px,-3px)', 2), p('translate(-1px,-2px)', 2),
        p('translate(0,-1px)', 1) ] },
      { sel: '.right-claw', name: 'carry-right', period: 1700, poses: [
        p('translate(0,-1px)', 1), p('translate(0,-2px)', 3), p('translate(1px,-3px)', 2),
        p('translate(1px,-2px)', 2) ] },
      { sel: '.leg-a', name: 'carry-leg-a', period: 1130, poses: [
        p('translateY(0)', 4), p('translateY(-1px)', 1), p('translateY(0)', 3) ] },
      { sel: '.leg-b', name: 'carry-leg-b', period: 1130, poses: [
        p('translateY(0)', 6), p('translateY(-1px)', 1), p('translateY(0)', 1) ] },
      { sel: '.leg-c', name: 'carry-leg-c', period: 1130, poses: [
        p('translateY(-1px)', 1), p('translateY(0)', 5), p('translateY(0)', 2) ] },
      { sel: '.leg-d', name: 'carry-leg-d', period: 1130, poses: [
        p('translateY(0)', 2), p('translateY(-1px)', 1), p('translateY(0)', 5) ] },
      { sel: '.eyes', name: 'carry-eyes', period: 2300, poses: [
        p('translate(0,-1px)', 4), p('translate(0,0)', 2), p('translate(0,-1px)', 3) ] },
      { sel: '.blink', name: 'carry-blink', period: 5300, poses: [
        p('scaleY(1)', 12), p('scaleY(.15)', 1), p('scaleY(1)', 4) ] },
    ],
  },

  {
    state: 'work-h',
    svg: {
      file: 'work-h-rain.svg',
      title: 'Task Rain',
      desc: 'Small tasks fall from above without pause; both claws bat them away in quick succession.',
      // 四个小件、从**上方**落、相位各不相同——前四个候选都是单件、从下方来。
      propsAfter: '<g class="drop-a motion"><rect x="2" y="-3" width="4" height="3" fill="#7BC8C4"/>'
        + '<rect x="3" y="-2" width="2" height="1" fill="#BDE7E4"/></g>'
        + '<g class="drop-b motion"><rect x="9" y="-3" width="4" height="3" fill="#F6C85F"/>'
        + '<rect x="10" y="-2" width="2" height="1" fill="#FFE3A3"/></g>'
        + '<g class="drop-c motion"><rect x="5" y="-3" width="4" height="3" fill="#B9A1D9"/>'
        + '<rect x="6" y="-2" width="2" height="1" fill="#E7DCF2"/></g>',
    },
    duration: 3400,
    comment: '任务雨。小件不停从上方掉下来，双爪快速拨挡。\n'
      + '   四个候选里节奏最急的一个：件多、来得快、应对是反射式的。\n'
      + '   语义也最直白——活儿是外面丢进来的，不是自己找的。',
    layers: [
      // 挡一下要顿住（吃到力），回位快速掠过——匀速会读成机械摆动。
      { sel: '.actor', name: 'rain-body', poses: [
        p('translate(-1px,0)', 4), p('translate(-1px,1px)', 1), p('translate(0,-1px)', 1),
        p('translate(1px,0)', 4), p('translate(1px,1px)', 1), p('translate(0,-1px)', 1) ] },
      { sel: '.left-claw', name: 'rain-left', period: 1130, poses: [
        p('translate(1px,-3px)', 2), p('translate(0,-1px)', 1), p('translate(0,1px)', 2),
        p('translate(1px,-1px)', 1) ] },
      { sel: '.right-claw', name: 'rain-right', period: 1130, poses: [
        p('translate(0,1px)', 2), p('translate(-1px,-1px)', 1), p('translate(-1px,-3px)', 2),
        p('translate(0,-1px)', 1) ] },
      { sel: '.drop-a', name: 'rain-drop-a', period: 1700, poses: [
        p('opacity:0;transform:translateY(-4px)', 1), p('opacity:1;transform:translateY(2px)', 2),
        p('opacity:1;transform:translateY(7px)', 2), p('opacity:1;transform:translate(-2px,11px)', 1),
        p('opacity:0;transform:translate(-4px,13px)', 1) ] },
      { sel: '.drop-b', name: 'rain-drop-b', period: 1700, poses: [
        p('opacity:1;transform:translateY(7px)', 2), p('opacity:1;transform:translate(2px,11px)', 1),
        p('opacity:0;transform:translate(4px,13px)', 1), p('opacity:0;transform:translateY(-4px)', 1),
        p('opacity:1;transform:translateY(2px)', 2) ] },
      { sel: '.drop-c', name: 'rain-drop-c', period: 2550, poses: [
        p('opacity:0;transform:translateY(-4px)', 1), p('opacity:1;transform:translateY(3px)', 2),
        p('opacity:1;transform:translateY(8px)', 2), p('opacity:0;transform:translate(3px,12px)', 1) ] },
      { sel: '.eyes', name: 'rain-eyes', period: 1900, poses: [
        p('translate(-1px,-1px)', 2), p('translate(0,-1px)', 1), p('translate(1px,-1px)', 2),
        p('translate(0,0)', 2) ] },
      { sel: '.blink', name: 'rain-blink', period: 3700, poses: [
        p('scaleY(1)', 8), p('scaleY(.15)', 1), p('scaleY(1)', 3) ] },
    ],
  },
);

// ============================================================================
// working 候选第三批
//
// 前两批都没碰过的轴：
//   I 朝向    — 背对着你（前八个全是正面）
//   J 位置    — 道具在**身后**且角色在位移（前八个道具都在身前/头顶，角色原地）
//   L 结构    — 一个循环内有起承转合（前八个都是均匀节拍的重复）
//   N 对称性  — 左右爪各干各的、周期还不同（前八个双爪都是同一件事的两半）
// ============================================================================

ANIMATIONS.push(
  {
    state: 'work-i',
    svg: {
      file: 'work-i-hunch.svg',
      title: 'Desk Hunch',
      desc: 'Turned away from you, hunched over the work; only the back and a bit of claw show.',
      // 背对：眼睛藏起来，壳纹替代面部特征，否则就是一个纯色方块。
      // 台面被身体挡住大半，只露上缘——那条边就是「有张桌子」的全部证据。
      props: '<g class="desk"><rect x="0" y="10" width="15" height="1" fill="#8C7A5E"/>'
        + '<rect x="1" y="11" width="13" height="1" fill="#6E5F49"/></g>',
      propsAfter: '<g class="shell"><rect x="3" y="8" width="9" height="1" fill="#C4715A"/>'
        + '<rect x="4" y="10" width="7" height="1" fill="#C4715A"/></g>',
    },
    duration: 3400,
    comment: '背身伏案。转过去不理你，只看得到背在起伏、一点爪尖在动。\n'
      + '   八个候选全是正面站着，这个换的是**朝向**——背对本身就是「别打扰我」。',
    layers: [
      { sel: '.actor', name: 'hunch-body', poses: [
        p('translate(0,2px) scaleY(.88)', 4), p('translate(0,1px) scaleY(.92)', 1),
        p('translate(0,1px) scaleY(.96)', 2), p('translate(0,2px) scaleY(.9)', 1),
        p('translate(0,3px) scaleY(.84)', 3), p('translate(0,2px) scaleY(.9)', 1),
        p('translate(0,2px) scaleY(.86)', 2) ] },
      { sel: '.left-claw', name: 'hunch-left', period: 1130, poses: [
        p('translate(2px,2px)', 3), p('translate(3px,3px)', 1), p('translate(3px,2px)', 2),
        p('translate(2px,1px)', 1) ] },
      { sel: '.right-claw', name: 'hunch-right', period: 1700, poses: [
        p('translate(-2px,1px)', 3), p('translate(-3px,3px)', 1), p('translate(-3px,2px)', 2),
        p('translate(-2px,2px)', 1) ] },
      // 背对时眼睛不可见。给一条恒定 opacity:0 的动画，比在素材里删掉更好——
      // 角色几何仍然与契约一致，只是这个动作看不到脸。
      { sel: '.eyes', name: 'hunch-eyes', poses: [p('opacity:0', 1)] },
      { sel: '.blink', name: 'hunch-blink', poses: [p('opacity:0', 1)] },
    ],
  },

  {
    state: 'work-j',
    svg: {
      file: 'work-j-tow.svg',
      title: 'Tow Line',
      desc: 'Hauls a train of crates behind it, stepping forward one small pace at a time.',
      splitLegs: true,
      // 道具在**身后**——前八个全在身前或头顶。串的每一节延迟跟随，
      // 那个延迟就是「拖」的全部读感；同步跟随会读成粘在身上。
      props: '<g class="tow-c"><rect x="-14" y="12" width="4" height="4" fill="#B9A1D9"/>'
        + '<rect x="-13" y="13" width="2" height="1" fill="#E7DCF2"/></g>'
        + '<g class="tow-b"><rect x="-9" y="12" width="4" height="4" fill="#7BC8C4"/>'
        + '<rect x="-8" y="13" width="2" height="1" fill="#BDE7E4"/></g>'
        + '<g class="tow-a"><rect x="-4" y="12" width="4" height="4" fill="#F6C85F"/>'
        + '<rect x="-3" y="13" width="2" height="1" fill="#FFE3A3"/></g>',
    },
    duration: 3400,
    comment: '拖运。身后拖着一串箱子，一小步一小步往前挪。\n'
      + '   串的每一节都比前一节晚一拍跟上——那个**延迟**就是「拖得动」的读感。',
    layers: [
      { sel: '.actor', name: 'tow-body', poses: [
        p('translate(0,0) scaleX(.96)', 4), p('translate(1px,-1px)', 1), p('translate(2px,0)', 2),
        p('translate(2px,0) scaleX(1.02)', 1), p('translate(1px,1px)', 3), p('translate(0,0)', 1),
        p('translate(0,1px) scaleX(.98)', 2) ] },
      { sel: '.left-claw', name: 'tow-left', poses: [
        p('translate(1px,1px)', 4), p('translate(2px,0)', 1), p('translate(2px,-1px)', 2),
        p('translate(1px,0)', 1), p('translate(1px,1px)', 3), p('translate(0,1px)', 3) ] },
      { sel: '.right-claw', name: 'tow-right', poses: [
        p('translate(-2px,2px)', 4), p('translate(-2px,1px)', 1), p('translate(-1px,1px)', 2),
        p('translate(-2px,2px)', 4), p('translate(-2px,1px)', 3) ] },
      // 三节各晚一拍：a 跟得最紧，c 拖在最后
      { sel: '.tow-a', name: 'tow-crate-a', poses: [
        p('translate(0,0)', 5), p('translate(1px,0)', 1), p('translate(2px,0)', 2),
        p('translate(2px,0)', 1), p('translate(1px,1px)', 3), p('translate(0,0)', 2) ] },
      { sel: '.tow-b', name: 'tow-crate-b', poses: [
        p('translate(0,0)', 7), p('translate(1px,0)', 1), p('translate(2px,0)', 2),
        p('translate(1px,1px)', 2), p('translate(0,0)', 2) ] },
      { sel: '.tow-c', name: 'tow-crate-c', poses: [
        p('translate(0,0)', 9), p('translate(1px,0)', 1), p('translate(2px,0)', 2),
        p('translate(1px,0)', 1), p('translate(0,1px)', 1) ] },
      { sel: '.leg-a', name: 'tow-leg-a', period: 1700, poses: [
        p('translate(0,0)', 4), p('translate(1px,-1px)', 1), p('translate(0,0)', 3) ] },
      { sel: '.leg-b', name: 'tow-leg-b', period: 1700, poses: [
        p('translate(0,0)', 6), p('translate(1px,-1px)', 1), p('translate(0,0)', 1) ] },
      { sel: '.leg-c', name: 'tow-leg-c', period: 1700, poses: [
        p('translate(1px,-1px)', 1), p('translate(0,0)', 5), p('translate(0,0)', 2) ] },
      { sel: '.leg-d', name: 'tow-leg-d', period: 1700, poses: [
        p('translate(0,0)', 2), p('translate(1px,-1px)', 1), p('translate(0,0)', 5) ] },
      { sel: '.eyes', name: 'tow-eyes', period: 2900, poses: [
        p('translate(1px,1px)', 4), p('translate(1px,0)', 2), p('translate(0,1px)', 3) ] },
      { sel: '.blink', name: 'tow-blink', period: 4700, poses: [
        p('scaleY(1)', 11), p('scaleY(.15)', 1), p('scaleY(1)', 4) ] },
    ],
  },

  {
    state: 'work-l',
    svg: {
      file: 'work-l-cycle.svg',
      title: 'Full Cycle',
      desc: 'One complete beat of work per loop: fetch, process, inspect, file away.',
      propsAfter: '<g class="item motion"><rect x="5" y="11" width="5" height="4" fill="#7BC8C4"/>'
        + '<rect x="6" y="12" width="3" height="1" fill="#BDE7E4"/></g>'
        + '<g class="done motion"><rect x="16" y="13" width="4" height="3" fill="#B9A1D9"/>'
        + '<rect x="17" y="14" width="2" height="1" fill="#E7DCF2"/></g>',
    },
    duration: 3400,
    comment: '起承转合。一个循环里是一件**完整的活**：伸手取料 → 快速加工 →\n'
      + '   举起来检查（停一拍）→ 归到右边。\n'
      + '   前八个候选都是均匀节拍的重复，这个换的是**循环结构**——\n'
      + '   有段落感，看久了不会腻，但也因此每一遍都一样、可预测。',
    layers: [
      { sel: '.actor', name: 'cycle-body', poses: [
        // ① 取
        p('translate(-2px,1px)', 3), p('translate(-1px,0)', 1),
        // ② 加工：高频小抖
        p('translate(0,-1px)', 1), p('translate(1px,0)', 1), p('translate(0,-1px)', 1),
        p('translate(1px,0)', 1), p('translate(0,-1px)', 1),
        // ③ 检查：举起来停住
        p('translate(0,-2px)', 4),
        // ④ 归位
        p('translate(1px,-1px)', 1), p('translate(2px,0)', 2), p('translate(1px,1px)', 1) ] },
      { sel: '.left-claw', name: 'cycle-left', poses: [
        p('translate(1px,3px)', 3), p('translate(2px,1px)', 1),
        p('translate(3px,-1px)', 1), p('translate(2px,0)', 1), p('translate(3px,-1px)', 1),
        p('translate(2px,0)', 1), p('translate(3px,-1px)', 1),
        p('translate(3px,-3px)', 4),
        p('translate(4px,-2px)', 1), p('translate(5px,0)', 2), p('translate(2px,2px)', 1) ] },
      { sel: '.right-claw', name: 'cycle-right', poses: [
        p('translate(-1px,2px)', 3), p('translate(-2px,1px)', 1),
        p('translate(-3px,-1px)', 1), p('translate(-2px,0)', 1), p('translate(-3px,-1px)', 1),
        p('translate(-2px,0)', 1), p('translate(-3px,-1px)', 1),
        p('translate(-3px,-3px)', 4),
        p('translate(-2px,-2px)', 1), p('translate(0,0)', 2), p('translate(-1px,1px)', 1) ] },
      { sel: '.item', name: 'cycle-item', poses: [
        p('opacity:0;transform:translate(-4px,3px)', 2), p('opacity:1;transform:translate(-3px,2px)', 1),
        p('opacity:1;transform:translate(-1px,0)', 1),
        p('opacity:1;transform:translate(0,-1px)', 1), p('opacity:1;transform:translate(0,0)', 1),
        p('opacity:1;transform:translate(0,-1px)', 1), p('opacity:1;transform:translate(0,0)', 1),
        p('opacity:1;transform:translate(0,-3px)', 4),
        p('opacity:1;transform:translate(4px,-2px)', 1), p('opacity:0;transform:translate(9px,0)', 2) ] },
      // 右边的成品堆一件件长高，一个循环加一件
      { sel: '.done', name: 'cycle-done', origin: '18px 16px', poses: [
        p('scaleY(.6)', 12), p('scaleY(1)', 3), p('scaleY(.9)', 2) ] },
      { sel: '.eyes', name: 'cycle-eyes', poses: [
        p('translate(-1px,1px)', 3), p('translate(0,0)', 4),
        p('translate(0,-1px)', 4), p('translate(1px,0)', 3) ] },
      { sel: '.blink', name: 'cycle-blink', period: 4700, poses: [
        p('scaleY(1)', 11), p('scaleY(.15)', 1), p('scaleY(1)', 4) ] },
    ],
  },

  {
    state: 'work-n',
    svg: {
      file: 'work-n-split.svg',
      title: 'Split Duty',
      desc: 'Each claw runs a different job at a different tempo — two things at once.',
      // 左右**不是同一件事的两半**：左边压、右边拉，周期还不同（1130 vs 1700）。
      // 前八个候选的双爪都是对称的。
      propsAfter: '<g class="job-l motion"><rect x="-2" y="12" width="5" height="3" fill="#F6C85F"/>'
        + '<rect x="-1" y="13" width="3" height="1" fill="#FFE3A3"/></g>'
        + '<g class="job-r motion"><rect x="12" y="10" width="4" height="6" fill="#7BC8C4"/>'
        + '<rect x="13" y="11" width="2" height="1" fill="#BDE7E4"/></g>',
    },
    duration: 3400,
    comment: '左右开工。左爪在压、右爪在拉，两边**周期不同**——\n'
      + '   1130ms 对 1700ms，永远错开，合起来的图案要 3.4 秒才重复一次。\n'
      + '   前八个的双爪都是同一件事的两半，这个是两件事同时在干。',
    layers: [
      { sel: '.actor', name: 'split-body', poses: [
        p('translate(-1px,0)', 4), p('translate(-1px,1px)', 1), p('translate(0,-1px)', 2),
        p('translate(1px,0)', 4), p('translate(1px,1px)', 1), p('translate(0,-1px)', 2) ] },
      // 左：压。快节奏
      { sel: '.left-claw', name: 'split-left', period: 1130, poses: [
        p('translate(-1px,0)', 3), p('translate(-2px,2px)', 2), p('translate(-2px,3px)', 1),
        p('translate(-1px,1px)', 1) ] },
      { sel: '.job-l', name: 'split-job-l', period: 1130, origin: '0.5px 15px', poses: [
        p('scaleY(1)', 3), p('scaleY(.6)', 2), p('scaleY(1.15)', 1), p('scaleY(1)', 1) ] },
      // 右：拉。慢节奏
      { sel: '.right-claw', name: 'split-right', period: 1700, poses: [
        p('translate(-1px,-2px)', 3), p('translate(-1px,0)', 1), p('translate(0,2px)', 3),
        p('translate(0,0)', 1) ] },
      { sel: '.job-r', name: 'split-job-r', period: 1700, origin: '14px 16px', poses: [
        p('scaleY(1)', 3), p('scaleY(.72)', 1), p('scaleY(.55)', 3), p('scaleY(.85)', 1) ] },
      { sel: '.eyes', name: 'split-eyes', period: 2300, poses: [
        p('translate(-1px,1px)', 3), p('translate(0,0)', 1), p('translate(1px,1px)', 3),
        p('translate(0,0)', 1) ] },
      { sel: '.blink', name: 'split-blink', period: 4300, poses: [
        p('scaleY(1)', 9), p('scaleY(.15)', 1), p('scaleY(1)', 4) ] },
    ],
  },
);

// ============================================================================
// working 候选第四批
//
//   O 敲键盘  — 电脑场景里最直白的「在干活」，用户点名要的
//   Q 翻卡片  — 快速连续过料，与 A 的「流入」区别在于是「翻过去」不是「收下」
//   R 踩踏板  — 修正 E 的失败：腿仍是主角，但给它配一个**看得见的**道具
//   S 收发    — 抽象方向：头顶天线一波波收发信号，表达「在和远端通信」
// ============================================================================

ANIMATIONS.push(
  {
    state: 'work-o',
    svg: {
      file: 'work-o-keys.svg',
      title: 'Keyboard',
      desc: 'Types on a small keyboard with both claws in rapid alternation; keys depress under each strike.',
      // 键帽必须 2 单位宽才看得见（1 单位 = 3px）。三个键够读出「一排键」，
      // 再多就糊成一条了。键盘抬到腿的高度，短手才够得着。
      propsAfter: '<g class="kbd"><rect x="2" y="14" width="12" height="3" fill="#6E5F49"/>'
        + '<rect x="2" y="17" width="12" height="1" fill="#544732"/></g>'
        + '<g class="key-a motion"><rect x="3" y="13" width="2" height="1" fill="#E8E0D2"/></g>'
        + '<g class="key-b motion"><rect x="7" y="13" width="2" height="1" fill="#E8E0D2"/></g>'
        + '<g class="key-c motion"><rect x="11" y="13" width="2" height="1" fill="#E8E0D2"/></g>',
    },
    duration: 3400,
    comment: '敲键盘。双爪高频交替下击，被敲到的键下沉一格。\n'
      + '   周期 850ms——四个候选里最快的，每 0.85 秒一轮双击，\n'
      + '   打字的读感全在**频率**上，慢下来就变成「戳」了。',
    layers: [
      { sel: '.actor', name: 'keys-body', poses: [
        p('translate(0,1px)', 4), p('translate(-1px,2px)', 1), p('translate(0,1px)', 2),
        p('translate(1px,2px)', 1), p('translate(0,1px)', 3), p('translate(0,2px)', 1),
        p('translate(-1px,1px)', 2) ] },
      { sel: '.left-claw', name: 'keys-left', period: 850, poses: [
        p('translate(3px,2px)', 3), p('translate(3px,4px)', 1), p('translate(3px,3px)', 1),
        p('translate(4px,1px)', 2) ] },
      { sel: '.right-claw', name: 'keys-right', period: 850, poses: [
        p('translate(-4px,1px)', 2), p('translate(-3px,2px)', 3), p('translate(-3px,4px)', 1),
        p('translate(-3px,3px)', 1) ] },
      { sel: '.key-a', name: 'keys-key-a', period: 850, poses: [
        p('translateY(0)', 5), p('translateY(1px)', 1), p('translateY(0)', 2) ] },
      { sel: '.key-b', name: 'keys-key-b', period: 850, poses: [
        p('translateY(1px)', 1), p('translateY(0)', 4), p('translateY(1px)', 1),
        p('translateY(0)', 2) ] },
      { sel: '.key-c', name: 'keys-key-c', period: 850, poses: [
        p('translateY(0)', 2), p('translateY(1px)', 1), p('translateY(0)', 5) ] },
      // 眼睛看前上方——盯着看不见的屏幕，不是盯着键盘。这是打字的人的样子。
      { sel: '.eyes', name: 'keys-eyes', period: 2900, poses: [
        p('translate(0,-1px)', 5), p('translate(1px,-1px)', 2), p('translate(0,-1px)', 3),
        p('translate(-1px,-1px)', 2) ] },
      { sel: '.blink', name: 'keys-blink', period: 4300, poses: [
        p('scaleY(1)', 10), p('scaleY(.15)', 1), p('scaleY(1)', 4) ] },
    ],
  },

  {
    state: 'work-q',
    svg: {
      file: 'work-q-cards.svg',
      title: 'Card Flip',
      desc: 'Flips through a stack card by card; each one snaps over to the far side.',
      propsAfter: '<g class="stack-r"><rect x="9" y="11" width="5" height="5" fill="#7BC8C4"/>'
        + '<rect x="10" y="12" width="3" height="1" fill="#BDE7E4"/></g>'
        + '<g class="stack-l"><rect x="1" y="12" width="5" height="4" fill="#B9A1D9"/>'
        + '<rect x="2" y="13" width="3" height="1" fill="#E7DCF2"/></g>'
        + '<g class="flip motion"><rect x="9" y="11" width="5" height="5" fill="#A8DBD8"/>'
        + '<rect x="10" y="12" width="3" height="1" fill="#DFF3F2"/></g>',
    },
    duration: 3400,
    comment: '翻卡。右边一叠翻到左边，一张接一张。\n'
      + '   翻转用 scaleX 压到 0 再展开——像素画里这就是「翻过去」的标准写法。\n'
      + '   与 A 的区别：A 是收下并消化，这个是**过一遍就扔到另一边**。',
    layers: [
      { sel: '.actor', name: 'cards-body', poses: [
        p('translate(1px,0)', 4), p('translate(0,-1px)', 1), p('translate(-1px,0)', 2),
        p('translate(-1px,1px)', 1), p('translate(1px,0)', 3), p('translate(0,-1px)', 1),
        p('translate(1px,1px)', 2) ] },
      { sel: '.left-claw', name: 'cards-left', period: 1130, poses: [
        p('translate(2px,1px)', 3), p('translate(3px,0)', 1), p('translate(3px,1px)', 2),
        p('translate(2px,2px)', 1) ] },
      { sel: '.right-claw', name: 'cards-right', period: 1130, poses: [
        p('translate(-2px,0)', 3), p('translate(-3px,1px)', 1), p('translate(-4px,0)', 2),
        p('translate(-3px,-1px)', 1) ] },
      // 一张卡从右叠翻到左叠：scaleX 压扁到 0 是「转到侧面」，再展开是「落下」
      { sel: '.flip', name: 'cards-flip', period: 1130, origin: '11.5px 13.5px', poses: [
        p('opacity:1;transform:scaleX(1)', 3),
        p('opacity:1;transform:scaleX(.4) translateX(-3px)', 1),
        p('opacity:1;transform:scaleX(.05) translateX(-8px)', 1),
        p('opacity:1;transform:scaleX(.5) translateX(-13px)', 1),
        p('opacity:0;transform:scaleX(1) translateX(-16px)', 2) ] },
      { sel: '.eyes', name: 'cards-eyes', period: 1900, poses: [
        p('translate(1px,0)', 3), p('translate(0,0)', 1), p('translate(-1px,0)', 3),
        p('translate(0,1px)', 1) ] },
      { sel: '.blink', name: 'cards-blink', period: 4300, poses: [
        p('scaleY(1)', 9), p('scaleY(.15)', 1), p('scaleY(1)', 4) ] },
    ],
  },

  {
    state: 'work-r',
    svg: {
      file: 'work-r-pedal.svg',
      title: 'Pedal',
      desc: 'Four legs work a treadle in turn; the board rocks under them and the whole body rides it.',
      splitLegs: true,
      // E 的教训：腿当主角没问题，但**必须有看得见的道具**，
      // 否则角色只是一个方块在变形，读不出在干什么。
      props: '<g class="board motion"><rect x="0" y="15" width="15" height="2" fill="#8C7A5E"/>'
        + '<rect x="0" y="17" width="15" height="1" fill="#6E5F49"/>'
        + '<rect x="2" y="16" width="3" height="1" fill="#A08C6C"/>'
        + '<rect x="10" y="16" width="3" height="1" fill="#A08C6C"/></g>',
    },
    duration: 3400,
    comment: '踩踏板。四条腿轮流蹬，板被踩得一头沉一头翘，整个身体跟着起伏。\n'
      + '   这是 E（无道具全身发力）的修正版：腿仍然是主角，\n'
      + '   但给了它一块看得见的板，「在使劲」才有了对象。',
    layers: [
      { sel: '.actor', name: 'pedal-body', poses: [
        p('translate(-1px,1px) scaleY(.94)', 4), p('translate(-1px,0)', 1),
        p('translate(0,-1px) scaleY(1.02)', 2), p('translate(1px,0)', 1),
        p('translate(1px,1px) scaleY(.94)', 3), p('translate(1px,0)', 1),
        p('translate(0,0) scaleY(.98)', 2) ] },
      // 板跟着重心一头沉一头翘。角色向左压时板左低右高。
      { sel: '.board', name: 'pedal-board', origin: '7.5px 16px', poses: [
        p('rotate(-6deg)', 4), p('rotate(-3deg)', 1), p('rotate(0)', 2),
        p('rotate(3deg)', 1), p('rotate(6deg)', 3), p('rotate(3deg)', 1),
        p('rotate(0)', 2) ] },
      { sel: '.leg-a', name: 'pedal-leg-a', period: 850, poses: [
        p('translateY(0)', 3), p('translateY(-2px)', 1), p('translateY(-1px)', 1),
        p('translateY(0)', 2) ] },
      { sel: '.leg-b', name: 'pedal-leg-b', period: 850, poses: [
        p('translateY(-1px)', 1), p('translateY(0)', 3), p('translateY(-2px)', 1),
        p('translateY(0)', 2) ] },
      { sel: '.leg-c', name: 'pedal-leg-c', period: 850, poses: [
        p('translateY(0)', 2), p('translateY(-2px)', 1), p('translateY(-1px)', 1),
        p('translateY(0)', 3) ] },
      { sel: '.leg-d', name: 'pedal-leg-d', period: 850, poses: [
        p('translateY(0)', 5), p('translateY(-2px)', 1), p('translateY(-1px)', 1) ] },
      { sel: '.left-claw', name: 'pedal-left', poses: [
        p('translate(1px,-1px)', 4), p('translate(1px,0)', 2), p('translate(2px,-1px)', 3),
        p('translate(1px,0)', 2) ] },
      { sel: '.right-claw', name: 'pedal-right', poses: [
        p('translate(-2px,-1px)', 4), p('translate(-1px,0)', 2), p('translate(-1px,-1px)', 3),
        p('translate(-2px,0)', 2) ] },
      { sel: '.eyes', name: 'pedal-eyes', period: 2300, poses: [
        p('translate(0,-1px)', 4), p('translate(0,0)', 2), p('translate(0,-1px)', 3) ] },
      { sel: '.blink', name: 'pedal-blink', period: 5300, poses: [
        p('scaleY(1)', 12), p('scaleY(.15)', 1), p('scaleY(1)', 4) ] },
    ],
  },

  {
    state: 'work-s',
    svg: {
      file: 'work-s-signal.svg',
      title: 'Signal Relay',
      desc: 'An antenna on the back sends pixel pulses upward in waves while both claws tend the base.',
      // 方块状的离散信号有先例：sleeping 的像素 Zzz 是用户批准过的。
      // 这不是 glow——契约禁止的是发光与速度线，不是道具化的符号。
      propsAfter: '<g class="mast"><rect x="7" y="1" width="1" height="6" fill="#8C7A5E"/>'
        + '<rect x="6" y="0" width="3" height="1" fill="#C4715A"/></g>'
        + '<g class="pulse-a motion"><rect x="5" y="-2" width="5" height="1" fill="#7BC8C4"/></g>'
        + '<g class="pulse-b motion"><rect x="5" y="-2" width="5" height="1" fill="#F6C85F"/></g>'
        + '<g class="pulse-c motion"><rect x="5" y="-2" width="5" height="1" fill="#B9A1D9"/></g>',
    },
    duration: 3400,
    comment: '收发。背上一根天线，信号一波波往外发；双爪在底座上调。\n'
      + '   十二个候选里最抽象的一个——不表演体力活，表演**在和远端通信**。\n'
      + '   对一个 AI 客户端来说，这可能比搬砖更贴近它真正在做的事。',
    layers: [
      // 「站着发信号」很容易写成站着不动。身体始终保持一点上抬，
      // 在小范围里持续调整——回到原位就读成信号停了。
      { sel: '.actor', name: 'signal-body', poses: [
        p('translate(0,-1px)', 4), p('translate(-1px,-1px)', 1), p('translate(-1px,0)', 2),
        p('translate(0,-2px)', 1), p('translate(1px,0)', 3), p('translate(1px,-1px)', 1),
        p('translate(0,-2px)', 2) ] },
      { sel: '.left-claw', name: 'signal-left', period: 1700, poses: [
        p('translate(2px,-2px)', 3), p('translate(2px,-3px)', 1), p('translate(3px,-2px)', 2),
        p('translate(2px,-1px)', 1) ] },
      { sel: '.right-claw', name: 'signal-right', period: 1700, poses: [
        p('translate(-2px,-1px)', 1), p('translate(-2px,-2px)', 3), p('translate(-3px,-3px)', 1),
        p('translate(-2px,-2px)', 2) ] },
      // 三道信号依次上行、逐渐变宽再淡出。相位各差三分之一。
      { sel: '.pulse-a', name: 'signal-pulse-a', poses: [
        p('opacity:0;transform:translateY(4px) scaleX(.4)', 1),
        p('opacity:1;transform:translateY(1px) scaleX(.7)', 2),
        p('opacity:1;transform:translateY(-2px) scaleX(1)', 2),
        p('opacity:1;transform:translateY(-5px) scaleX(1.3)', 2),
        p('opacity:0;transform:translateY(-8px) scaleX(1.6)', 2) ] },
      { sel: '.pulse-b', name: 'signal-pulse-b', poses: [
        p('opacity:1;transform:translateY(-2px) scaleX(1)', 2),
        p('opacity:1;transform:translateY(-5px) scaleX(1.3)', 2),
        p('opacity:0;transform:translateY(-8px) scaleX(1.6)', 2),
        p('opacity:0;transform:translateY(4px) scaleX(.4)', 1),
        p('opacity:1;transform:translateY(1px) scaleX(.7)', 2) ] },
      { sel: '.pulse-c', name: 'signal-pulse-c', poses: [
        p('opacity:0;transform:translateY(-8px) scaleX(1.6)', 2),
        p('opacity:0;transform:translateY(4px) scaleX(.4)', 1),
        p('opacity:1;transform:translateY(1px) scaleX(.7)', 2),
        p('opacity:1;transform:translateY(-2px) scaleX(1)', 2),
        p('opacity:1;transform:translateY(-5px) scaleX(1.3)', 2) ] },
      { sel: '.eyes', name: 'signal-eyes', period: 2900, poses: [
        p('translate(0,-1px)', 4), p('translate(0,0)', 2), p('translate(0,-1px)', 3),
        p('translate(1px,0)', 2) ] },
      { sel: '.blink', name: 'signal-blink', period: 4700, poses: [
        p('scaleY(1)', 11), p('scaleY(.15)', 1), p('scaleY(1)', 4) ] },
    ],
  },
);

// ============================================================================
// 两个新的工作修饰
//
// 都**复用 Tile Feed 的道具与场景**，只改材料的命运——用户不需要学新符号。
// 这是它们全部的表意来源，所以必须和 working 放在一起看才成立。
// ============================================================================

ANIMATIONS.push(
  {
    state: 'working-retrying',
    svg: {
      file: 'work-retry.svg',
      title: 'Retry Grip',
      desc: 'A work tile slips from the claws and drops away; the claws grab for the next one and start over.',
      propsAfter: '<g class="tile-ok motion"><rect x="5" y="11" width="5" height="4" fill="#7BC8C4"/>'
        + '<rect x="6" y="12" width="3" height="1" fill="#BDE7E4"/></g>'
        + '<g class="tile-slip motion"><rect x="5" y="11" width="5" height="4" fill="#C4715A"/>'
        + '<rect x="6" y="12" width="3" height="1" fill="#E09A85"/></g>',
    },
    duration: 3400,
    comment: '重试。牌升到一半滑脱掉下去，爪子扑空，身体一顿，再抓下一块。\n'
      + '   与 Tile Feed 用**同样的道具、同样的时长**——对比才是表意来源：\n'
      + '   同一个画面里「这次没接住」本身就是失败的意思。\n'
      + '   滑脱那一下必须**快**（一拍掉到底），顿住必须**长**——\n'
      + '   慢慢滑下去读作「放下」，不是「掉了」。',
    layers: [
      {
        sel: '.actor',
        name: 'retry-body',
        poses: [
          p('translate(0,-1px)', 3), p('translate(-1px,0)', 1), p('translate(-1px,-1px)', 2),
          p('translate(0,1px)', 1),        // 扑空，重心往下一沉
          p('translate(0,2px)', 4),        // 顿住：这一拍最长，是「怎么又掉了」
          p('translate(0,0)', 1), p('translate(1px,-1px)', 2),
        ],
      },
      {
        sel: '.left-claw',
        name: 'retry-left',
        poses: [
          p('translate(4px,2px)', 3), p('translate(4px,0)', 1), p('translate(3px,-2px)', 2),
          p('translate(3px,0)', 1),        // 手滑
          p('translate(4px,3px)', 4),      // 空抓，停在低位
          p('translate(4px,2px)', 1), p('translate(3px,-1px)', 2),
        ],
      },
      {
        sel: '.right-claw',
        name: 'retry-right',
        poses: [
          p('translate(-3px,0)', 3), p('translate(-3px,-2px)', 1), p('translate(-4px,-3px)', 2),
          p('translate(-3px,-1px)', 1), p('translate(-3px,2px)', 4),
          p('translate(-3px,1px)', 1), p('translate(-4px,-2px)', 2),
        ],
      },
      {
        // 滑脱的那块：升到一半突然一拍掉到画面外
        sel: '.tile-slip',
        name: 'retry-slip',
        poses: [
          p('opacity:1;transform:translateY(4px)', 3),
          p('opacity:1;transform:translateY(1px)', 1),
          p('opacity:1;transform:translateY(-1px)', 2),
          p('opacity:1;transform:translate(1px,6px)', 1),   // 一拍掉到底
          p('opacity:0;transform:translate(2px,12px)', 4),
          p('opacity:0;transform:translateY(7px)', 1),
          p('opacity:1;transform:translateY(5px)', 2),
        ],
      },
      {
        // 下一块已经在等着：失败不是终点，它还在继续
        sel: '.tile-ok',
        name: 'retry-next',
        poses: [
          p('opacity:0;transform:translateY(9px)', 5),
          p('opacity:0;transform:translateY(8px)', 2),
          p('opacity:1;transform:translateY(6px)', 4),
          p('opacity:1;transform:translateY(4px)', 2),
        ],
      },
      {
        sel: '.eyes',
        name: 'retry-eyes',
        period: 2900,
        poses: [
          p('translate(0,1px)', 3), p('translate(0,2px)', 3), p('translate(-1px,1px)', 2),
          p('translate(0,1px)', 2),
        ],
      },
      {
        sel: '.blink',
        name: 'retry-blink',
        period: 3700,
        poses: [p('scaleY(1)', 7), p('scaleY(.15)', 1), p('scaleY(1)', 3)],
      },
    ],
  },

  {
    state: 'working-long',
    svg: {
      file: 'work-long.svg',
      title: 'Deep Work',
      desc: 'Smaller, steadier motion with half-lidded eyes; finished tiles pile up at the side.',
      propsAfter: '<g class="tile-a motion"><rect x="5" y="11" width="5" height="4" fill="#7BC8C4"/>'
        + '<rect x="6" y="12" width="3" height="1" fill="#BDE7E4"/></g>'
        + '<g class="done-pile motion"><rect x="15" y="9" width="5" height="6" fill="#B9A1D9"/>'
        + '<rect x="16" y="10" width="3" height="1" fill="#E7DCF2"/>'
        + '<rect x="16" y="12" width="3" height="1" fill="#E7DCF2"/></g>',
    },
    duration: 5000,
    comment: '久战。「干很久」**不能画成更快**——那读作着急。反过来做：\n'
      + '   幅度更小、节奏更沉、眼睛半阖，像进了心流。\n'
      + '   身侧那摞完成品缓慢增高，是唯一说明「已经干了不少」的可见证据。',
    layers: [
      {
        sel: '.actor',
        name: 'long-body',
        // 幅度只有 working 的一半：全程 1 格以内，但一刻不停
        poses: [
          p('translate(0,-1px)', 5), p('translate(0,0)', 2), p('translate(-1px,-1px)', 4),
          p('translate(0,0)', 2), p('translate(0,-1px)', 5), p('translate(1px,0)', 2),
          p('translate(1px,-1px)', 3),
        ],
      },
      {
        sel: '.left-claw',
        name: 'long-left',
        period: 2500,
        poses: [
          p('translate(3px,1px)', 4), p('translate(3px,0)', 2), p('translate(4px,-1px)', 3),
          p('translate(3px,0)', 2),
        ],
      },
      {
        sel: '.right-claw',
        name: 'long-right',
        period: 2500,
        poses: [
          p('translate(-3px,-1px)', 3), p('translate(-3px,0)', 2), p('translate(-2px,1px)', 4),
          p('translate(-3px,0)', 2),
        ],
      },
      {
        sel: '.tile-a',
        name: 'long-tile',
        period: 2500,
        poses: [
          p('opacity:0;transform:translateY(7px)', 1), p('opacity:1;transform:translateY(5px)', 3),
          p('opacity:1;transform:translateY(2px)', 3), p('opacity:1;transform:translateY(0)', 2),
          p('opacity:0;transform:translateY(-2px)', 1),
        ],
      },
      {
        // 完成品一层层长高，满了整摞搬走再来。这是「已经干了很久」的证据。
        sel: '.done-pile',
        name: 'long-pile',
        origin: '17.5px 15px',
        poses: [
          p('scaleY(.34)', 4), p('scaleY(.5)', 4), p('scaleY(.67)', 4),
          p('scaleY(.84)', 4), p('scaleY(1)', 5), p('opacity:0;transform:scaleY(1) translateY(-3px)', 1),
        ],
      },
      {
        sel: '.eyes',
        name: 'long-eyes',
        period: 3100,
        // 半阖：专注，不是困倦——所以不往下沉，只是收窄
        poses: [
          p('translateY(1px) scaleY(.6)', 5), p('translateY(1px) scaleY(.5)', 3),
          p('translateY(1px) scaleY(.65)', 2), p('translateY(1px) scaleY(.55)', 3),
        ],
      },
      {
        sel: '.blink',
        name: 'long-blink',
        period: 6700,
        poses: [p('scaleY(1)', 14), p('scaleY(.15)', 1), p('scaleY(1)', 5)],
      },
    ],
  },
);

// ============================================================================
// working 的并发分档（tier）——**占位素材，动作待定**
//
// 机制：同一个状态按并发会话数换素材，状态 id 始终是 working。
// 这里只做到「数量看得见」这一步，用来验证机制通不通；
// 真正的动作设计另行讨论，所以契约里标了 placeholder，测试会盯着它。
//
// 参考 clawd-on-desk 的机制但不抄它的映射：它用「戴耳机摇摆」表示 2 个会话，
// 用户读不出这个对应关系——那是换皮，不是传信息。
// 让**数量本身可见**才不需要用户学映射。
// ============================================================================

/** 占位用：一条流水线的姿态谱，牌从下方流入、在胸口淡出。 */
const lane = (dx) => [
  p(`opacity:0;transform:translate(${dx}px,8px)`, 1),
  p(`opacity:1;transform:translate(${dx}px,6px)`, 2),
  p(`opacity:1;transform:translate(${dx}px,4px)`, 2),
  p(`opacity:1;transform:translate(${dx}px,2px)`, 2),
  p(`opacity:1;transform:translate(${dx}px,0)`, 2),
  p(`opacity:0;transform:translate(${dx}px,-2px)`, 1),
];

/** 占位用：身体的通用工作节奏，无静止姿态、首尾不同。 */
const busyBody = [
  p('translate(0,-1px)', 3), p('translate(-1px,0)', 1), p('translate(-1px,1px)', 2),
  p('translate(0,-1px)', 3), p('translate(1px,0)', 1), p('translate(1px,1px)', 2),
];

ANIMATIONS.push(
  {
    state: 'work-tier2',
    svg: {
      file: 'work-tier2.svg',
      title: 'Tile Feed ×2',
      desc: 'PLACEHOLDER — two parallel tile lanes, one per concurrent session.',
      propsAfter: '<g class="lane-a motion"><rect x="1" y="11" width="4" height="4" fill="#7BC8C4"/>'
        + '<rect x="2" y="12" width="2" height="1" fill="#BDE7E4"/></g>'
        + '<g class="lane-b motion"><rect x="10" y="11" width="4" height="4" fill="#B9A1D9"/>'
        + '<rect x="11" y="12" width="2" height="1" fill="#E7DCF2"/></g>',
    },
    duration: 3400,
    comment: '**占位**。两个会话 = 两条并行的流水线，数量直接可见。\n'
      + '   动作本身待定：现在只是把 Tile Feed 的流动复制两份、错开半个周期，\n'
      + '   够验证「并发数变了画面真的会变」这件事，不是最终设计。',
    layers: [
      { sel: '.actor', name: 'tier2-body', poses: busyBody },
      { sel: '.left-claw', name: 'tier2-left', period: 1700, poses: [
        p('translate(1px,2px)', 3), p('translate(1px,0)', 2), p('translate(2px,-1px)', 2),
        p('translate(1px,1px)', 1) ] },
      { sel: '.right-claw', name: 'tier2-right', period: 1700, poses: [
        p('translate(-2px,-1px)', 2), p('translate(-1px,1px)', 1), p('translate(-1px,2px)', 3),
        p('translate(-1px,0)', 2) ] },
      { sel: '.lane-a', name: 'tier2-lane-a', poses: lane(0) },
      // 错开半个周期：两条同步会读成「一块大板」，错开才是两条
      { sel: '.lane-b', name: 'tier2-lane-b', poses: [...lane(0).slice(3), ...lane(0).slice(0, 3)] },
      { sel: '.eyes', name: 'tier2-eyes', period: 2900, poses: [
        p('translate(0,1px)', 3), p('translate(-1px,1px)', 2), p('translate(1px,1px)', 2),
        p('translate(0,0)', 2) ] },
      { sel: '.blink', name: 'tier2-blink', period: 4700, poses: [
        p('scaleY(1)', 11), p('scaleY(.15)', 1), p('scaleY(1)', 4) ] },
    ],
  },

  {
    state: 'work-tier3',
    svg: {
      file: 'work-tier3.svg',
      title: 'Tile Feed ×3',
      desc: 'PLACEHOLDER — three parallel tile lanes for three or more concurrent sessions.',
      propsAfter: '<g class="lane-a motion"><rect x="0" y="11" width="3" height="4" fill="#7BC8C4"/></g>'
        + '<g class="lane-b motion"><rect x="6" y="11" width="3" height="4" fill="#F6C85F"/></g>'
        + '<g class="lane-c motion"><rect x="12" y="11" width="3" height="4" fill="#B9A1D9"/></g>',
    },
    duration: 3400,
    comment: '**占位**。三条及以上并行。三条相位各差三分之一周期，\n'
      + '   画面上任何时刻都有牌在不同高度——这是「同时在跑好几摊」的读法。\n'
      + '   动作待定，现在只验证机制。',
    layers: [
      { sel: '.actor', name: 'tier3-body', poses: busyBody },
      { sel: '.left-claw', name: 'tier3-left', period: 1130, poses: [
        p('translate(1px,2px)', 3), p('translate(1px,0)', 2), p('translate(2px,-1px)', 2) ] },
      { sel: '.right-claw', name: 'tier3-right', period: 1130, poses: [
        p('translate(-2px,-1px)', 2), p('translate(-1px,1px)', 2), p('translate(-1px,2px)', 3) ] },
      { sel: '.lane-a', name: 'tier3-lane-a', poses: lane(0) },
      { sel: '.lane-b', name: 'tier3-lane-b', poses: [...lane(0).slice(2), ...lane(0).slice(0, 2)] },
      { sel: '.lane-c', name: 'tier3-lane-c', poses: [...lane(0).slice(4), ...lane(0).slice(0, 4)] },
      { sel: '.eyes', name: 'tier3-eyes', period: 1900, poses: [
        p('translate(-1px,1px)', 3), p('translate(0,0)', 1), p('translate(1px,1px)', 3),
        p('translate(0,1px)', 1) ] },
      { sel: '.blink', name: 'tier3-blink', period: 4300, poses: [
        p('scaleY(1)', 9), p('scaleY(.15)', 1), p('scaleY(1)', 4) ] },
    ],
  },
);
