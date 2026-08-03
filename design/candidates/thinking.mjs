/**
 * thinking（思考）的六个候选。
 *
 * 当前实现是 Puzzle Turn：双爪之间夹一块拼图，转动、比对两面、停顿，
 * 4600ms。它的核心判断是对的——**「思考」的读感来自停顿，不来自转动**，
 * 所以停顿那一拍最长。六个候选都继承这条，改的是别的东西。
 *
 * ## 六条轴，一个候选换一条
 *
 * 上一轮 working 的第一批被判为「太类似」：四个候选只换了道具，
 * 姿态语汇完全一样——变的是拿什么，没变的是怎么站。这里每个候选
 * 换掉的是**不同的一条轴**，两两之间不是换皮：
 *
 *   C1 有无外物  — 一个道具都没有，读感全落在姿态上（挠头）
 *   C2 朝向      — 背对着你，脸整个不可见
 *   C3 比喻      — 从「把玩一个」换成「在摊开的三块之间选」
 *   C4 节奏结构  — 从均匀的动-顿-动-顿换成「长静默 → 抽动 → 落进新的静默」
 *   C5 循环收尾  — 循环里包含一次「想通了」，当前版本全程都是「还在想」
 *   C6 头与身分离 — 道具与构图**故意保持不变**，只把眼睛从身体的拍子里拆出来
 *
 * C6 是刻意的对照组：它和当前实现拿着同一块拼图、同一个构图，
 * 唯一的差别是视线不再跟着身体走。轴要能被单独读出来，就得有一个
 * 除了那条轴以外什么都不变的样本。
 *
 * 考虑过但没做的一条轴是**踱步**（来回走着想）。它换的是位移，
 * 本来很值得，但两个问题：`self.roam`（Little Wander）已经是「宠物自己
 * 溜达」，两者在画面上分不开；而且踱步最容易滑向「无所事事」——
 * 那是 idle 的活。thinking 是 **Claude 在想**，必须读作「在处理什么」。
 *
 * ## 两条这次踩出来的几何约束
 *
 * 1. **爪子落进躯干矩形里就等于消失。** 爪和躯干同色 #DE886D、没有描边，
 *    躯干是 x2–13 / y6–13。左爪基座 x0–2、y9–11，所以 dx∈[2,11] 且
 *    dy∈[-3,2] 的任何位移都会让它被躯干整个吃掉；右爪是 dx≤-2 且
 *    dy∈[-3,2]。当前实现里 `translate(5px,-2px)` 就在这个区间——
 *    它不要紧，因为那一版有拼图在手上替爪子表意。**没有道具的候选
 *    （C1、C4）必须全程把爪留在轮廓外**，否则「在比划」根本看不见。
 *
 * 2. **道具组不在 .actor 里，不会跟着身体走。** 背对那版的壳纹必须
 *    显式复制身体的位移，否则身体一动壳纹就从背上滑下来。
 *    （work-i 的 .shell 就没有自己的图层，身体位移 3px 时壳纹是留在原地的。）
 *
 * ## 共同守的硬约束
 *
 * - 循环内没有静止姿态：六个的 `.actor` 全程带位移，一个 translate(0,0) 都没有；
 *   **停顿停在偏移姿势上**——保持一个偏移读作「在想」，回中立读作「停了」。
 * - 首尾姿态不同，跨接缝不会把停顿加倍。
 * - 保持时长不等分，身体图层的变异系数都在 0.55 以上（门槛 0.35）。
 * - 位移一律整数 px；道具全部避开 x4/x10、y8–10 的眼位。
 */

/** 缩写：造一串姿态，[transform, 权重]。权重省略时为 1。 */
const p = (transform, weight = 1) => [transform, weight];

export const CANDIDATES = [
  // ------------------------------------------------------------------ C1
  {
    action: 'thinking',
    id: 'thinking-c1',
    title: 'Head Scratch',
    axis: '有无外物 — 拿掉全部道具，读感只能靠姿态本身撑住（当前版本靠手里那块拼图）',
    desc: '一只爪搭在头顶偏左，偶尔挠两下；重心慢慢在两边挪，最长的一拍压在爪的那一侧。',
    duration: 4600,
    props: '',
    propsAfter: '',
    splitLegs: false,
    layers: [
      // 停顿停在「压着爪的那一侧」——一个偏移的、有表情的姿势。
      // 首 translate(-1px,1px)、尾 translate(-1px,0)，接缝上仍有一次变化。
      { sel: '.actor', name: 'think-c1-body', poses: [
        p('translate(-1px,1px)', 4), p('translate(-1px,0)', 1), p('translate(0,-1px)', 2),
        p('translate(1px,-1px)', 1), p('translate(1px,0)', 3), p('translate(1px,1px)', 1),
        p('translate(0,1px)', 2), p('translate(-1px,0)', 1) ] },
      // 挠头的那只爪：dy 一律 ≤ -4，让它始终露在头顶轮廓之外。
      // dy=-3 配 dx≥2 会整块沉进躯干里——这个动作没有道具，爪一消失就没内容了。
      { sel: '.left-claw', name: 'think-c1-left', poses: [
        p('translate(2px,-4px)', 4), p('translate(2px,-5px)', 1), p('translate(3px,-5px)', 2),
        p('translate(3px,-4px)', 1), p('translate(2px,-4px)', 3), p('translate(1px,-5px)', 1),
        p('translate(2px,-5px)', 2), p('translate(1px,-4px)', 1) ] },
      // 另一只爪垂在身侧，走自己的周期：它不是这个手势的一部分，
      // 不该踩在挠头的拍子上。dx 不低于 -1，否则也会被躯干吃掉。
      { sel: '.right-claw', name: 'think-c1-right', period: 2900, poses: [
        p('translate(0,1px)', 5), p('translate(0,2px)', 1), p('translate(-1px,2px)', 3),
        p('translate(-1px,3px)', 1), p('translate(0,2px)', 2) ] },
      { sel: '.eyes', name: 'think-c1-eyes', period: 3100, poses: [
        p('translate(-1px,1px)', 4), p('translate(-1px,0)', 1), p('translate(0,1px)', 2),
        p('translate(1px,1px)', 3), p('translate(0,0)', 1), p('translate(0,1px)', 2) ] },
      // 眯眼比眨眼更像在琢磨：半闭那一拍停三个权重，全闭只有一拍。
      { sel: '.blink', name: 'think-c1-blink', period: 5300, poses: [
        p('scaleY(1)', 6), p('scaleY(.55)', 3), p('scaleY(1)', 4), p('scaleY(.15)', 1),
        p('scaleY(1)', 3) ] },
    ],
  },

  // ------------------------------------------------------------------ C2
  {
    action: 'thinking',
    id: 'thinking-c2',
    title: 'Turned Away',
    axis: '朝向 — 背对着你，脸整个不可见（当前版本与其余五个都是正面）',
    desc: '转过去不理你，只看得到壳在缓慢起伏、头那一端左右微转，爪偶尔在身侧动一下。',
    duration: 4600,
    props: '',
    // 壳纹刻意避开眼位：横条在 y7 与 y11、脊在 x6–9，
    // 三块都不碰 x4/x10 × y8–10。就算哪天要把脸露出来，这套纹样也不遮脸。
    propsAfter: '<g class="think-c2-shell motion">'
      + '<rect x="3" y="7" width="9" height="1" fill="#C4715A"/>'
      + '<rect x="6" y="8" width="3" height="4" fill="#C4715A"/>'
      + '<rect x="4" y="11" width="7" height="1" fill="#C4715A"/></g>',
    splitLegs: false,
    layers: [
      // 背身版本刻意不用 scaleY 做呼吸：壳纹是独立的组，身体一缩放
      // 就对不上了。全程沉 1–2px，读作伏低着想事，且没有中立姿势。
      { sel: '.actor', name: 'think-c2-body', poses: [
        p('translate(0,2px)', 4), p('translate(-1px,2px)', 1), p('translate(-1px,1px)', 2),
        p('translate(0,1px)', 1), p('translate(1px,1px)', 3), p('translate(1px,2px)', 1),
        p('translate(0,2px)', 2), p('translate(-1px,2px)', 1) ] },
      // 壳纹 = 身体的位移 + 额外 ±1px 横移。那 1px 的相对滑动就是「头在转」，
      // 没有它，背影只是在上下起伏。
      { sel: '.think-c2-shell', name: 'think-c2-shellmove', poses: [
        p('translate(0,2px)', 4), p('translate(-2px,2px)', 1), p('translate(-2px,1px)', 2),
        p('translate(-1px,1px)', 1), p('translate(2px,1px)', 3), p('translate(2px,2px)', 1),
        p('translate(1px,2px)', 2), p('translate(-1px,2px)', 1) ] },
      // 背对时爪只该露一点边。往外伸会读成断肢（没有可够的东西），
      // 所以只在轮廓边缘做上下的小动作。
      { sel: '.left-claw', name: 'think-c2-left', period: 2900, poses: [
        p('translate(1px,2px)', 5), p('translate(1px,1px)', 1), p('translate(0,1px)', 2),
        p('translate(0,2px)', 1), p('translate(1px,3px)', 2) ] },
      { sel: '.right-claw', name: 'think-c2-right', period: 3700, poses: [
        p('translate(-1px,2px)', 4), p('translate(-1px,3px)', 1), p('translate(0,2px)', 3),
        p('translate(-1px,1px)', 1), p('translate(0,3px)', 2) ] },
      // 背对时眼睛不可见。给一条恒定 opacity:0 的动画，而不是在素材里删掉——
      // 角色几何仍然与契约一致，只是这个动作看不到脸。
      { sel: '.eyes', name: 'think-c2-eyes', poses: [p('opacity:0', 1)] },
      { sel: '.blink', name: 'think-c2-blink', poses: [p('opacity:0', 1)] },
    ],
  },

  // ------------------------------------------------------------------ C3
  {
    action: 'thinking',
    id: 'thinking-c3',
    title: 'Three Options',
    axis: '思考的比喻 — 从「把玩一个东西」换成「在摊开的三块之间比对、挑一块」，思考的对象是复数且可见',
    desc: '三块碎片摊在脚前，爪在它们之间移动；正在被考虑的那块亮起来、抬高一格。最长的停顿停在双爪悬在中间那块上方、还没落下的时候。',
    duration: 4600,
    props: '',
    // 碎片全在脚下 y15–18，离眼位（y8–10）有五个单位，不可能遮脸。
    // 三块颜色不同是必要的：同色的三块读成「一堆」，不是「三个选项」。
    propsAfter: '<g class="think-c3-frag-a motion">'
      + '<rect x="-1" y="15" width="4" height="3" fill="#7BC8C4"/>'
      + '<rect x="0" y="16" width="2" height="1" fill="#BDE7E4"/></g>'
      + '<g class="think-c3-frag-b motion">'
      + '<rect x="5" y="15" width="4" height="3" fill="#F6C85F"/>'
      + '<rect x="6" y="16" width="2" height="1" fill="#FFE3A3"/></g>'
      + '<g class="think-c3-frag-c motion">'
      + '<rect x="11" y="15" width="4" height="3" fill="#B9A1D9"/>'
      + '<rect x="12" y="16" width="2" height="1" fill="#E7DCF2"/></g>',
    splitLegs: false,
    layers: [
      // 身体倾向正在被考虑的那一块：左 → 右 → 回到中间并沉下去。
      // 停顿（权重 4）落在「悬在中间那块上方」，是一个前倾下沉的偏移姿势。
      { sel: '.actor', name: 'think-c3-body', poses: [
        p('translate(-2px,1px)', 3), p('translate(-1px,1px)', 1), p('translate(0,1px)', 1),
        p('translate(2px,1px)', 3), p('translate(2px,2px)', 1), p('translate(1px,1px)', 1),
        p('translate(0,2px)', 4), p('translate(-1px,2px)', 1) ] },
      // 左爪向左下够 frag-a：向外伸只有在**有东西可够**时才成立，
      // 这里够的是画面上真实存在的那块碎片。
      // 全程 dy ≥ 3，爪永远在躯干下缘之外，不会被吃掉。
      { sel: '.left-claw', name: 'think-c3-left', poses: [
        p('translate(-1px,4px)', 3), p('translate(0,3px)', 1), p('translate(2px,3px)', 1),
        p('translate(4px,3px)', 3), p('translate(4px,4px)', 1), p('translate(3px,3px)', 1),
        p('translate(4px,4px)', 4), p('translate(3px,4px)', 1) ] },
      { sel: '.right-claw', name: 'think-c3-right', poses: [
        p('translate(-1px,4px)', 3), p('translate(-1px,3px)', 1), p('translate(-3px,3px)', 1),
        p('translate(-5px,3px)', 3), p('translate(-5px,4px)', 1), p('translate(-4px,3px)', 1),
        p('translate(-6px,4px)', 4), p('translate(-5px,4px)', 1) ] },
      // 亮度就是「在考虑哪一块」。三块共用状态周期，因为「谁亮」必须
      // 和爪、和身体对上；各走各的周期会变成三盏无关的灯在闪。
      { sel: '.think-c3-frag-a', name: 'think-c3-fa', poses: [
        p('opacity:1;transform:translateY(-1px)', 4), p('opacity:1;transform:translateY(0)', 1),
        p('opacity:.45;transform:translateY(0)', 7), p('opacity:.7;transform:translateY(0)', 3) ] },
      { sel: '.think-c3-frag-b', name: 'think-c3-fb', poses: [
        p('opacity:.45;transform:translateY(0)', 5), p('opacity:.7;transform:translateY(0)', 2),
        p('opacity:1;transform:translateY(-1px)', 6), p('opacity:1;transform:translateY(-2px)', 2),
        p('opacity:.7;transform:translateY(0)', 1) ] },
      { sel: '.think-c3-frag-c', name: 'think-c3-fc', poses: [
        p('opacity:.45;transform:translateY(0)', 3), p('opacity:1;transform:translateY(-1px)', 4),
        p('opacity:1;transform:translateY(0)', 2), p('opacity:.6;transform:translateY(0)', 7) ] },
      // 视线走自己的周期：眼睛先到、爪后到，这个时间差就是「先看中再去拿」。
      { sel: '.eyes', name: 'think-c3-eyes', period: 2300, poses: [
        p('translate(-1px,1px)', 3), p('translate(0,1px)', 1), p('translate(1px,1px)', 3),
        p('translate(0,2px)', 2), p('translate(-1px,2px)', 1) ] },
      { sel: '.blink', name: 'think-c3-blink', period: 4300, poses: [
        p('scaleY(1)', 9), p('scaleY(.15)', 1), p('scaleY(1)', 3), p('scaleY(.5)', 2) ] },
    ],
  },

  // ------------------------------------------------------------------ C4
  {
    action: 'thinking',
    id: 'thinking-c4',
    title: 'Three Beats',
    axis: '节奏结构 — 从均匀的「动-顿-动-顿」换成「长静默 → 突然一动 → 落进另一个静默」，一个循环推进三段',
    desc: '三段静默，每段之间抽动一次。每次抽动之后停在和上一段不同的姿势上——不是弹回原样，是往前挪了一步。',
    duration: 4600,
    props: '',
    propsAfter: '',
    splitLegs: false,
    layers: [
      // 三个「保持」姿势逐段升高、前移：(-1,1) → (0,-1) → (2,-2)。
      // 姿势在推进，才读作「想到了下一步」；原地弹回读作「回神了」。
      // 最长的一拍 6/20 = 1380ms，但那 1380ms 里眼睛和眨眼都在走
      // 自己的周期——身体停住不等于画面停住。
      { sel: '.actor', name: 'think-c4-body', poses: [
        p('translate(-1px,1px)', 6),
        p('translate(-1px,-1px)', 1), p('translate(1px,-2px)', 1),
        p('translate(0,-1px)', 5),
        p('translate(1px,-2px)', 1), p('translate(3px,-3px)', 1),
        p('translate(2px,-2px)', 4),
        p('translate(1px,-1px)', 1) ] },
      // 双爪跟身体同一个拍子：这个候选的主角是**节奏**，四肢各走各的会
      // 把静默填满，那一段就不静了。密度改由眼睛与眨眼承担。
      // 没有道具，所以爪必须全程露在轮廓外：左爪 dy ≤ -4（举在头侧以上），
      // 右爪 dy ≥ 3（垂在躯干下缘以下）。左右不对称是故意的——
      // 对称的举爪读成「万岁」，一高一低才读成「动作做到一半停住了」。
      { sel: '.left-claw', name: 'think-c4-left', poses: [
        p('translate(1px,-4px)', 6),
        p('translate(2px,-6px)', 1), p('translate(3px,-6px)', 1),
        p('translate(3px,-5px)', 5),
        p('translate(4px,-6px)', 1), p('translate(4px,-7px)', 1),
        p('translate(4px,-6px)', 4),
        p('translate(2px,-5px)', 1) ] },
      { sel: '.right-claw', name: 'think-c4-right', poses: [
        p('translate(-1px,3px)', 6),
        p('translate(-2px,4px)', 1), p('translate(-4px,4px)', 1),
        p('translate(-3px,4px)', 5),
        p('translate(-5px,3px)', 1), p('translate(-6px,4px)', 1),
        p('translate(-5px,4px)', 4),
        p('translate(-3px,3px)', 1) ] },
      // 静默期间画面靠这两层活着。眼睛是「盯住不动的微漂移」，
      // 幅度只有 1px——大幅扫视会把静默毁掉（那是 C6 干的事）。
      // 姿态数排到 6 是有意的：最长那段静默是 1380ms，眼睛必须在这段里
      // 变四次，画面才不是一张静止图。四个姿态的话这段里只剩两次。
      { sel: '.eyes', name: 'think-c4-eyes', period: 2100, poses: [
        p('translate(0,-1px)', 4), p('translate(1px,-1px)', 1), p('translate(1px,0)', 2),
        p('translate(0,0)', 1), p('translate(-1px,0)', 3), p('translate(-1px,-1px)', 1) ] },
      { sel: '.blink', name: 'think-c4-blink', period: 2600, poses: [
        p('scaleY(1)', 8), p('scaleY(.5)', 1), p('scaleY(1)', 4), p('scaleY(.15)', 1) ] },
    ],
  },

  // ------------------------------------------------------------------ C5
  {
    action: 'thinking',
    id: 'thinking-c5',
    title: 'Settled',
    axis: '有没有「想通了」的收尾 — 循环里包含一次结论（当前版本循环里全是「还在想」）',
    desc: '头顶三个小点各自明灭，收拢成中间那一个的瞬间身体挺起来一拍，随即散开重来。',
    duration: 4600,
    props: '',
    // 点在头顶 y0–4，离躯干上缘还有两格，绝无遮脸可能。
    // 取景上方那片空间在主状态里基本没用过（只有 work-g 的头顶货物用了）。
    propsAfter: '<g class="think-c5-dot-a motion"><rect x="2" y="1" width="2" height="2" fill="#7BC8C4"/></g>'
      + '<g class="think-c5-dot-b motion"><rect x="7" y="0" width="2" height="2" fill="#F6C85F"/></g>'
      + '<g class="think-c5-dot-c motion"><rect x="11" y="2" width="2" height="2" fill="#B9A1D9"/></g>',
    splitLegs: false,
    layers: [
      // 低着想 → 更低（快到了）→ **挺起来一拍**（想通了）→ 重新沉下去。
      // 挺起那一拍只有 2/17，短才读作「叮」的一下；给足权重就变成庆祝了。
      // 这是这个候选最大的风险：thinking 每 4.6 秒宣布一次结论，
      // 而屏幕上并没有真的发生什么。所以收尾必须小、必须马上回到低头。
      { sel: '.actor', name: 'think-c5-body', poses: [
        p('translate(-1px,1px)', 3), p('translate(0,2px)', 1), p('translate(1px,1px)', 3),
        p('translate(0,2px)', 1), p('translate(-1px,2px)', 2), p('translate(0,1px)', 1),
        p('translate(0,-3px)', 2), p('translate(0,-1px)', 1), p('translate(1px,1px)', 1) ] },
      { sel: '.left-claw', name: 'think-c5-left', poses: [
        p('translate(1px,2px)', 3), p('translate(0,3px)', 1), p('translate(1px,3px)', 3),
        p('translate(0,2px)', 1), p('translate(1px,4px)', 2), p('translate(0,3px)', 1),
        p('translate(1px,-5px)', 2), p('translate(0,-4px)', 1), p('translate(1px,1px)', 1) ] },
      { sel: '.right-claw', name: 'think-c5-right', poses: [
        p('translate(-1px,2px)', 3), p('translate(0,3px)', 1), p('translate(-1px,3px)', 3),
        p('translate(0,2px)', 1), p('translate(-1px,4px)', 2), p('translate(0,3px)', 1),
        p('translate(-1px,-5px)', 2), p('translate(0,-4px)', 1), p('translate(-1px,1px)', 1) ] },
      // 三个点走状态周期而不是各自的周期：「收拢」必须同时发生。
      // 独立性靠不同的明灭序列做出来，不靠不同的周期——
      // 各走各的周期就永远对不上那一拍，收尾也就不存在了。
      //
      // 位移是**算出来**的，不是估的：a 在 x2 y1、c 在 x11 y2、b 在 x7 y0，
      // 所以 a 要 (+5,-1)、c 要 (-4,-2) 才真正落在 b 上。差一格就不是
      // 「三变一」，是「三个点各自飘了一下」——收尾的全部意思都在这一格上。
      //
      // 拍子也对过：两侧点在 59% 到位、中间那个在 71% 亮满并抬起、
      // 身体在 73% 挺起来。先有结论、后有反应，因果不能反。
      { sel: '.think-c5-dot-a', name: 'think-c5-da', poses: [
        p('opacity:.35;transform:translate(0,0)', 4), p('opacity:1;transform:translate(0,-1px)', 1),
        p('opacity:.6;transform:translate(1px,0)', 3), p('opacity:1;transform:translate(0,-1px)', 2),
        p('opacity:1;transform:translate(5px,-1px)', 2), p('opacity:0;transform:translate(5px,-1px)', 2),
        p('opacity:.35;transform:translate(0,1px)', 3) ] },
      { sel: '.think-c5-dot-b', name: 'think-c5-db', poses: [
        p('opacity:.5;transform:translate(0,1px)', 5), p('opacity:.8;transform:translate(0,0)', 2),
        p('opacity:.5;transform:translate(0,1px)', 3), p('opacity:1;transform:translate(0,0)', 2),
        p('opacity:1;transform:translate(0,-1px)', 2), p('opacity:0;transform:translate(0,-2px)', 2),
        p('opacity:.5;transform:translate(0,0)', 1) ] },
      { sel: '.think-c5-dot-c', name: 'think-c5-dc', poses: [
        p('opacity:1;transform:translate(0,-1px)', 3), p('opacity:.4;transform:translate(0,0)', 2),
        p('opacity:1;transform:translate(-1px,-1px)', 4), p('opacity:.6;transform:translate(0,0)', 1),
        p('opacity:1;transform:translate(-4px,-2px)', 2), p('opacity:0;transform:translate(-4px,-2px)', 2),
        p('opacity:.8;transform:translate(0,0)', 3) ] },
      // 视线也走状态周期：想通那一拍眼睛要往上看那个点，
      // 错开周期就会有一半的循环在「挺起来但没看」。
      { sel: '.eyes', name: 'think-c5-eyes', poses: [
        p('translate(0,1px)', 3), p('translate(-1px,1px)', 1), p('translate(0,2px)', 3),
        p('translate(1px,1px)', 1), p('translate(0,2px)', 2), p('translate(0,1px)', 1),
        p('translate(0,-1px)', 2), p('translate(0,0)', 1), p('translate(-1px,1px)', 1) ] },
      { sel: '.blink', name: 'think-c5-blink', period: 3700, poses: [
        p('scaleY(1)', 7), p('scaleY(.5)', 2), p('scaleY(1)', 4), p('scaleY(.15)', 1),
        p('scaleY(1)', 2) ] },
    ],
  },

  // ------------------------------------------------------------------ C6
  {
    action: 'thinking',
    id: 'thinking-c6',
    title: 'Hands Stop',
    axis: '头与身的分离 — 道具、构图、姿势全部沿用当前实现，只把眼睛从身体的拍子里拆出来（视线周期 1300ms，身体 4600ms）',
    desc: '拼图停在爪里几乎不转，视线以三倍多的速度扫来扫去、停住、再扫。手上的活停了，脑子没停。',
    duration: 4600,
    props: '',
    // 和当前实现同一块拼图、同一个位置（y13–18，远离眼位）。
    // 这是对照组：轴要能被单独读出来，就得有一个除了那条轴以外什么都不变的样本。
    // 改成画在身前而不是身后——拿在手里的东西画在身后会被躯干挡掉一半。
    propsAfter: '<g class="think-c6-piece motion">'
      + '<path d="M5 13H10V14H12V17H10V18H5V17H3V14H5Z" fill="#B9A1D9"/>'
      + '<rect x="6" y="14" width="3" height="1" fill="#E7DCF2"/></g>',
    splitLegs: false,
    layers: [
      // 身体走一圈很慢的小环绕，全程带位移、没有中立姿势。
      // 它的作用是「还活着」，不是「在干什么」——干什么全交给眼睛。
      { sel: '.actor', name: 'think-c6-body', poses: [
        p('translate(0,-1px)', 4), p('translate(-1px,-1px)', 1), p('translate(-1px,0)', 3),
        p('translate(-1px,1px)', 1), p('translate(0,1px)', 2), p('translate(1px,1px)', 1),
        p('translate(1px,0)', 3), p('translate(1px,-1px)', 1) ] },
      // 爪扶在拼图的两个上角，周期 3900——比身体还慢。
      // 「几乎不动」不能写成完全不动：完全不动读作松手了，
      // 每隔几秒挪一格才读作还托着、只是没在转。
      { sel: '.left-claw', name: 'think-c6-left', period: 3900, poses: [
        p('translate(2px,3px)', 6), p('translate(2px,4px)', 1), p('translate(3px,3px)', 2),
        p('translate(3px,4px)', 1) ] },
      { sel: '.right-claw', name: 'think-c6-right', period: 3900, poses: [
        p('translate(-2px,3px)', 5), p('translate(-3px,4px)', 1), p('translate(-2px,4px)', 2),
        p('translate(-3px,3px)', 1) ] },
      { sel: '.think-c6-piece', name: 'think-c6-prop', period: 3900, origin: '7.5px 15.5px', poses: [
        p('translate(0,0) rotate(0)', 7), p('translate(0,-1px) rotate(0)', 1),
        p('translate(0,0) rotate(-3deg)', 3), p('translate(1px,0) rotate(-3deg)', 1),
        p('translate(0,0) rotate(2deg)', 2) ] },
      // 全动作的重点。周期 1300ms，一个状态周期里跑三轮半，
      // 与身体的 4600ms 永远对不齐——那个「对不齐」就是头身分离本身。
      // 幅度也拉到 ±2px（其余候选都是 ±1）：眼睛只有 1 单位宽，
      // 2px 已经是扫到躯干边缘了，读作真的在四处看，而不是在抖。
      { sel: '.eyes', name: 'think-c6-eyes', period: 1300, poses: [
        p('translate(-2px,0)', 3), p('translate(-1px,-1px)', 1), p('translate(2px,0)', 3),
        p('translate(1px,1px)', 1), p('translate(0,-1px)', 2) ] },
      { sel: '.blink', name: 'think-c6-blink', period: 3100, poses: [
        p('scaleY(1)', 7), p('scaleY(.15)', 1), p('scaleY(1)', 3), p('scaleY(.55)', 2),
        p('scaleY(1)', 2) ] },
    ],
  },
];
