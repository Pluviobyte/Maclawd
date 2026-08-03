/**
 * `error`（整轮任务失败）的六个候选。
 *
 * 语义边界（这三个动作挨着，很容易互相串味）：
 *   working.retrying  单个工具失败但还在继续  → 「遇到点麻烦」
 *   error             这一轮砸了，停在这里了  → 这里
 *   recovering        正在从失败里爬起来      → 「已经在动了」
 *
 * 基调沿用当前的 Basket Rescue：**困住了但没死**。
 * 不沿用的是表达方式——出错可能停留很久（人不在电脑前），
 * 一个持续哀嚎的桌宠会让人反感。所以六个候选里没有一个是「吵」的，
 * 差别在于「安静」的六种不同来源。
 *
 * 六条轴，每个候选换一条：
 *   c1  被困的方式   扣住 → 卡在两个东西中间
 *   c2  有无道具     有篮子 → 完全没有道具
 *   c3  情绪         挣扎 → 认命
 *   c4  循环结构     挣脱↔被碰倒的往复 → 单向下滑，没有「站稳」这个高点
 *   c5  构图         角色是主体 → 障碍物是主体，角色被淹没
 *   c6  朝向         正面站立 → 翻倒
 *
 * ---------------------------------------------------------------------------
 * 写之前查出来的两件事，六个候选都是绕着它们设计的：
 *
 * **一、当前的 error 全程遮脸。** yarn-tangle.svg 里篮子画在角色之后（在身前），
 * 覆盖 x-3..17 / y6..18；`fail-basket` 抬得最高的一拍是 translate(1px,-6px)
 * rotate(14deg)，算下来篮身仍盖在 y3..11 上，而眼睛在 y8..10。
 * 也就是说整个 4800ms 里一次都没露过脸。README 硬约束 7 说「脸是桌宠的身份」——
 * 这一条现在是破的。六个候选全部把 x4..11 / y8..10 留空，任何一拍都不遮。
 *
 * **二、纯姿态的「垮掉」这条路已经被 low-battery 占了。** battery-body 就是
 * 下沉 + scaleY 压缩 + 半闭眼 + 一次徒劳的撑起，6200ms。所以 c2 虽然换的是
 * 「有无道具」这条轴，走的却不是垮——它是「动作做到一半停住了」。
 * 真做成垮，桌宠会用同一个画面表达「失败」和「电量低」。
 *
 * 顺带：当前 fail-body 的首尾姿态都是 translate(0,2px)，跨接缝是一段停顿。
 * error 不在 motion-quality 那条「持续态」白名单里，所以没被测到。
 * 六个候选的 .actor 首尾都不同。
 *
 * ---------------------------------------------------------------------------
 * 六个都守的约束：
 *   · 躯干不许长期倾斜——除 c6 的 -90°（轴对齐，不产生锯齿平行四边形，
 *     和被禁的小角度斜切是两回事）外，`.actor` 上没有任何 rotate。
 *     「垮」一律用下沉 + scaleY 表达。
 *   · 位移全是整数 px。c1 一度想用 scaleX 表达被挤压，算下来眼睛会落在
 *     0.2 单位（约 0.6px）上，crispEdges 会让它左右跳，删掉了——
 *     「夹住」的读感由两块板贴着身体这个构图给，不需要变形。
 *   · 道具不遮 x4..11 / y8..10。
 *   · 爪只在有道具可抵的方向外伸（c1 抵板、c3 搭筐沿、c4 抓墙）；
 *     c2/c6 没有可够的东西，爪只做纵向，不外伸。
 *   · 爪从不往躯干里挪。左爪的 dx 全是 0 或负、右爪全是 0 或正，
 *     没有一拍落进 x2–13 / y6–13 里被同色的躯干吃掉。
 *   · 唯一「长在身上」的道具是 c5 露在堆外的那只爪，它逐拍抄了身体的下沉；
 *     其余道具（板、筐、墙、堆、地板）都是环境，本来就不该跟着身体走。
 *   · `.actor` 的保持时长变异系数全部 ≥ 0.50。
 *
 * 时长统一 4800ms：和契约里的 error 一致，选中哪个都能直接换进去而不动契约；
 * 并排看的时候循环长度相同，比较的才是设计本身。
 *
 * ---------------------------------------------------------------------------
 * **长时间停留的推荐是 c3（Under the Crate）。** 判据不是「哪个好看」，
 * 是「盯着它二十分钟会不会烦」，四条：
 *   1. 幅度低、没有周期性的高潮拍。c1 每圈使一次劲、c4 每圈滑到底一次、
 *      c6 每圈蹬两下——这三个都有一个「又来了」的节拍点，那是烦的来源。
 *   2. 一眼能读完，不用等一个循环。c3 的静止画面本身就说明了处境。
 *   3. 不像坏了。c2 比 c3 还安静，但一个几乎不动的桌宠会让人怀疑是不是崩了；
 *      c3 画面里有个明确的外因，读的是「被什么东西困住了」而不是「它没反应」。
 *   4. 角色还在。c5 把桌宠埋掉了大半，挂久了等于把宠物拿走。
 * 最不适合长停留的是 c4——单向下滑每 4.8 秒重演一次，是六个里最催人的。
 */

/** 与 motion-poses.mjs 同一个缩写：[transform, 权重]。 */
const p = (transform, weight = 1) => [transform, weight];

export const CANDIDATES = [
  // ------------------------------------------------------------------ c1
  {
    action: 'error',
    id: 'error-c1',
    title: 'Pinned Between',
    axis: '被困的方式 —— 从「被一个东西扣住」换成「卡在两个东西中间」',
    desc: '两块厚板从左右夹住。往上顶想从缝里挤出去，顶到最高卡住，滑回来，'
      + '板又收紧一格。困住它的不是一个盖子，是两边同时的挤压。',
    duration: 4800,
    // 板画在角色**身后**：爪抵在板上时爪要在上面，才读成「在推」而不是「被压」。
    // 两块板都在 x<2 与 x>13 之外，脸全程不被碰。
    props: '<g class="wall-l motion">'
      + '<rect x="-9" y="3" width="10" height="13" fill="#8C7A5E"/>'
      + '<rect x="-1" y="3" width="2" height="13" fill="#6E5F49"/>'
      + '<rect x="-7" y="5" width="2" height="9" fill="#A08C6C"/></g>'
      + '<g class="wall-r motion">'
      + '<rect x="14" y="3" width="10" height="13" fill="#8C7A5E"/>'
      + '<rect x="14" y="3" width="2" height="13" fill="#6E5F49"/>'
      + '<rect x="20" y="5" width="2" height="9" fill="#A08C6C"/></g>',
    layers: [
      // 卡住的东西只能往上走。所以身体全程只有纵向——横向被两块板吃掉了，
      // 那个「一格都挪不动」本身就是这个候选的话。
      { sel: '.actor', name: 'error-c1-body', poses: [
        p('translate(0,2px)', 4), p('translate(0,1px)', 1), p('translate(0,-1px)', 3),
        p('translate(0,1px)', 1), p('translate(0,2px)', 4), p('translate(0,3px)', 2) ] },
      // 板几乎不动，只在自己的周期里收紧一格。两块板周期不同，
      // 于是「什么时候更紧」永远对不上拍——挤压才读成没完没了的。
      { sel: '.wall-l', name: 'error-c1-wall-l', period: 3300, poses: [
        p('translate(0,0)', 6), p('translate(1px,0)', 5), p('translate(0,0)', 2),
        p('translate(1px,0)', 1) ] },
      { sel: '.wall-r', name: 'error-c1-wall-r', period: 3900, poses: [
        p('translate(0,0)', 5), p('translate(-1px,0)', 6), p('translate(0,0)', 1),
        p('translate(-1px,0)', 2) ] },
      // 爪抵着板往外推。有板可抵，所以向外伸不会读成断肢。
      { sel: '.left-claw', name: 'error-c1-left', period: 2300, poses: [
        p('translate(-1px,0)', 4), p('translate(-2px,0)', 2), p('translate(-2px,-1px)', 1),
        p('translate(-1px,1px)', 3) ] },
      { sel: '.right-claw', name: 'error-c1-right', period: 2900, poses: [
        p('translate(1px,0)', 3), p('translate(2px,0)', 1), p('translate(2px,1px)', 4),
        p('translate(1px,1px)', 2) ] },
      // 视线在两块板之间来回——还在找哪边松一点，最后落到脚下。
      { sel: '.eyes', name: 'error-c1-eyes', period: 3100, poses: [
        p('translate(-1px,0)', 4), p('translate(0,0)', 1), p('translate(1px,0)', 3),
        p('translate(0,1px)', 4) ] },
      { sel: '.blink', name: 'error-c1-blink', period: 5300, poses: [
        p('scaleY(1)', 9), p('scaleY(.15)', 1), p('scaleY(1)', 4) ] },
    ],
  },

  // ------------------------------------------------------------------ c2
  {
    action: 'error',
    id: 'error-c2',
    title: 'Caught Mid-Reach',
    axis: '有无道具 —— 从「有一个篮子」换成「画面里什么都没有」',
    desc: '动作做到一半停住了：一只爪还举在半空，身体绷着维持不住，'
      + '掉一格又勉强撑回去。没有任何东西困住它，停下来的是它自己。',
    duration: 4800,
    // 无道具。这条轴最容易滑向「垮掉」，但垮掉是 low-battery 的画面
    // （下沉 + scaleY 压缩 + 半闭眼）。所以这里反过来：它不往下垮，
    // 它在**勉强维持一个高姿态**，那个维持不住才是「停在这里了」。
    layers: [
      // 幅度全在 1px 以内，节奏靠权重拉开。这是六个里最安静的一个：
      // 不动不是没设计，是它就该像一帧卡住的画面——只是仔细看还在呼吸。
      { sel: '.actor', name: 'error-c2-body', poses: [
        p('translate(0,-1px)', 5), p('translate(0,0) scaleY(.99)', 1),
        p('translate(0,1px) scaleY(.96)', 4), p('translate(0,0) scaleY(.99)', 1),
        p('translate(0,-1px)', 6), p('translate(0,0) scaleY(.98)', 2) ] },
      // 举着的那只爪。没有可够的东西，所以只走纵向——向左伸出去就只剩断肢。
      // 它一格一格往下掉、又抬回去：全动作唯一「还在使劲」的地方。
      { sel: '.left-claw', name: 'error-c2-left', period: 3700, poses: [
        p('translate(0,-4px)', 6), p('translate(0,-3px)', 1), p('translate(0,-2px)', 3),
        p('translate(0,-4px)', 1), p('translate(0,-5px)', 4) ] },
      // 另一只早就放下了，几乎不动。两只爪状态不同，是「做到一半」的证据。
      { sel: '.right-claw', name: 'error-c2-right', period: 5300, poses: [
        p('translate(0,1px)', 9), p('translate(0,2px)', 1), p('translate(0,1px)', 3),
        p('translate(0,2px)', 1) ] },
      // 视线长时间不动。不是在找出路——找出路是 recovering 的事。
      { sel: '.eyes', name: 'error-c2-eyes', period: 4100, poses: [
        p('translate(0,0)', 10), p('translate(-1px,1px)', 3), p('translate(0,1px)', 4) ] },
      // 一次很慢的眨：半闭 → 全闭 → 半闭。快眨读作清醒，慢眨才读作停摆。
      { sel: '.blink', name: 'error-c2-blink', period: 6700, poses: [
        p('scaleY(1)', 12), p('scaleY(.4)', 1), p('scaleY(.15)', 1),
        p('scaleY(.4)', 1), p('scaleY(1)', 5) ] },
    ],
  },

  // ------------------------------------------------------------------ c3
  {
    action: 'error',
    id: 'error-c3',
    title: 'Under the Crate',
    axis: '情绪 —— 从「挣扎」换成「认命」（困住的方式照旧，只换态度）',
    desc: '一个倒扣的浅筐罩住了下半身。它试了一下，筐纹丝不动，'
      + '于是就站在那儿不试了。整套里唯一一个「放弃」写在动作里的。',
    duration: 4800,
    // 刻意保留「被扣住」这个原有的困法，好让换掉的只有情绪这一条。
    // 但筐做浅了：只罩住 y11 以下，脸永远在筐口之上——
    // 这同时修掉了当前实现全程遮脸的问题。
    propsAfter: '<g class="crate motion">'
      + '<rect x="-2" y="11" width="19" height="2" fill="#8A5E3B"/>'
      + '<rect x="-1" y="13" width="17" height="5" fill="#D4A66D"/>'
      + '<rect x="2" y="13" width="2" height="5" fill="#F0C98F"/>'
      + '<rect x="7" y="13" width="2" height="5" fill="#F0C98F"/>'
      + '<rect x="12" y="13" width="2" height="5" fill="#F0C98F"/>'
      + '<rect x="-1" y="15" width="17" height="1" fill="#A87447"/></g>',
    layers: [
      // 结构是「沉 → 试一下 → 沉得更低」。关键在最后那段 7 拍：
      // 试完之后它比试之前更矮，而且停得最久。放弃是可以画出来的，
      // 画法是**放弃之后的姿势比放弃之前更低**，并且在那儿待着不走。
      { sel: '.actor', name: 'error-c3-body', poses: [
        p('translate(0,1px) scaleY(.96)', 6), p('translate(0,0) scaleY(.99)', 1),
        p('translate(0,-1px) scaleY(1)', 2), p('translate(0,1px) scaleY(.96)', 1),
        p('translate(0,3px) scaleY(.92)', 7), p('translate(0,2px) scaleY(.94)', 2) ] },
      // 筐在被顶的那一拍抬起一格，然后砸回来还多沉一格。
      // 「顶了，没用」这句话由筐说，不由角色说。
      //
      // 这里试过让筐绕远端翘 -3°（更像被顶起的重物），算下来筐口在脸那一段
      // 会抬到 y10.3——眼睛底边正好是 y10，余量不到 1px，crispEdges 下够不着
      // 也够得着。翘一下不值这个风险，改成纯位移：筐口最高 y10，永远只是贴着。
      { sel: '.crate', name: 'error-c3-crate', poses: [
        p('translate(0,0)', 6), p('translate(0,-1px)', 3),
        p('translate(0,1px)', 1), p('translate(0,0)', 7),
        p('translate(1px,0)', 2) ] },
      // 爪搭在筐沿上，不使劲。搭着和撑着的区别全在这里：没有向外的推。
      { sel: '.left-claw', name: 'error-c3-left', period: 3700, poses: [
        p('translate(0,1px)', 7), p('translate(0,2px)', 2), p('translate(-1px,1px)', 1),
        p('translate(0,2px)', 4) ] },
      { sel: '.right-claw', name: 'error-c3-right', period: 4300, poses: [
        p('translate(0,1px)', 8), p('translate(0,2px)', 3), p('translate(0,1px)', 2),
        p('translate(1px,2px)', 1) ] },
      // 平视前方，只在「顶」的那一下往上瞟一眼。之后不再往上看。
      { sel: '.eyes', name: 'error-c3-eyes', period: 3100, poses: [
        p('translate(0,0)', 8), p('translate(0,-1px)', 2), p('translate(0,0)', 3),
        p('translate(0,1px)', 4) ] },
      // 完整的慢眨，不是半闭。认命不是困——半闭眼会读成 away。
      { sel: '.blink', name: 'error-c3-blink', period: 5900, poses: [
        p('scaleY(1)', 11), p('scaleY(.15)', 2), p('scaleY(1)', 6) ] },
    ],
  },

  // ------------------------------------------------------------------ c4
  {
    action: 'error',
    id: 'error-c4',
    title: 'Losing Ground',
    axis: '循环结构 —— 从「挣脱↔被碰倒」的往复换成单向下滑，没有「站稳」这一拍',
    desc: '顺着一面墙往下滑。中间卡住过一次，但每一拍都比上一拍低，'
      + '一次都没有站回去。墙上的横档是不动的参照物，滑了多少一眼看得出。',
    duration: 4800,
    // 当前实现有一个「终于站稳了」的高点，然后被碰倒——那是「还有戏」。
    // 这个候选把那个高点删掉：全程只有下滑的**速率**在变，方向从不反转。
    // 唯一一次向上是循环接缝，而接缝被安排在最后那一拍最快的位置上，
    // 快动作能盖住跳变；读出来是「又被拖回去重来一次」。
    props: '<g class="wall"><rect x="14" y="-9" width="11" height="26" fill="#8C7A5E"/>'
      + '<rect x="14" y="-9" width="2" height="26" fill="#6E5F49"/>'
      + '<rect x="16" y="-6" width="9" height="1" fill="#A08C6C"/>'
      + '<rect x="16" y="0" width="9" height="1" fill="#A08C6C"/>'
      + '<rect x="16" y="6" width="9" height="1" fill="#A08C6C"/>'
      + '<rect x="16" y="12" width="9" height="1" fill="#A08C6C"/></g>'
      + '<g class="grit motion"><rect x="16" y="2" width="1" height="1" fill="#A08C6C"/></g>',
    layers: [
      // -4 → -3 → -1 → 0 → 1 → 3：单调不增。快滑（1 拍）与卡住（4 拍）
      // 交替，速率变化才是这个动作全部的节奏来源。
      { sel: '.actor', name: 'error-c4-body', poses: [
        p('translate(0,-4px)', 5), p('translate(0,-3px)', 1), p('translate(0,-1px)', 1),
        p('translate(0,0) scaleY(.98)', 4), p('translate(0,1px) scaleY(.96)', 1),
        p('translate(0,3px) scaleY(.92)', 3), p('translate(0,2px) scaleY(.94)', 1) ] },
      // 从墙上刮下来的碎屑。它自己的周期比整体快一倍多，
      // 于是「一直在掉东西」不会和身体的下滑对齐成一个节拍。
      { sel: '.grit', name: 'error-c4-grit', period: 2300, poses: [
        p('opacity:0;transform:translate(0,0)', 5), p('opacity:1;transform:translate(0,3px)', 1),
        p('opacity:1;transform:translate(-1px,7px)', 1),
        p('opacity:0;transform:translate(-1px,10px)', 3) ] },
      // 左爪被身体带着往下，抓的是空气——所以只有纵向，没有横向的够。
      { sel: '.left-claw', name: 'error-c4-left', poses: [
        p('translate(0,-3px)', 5), p('translate(0,-2px)', 1), p('translate(0,0)', 1),
        p('translate(0,1px)', 4), p('translate(0,2px)', 1), p('translate(0,4px)', 3),
        p('translate(0,3px)', 1) ] },
      // 右爪在墙上急抓，周期 1700——全动作最快的一层。
      // 抓得越急、滑得越稳，那个反差才是「抓不住」。
      { sel: '.right-claw', name: 'error-c4-right', period: 1700, poses: [
        p('translate(1px,-1px)', 3), p('translate(2px,1px)', 1), p('translate(1px,2px)', 2),
        p('translate(2px,0)', 1) ] },
      // 眼睛朝上——看着自己刚才还在的高度。视线方向是这个候选的落点。
      { sel: '.eyes', name: 'error-c4-eyes', period: 3100, poses: [
        p('translate(0,-1px)', 6), p('translate(0,0)', 1), p('translate(0,-1px)', 3),
        p('translate(1px,0)', 4) ] },
      { sel: '.blink', name: 'error-c4-blink', period: 4300, poses: [
        p('scaleY(1)', 8), p('scaleY(.15)', 1), p('scaleY(1)', 4) ] },
    ],
  },

  // ------------------------------------------------------------------ c5
  {
    action: 'error',
    id: 'error-c5',
    title: 'Under the Pile',
    axis: '构图 —— 从「角色是主体」换成「障碍物是主体」，角色被淹没',
    desc: '塌下来的一堆东西埋掉了整个身子，只剩一条露着眼睛的横带和一只搭在外面的爪。'
      + '画面主体是那堆东西；角色只是从里面露出来的一小块。',
    duration: 4800,
    // 堆画在角色**身前**才能盖住身体。三段式留出中间那条缝，
    // 眼睛（x4..11 / y8..10）在缝里，任何一拍都不被盖——
    // 这条缝是这个构图唯一不能动的东西，所以三边都按**动到极限**的位置算：
    // 眼睛自己最多左右各偏 1，两侧的堆因此收到 x≤2 与 x≥13，各留 1 格；
    // 中间的堆顶最高涨到 y12.76（scaleY 1.03 绕 y21），而身体沉到最低时
    // 眼睛底边是 y11.4，留 1.36 格。为了守住下面这条，身体不做横向位移——
    // 被埋着的东西不会左右挪，去掉它同时也把余量还给了缝。
    propsAfter: '<g class="pile motion">'
      + '<rect x="-13" y="9" width="15" height="12" fill="#B9A1D9"/>'
      + '<rect x="13" y="9" width="16" height="12" fill="#B9A1D9"/>'
      + '<rect x="3" y="13" width="9" height="8" fill="#B9A1D9"/>'
      + '<rect x="-10" y="11" width="5" height="1" fill="#E7DCF2"/>'
      + '<rect x="5" y="16" width="5" height="1" fill="#E7DCF2"/>'
      + '<rect x="15" y="10" width="6" height="1" fill="#E7DCF2"/>'
      + '<rect x="-6" y="15" width="4" height="1" fill="#E7DCF2"/></g>'
      + '<g class="debris motion">'
      + '<rect x="17" y="2" width="7" height="2" fill="#8B73B3"/>'
      + '<rect x="15" y="4" width="7" height="2" fill="#8B73B3"/>'
      + '<rect x="13" y="6" width="7" height="2" fill="#8B73B3"/>'
      + '<rect x="-13" y="4" width="4" height="5" fill="#8B73B3"/></g>'
      + '<g class="out-claw motion"><rect x="-2" y="8" width="3" height="2" fill="#DE886D"/></g>',
    layers: [
      // 角色几乎不动——它是被压住的。可动的只有纵向压缩，绕 `.actor` 默认的
      // 7.5px 15px（脚）收，所以下沉全部发生在缝的余量之内。
      { sel: '.actor', name: 'error-c5-body', poses: [
        p('translate(0,1px) scaleY(.97)', 6), p('translate(0,1px) scaleY(.94)', 2),
        p('translate(0,1px) scaleY(.96)', 1), p('translate(0,1px) scaleY(.92)', 5),
        p('translate(0,0) scaleY(.95)', 1), p('translate(0,1px) scaleY(.93)', 2) ] },
      // 堆才是主角，所以它的运动幅度比角色大：还在往下坐、还在微塌。
      { sel: '.pile', name: 'error-c5-pile', origin: '7.5px 21px', poses: [
        p('scaleY(1)', 5), p('scaleY(1.03) translate(-1px,0)', 1), p('scaleY(.97) translateY(1px)', 4),
        p('scaleY(1.01) translate(1px,0)', 1), p('scaleY(.96) translateY(1px)', 5),
        p('scaleY(.99)', 2) ] },
      // 塌下来的残骸，比堆晚一步安定——余震让「刚刚才塌」成立。
      { sel: '.debris', name: 'error-c5-debris', period: 3700, origin: '13px 9px', poses: [
        p('translate(0,0)', 7), p('translate(0,1px)', 1), p('translate(-1px,1px)', 2),
        p('translate(0,1px)', 5) ] },
      // 露在堆外的那只爪。全画面唯一的生命迹象，所以它必须小到几乎看不见。
      // **权重与身体逐拍相同、不给 period**：它是身体的一部分，而道具组是
      // `.actor` 的兄弟节点、不继承身体位移，不逐拍抄一遍身体的下沉，
      // 身体往下坐的时候这只爪会留在原地。抽动是叠在那份下沉之上的。
      { sel: '.out-claw', name: 'error-c5-claw', poses: [
        p('translate(0,1px)', 6), p('translate(0,0)', 2), p('translate(1px,1px)', 1),
        p('translate(0,1px)', 5), p('translate(0,0)', 1), p('translate(-1px,1px)', 2) ] },
      // 视线朝上，看着塌下来的方向。整个角色只剩眼睛在说话，
      // 所以眼睛是六个候选里动得最多的一层。
      { sel: '.eyes', name: 'error-c5-eyes', period: 3100, poses: [
        p('translate(0,-1px)', 6), p('translate(-1px,-1px)', 2), p('translate(0,0)', 3),
        p('translate(1px,-1px)', 4) ] },
      { sel: '.blink', name: 'error-c5-blink', period: 5300, poses: [
        p('scaleY(1)', 10), p('scaleY(.15)', 1), p('scaleY(1)', 3),
        p('scaleY(.15)', 1), p('scaleY(1)', 2) ] },
    ],
  },

  // ------------------------------------------------------------------ c6
  {
    action: 'error',
    id: 'error-c6',
    title: 'Wrong Way Up',
    axis: '朝向 —— 从「正面站立」换成「翻倒」，整个角色转了 90°',
    desc: '被地上翘起的一块板绊翻，横躺着。蹬两下没翻回来，就不蹬了。'
      + '翻不过身的乌龟——困住了但完全没死，这个基调最直白的一版。',
    duration: 4800,
    // **这里的 rotate(-90deg) 不违反「躯干不许长期倾斜」。**
    // 那条禁的是小角度斜切：crispEdges 下矩形边落在斜线上，渲染成锯齿平行四边形。
    // 90° 的整数倍是轴对齐的，矩形转过去还是矩形，一个锯齿都不产生。
    // 支点取 8px 12px（整数），所有角点的位移量都是整数，转完仍然落在栅格上
    // （逐拍验算过，六个部件的包围盒全是整数）：躯干 → x1..8 / y3..14，
    // 两只眼睛叠成一竖排 x3..5，四条腿成了朝右戳出的四个短桩，
    // 左爪转到最下面（原来它在躯干左侧探出 2 格），整只角色是**撑在那只爪上**的。
    //
    // 所以落地高度按左爪算而不是按躯干算：translate 的 y 只用 -4（爪底 y16，
    // 坐在地面线上）和 -5（爪底 y15，蹬起来离地一格）。一开始按躯干算，
    // 结果爪子插进地板里两格。
    props: '<g class="floor"><rect x="-15" y="16" width="45" height="1" fill="#A08C6C"/>'
      + '<rect x="-15" y="17" width="45" height="3" fill="#8C7A5E"/></g>'
      + '<g class="lip"><rect x="-8" y="13" width="6" height="3" fill="#6E5F49"/>'
      + '<rect x="-8" y="13" width="6" height="1" fill="#A08C6C"/></g>',
    layers: [
      // 蹬两下、掉回去、反而往边上滑了一格。两下之后就没有第三下——
      // 「不蹬了」是这个动作的落点，也是它能长时间挂着不烦人的原因。
      // 尾拍只离地一格，接缝的跳变因此只有 1 格。
      { sel: '.actor', name: 'error-c6-body', origin: '8px 12px', poses: [
        p('translate(-1px,-4px) rotate(-90deg)', 6), p('translate(0,-5px) rotate(-90deg)', 1),
        p('translate(-1px,-4px) rotate(-90deg)', 1), p('translate(0,-5px) rotate(-90deg)', 1),
        p('translate(-2px,-4px) rotate(-90deg)', 5), p('translate(-1px,-5px) rotate(-90deg)', 2) ] },
      // 爪在转过去的坐标系里动：只走本地纵轴（贴着躯干那条边），
      // 不走本地横轴——横着伸出去照样会脱开躯干，转了 90° 也一样。
      { sel: '.left-claw', name: 'error-c6-left', period: 2300, poses: [
        p('translate(0,-1px)', 4), p('translate(0,-3px)', 1), p('translate(0,-2px)', 2),
        p('translate(0,0)', 3) ] },
      { sel: '.right-claw', name: 'error-c6-right', period: 2900, poses: [
        p('translate(0,1px)', 3), p('translate(0,3px)', 1), p('translate(0,2px)', 2),
        p('translate(0,0)', 4) ] },
      { sel: '.eyes', name: 'error-c6-eyes', period: 3100, poses: [
        p('translate(0,0)', 6), p('translate(1px,0)', 2), p('translate(0,1px)', 3),
        p('translate(-1px,0)', 4) ] },
      // 眨眼跟着转：本地 scaleY 压的是眼睛的长边，转过去正好是屏幕上的横向，
      // 也就是躺着时眼皮该合的方向。这一层不需要改，转了自然就对。
      { sel: '.blink', name: 'error-c6-blink', period: 4700, poses: [
        p('scaleY(1)', 9), p('scaleY(.15)', 1), p('scaleY(1)', 5) ] },
    ],
  },
];
