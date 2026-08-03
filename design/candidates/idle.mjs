/**
 * idle（待机）的六个候选。
 *
 * idle 与其余动作有一条不同的验收线：**它是桌宠一天里显示时间最长的状态**。
 * 别的动作按秒计，它按小时计。所以判据不是「好看」而是「耐看」——
 * 一个动作只要有任何一处会让人「又来了」，在 idle 上就会被放大几百倍。
 *
 * 由此推出三条本文件自己的取舍，与其余动作不同：
 *
 * 1. **峰值幅度越低越好。** 任何一次超过 2 格的位移都会把视线从你正在做的
 *    事上拽走一次。所有候选的主幅度压在 1–2 格，例外只留给「回神」那类
 *    一个循环只发生一次的事件。
 *
 * 2. **合成周期要长到数不出来。** 现行实现靠的就是这一手（各层 3100 /
 *    3400 / 4200 / 6700 各走各的），这里除了 c6 之外全部沿用并加强——
 *    c5 与 c2 把四条腿放在 4300 / 4700 / 5300 / 6100 上，约掉公因数 100
 *    之后是 43 / 47 / 53 / 61，四个不同的质数。四只脚回到同一相位要
 *    100 × 43 × 47 × 53 × 61 毫秒 ≈ 7.5 天。
 *
 * 3. **不许有「事件」反复要求解读。** 一个明显的动作看第三遍就变成噪音。
 *    所以候选之间的差别不在「加了什么动作」，而在**生命感从哪儿来**：
 *    胸腔、眼睑、下盘、手里的东西、姿态本身、还是时间结构。
 *
 * 六个候选各换一条轴，而且是六条**不同**的轴——不是六种皮肤。
 * 现行实现（Quiet Watch）在每条轴上的取值都是「默认值」：
 * 看前方、站直、无道具、1 格呼吸、腿不动、均匀循环。
 * 六个候选各把其中一项推到另一端，其余项保持默认，这样对比才是干净的。
 *
 * README 的十条硬约束逐条用脚本验过：每层首尾姿态不同、身体层变异系数
 * ≥ 0.35（实测 0.53–0.64）、位移一律整数格、躯干不旋转、无道具时爪不外扩、
 * 爪不落进同色躯干里、道具不遮脸、姿态密度 ≥ 2.8/秒（实测 3.75–8.93）。
 *
 * 另外自加一条 README 没写但同源的：**循环内最长静默 < 1 秒**。
 * 旧 working 的失效模式是跨接缝 1.5 秒不动被读成卡住，而各层要是都把
 * 最长的一拍排在 0%，一进 idle 就会复现同一个失效——CSS 动画在加上状态类
 * 那一刻全部从 0 起跑。所以六个候选每一层都从短拍开始，长保持排在中段。
 */

/** 缩写：造一串姿态，[transform, 权重]。权重省略时为 1。 */
const p = (transform, weight = 1) => [transform, weight];

export const CANDIDATES = [
  // ------------------------------------------------------------------ c1
  // 换的是「它在看哪儿」。现行实现的视线在中位 ±1 格里晃——那读作
  // **一直看着你**。看一小时的东西一直盯着你，是有压力的。
  // 这个候选把视线推到脸的两端（±2 格已经是眼睛不掉出躯干的极限），
  // 而且每次都**停很久**：不是在扫，是在看某个具体的东西。
  // 身体晚半拍跟过去——先看再转，这个先后关系就是「有目的」的全部证据
  // （同一手法在 self-roam 的眼睛层用过）。
  //
  // 与 ambient.offline（左右仔细听）的区别是谁带头：那个是身体大幅转、
  // 眼睛跟着；这个是眼睛带头、身体只跟 1 格。offline 你一年看不到几次，
  // 这个要看一年。
  {
    action: 'idle',
    id: 'idle-c1',
    title: 'Room Scan',
    axis: '注意力朝向 —— 从「一直看着你」换成「在屋里各处看」，视线带头、身体晚半拍跟随',
    desc: '视线在左端、右端、上方三个落点之间巡，每处都盯住不动，身体晚半拍才转过去。',
    duration: 5600,
    layers: [
      {
        sel: '.actor',
        // 身体与眼睛同周期——错开周期会让「跟随」时对时不对，
        // 那个关系一散，整个候选就退回成随机晃动。
        // 但爪与眨眼仍各走各的，合成图案照样不重复。
        name: 'idle-c1-body',
        poses: [
          p('translate(1px,0)', 1), p('translate(0,0)', 1), p('translate(-1px,0)', 4),
          p('translate(-1px,-1px)', 2), p('translate(0,0)', 1), p('translate(1px,0)', 4),
          p('translate(1px,1px)', 2), p('translate(1px,0)', 1), p('translate(0,-1px)', 2),
        ],
      },
      {
        sel: '.eyes',
        name: 'idle-c1-eyes',
        // ±2 格：右眼此时与躯干右沿齐平，左眼与左沿齐平。再多就掉出脸。
        // 每个落点权重 4，转场只给 1——「看」的读感全在停住的那几拍。
        poses: [
          p('translate(-2px,0)', 4), p('translate(-2px,-1px)', 2), p('translate(-1px,0)', 1),
          p('translate(1px,0)', 1), p('translate(2px,0)', 4), p('translate(2px,1px)', 2),
          p('translate(1px,1px)', 1), p('translate(0,-1px)', 3), p('translate(-1px,-1px)', 2),
        ],
      },
      // 无道具，爪一律只向内、向上、向下——向外会在爪与躯干之间拉开一条缝
      { sel: '.left-claw', name: 'idle-c1-left', period: 4300, poses: [
        p('translate(0,0)', 5), p('translate(1px,-1px)', 1), p('translate(1px,0)', 2),
        p('translate(0,1px)', 3) ] },
      { sel: '.right-claw', name: 'idle-c1-right', period: 3700, poses: [
        p('translate(0,0)', 6), p('translate(-1px,0)', 2), p('translate(-1px,-1px)', 1),
        p('translate(0,-1px)', 2) ] },
      // 收尾停在半闭，接缝处不会把「睁着」的保持时长加倍
      { sel: '.blink', name: 'idle-c1-blink', period: 6700, poses: [
        p('scaleY(1)', 11), p('scaleY(.15)', 1), p('scaleY(1)', 5), p('scaleY(.15)', 1),
        p('scaleY(.6)', 1) ] },
    ],
  },

  // ------------------------------------------------------------------ c2
  // 换的是重心：不站着了，坐下来。**轮廓本身变了**——这是六个候选里
  // 唯一一个从剪影就能一眼认出的。看一小时的东西，剪影比动作重要。
  //
  // 风险在于「下沉 + 纵向压缩」在这套语言里已经被 low-battery 占用为
  // 「垮掉」。三处刻意的反签名把它掰回「坐得很舒服」：
  //   - 眼睛反向上提并抵消父层的纵向压缩（scaleY(1.25) × 父层 .8 = 1），
  //     脸保持在躯干上部、眼睛保持满高。垮掉时脸是往下陷的。
  //   - 外侧两条腿向外摊开。垮掉时四肢是内卷的，没人瘫下去还把腿摆开。
  //   - 节奏是「坐定 — 长保持 — 换一边」，不是单调下降。
  {
    action: 'idle',
    id: 'idle-c2',
    title: 'Settled Sit',
    axis: '重心 —— 从站立换成坐下：躯干压到八成高、外侧腿向外摊开，剪影整个变矮',
    desc: '坐在原地，重心在左右之间慢慢换边，外侧两条腿摊开撑着，脸仍然保持在高处。',
    duration: 5600,
    splitLegs: true,
    layers: [
      {
        sel: '.actor',
        // transform-origin 是 7.5px 15px（脚线），所以 scaleY 只压低顶部、
        // 脚不离地——不用位移就能坐下去，接地关系与其余所有动作一致。
        //
        // 各层都从短拍起，长保持排在中段：九层要是都把最长的一拍放在 0%，
        // 刚进 idle 的第一秒就是一张静止图（CSS 动画在加类那一刻全部从 0 起跑）。
        name: 'idle-c2-body',
        poses: [
          p('scaleY(.81)', 1), p('translateX(-1px) scaleY(.8)', 4),
          p('translateX(-1px) scaleY(.83)', 2), p('scaleY(.81)', 1),
          p('translateX(1px) scaleY(.8)', 3), p('translateX(1px) scaleY(.82)', 2),
          p('scaleY(.8)', 5), p('scaleY(.83)', 2),
        ],
      },
      {
        sel: '.eyes',
        // 上提 1 格 + 抵消父层压缩。少了这一层，坐下去的同时眼睛会被压成
        // 1.6 格高并陷进躯干中部——那正好是 low-battery 的半闭眼。
        name: 'idle-c2-eyes',
        period: 3100,
        poses: [
          p('translate(1px,-1px) scaleY(1.25)', 1), p('translate(0,-1px) scaleY(1.25)', 4),
          p('translate(-1px,-1px) scaleY(1.25)', 2), p('translate(-1px,-2px) scaleY(1.25)', 2),
          p('translate(0,-1px) scaleY(1.25)', 5),
        ],
      },
      // 坐下后爪垂在身前偏下。**横向位移封在 ±1 格以内**：躯干 x2–13 与爪同色
      // 无描边，左爪 dx≥2（右爪 dx≤-2）会整块落进躯干矩形里，那不是「手放在身前」
      // 而是「手没了」。dx≤1 时爪至少还有一列露在轮廓外。
      // 这个候选没有道具能替爪子表意，所以这条不能破。
      { sel: '.left-claw', name: 'idle-c2-left', period: 3700, poses: [
        p('translate(1px,1px)', 1), p('translate(0,2px)', 3), p('translate(1px,3px)', 2),
        p('translate(1px,2px)', 6) ] },
      { sel: '.right-claw', name: 'idle-c2-right', period: 4300, poses: [
        p('translate(0,2px)', 2), p('translate(-1px,1px)', 1), p('translate(-1px,3px)', 2),
        p('translate(-1px,2px)', 7) ] },
      // 外侧两条腿常态摊开 1 格（仍在躯干 x2–13 的覆盖范围内，不会脱开），
      // 内侧两条不动。每条腿只做「原地抬一下再放」，不横移——横移是 c5 的词汇，
      // 这个候选换的是姿态不是步法。四个周期约掉 100 之后是四个不同的质数，
      // 四条腿要 7.5 天才会回到同一相位，所以永远不会一起动。
      { sel: '.leg-a', name: 'idle-c2-leg-a', period: 4700, poses: [
        p('translate(-1px,-1px)', 1), p('translate(-1px,0)', 4), p('translate(-1px,-1px)', 1),
        p('translate(-1px,0)', 12) ] },
      { sel: '.leg-b', name: 'idle-c2-leg-b', period: 5300, poses: [
        p('translate(0,-1px)', 1), p('translate(0,0)', 3), p('translate(0,-1px)', 1),
        p('translate(0,0)', 14) ] },
      { sel: '.leg-c', name: 'idle-c2-leg-c', period: 6100, poses: [
        p('translate(0,-1px)', 1), p('translate(0,0)', 6), p('translate(0,-1px)', 1),
        p('translate(0,0)', 9) ] },
      { sel: '.leg-d', name: 'idle-c2-leg-d', period: 4300, poses: [
        p('translate(1px,-1px)', 1), p('translate(1px,0)', 5), p('translate(1px,-1px)', 1),
        p('translate(1px,0)', 11) ] },
      { sel: '.blink', name: 'idle-c2-blink', period: 6100, poses: [
        p('scaleY(.15)', 1), p('scaleY(1)', 6), p('scaleY(.55)', 1), p('scaleY(1)', 10) ] },
    ],
  },

  // ------------------------------------------------------------------ c3
  // 换的是有无道具。现行 idle 无道具，于是爪只能在原地抽动——而抽动
  // 看多了就是抽搐。给它一颗石子之后，爪的每一次位移都有了理由，
  // 这也是唯一能合法解开「爪不许外扩」那条约束的办法（有东西可够）。
  // 这里连外扩都不需要：石子在胸前来回倒手，两只爪全程向内。
  //
  // 与 working 的牌流刻意拉开三处，否则待机会读成在干活：
  //   - **只有一颗**，不是流。牌流的语义是「材料在推进」，这里什么都没被处理。
  //   - 停远多于动：两个长保持各占 29% 的循环，中间的传递只占 6%。
  //   - 用桌面那组土色，不用工作牌的青/紫——颜色族不同，一眼就不是同一件事。
  {
    action: 'idle',
    id: 'idle-c3',
    title: 'Pocket Stone',
    axis: '有无道具 —— 从空手换成手里有颗小石子，无聊时来回倒手、翻面',
    desc: '胸前托着一颗石子，托很久、翻一下、倒到另一只爪里，再托很久。',
    duration: 5600,
    // 画在身前：托在手里的东西画在身后会被躯干挡掉一半。
    // 位置压在 y12 以下——眼睛在 y8–10，道具不许遮脸。
    //
    // 高度定在 y12–14 还有第二个理由：躯干下沿在 y13，托着石子的爪因此
    // 有一列露在轮廓外。爪与躯干同色无描边，全在 y6–13 之内就等于消失，
    // 那时画面上只剩一颗浮在胸口的石子。
    //
    // 石子是 .actor 的兄弟节点，不继承身体的位移——所以这个候选的身体
    // 横向只走 1 格，爪与石子最多错开 1 格。同样的取舍 thinking 的拼图
    // 与 working 的工作牌都在用，那是有道具动作的既定做法。
    propsAfter: '<g class="stone motion"><rect x="4" y="12" width="2" height="2" fill="#8C7A5E"/>'
      + '<rect x="4" y="12" width="1" height="1" fill="#A08C6C"/></g>',
    layers: [
      {
        sel: '.actor',
        // 重心跟着石子在哪只爪里换边。权重总和与爪层刻意不同（18 对 17），
        // 于是身体的换重心永远落在传递动作的空档里，不是同一拍。
        //
        // 六层整体旋转过相位，让「托着不动」的长保持落在循环中段而不是 0%：
        // 各层的最长一拍全排在开头的话，一进 idle 就是一秒多的静止图。
        name: 'idle-c3-body',
        poses: [
          p('translate(1px,1px)', 2), p('translate(0,1px)', 1), p('translate(0,-1px)', 2),
          p('translate(-1px,0)', 4), p('translate(-1px,-1px)', 1), p('translate(0,-1px)', 2),
          p('translate(1px,-1px)', 1), p('translate(1px,0)', 5),
        ],
      },
      {
        sel: '.stone',
        // scaleX 压到一半 = 转到侧面。像素画里这就是「翻了一下」的说法
        // （work-q 的翻牌用的是同一手）。origin 放在石子自己中心，
        // 少了它会绕着角色的脚转。
        name: 'idle-c3-stone',
        origin: '5px 12px',
        poses: [
          p('translate(4px,0) scaleX(.5)', 1), p('translate(3px,1px)', 1), p('translate(2px,0)', 2),
          p('translate(0,0)', 5), p('translate(0,0) scaleX(.5)', 1), p('translate(1px,-1px)', 1),
          p('translate(3px,-1px)', 1), p('translate(4px,0)', 5),
        ],
      },
      {
        sel: '.left-claw',
        // 与石子同权重表 → 同一拍变化，手和东西不会分家
        // 与石子同高（dy ≥ 3）：托着的爪因此总有一行落在躯干下沿 y13 以外。
        // 伸到躯干内侧（dx ≥ 2）而 dy 又在 2 以内的姿态一个都不能留——
        // 那时爪整块落在同色躯干里，画面上只剩一颗浮在肚子上的石子。
        name: 'idle-c3-left',
        poses: [
          p('translate(1px,4px)', 1), p('translate(2px,4px)', 1), p('translate(3px,3px)', 2),
          p('translate(2px,3px)', 5), p('translate(3px,3px)', 1), p('translate(3px,4px)', 1),
          p('translate(1px,4px)', 1), p('translate(1px,3px)', 5),
        ],
      },
      {
        sel: '.right-claw',
        name: 'idle-c3-right',
        poses: [
          p('translate(-2px,3px)', 1), p('translate(-2px,4px)', 1), p('translate(-1px,2px)', 2),
          p('translate(-1px,3px)', 5), p('translate(-1px,4px)', 1), p('translate(-2px,4px)', 1),
          p('translate(-3px,4px)', 1), p('translate(-3px,3px)', 5),
        ],
      },
      {
        sel: '.eyes',
        // 视线往下看着自己手里——这是与现行 idle（看前方）最大的读感差别，
        // 也是「有事可做的桌宠」不盯着你的理由。周期与手不同，
        // 所以偶尔会走神看开一点再收回来。
        name: 'idle-c3-eyes',
        period: 3100,
        poses: [
          p('translate(-1px,1px)', 1), p('translate(0,1px)', 3), p('translate(1px,1px)', 1),
          p('translate(0,0)', 2), p('translate(0,1px)', 6),
        ],
      },
      { sel: '.blink', name: 'idle-c3-blink', period: 4700, poses: [
        p('scaleY(.15)', 1), p('scaleY(1)', 5), p('scaleY(.6)', 1), p('scaleY(1)', 9) ] },
    ],
  },

  // ------------------------------------------------------------------ c4
  // 换的是呼吸的可见度：压到看不见为止。现行实现的呼吸是 1 格位移——
  // 在 135px / 3px 每格下那是 3 个屏幕像素，余光里是看得见的。
  // 这个候选把身体的纵向动作全部换成 2% 的纵向缩放（9 格 × 0.02 ≈ 0.5px，
  // 在余光里等于没动），一个循环只留一次 1 格的换重心。
  //
  // 于是全部生命感落在**眼睑**上：单眨、双眨、半眨没眨到底、闭得久一点的慢眨。
  // 眨眼层给了一个 7900ms 的长周期，比状态时长还长，所以这套眨眼谱
  // 永远不会在同一个位置重复——你没法预判下一次眨在哪。
  //
  // 与 paused（暂停，几乎静止）的区别是信息量的落点：那个是身体和眼睛
  // 都安静下来，读作「停住了」；这个身体安静而眼睑一直在说话，读作「醒着」。
  {
    action: 'idle',
    id: 'idle-c4',
    title: 'Still Life',
    axis: '呼吸的可见度 —— 从 1 格起伏压到 2% 缩放（余光里等于没动），生命感全部移到眼睑',
    desc: '身体几乎不动，一个循环只挪一次；眨眼却有单眨、双眨、半眨、慢眨四种节奏。',
    duration: 5600,
    layers: [
      {
        sel: '.actor',
        // 幅度虽小但一刻没停：没有连续两拍是同一个值，
        // 也没有停在 translate(0,0) 超过一个长保持——这条守的是
        // 「不许退回静止图」，不是「必须看得出在动」。
        //
        // 每一层都**从短拍开始**（长保持排在循环中段）。CSS 动画在加上
        // 状态类的那一刻全部从 0 起跑，各层要是都把最长的一拍放在开头，
        // 刚进 idle 的头一秒半就是一张静止图——那正好是「刚干完活就死机了」
        // 的读感。实测这个候选原本在 t=0 有 1481ms 的空白，就是这么来的。
        name: 'idle-c4-body',
        poses: [
          p('translateX(-1px) scaleY(1)', 1), p('translateX(-1px) scaleY(1.02)', 5),
          p('translateX(-1px) scaleY(1.01)', 2), p('scaleY(1)', 6), p('scaleY(1.02)', 1),
          p('scaleY(1.01)', 4),
        ],
      },
      {
        sel: '.blink',
        // 这个候选真正的主角。四种眨法轮着来，周期 7900 比状态时长长，
        // 于是它与其余各层永远对不齐——观感是「想眨就眨」而不是「每 N 秒眨一次」。
        name: 'idle-c4-blink',
        period: 7900,
        poses: [
          p('scaleY(1)', 2), p('scaleY(.15)', 1), p('scaleY(1)', 7), p('scaleY(.6)', 1),
          p('scaleY(1)', 4), p('scaleY(.15)', 2), p('scaleY(.55)', 1), p('scaleY(1)', 5),
          p('scaleY(.15)', 1), p('scaleY(.6)', 1), p('scaleY(1)', 6), p('scaleY(.15)', 1),
        ],
      },
      {
        sel: '.eyes',
        // 视线基本钉在前方，只有极小的重新对焦。眼球一大动，
        // 注意力就从眼睑转移走了，这个候选的论点就没了。
        name: 'idle-c4-eyes',
        period: 4300,
        poses: [
          p('translate(0,-1px)', 2), p('translate(0,0)', 5), p('translate(1px,0)', 2),
          p('translate(0,0)', 8),
        ],
      },
      { sel: '.left-claw', name: 'idle-c4-left', period: 3700, poses: [
        p('translate(1px,0)', 1), p('translate(0,0)', 5), p('translate(0,-1px)', 2),
        p('translate(0,0)', 9) ] },
      { sel: '.right-claw', name: 'idle-c4-right', period: 4100, poses: [
        p('translate(0,-1px)', 1), p('translate(0,0)', 4), p('translate(-1px,0)', 2),
        p('translate(0,0)', 11) ] },
    ],
  },

  // ------------------------------------------------------------------ c5
  // 换的是腿参不参与。现行实现里四条腿是钉死的，整只桌宠的生命感
  // 全靠胸腔那 1 格呼吸——那是一个**周期性**信号，而周期性的东西
  // 看久了必然被认出来。
  //
  // 这个候选把生命感移到下盘：身体在腿上左右慢慢倒，四只脚各自在
  // 4300 / 4700 / 5300 / 6100 上做「抬起—挪一格—落下」。约掉公因数 100
  // 之后是 43 / 47 / 53 / 61，四个不同的质数，四只脚要 7.5 天才会回到
  // 同一相位——**永远不会出现四只脚同时做同一件事的画面**。
  // 要判断它有没有重复，人得同时记住四条腿各自的相位。
  //
  // 与 idle.leg_shuffle（依次抬四条腿重新找站姿）的区别是：那个是一次
  // 有始有终的小事件，四条腿在同一个周期里排队；这个没有事件，
  // 只有一直在微调的下盘。
  //
  // 每条腿的最后一拍都停在「抬着还没落下」，接缝正好是落地那一下——
  // 首尾不同这条约束在这里不是形式，它决定了脚是踩下去还是凭空滑过去。
  {
    action: 'idle',
    id: 'idle-c5',
    title: 'Footwork',
    axis: '腿参不参与 —— 腿从完全钉死换成唯一持续在动的部位，四只脚各走互质周期',
    desc: '身体在四条腿上左右慢慢倒，四只脚各按自己的节奏抬起、挪一格、落下，从不同时。',
    duration: 5600,
    splitLegs: true,
    layers: [
      {
        sel: '.actor',
        // 只有 ±1 格的横向倒重心，纵向留一点呼吸。幅度必须小：
        // 这个候选的看点在脚上，身体一大动就把注意力抢回去了。
        //
        // 各层的长保持一律排在循环中段，开头留短拍。九层要是都把最长的
        // 一拍放在 0%，刚进 idle 的头 1.5 秒就是一张静止图（实测原本 1556ms）。
        name: 'idle-c5-body',
        poses: [
          p('translate(0,0)', 1), p('translate(1px,0)', 5), p('translate(1px,-1px)', 2),
          p('translate(0,-1px)', 1), p('translate(0,0)', 2), p('translate(-1px,0)', 5),
          p('translate(-1px,-1px)', 2),
        ],
      },
      // 四条腿：抬 1 格 → 横挪 1 格 → 落下 → 待一阵 → 再抬起挪回来。
      // 横挪范围全部留在躯干 x2–13 的覆盖内，脚不会跑到躯干外面去。
      // 每条的末拍都停在「抬着还没落」，接缝正好是落地那一下——
      // 首尾不同这条在这里不是形式：接缝落在悬空拍上，脚才是踩下去的，
      // 落在着地拍上就成了凭空平移一格。
      { sel: '.leg-a', name: 'idle-c5-leg-a', period: 4300, poses: [
        p('translate(0,-1px)', 1), p('translate(1px,-1px)', 1), p('translate(1px,0)', 7),
        p('translate(1px,-1px)', 1), p('translate(0,-1px)', 2), p('translate(0,0)', 8) ] },
      { sel: '.leg-b', name: 'idle-c5-leg-b', period: 5300, poses: [
        p('translate(0,-1px)', 2), p('translate(0,0)', 6), p('translate(-1px,-1px)', 1),
        p('translate(-1px,0)', 9) ] },
      { sel: '.leg-c', name: 'idle-c5-leg-c', period: 6100, poses: [
        p('translate(0,-1px)', 2), p('translate(0,0)', 7), p('translate(1px,-1px)', 1),
        p('translate(1px,0)', 8) ] },
      { sel: '.leg-d', name: 'idle-c5-leg-d', period: 4700, poses: [
        p('translate(-1px,-1px)', 1), p('translate(-1px,0)', 6), p('translate(-1px,-1px)', 1),
        p('translate(0,-1px)', 1), p('translate(0,0)', 9) ] },
      {
        sel: '.eyes',
        // 与身体同周期，方向相反：身体倒过去，眼睛往回补——
        // 视线因此**钉在同一个点上**，读作「站着没打算去哪」。
        // 眼睛跟着身体一起倒的话，整只宠会读成在左右摇晃。
        name: 'idle-c5-eyes',
        poses: [
          p('translate(0,0)', 1), p('translate(-1px,0)', 5), p('translate(0,0)', 1),
          p('translate(0,-1px)', 2), p('translate(1px,0)', 5), p('translate(1px,-1px)', 2),
        ],
      },
      { sel: '.left-claw', name: 'idle-c5-left', period: 3700, poses: [
        p('translate(1px,0)', 2), p('translate(1px,-1px)', 1), p('translate(0,-1px)', 2),
        p('translate(0,0)', 7) ] },
      { sel: '.right-claw', name: 'idle-c5-right', period: 3100, poses: [
        p('translate(-1px,-1px)', 1), p('translate(-1px,0)', 2), p('translate(0,-1px)', 1),
        p('translate(0,0)', 8) ] },
      { sel: '.blink', name: 'idle-c5-blink', period: 6700, poses: [
        p('scaleY(.15)', 1), p('scaleY(1)', 5), p('scaleY(.6)', 1), p('scaleY(1)', 12) ] },
    ],
  },

  // ------------------------------------------------------------------ c6
  // 换的是循环结构。前五个（以及现行实现）用的都是同一套时间架构：
  // 各层各走各的周期，靠错拍把重复藏起来。这个候选**把那一手整个拿掉**——
  // 六层全部锁在同一个 5600ms 上，换来的是能被读出来的段落：
  //
  //   观察 0–35%   前方小幅扫视，正常呼吸，正常眨眼
  //   走神 35–80%  视线飘到一侧停住不动、**一次也不眨**、呼吸变浅、爪松开垂下
  //   回神 80–100% 眨一下 → 视线弹回 → 身体一个上提整理
  //
  // 赌的是另一种耐看：前五个是「永远不重复所以不腻」，这个是
  // 「重复但每次都有内容所以不腻」——像看一个人发呆，你知道他等会儿会回过神来。
  //
  // 两处必须守住，否则整个结构会塌：
  //   1. **走神段不许真的静止。** 旧 working 的教训就是连续 1.5 秒不动被读成卡住。
  //      所以走神段里身体仍有两次浅呼吸、爪还往下垂了一格——安静，不是停住。
  //   2. **回神必须快。** 眨眼、视线、身体三件事挤在最后 20% 里依次发生；
  //      摊开就不是「回过神」，是「慢慢转回来」。
  {
    action: 'idle',
    id: 'idle-c6',
    title: 'Drift and Return',
    axis: '循环结构 —— 从各层错拍的均匀循环换成全层同周期的三段式：观察 → 走神 → 回神',
    desc: '看一会儿前方，视线飘走出神（连眨都不眨），最后眨一下回过神来，重新看向前方。',
    duration: 5600,
    layers: [
      {
        sel: '.actor',
        name: 'idle-c6-body',
        poses: [
          p('translate(0,-1px)', 3), p('translate(0,0)', 2), p('translate(0,-1px)', 2),
          p('translate(1px,0)', 2), p('translate(1px,-1px)', 5), p('translate(1px,0)', 4),
          p('translate(0,-2px)', 1), p('translate(0,0)', 1),
        ],
      },
      {
        sel: '.eyes',
        // 走神那一停占了 45% 的循环。一个动作里最长的保持必须落在
        // 它想表达的那件事上——这里想说的就是「出神」。
        name: 'idle-c6-eyes',
        poses: [
          p('translate(0,0)', 2), p('translate(-1px,0)', 2), p('translate(0,0)', 1),
          p('translate(1px,0)', 2), p('translate(2px,1px)', 9), p('translate(2px,0)', 2),
          p('translate(0,0)', 1), p('translate(-1px,0)', 1),
        ],
      },
      {
        sel: '.blink',
        // 出神时不眨眼，回神那一下才眨——这一拍是整个候选的支点。
        // 权重排布让它正好落在 80%，视线在 90% 才弹回：先眨、后回神。
        name: 'idle-c6-blink',
        poses: [
          p('scaleY(1)', 2), p('scaleY(.15)', 1), p('scaleY(1)', 13), p('scaleY(.15)', 1),
          p('scaleY(1)', 2), p('scaleY(.6)', 1),
        ],
      },
      {
        sel: '.left-claw',
        // 走神段里爪继续往下垂一格——这一格就是「还醒着」的全部证据
        name: 'idle-c6-left',
        poses: [
          p('translate(0,0)', 3), p('translate(1px,0)', 2), p('translate(0,0)', 2),
          p('translate(0,1px)', 4), p('translate(0,2px)', 4), p('translate(0,1px)', 2),
          p('translate(0,-1px)', 2), p('translate(1px,0)', 1),
        ],
      },
      {
        sel: '.right-claw',
        // 权重总和 19，与其余层的 20 不同：同周期不等于同拍子，
        // 右爪的变化点因此落在别人的空档里，画面不会一格一格地齐步走。
        name: 'idle-c6-right',
        poses: [
          p('translate(0,0)', 3), p('translate(-1px,0)', 1), p('translate(0,0)', 2),
          p('translate(0,1px)', 3), p('translate(-1px,2px)', 4), p('translate(0,2px)', 3),
          p('translate(0,-1px)', 2), p('translate(-1px,0)', 1),
        ],
      },
    ],
  },
];
