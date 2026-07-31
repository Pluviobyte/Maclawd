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
      title: 'Tile Stack',
      desc: 'Maclawd alternates both claws on two compact overlapping work tiles.',
      props: '<g class="work-tile-a motion"><path d="M4 11H10V15H4Z" fill="#7BC8C4"/>'
        + '<rect x="5" y="12" width="4" height="1" fill="#BDE7E4"/></g>'
        + '<g class="work-tile-b motion"><path d="M6 14H12V18H6Z" fill="#B9A1D9"/>'
        + '<rect x="7" y="15" width="4" height="1" fill="#E7DCF2"/></g>',
    },
    duration: 3400,
    comment: '整理两块工作牌。这是「在干活」的主视觉，节奏要稳、要密，\n'
      + '   但不能急躁——急躁读作焦虑，不是专注。',
    layers: [
      {
        sel: '.actor',
        name: 'work-body',
        poses: [
          p('translate(0,0)', 2), p('translate(-1px,-1px)', 1), p('translate(-1px,-1px)', 2),
          p('translate(0,-1px)', 1), p('translate(1px,-1px)', 2), p('translate(1px,-2px)', 1),
          p('translate(0,-1px)', 1), p('translate(0,0)', 2),
        ],
      },
      {
        sel: '.left-claw',
        name: 'work-left',
        period: 3400,
        poses: [
          p('translate(0,0)', 1), p('translate(3px,-2px)', 1), p('translate(5px,-3px)', 2),
          p('translate(4px,-1px)', 1), p('translate(2px,1px)', 2), p('translate(3px,-1px)', 1),
          p('translate(5px,-2px)', 2), p('translate(2px,0)', 1), p('translate(0,0)', 1),
        ],
      },
      {
        sel: '.right-claw',
        name: 'work-right',
        period: 3400,
        // 与左爪反相：一只上去时另一只下来，这是「交替整理」的读法
        poses: [
          p('translate(0,0)', 1), p('translate(-2px,1px)', 2), p('translate(-4px,-1px)', 1),
          p('translate(-5px,-3px)', 2), p('translate(-3px,-1px)', 1), p('translate(-2px,1px)', 2),
          p('translate(-4px,-2px)', 1), p('translate(0,0)', 2),
        ],
      },
      {
        sel: '.work-tile-a',
        name: 'work-tile-a',
        period: 3400,
        poses: [
          p('translateY(0)', 2), p('translateY(1px)', 1), p('translateY(0)', 1),
          p('translateY(1px)', 2), p('translateY(0)', 2),
        ],
      },
      {
        sel: '.work-tile-b',
        name: 'work-tile-b',
        period: 3400,
        poses: [
          p('translateY(1px)', 2), p('translateY(0)', 2), p('translateY(1px)', 1),
          p('translateY(0)', 1), p('translateY(1px)', 2),
        ],
      },
      {
        sel: '.eyes',
        name: 'work-eyes',
        period: 2900, // 与身体不同周期：视线不跟着手上的节拍走
        poses: [
          p('translate(0,1px)', 4), p('translate(0,0)', 2), p('translate(1px,0)', 1),
          p('translate(0,1px)', 3),
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
      { sel: '.actor', name: 'think-body', poses: [
        p('translate(0,0)', 2), p('translate(-1px,-1px)', 1), p('translate(-1px,-1px)', 2),
        p('translate(0,-1px)', 1), p('translate(1px,-1px)', 2), p('translate(1px,-1px)', 1),
        p('translate(0,-2px)', 4), p('translate(0,0)', 2) ] },
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
        p('translate(0,-1px)', 3) ] },
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
        p('translate(0,0)', 2), p('translate(0,1px)', 1), p('translate(0,2px)', 2),
        p('translate(0,1px)', 1), p('translate(0,0)', 1), p('translate(0,1px)', 1),
        p('translate(0,2px)', 2), p('translate(0,1px)', 1), p('translate(0,0)', 1),
        p('translate(0,1px)', 1), p('translate(0,2px)', 2), p('translate(0,1px)', 1),
        p('translate(0,0)', 2) ] },
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
        p('translate(0,0)', 3), p('translate(-1px,0)', 1), p('translate(-1px,-1px)', 3),
        p('translate(0,-1px)', 1), p('translate(0,0)', 4), p('translate(0,1px)', 1),
        p('translate(0,0)', 1), p('translate(-1px,0)', 1), p('translate(0,0)', 3) ] },
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
      { sel: '.actor', name: 'test-body', poses: [
        p('translate(0,0)', 3), p('translate(-1px,0)', 1), p('translate(-2px,0)', 2),
        p('translate(-1px,0)', 1), p('translate(0,0)', 5), p('translate(0,-1px)', 1),
        p('translate(0,0)', 3) ] },
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
        p('translate(2px,2px)', 2), p('translate(1px,1px)', 1), p('translate(0,1px)', 1) ] },
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
      { sel: '.actor', name: 'hover-body', poses: [
        p('translate(0,0)', 3), p('translate(0,-1px)', 1), p('translate(1px,-1px)', 2),
        p('translate(1px,0)', 1), p('translate(0,0)', 2), p('translate(-1px,0)', 1),
        p('translate(0,0)', 2) ] },
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
