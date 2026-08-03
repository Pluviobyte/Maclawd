/**
 * delegating（派子代理）的六个候选。
 *
 * 现状是 Parcel Stack：主角站在画面中央，把一个包裹递给身侧纵向叠放的两个
 * 助手。六个候选**各自换掉一条不同的轴**，不是同一个构图的六种皮肤：
 *
 *   c1 助手的形态      助手不是别的小生物，是主角自己剥离出去的分身
 *   c2 交接的方式      不递，抛——包裹有滞空，主角在它落地前就空手了
 *   c3 主角的位置      主角退到左边的调度台上，全程不碰任何东西
 *   c4 助手在不在画面  画面上只有主角和包裹，东西被画外的手抽走
 *   c5 循环结构        派出去 → 等 → 收回来，一个完整回合而不是均匀接力
 *   c6 数量的表达      N 靠线的条数表达，主角的动作与 N 无关
 *
 * 一条语义边界贯穿六个：delegating 是「我把活分出去了」，不是「我在忙」。
 * 所以主角**不许有埋头干的姿态**——不弯腰持续操作、不双爪高频交替。
 * 它的动作只有三类：交出、指派、等待。c3 最极端（一次都不碰道具），
 * c5 次之（最长的一拍是空手等着）。
 *
 * ---------------------------------------------------------------- 两个约定
 *
 * **1. 第二个子代理的所有元素都放进 `.helper-b` 这个组里。**
 * 现有的变体规则是
 *     [data-variant="one-subagent"] .state-delegating .helper-b { display: none }
 * 只认这一个 class。所以凡是「只有 ≥2 个子代理时才该出现」的东西——第二个
 * 助手、它抱着的包裹、第二条线——一律**嵌在 `.helper-b` 组内部**，
 * 组内可以再挂自己的动画 class。这样换任何一个候选，那条 CSS 规则不用改。
 * c6 多了一条 `.helper-c`（第三条线），采用它需要给 helper-c 补一条同样的
 * display:none 规则——写在这里是因为「变体静默失效」这个坑踩过一次
 * （样式表被按行过滤器删坏，一个和两个子代理长得一模一样，没有任何报错）。
 *
 * **2. 用 opacity 的图层，每一个姿态都要写 opacity。**
 * 生成器只在字符串含 `:` 时原样输出，否则包一层 `transform:`——所以写
 * `'opacity:0;transform:translate(0,1px)'` 是对的。但还有第二层：CSS 的
 * 关键帧是**按属性**各算各的，某个属性只在部分帧里出现时，其余帧会走
 * 隐式关键帧 + step-end 的保持规则。现有的 helper-a 只在第一帧写了
 * `opacity:0`，后面几帧都没写——按这条规则它整轮都是 0，也就是**现在这个
 * 助手很可能根本没显示出来**。所以下面所有带 opacity 的图层，每一帧都写全。
 *
 * ---------------------------------------------------------------- 时长
 *
 * 契约里 delegating 的 durationMs 是 5000。c3/c5 需要更长的一拍（指住、
 * 空手等着），c4 需要更急，所以时长不同；采用它们时要同步改
 * design/main-state-actions.json 的 durationMs，否则 motion-quality 的
 * 「每个动作的时长都没被改动」会当场炸。
 */

/** 缩写：造一串姿态，[transform 或完整声明, 权重]。 */
const p = (t, w = 1) => [t, w];

/** 助手的一张脸，重复出现三次，抽出来免得手抄出错。 */
const helperBody = (x, y, fill) =>
  `<rect x="${x}" y="${y}" width="6" height="4" fill="${fill}"/>`
  + `<rect x="${x - 2}" y="${y + 1}" width="2" height="2" fill="${fill}"/>`
  + `<rect x="${x + 6}" y="${y + 1}" width="2" height="2" fill="${fill}"/>`
  + `<rect x="${x + 1}" y="${y + 4}" width="1" height="2" fill="${fill}"/>`
  + `<rect x="${x + 4}" y="${y + 4}" width="1" height="2" fill="${fill}"/>`
  + `<rect x="${x + 1}" y="${y + 1}" width="1" height="2" fill="#000000"/>`
  + `<rect x="${x + 4}" y="${y + 1}" width="1" height="2" fill="#000000"/>`;

/** 远处那个：更小更高 = 更远。像素画里这是唯一不靠透视的深度线索。 */
const helperFar = (x, y, fill) =>
  `<rect x="${x}" y="${y}" width="5" height="3" fill="${fill}"/>`
  + `<rect x="${x + 1}" y="${y + 3}" width="1" height="2" fill="${fill}"/>`
  + `<rect x="${x + 3}" y="${y + 3}" width="1" height="2" fill="${fill}"/>`
  + `<rect x="${x + 1}" y="${y + 1}" width="1" height="1" fill="#000000"/>`
  + `<rect x="${x + 3}" y="${y + 1}" width="1" height="1" fill="#000000"/>`;

export const CANDIDATES = [
  // ------------------------------------------------------------------ c1
  {
    action: 'delegating',
    id: 'delegating-c1',
    title: 'Shadow Split',
    axis: '助手的形态 — 助手不是另一种小生物，是主角自己剥离出去的分身',
    desc: '主角下蹲蓄力、弹起，一个和自己同形的深色分身从身体里脱出来，'
      + '往侧面滑走、到边缘淡掉；主角站直目送，眼睛跟着它走。'
      + '子代理就是「另一个我」——这个候选把那句话直接画出来，'
      + '不需要观众建立「小家伙 = 子代理」的额外联想。'
      + '【一个 vs 多个】一个子代理时只有右边那个分身；两个及以上时 .helper-b'
      + '（左边的分身）同时出现，左右对称地各走一个方向，读作「一分为二」。'
      + '【表达 N】不好扩：三个以上分身会把主角围住，读成「被自己包围」而不是'
      + '「派了三个」。它换的是形态，不是数量。'
      + '【不像埋头干】主角全程没有操作任何东西，只有一次蓄力和一次目送。',
    duration: 4800,
    splitLegs: false,
    variants: ['one-subagent', 'two-or-more-subagents'],
    // 分身画在角色**身后**：它是从身体里出来的，第一帧必须被躯干完全挡住
    props:
      '<g class="clone-a motion" fill="#C4715A">'
      + '<rect x="3" y="8" width="8" height="5"/>'
      + '<rect x="4" y="13" width="1" height="2"/><rect x="9" y="13" width="1" height="2"/>'
      + '<rect x="5" y="10" width="1" height="2" fill="#000000"/>'
      + '<rect x="8" y="10" width="1" height="2" fill="#000000"/></g>'
      + '<g class="helper-b motion" fill="#B9705C">'
      + '<rect x="3" y="8" width="8" height="5"/>'
      + '<rect x="4" y="13" width="1" height="2"/><rect x="9" y="13" width="1" height="2"/>'
      + '<rect x="5" y="10" width="1" height="2" fill="#000000"/>'
      + '<rect x="8" y="10" width="1" height="2" fill="#000000"/></g>',
    propsAfter: '',
    layers: [
      // 蓄力 → 弹起（分身脱体的那一刻）→ 站直目送。没有一帧停在原位
      { sel: '.actor', name: 'c1-body', poses: [
        p('translate(0,1px)', 3), p('translate(0,2px)', 1), p('translate(0,-1px)', 2),
        p('translate(1px,0)', 1), p('translate(1px,-1px)', 3), p('translate(-1px,0)', 1),
        p('translate(0,-1px)', 2) ] },
      // 左爪一律不往左走：脱离躯干会读成断肢
      { sel: '.left-claw', name: 'c1-left', poses: [
        p('translate(0,1px)', 3), p('translate(1px,2px)', 1), p('translate(1px,-1px)', 2),
        p('translate(0,0)', 1), p('translate(0,1px)', 3), p('translate(1px,0)', 1),
        p('translate(0,2px)', 2) ] },
      { sel: '.right-claw', name: 'c1-right', poses: [
        p('translate(0,1px)', 3), p('translate(-1px,2px)', 1), p('translate(1px,-1px)', 2),
        p('translate(2px,0)', 1), p('translate(2px,-1px)', 3), p('translate(1px,0)', 1),
        p('translate(0,1px)', 2) ] },
      // 分身：躯干后面 → 弹出 → 滑到画面边缘淡掉。每一帧都写 opacity。
      // 第一帧就跨到 ±4：分身和主角一样大，停在躯干后面等于没画，
      // 「脱体」的读感靠**一拍之内就分开**，不靠慢慢挪出来
      { sel: '.clone-a', name: 'c1-clone-a', origin: '7px 15px', poses: [
        p('opacity:0;transform:translate(0,1px)', 3),
        p('opacity:1;transform:translate(4px,0)', 1),
        p('opacity:1;transform:translate(9px,0)', 2),
        p('opacity:1;transform:translate(14px,1px)', 2),
        p('opacity:1;transform:translate(18px,0)', 1),
        p('opacity:0;transform:translate(21px,1px)', 2) ] },
      { sel: '.helper-b', name: 'c1-clone-b', origin: '7px 15px', poses: [
        p('opacity:0;transform:translate(0,1px)', 4),
        p('opacity:1;transform:translate(-4px,0)', 1),
        p('opacity:1;transform:translate(-9px,1px)', 2),
        p('opacity:1;transform:translate(-14px,0)', 3),
        p('opacity:0;transform:translate(-17px,1px)', 2) ] },
      // 视线先送右边那个，再回头找左边那个
      { sel: '.eyes', name: 'c1-eyes', period: 3900, poses: [
        p('translate(1px,1px)', 4), p('translate(2px,1px)', 2), p('translate(0,1px)', 1),
        p('translate(-1px,1px)', 3), p('translate(0,0)', 2) ] },
      { sel: '.blink', name: 'c1-blink', period: 6100, poses: [
        p('scaleY(1)', 11), p('scaleY(.15)', 1), p('scaleY(1)', 4) ] },
    ],
  },

  // ------------------------------------------------------------------ c2
  {
    action: 'delegating',
    id: 'delegating-c2',
    title: 'Long Toss',
    axis: '交接的方式 — 抛，不递：包裹有滞空，主角在它落地前就空手了',
    desc: '后仰蓄力，把包裹抛出一条弧线，最高点停最久——那一拍主角已经空着手，'
      + '包裹还在天上，接手在下面抬爪等着。包裹落到它头顶那一瞬间被砸得一沉'
      + '（落怀里会正好盖住它的脸），顶着走两步，主角同时弯腰摸下一个。'
      + '「递过去」两只手一直连在一起，「抛过去」中间有一段谁都没拿着——'
      + '那段滞空就是「已经不归我管了」。'
      + '【一个 vs 多个】一个子代理时只有近处那个接手；两个及以上时 .helper-b'
      + '（更高更小、抱着上一件正在走远的那个）出现，周期 4200 与主循环错开，'
      + '于是画面上永远有一件在飞、一件在被搬走。'
      + '【表达 N】靠远处那条走廊上的助手数，可以再排第三个更小更高的，'
      + '但三个之后深度线索就用完了。'
      + '【不像埋头干】抛完之后有明确的「空手」段，那是 working 里不会出现的。',
    duration: 5000,
    splitLegs: false,
    variants: ['one-subagent', 'two-or-more-subagents'],
    props:
      `<g class="helper-a motion">${helperBody(18, 9, '#F1A186')}</g>`
      + `<g class="helper-b motion">${helperFar(24, 5, '#EAB078')}`
      + '<rect x="21" y="3" width="3" height="3" fill="#B9A1D9"/>'
      + '<rect x="21" y="4" width="3" height="1" fill="#E7DCF2"/></g>',
    // 抛出去的东西必须在身前，画在身后会被躯干吃掉半条弧线
    // x13 起画：眼睛加上身体的平移后最远能到 x12，道具从 x13 开始才碰不到
    propsAfter:
      '<g class="parcel motion"><rect x="13" y="9" width="4" height="4" fill="#F6C85F"/>'
      + '<rect x="13" y="10" width="4" height="1" fill="#B67B19"/></g>',
    layers: [
      // 后仰 → 送出 → 跟随（空手）→ 弯腰取下一个 → 起身
      { sel: '.actor', name: 'c2-body', poses: [
        p('translate(-1px,0)', 3), p('translate(-1px,1px)', 1), p('translate(2px,-1px)', 1),
        p('translate(1px,0)', 3), p('translate(0,1px)', 1), p('translate(0,2px)', 2),
        p('translate(1px,1px)', 1), p('translate(0,-1px)', 2) ] },
      { sel: '.right-claw', name: 'c2-right', poses: [
        p('translate(-1px,1px)', 3), p('translate(-1px,2px)', 1), p('translate(1px,-2px)', 1),
        p('translate(2px,-3px)', 3), p('translate(1px,-1px)', 1), p('translate(0,1px)', 2),
        p('translate(1px,2px)', 1), p('translate(0,0)', 2) ] },
      { sel: '.left-claw', name: 'c2-left', poses: [
        p('translate(0,0)', 3), p('translate(0,1px)', 1), p('translate(1px,-1px)', 1),
        p('translate(1px,-2px)', 3), p('translate(0,-1px)', 1), p('translate(0,1px)', 2),
        p('translate(1px,2px)', 1), p('translate(0,1px)', 2) ] },
      // 弧线：出手快、最高点停久、下落快、落袋后淡掉再回到手边
      { sel: '.parcel', name: 'c2-parcel', origin: '15px 11px', poses: [
        p('opacity:1;transform:translate(0,1px)', 3),
        p('opacity:1;transform:translate(0,2px)', 1),
        p('opacity:1;transform:translate(2px,-5px)', 1),
        p('opacity:1;transform:translate(4px,-8px)', 2),
        p('opacity:1;transform:translate(5px,-6px)', 1),
        // 落在接手**头顶**而不是怀里：落怀里会正好盖住它的两只眼睛
        p('opacity:1;transform:translate(5px,-4px)', 2),
        p('opacity:0;transform:translate(5px,-3px)', 1),
        p('opacity:0;transform:translate(0,1px)', 1) ] },
      // 接手：抬爪 → 被砸得一沉 → 抱着挪两步 → 折返回等位
      { sel: '.helper-a', name: 'c2-catch', origin: '21px 15px', poses: [
        p('translate(1px,0)', 3), p('translate(0,-1px)', 1), p('translate(0,1px)', 2),
        p('translate(1px,1px)', 1), p('translate(3px,0)', 3), p('translate(2px,1px)', 2) ] },
      { sel: '.helper-b', name: 'c2-far', period: 4200, origin: '26px 10px', poses: [
        p('opacity:1;transform:translate(0,0)', 3),
        p('opacity:1;transform:translate(1px,-1px)', 1),
        p('opacity:1;transform:translate(3px,0)', 2),
        p('opacity:1;transform:translate(5px,-1px)', 1),
        p('opacity:0;transform:translate(7px,0)', 2),
        p('opacity:0;transform:translate(-2px,0)', 1),
        p('opacity:1;transform:translate(-1px,-1px)', 2) ] },
      // 视线追着弧线走：先抬头看天，再落到接手身上。
      // 最多往右 1 格——身体本身还会再往右 2 格，加起来眼睛才不会追到道具下面
      { sel: '.eyes', name: 'c2-eyes', period: 3300, poses: [
        p('translate(1px,0)', 4), p('translate(0,-1px)', 2), p('translate(1px,-1px)', 1),
        p('translate(1px,1px)', 3), p('translate(0,1px)', 2) ] },
      { sel: '.blink', name: 'c2-blink', period: 5900, poses: [
        p('scaleY(1)', 10), p('scaleY(.15)', 1), p('scaleY(1)', 5) ] },
    ],
  },

  // ------------------------------------------------------------------ c3
  {
    action: 'delegating',
    id: 'delegating-c3',
    title: 'Dispatch Desk',
    axis: '主角的位置 — 退到左边的调度台上，全程不碰任何东西',
    desc: '主角站到画面左侧的台子上，右爪抬起指向右边，**指住那一拍是全循环最长的**；'
      + '被指的助手扛着包裹往右走、出画、下一个补上。主角自己手上什么都没有，'
      + '全程只有指、看、换重心三件事。'
      + '六个里唯一一个「主角不在画面中央、也不接触任何道具」的构图——'
      + '「我只负责分配」这句话靠位置和空手说，不靠动作。'
      + '【一个 vs 多个】一个子代理时只有下面那条道；两个及以上时 .helper-b'
      + '（更高那条道上更小的那个）出现，周期 3900 与主循环互质，两条道永远错开，'
      + '读作「两边各跑各的」。'
      + '【表达 N】天然按「道」扩：每多一个子代理加一条更高更小的道，'
      + '主角的动作一个字都不用改——这一点最接近 working.tiers 想要的东西。'
      + '【注意】主角的偏移是靠每一帧的 translate(-7px,-3px) 做的，'
      + 'prefers-reduced-motion 下动画被整体关掉，主角会掉回画面中央、站在台子旁边。'
      + '要采用它得给这个动作单独写一条静止姿势。',
    duration: 5200,
    splitLegs: false,
    variants: ['one-subagent', 'two-or-more-subagents'],
    props:
      // 调度台：画面里唯一一处高地，主角站上去就不再和地面上的活儿同层
      '<rect x="-7" y="12" width="14" height="3" fill="#8C7A5E"/>'
      + '<rect x="-7" y="12" width="14" height="1" fill="#A99070"/>'
      + `<g class="helper-a motion">${helperBody(14, 9, '#F1A186')}`
      + '<rect x="16" y="6" width="3" height="3" fill="#F6C85F"/>'
      + '<rect x="16" y="7" width="3" height="1" fill="#FFE59A"/></g>'
      + `<g class="helper-b motion">${helperFar(22, 5, '#EAB078')}`
      + '<rect x="23" y="2" width="3" height="3" fill="#7BC8C4"/>'
      + '<rect x="23" y="3" width="3" height="1" fill="#BDE7E4"/></g>',
    propsAfter: '',
    layers: [
      // 每一帧都带 -7,-3 的常量偏移：主角在台子上，不在中央
      { sel: '.actor', name: 'c3-body', poses: [
        p('translate(-7px,-3px)', 3), p('translate(-7px,-2px)', 1), p('translate(-6px,-3px)', 2),
        p('translate(-6px,-4px)', 1), p('translate(-7px,-4px)', 3), p('translate(-8px,-3px)', 1),
        p('translate(-7px,-2px)', 2) ] },
      // 指住那一拍权重 5，是全循环最长的保持——这就是「我只负责分配」。
      // 只往右 1 格：再远爪子和躯干之间会空出两格，读成断肢而不是「在指」
      { sel: '.right-claw', name: 'c3-point', poses: [
        p('translate(0,1px)', 2), p('translate(1px,-1px)', 1), p('translate(1px,-3px)', 5),
        p('translate(1px,-1px)', 1), p('translate(0,0)', 2), p('translate(1px,1px)', 1),
        p('translate(0,2px)', 2) ] },
      { sel: '.left-claw', name: 'c3-left', period: 4100, poses: [
        p('translate(0,1px)', 3), p('translate(0,0)', 1), p('translate(1px,0)', 2),
        p('translate(1px,1px)', 1), p('translate(0,2px)', 2) ] },
      // 扛着包裹往右走 → 出画淡掉 → 下一个从左边补上
      { sel: '.helper-a', name: 'c3-lane-a', origin: '17px 15px', poses: [
        p('opacity:1;transform:translate(0,0)', 3),
        p('opacity:1;transform:translate(2px,-1px)', 1),
        p('opacity:1;transform:translate(5px,0)', 2),
        p('opacity:1;transform:translate(9px,-1px)', 1),
        p('opacity:0;transform:translate(13px,0)', 3),
        p('opacity:0;transform:translate(-2px,0)', 1),
        p('opacity:1;transform:translate(-1px,-1px)', 2) ] },
      { sel: '.helper-b', name: 'c3-lane-b', period: 3900, origin: '24px 10px', poses: [
        p('opacity:1;transform:translate(-1px,0)', 2),
        p('opacity:1;transform:translate(1px,-1px)', 1),
        p('opacity:1;transform:translate(4px,0)', 3),
        p('opacity:0;transform:translate(7px,-1px)', 2),
        p('opacity:0;transform:translate(-3px,0)', 1),
        p('opacity:1;transform:translate(-2px,-1px)', 2) ] },
      // 视线：顺着指的方向扫出去，再收回来找下一个
      { sel: '.eyes', name: 'c3-eyes', period: 3500, poses: [
        p('translate(1px,1px)', 2), p('translate(2px,1px)', 4), p('translate(2px,0)', 1),
        p('translate(1px,0)', 2), p('translate(0,1px)', 3) ] },
      { sel: '.blink', name: 'c3-blink', period: 6700, poses: [
        p('scaleY(1)', 12), p('scaleY(.15)', 1), p('scaleY(1)', 4) ] },
    ],
  },

  // ------------------------------------------------------------------ c4
  {
    action: 'delegating',
    id: 'delegating-c4',
    title: 'Handoff Ghost',
    axis: '助手在不在画面里 — 一个助手都不画，只画「东西被拿走了」',
    desc: '画面上只有主角和包裹。主角把包裹举到身侧递出去、举着等一拍，'
      + '然后包裹**加速**往右抽走（一拍 6 格、下一拍 9 格）、出画淡掉；'
      + '主角被带得往回一缩，目送，再从脚边捡起下一个。'
      + '助手一个都不画，靠三件事说清「被人接走了」：抽走的加速度、'
      + '主角的反冲、以及那只还张着的空爪。'
      + '好处是构图最干净——135px 下其余五个都要挤两三个小家伙，这个不用。'
      + '【一个 vs 多个】数量落在**包裹**上而不是助手上：一个子代理时只有那个'
      + '黄包裹；两个及以上时 .helper-b（脚边那个青色包裹）出现，周期 3400，'
      + '自己走自己的节奏被抽走，于是画面上两件东西在被并行取走。'
      + '【表达 N】可以按包裹数扩到三四件，但它们都从同一个人手里出去，'
      + '读作「东西多」比读作「人多」自然。'
      + '【不像埋头干】主角的动作只有举起和松手，没有任何反复操作。',
    duration: 4600,
    splitLegs: false,
    variants: ['one-subagent', 'two-or-more-subagents'],
    props: '',
    // 两件都从 y12 起画：主角弯腰取件时眼睛会掉到 y12，再高一格就压到脸上了
    propsAfter:
      '<g class="parcel motion"><rect x="12" y="12" width="4" height="3" fill="#F6C85F"/>'
      + '<rect x="12" y="13" width="4" height="1" fill="#B67B19"/></g>'
      + '<g class="helper-b motion"><rect x="2" y="12" width="4" height="3" fill="#7BC8C4"/>'
      + '<rect x="2" y="13" width="4" height="1" fill="#BDE7E4"/></g>',
    layers: [
      // 托着 → 举起递出（长）→ 被抽走时反冲 → 目送
      { sel: '.actor', name: 'c4-body', poses: [
        p('translate(0,1px)', 3), p('translate(0,2px)', 1), p('translate(1px,0)', 2),
        p('translate(2px,-1px)', 3), p('translate(-1px,0)', 1), p('translate(0,1px)', 1),
        p('translate(1px,-1px)', 2) ] },
      { sel: '.right-claw', name: 'c4-right', poses: [
        p('translate(-1px,2px)', 3), p('translate(0,3px)', 1), p('translate(1px,0)', 2),
        p('translate(2px,-1px)', 3), p('translate(2px,-2px)', 1), p('translate(1px,0)', 1),
        p('translate(0,1px)', 2) ] },
      // 左爪最多往右 1 格：+2 之后整只爪落进躯干矩形里，同色无描边 = 消失
      { sel: '.left-claw', name: 'c4-left', poses: [
        p('translate(1px,2px)', 3), p('translate(1px,3px)', 1), p('translate(1px,0)', 2),
        p('translate(1px,-1px)', 3), p('translate(0,0)', 1), p('translate(0,2px)', 1),
        p('translate(0,1px)', 2) ] },
      // 抽走那两拍走的距离是前面的六倍——加速度就是「有人在拉」
      { sel: '.parcel', name: 'c4-parcel', origin: '14px 15px', poses: [
        p('opacity:1;transform:translate(0,0)', 3),
        p('opacity:1;transform:translate(1px,-1px)', 1),
        p('opacity:1;transform:translate(4px,-2px)', 3),
        p('opacity:1;transform:translate(10px,-3px)', 1),
        p('opacity:0;transform:translate(19px,-5px)', 1),
        p('opacity:0;transform:translate(0,1px)', 2),
        p('opacity:1;transform:translate(0,1px)', 2) ] },
      // 第二件：低位横着走，过了脸的横向范围才抬起来，免得越界压到眼睛
      { sel: '.helper-b', name: 'c4-parcel-b', period: 3400, origin: '4px 15px', poses: [
        p('opacity:1;transform:translate(0,0)', 4),
        p('opacity:1;transform:translate(3px,0)', 1),
        p('opacity:1;transform:translate(8px,0)', 2),
        p('opacity:1;transform:translate(12px,-2px)', 1),
        p('opacity:0;transform:translate(20px,-4px)', 1),
        p('opacity:0;transform:translate(0,1px)', 2),
        p('opacity:1;transform:translate(0,1px)', 1) ] },
      // 目送：视线一路追到右缘，然后落回脚边找下一个
      // 视线不再往下压：身体本身已经弯到 +2 格，再叠一格眼睛就掉到脚边道具那一层了
      { sel: '.eyes', name: 'c4-eyes', period: 3100, poses: [
        p('translate(0,0)', 3), p('translate(1px,0)', 1), p('translate(1px,-1px)', 2),
        p('translate(0,-1px)', 1), p('translate(-1px,0)', 3) ] },
      { sel: '.blink', name: 'c4-blink', period: 5300, poses: [
        p('scaleY(1)', 9), p('scaleY(.15)', 1), p('scaleY(1)', 5) ] },
    ],
  },

  // ------------------------------------------------------------------ c5
  {
    action: 'delegating',
    id: 'delegating-c5',
    title: 'Round Trip',
    axis: '循环结构 — 派出去 → 等 → 收回来，一个完整回合而不是均匀接力',
    desc: '一个循环是一件完整的事：交出包裹（两拍，快）→ **空手等着（最长的一拍，'
      + '占三成，主角沉下来、点脚、盯着信使走的方向）** → 信使带着东西回来 → '
      + '接过、点一下头。包裹出去是黄的、回来是青的（关键帧直接换 fill），'
      + '所以「回来的不是同一件东西，是结果」这件事不用讲。'
      + '现在的实现是均匀接力，从头到尾一个节奏；这个候选把 SubagentStart 到'
      + 'SubagentStop 的整个回合画进了一个循环里。'
      + '【一个 vs 多个】变的是**等待时间**：一个子代理时那段空手真的空着，'
      + '主角在点脚；两个及以上时 .helper-b（更高那条道上的第二个信使，'
      + '周期 4200 与 5600 错开）在空档里进出，主角几乎没有闲着的时候。'
      + '「派得越多越没空」——这是六个里唯一一个变体改的是节奏而不是元素数量的。'
      + '【表达 N】按信使数扩，每个用一个互质周期，回合自然交错。'
      + '【不像埋头干】最长的一拍是**什么都没干**，working 里不可能有这一拍。',
    duration: 5600,
    splitLegs: true, // 等待时要单独驱动一条腿点地
    variants: ['one-subagent', 'two-or-more-subagents'],
    props:
      `<g class="helper-a motion">${helperBody(17, 9, '#F1A186')}</g>`
      + `<g class="helper-b motion">${helperFar(21, 4, '#EAB078')}`
      + '<rect x="21" y="1" width="3" height="3" fill="#F6C85F"/>'
      + '<rect x="21" y="2" width="3" height="1" fill="#FFE59A"/></g>',
    // 从 x13 起画：正好落在右爪上，也刚好躲开眼睛能到的最右一格
    propsAfter:
      '<g class="parcel motion" fill="#F6C85F"><rect x="13" y="10" width="4" height="4"/>'
      + '<rect x="13" y="11" width="4" height="1" fill="#8C7A5E"/></g>',
    layers: [
      // 交出(1,1) → 等(5,3，最长) → 迎上去(1,1) → 接过并点头(2,1,2)
      { sel: '.actor', name: 'c5-body', poses: [
        p('translate(1px,-1px)', 1), p('translate(0,-1px)', 1), p('translate(0,1px)', 5),
        p('translate(-1px,1px)', 3), p('translate(-1px,0)', 1), p('translate(1px,0)', 1),
        p('translate(0,-1px)', 2), p('translate(0,2px)', 1), p('translate(-1px,-1px)', 2) ] },
      // 三次点脚全部落在等待窗口内（身体的「等」是 12%–59%），
      // 信使一回来就不点了——不耐烦是有对象的，人到了就不该再抖腿
      { sel: '.leg-b', name: 'c5-tap', poses: [
        p('translate(0,0)', 2), p('translate(0,-1px)', 1), p('translate(0,0)', 1),
        p('translate(0,-1px)', 1), p('translate(0,0)', 1), p('translate(0,-1px)', 1),
        p('translate(1px,0)', 6) ] },
      { sel: '.right-claw', name: 'c5-right', poses: [
        p('translate(2px,0)', 1), p('translate(1px,1px)', 1), p('translate(0,2px)', 5),
        p('translate(0,1px)', 3), p('translate(1px,1px)', 1), p('translate(2px,0)', 1),
        p('translate(1px,-1px)', 2), p('translate(0,1px)', 1), p('translate(0,0)', 2) ] },
      { sel: '.left-claw', name: 'c5-left', period: 4700, poses: [
        p('translate(0,1px)', 3), p('translate(0,2px)', 2), p('translate(1px,1px)', 1),
        p('translate(1px,0)', 2), p('translate(0,0)', 1) ] },
      // 出去是黄的、回来是青的。fill 也能写进关键帧，step-end 下是硬切不是渐变
      { sel: '.parcel', name: 'c5-parcel', origin: '15px 14px', poses: [
        p('fill:#F6C85F;opacity:1;transform:translate(0,0)', 1),
        p('fill:#F6C85F;opacity:1;transform:translate(5px,0)', 1),
        p('fill:#F6C85F;opacity:1;transform:translate(11px,-1px)', 2),
        p('fill:#F6C85F;opacity:0;transform:translate(16px,0)', 4),
        p('fill:#7BC8C4;opacity:0;transform:translate(15px,-1px)', 2),
        p('fill:#7BC8C4;opacity:1;transform:translate(11px,0)', 2),
        p('fill:#7BC8C4;opacity:1;transform:translate(5px,-1px)', 1),
        p('fill:#7BC8C4;opacity:1;transform:translate(1px,1px)', 2),
        p('fill:#7BC8C4;opacity:1;transform:translate(0,-1px)', 2) ] },
      // 信使：接活 → 跑出画（等待期间画面上真的没有它）→ 跑回来交还
      { sel: '.helper-a', name: 'c5-courier', origin: '20px 15px', poses: [
        p('opacity:1;transform:translate(-2px,0)', 1),
        p('opacity:1;transform:translate(3px,0)', 1),
        p('opacity:1;transform:translate(9px,-1px)', 2),
        p('opacity:0;transform:translate(14px,0)', 4),
        p('opacity:0;transform:translate(13px,-1px)', 2),
        p('opacity:1;transform:translate(9px,0)', 2),
        p('opacity:1;transform:translate(3px,-1px)', 1),
        p('opacity:1;transform:translate(-1px,1px)', 2),
        p('opacity:1;transform:translate(-2px,-1px)', 2) ] },
      // 第二个信使：周期 4200 与 5600 错开，专门填主角的空档
      // 出画那一段只占两成：它的作用就是填主角的空档，消失太久就填不上了
      { sel: '.helper-b', name: 'c5-courier-b', period: 4200, origin: '23px 9px', poses: [
        p('opacity:1;transform:translate(-3px,0)', 1),
        p('opacity:1;transform:translate(2px,-1px)', 3),
        p('opacity:0;transform:translate(6px,0)', 2),
        p('opacity:1;transform:translate(4px,-1px)', 1),
        p('opacity:1;transform:translate(0,0)', 2),
        p('opacity:1;transform:translate(-2px,-1px)', 1) ] },
      // 等待期间视线钉在信使走的方向，偶尔抬一下——那是「还没回来啊」
      { sel: '.eyes', name: 'c5-eyes', period: 4300, poses: [
        p('translate(1px,1px)', 4), p('translate(1px,0)', 2), p('translate(0,-1px)', 1),
        p('translate(1px,1px)', 3), p('translate(0,1px)', 2) ] },
      { sel: '.blink', name: 'c5-blink', period: 6300, poses: [
        p('scaleY(1)', 11), p('scaleY(.15)', 1), p('scaleY(1)', 4) ] },
    ],
  },

  // ------------------------------------------------------------------ c6
  {
    action: 'delegating',
    id: 'delegating-c6',
    title: 'Tether Lines',
    axis: '数量的表达 — N 靠线的条数，主角的动作与 N 无关',
    desc: '主角右爪握着一根线轴，三条线从线轴上往右拉出去，'
      + '每条线的另一头挂着一个远处的小方块——那就是一个子代理。'
      + '三条线各自以 2900 / 3700 / 4300 的周期一收一放（各自在忙，永不同步），'
      + '主角被拽着微微后仰、偶尔收一下线，眼睛在三条线之间来回。'
      + '【一个 vs 多个】线的条数就是数量，主角的关键帧一帧都不用改：'
      + '一个子代理时只留 .tether-a；≥2 时 .helper-b 出现；'
      + '.helper-c 是留给 ≥3 的那条——**采用这个候选要给 helper-c 补一条'
      + '和 helper-b 一样的 display:none 规则**，否则一个子代理时会露出三条线。'
      + '【表达 N】六个里唯一一个真正按 N 线性扩展的：加一条线 = 加一个子代理，'
      + '线的长短还能顺带表达「跑了多久」。这正是 working.tiers 想要的形状——'
      + 'delegating 的 one/two 变体只是它的二值前身。'
      + '【不像埋头干】主角是被三条线拽着的那一端，不是在操作任何东西；'
      + '它唯一的动作是「拉住」和「看」。',
    duration: 5000,
    splitLegs: false,
    variants: ['one-subagent', 'two-or-more-subagents'],
    // 线画在身后：线轴（propsAfter）压在最上面，读作握在爪里。
    // 每条线都从 x13 起画（伸进爪子底下 2 格）：道具不继承身体的位移，
    // 线和线轴各自动起来后端点会错开，多留的这 2 格就是错位的余量
    props:
      '<g class="tether-a motion"><rect x="13" y="7" width="11" height="1" fill="#8C7A5E"/>'
      + '<rect x="24" y="5" width="4" height="4" fill="#7BC8C4"/>'
      + '<rect x="24" y="6" width="4" height="1" fill="#BDE7E4"/></g>'
      + '<g class="helper-b motion"><rect x="13" y="10" width="12" height="1" fill="#8C7A5E"/>'
      + '<rect x="25" y="8" width="4" height="4" fill="#B9A1D9"/>'
      + '<rect x="25" y="9" width="4" height="1" fill="#E7DCF2"/></g>'
      + '<g class="helper-c motion"><rect x="13" y="13" width="9" height="1" fill="#8C7A5E"/>'
      + '<rect x="22" y="11" width="4" height="4" fill="#EAB078"/>'
      + '<rect x="22" y="12" width="4" height="1" fill="#F7D9AE"/></g>',
    // 线轴只有 1 格宽：2 格宽会读成一堵墙，整组变成书架而不是三根线
    propsAfter:
      '<g class="reins motion"><rect x="15" y="7" width="1" height="7" fill="#6F5F49"/></g>',
    layers: [
      // 被拽着后仰，重心一直在左脚——没有一帧是「站直不动」
      { sel: '.actor', name: 'c6-body', poses: [
        p('translate(-1px,0)', 3), p('translate(-1px,-1px)', 1), p('translate(0,-1px)', 2),
        p('translate(-2px,0)', 1), p('translate(-1px,1px)', 3), p('translate(0,1px)', 1),
        p('translate(-1px,-1px)', 2) ] },
      { sel: '.right-claw', name: 'c6-right', poses: [
        p('translate(0,0)', 3), p('translate(0,-1px)', 1), p('translate(1px,-1px)', 2),
        p('translate(1px,1px)', 1), p('translate(-1px,0)', 3), p('translate(0,-1px)', 1),
        p('translate(1px,0)', 2) ] },
      // 线轴是 .actor 的兄弟节点，**不继承身体的位移**。要让它看起来是握在爪里，
      // 它的每一帧必须等于「身体 + 右爪」的和，而不是照抄右爪。
      // 两条图层的权重必须一模一样，否则相加的时刻对不上
      { sel: '.reins', name: 'c6-reins', origin: '15px 14px', poses: [
        p('translate(-1px,0)', 3), p('translate(-1px,-2px)', 1), p('translate(1px,-2px)', 2),
        p('translate(-1px,1px)', 1), p('translate(-2px,1px)', 3), p('translate(0,0)', 1),
        p('translate(0,-1px)', 2) ] },
      { sel: '.left-claw', name: 'c6-left', period: 4100, poses: [
        p('translate(0,0)', 3), p('translate(0,1px)', 1), p('translate(1px,1px)', 2),
        p('translate(1px,0)', 1), p('translate(0,2px)', 2) ] },
      // 三条线各走各的周期：合成图案 5000/2900/3700/4300 的最小公倍数才重复
      { sel: '.tether-a', name: 'c6-line-a', period: 2900, origin: '13px 8px', poses: [
        p('translate(0,0)', 3), p('translate(1px,-1px)', 1), p('translate(1px,0)', 2),
        p('translate(0,1px)', 1), p('translate(-1px,0)', 2) ] },
      { sel: '.helper-b', name: 'c6-line-b', period: 3700, origin: '13px 11px', poses: [
        p('translate(1px,0)', 2), p('translate(0,1px)', 1), p('translate(-1px,0)', 3),
        p('translate(0,-1px)', 1), p('translate(1px,1px)', 2) ] },
      { sel: '.helper-c', name: 'c6-line-c', period: 4300, origin: '13px 14px', poses: [
        p('translate(0,1px)', 3), p('translate(-1px,0)', 2), p('translate(1px,0)', 1),
        p('translate(1px,-1px)', 2), p('translate(0,-1px)', 1) ] },
      // 视线在三条线之间上下扫，不盯着爪子——盯爪子就成了「在操作」
      { sel: '.eyes', name: 'c6-eyes', period: 3100, poses: [
        p('translate(1px,-1px)', 4), p('translate(2px,0)', 2), p('translate(1px,1px)', 1),
        p('translate(2px,1px)', 3), p('translate(0,0)', 2) ] },
      { sel: '.blink', name: 'c6-blink', period: 5700, poses: [
        p('scaleY(1)', 10), p('scaleY(.15)', 1), p('scaleY(1)', 4) ] },
    ],
  },
];
