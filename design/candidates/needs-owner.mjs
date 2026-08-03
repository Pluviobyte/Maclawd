/**
 * needs_owner 的六个候选。
 *
 * 这个动作的设计问题和别的动作不一样。它是全项目优先级最高的状态：
 * 它出现时 Claude 卡住了、在等批准或回答，**你不看它，事情就停在那**。
 * 所以它必须在余光里就能被注意到。
 *
 * 但它同时可能持续几分钟（你去倒咖啡了）。一个几分钟不停的高频闪动
 * 会让人想把桌宠关掉。所以真正的设计问题只有一个：
 *
 *   **怎么在不烦人的前提下被余光捕捉到。**
 *
 * 余光（周边视野）的三个事实决定了这六个候选怎么分：
 *
 *   1. 余光对**剪影**和**大幅位移**敏感，对细节和颜色不敏感。
 *      眼睛动、爪子抖这些在余光里等于不存在——它们是「你已经看过来之后」
 *      才起作用的层次。所以「视线」那条轴天生解决不了余光问题（见 c6）。
 *
 *   2. 余光抓的是**突变**，不是持续运动。持续均匀的小动作会被习惯化，
 *      几十秒后就等于背景。「安静很久 + 偶尔一次明显动作」在两个指标上
 *      同时赢：单次事件更显眼，总打扰量更低（见 c2）。
 *
 *   3. **形状本身变了**比**东西在动**更耐久。举高的罐子、举起的爪、
 *      塌下去的身体——这些即使停住也在持续传递信息，
 *      你随便一瞥就能读到，不需要正好赶上它动的那一瞬间（见 c1 / c3 / c5）。
 *
 * 六个候选各换掉一条轴，其余尽量保持基线（Stuck Jar：身侧一个罐子、
 * 拧两次拧不开、使劲、把罐子推给你）。上一轮 working 候选栽在
 * 「只换道具、姿态语汇全一样」，这里反过来做：**大多数候选保留罐子**，
 * 换的是求助方式 / 节奏 / 朝向 / 进度 / 视线这些更底层的东西。
 *
 * ── 几何备忘（这几条是踩出来的，改之前先看 README）──────────────────
 *
 *   躯干 x2-13 y6-13，眼睛 x4/x10 y8-10，爪 左 x0-2 右 x13-15 y9-11，腿 y13-15。
 *
 *   · **爪子只有落在躯干轮廓之外才看得见。** 躯干和爪同色，爪挪到
 *     x2-13 且 y6-13 的范围里就整块消失。可读的位置只有三种：
 *     身体两侧（x<2 / x>13）、头顶之上（y<6）、腿的高度之下（y>13）。
 *     具体到数值：爪自己的 **x 位移只有 0 是完全可见的**，
 *     ±1 还剩一半，超过就要么被躯干吃掉、要么脱离成断肢。
 *     所以「身体在两侧的动作」基本只能靠 y 做，除非那个方向上有道具。
 *     写完之后一定要**把合成后的位置算出来看**：身体自己也在位移，
 *     爪是它的子节点，两个位移叠起来才是屏幕上的位置——
 *     这六个候选里有三个是这么发现爪子不见了的。
 *     c3 是纯姿态候选，这条对它是生死线。
 *
 *   · **爪子往外挪会脱离躯干**（左爪往左、右爪往右）。只有那个方向上
 *     确实有道具时才成立——那时读作「伸手去够」，没有时只读成断肢。
 *
 *   · **`.actor` 的支点已经在脚下**（样式表里 `.actor { transform-origin: 7.5px 15px }`），
 *     所以 scaleY(s) 之后头顶落在 `15 - 9s`，脚不动。「垮掉」就是把 s 调小，
 *     不需要再拿 translateY 去补偿，更不需要旋转躯干
 *     （crispEdges 下倾斜的躯干会渲染成锯齿平行四边形）。
 *
 *   · **道具不许遮住 x4 / x10、y8-10 的眼睛。** 这条和上面那条一起，
 *     把 c1 的罐子夹在一条很窄的缝里：罐底再低一格，抓着它的爪就缩进
 *     躯干里没了；再高一格，手就够不着。所以「举累了往下沉」这个
 *     最自然的动作在这里做不了，c1 的「撑不住」改成了
 *     「身体往下坠、手还钉在罐子上」。
 *
 *   · **首尾姿态「不一样」不等于接缝不停顿。** 差 1px 的两个姿势在屏幕上
 *     是同一个画面，而首尾往往正好是两个长停——加起来能有 40% 的循环
 *     卡在一个姿势上。c1 和 c4 第一版都栽在这里（首尾各差一格，
 *     跨接缝连成一秒七的静止）。判据要用**合成后的位移量**，不是字符串比较。
 */

/** 缩写：造一串姿态，[transform, 权重]。权重省略时为 1。 */
const p = (transform, weight = 1) => [transform, weight];

/** 基线罐子：身侧偏左，x-8..0 / y6..18。c4 c5 c6 三个候选原样沿用。 */
const SIDE_JAR =
  '<g class="jar motion"><g class="lid motion">'
  + '<rect x="-8" y="7" width="8" height="2" fill="#544942"/>'
  + '<rect x="-7" y="6" width="6" height="1" fill="#7A6A60"/></g>'
  + '<path d="M-8 9H0V17H-1V18H-7V17H-8Z" fill="#BDE7E4"/>'
  + '<rect x="-7" y="10" width="1" height="5" fill="#FFF"/>'
  + '<rect x="-6" y="13" width="4" height="3" fill="#F4D3E7"/>'
  + '<rect x="-5" y="15" width="3" height="1" fill="#C98FBA"/></g>';

export const CANDIDATES = [
  // ------------------------------------------------------------------ c1
  {
    action: 'needs_owner',
    id: 'needs-owner-c1',
    title: 'Held High',
    axis: '求助的方式 —— 从「推给你」换成「举着等你来拿」',
    desc: '双爪把罐子整个举过头顶，撑住不放；撑久了手发抖、腿打颤、'
      + '重心左右晃，然后深吸一口气再顶高一格。基线是把东西推开，'
      + '这个是把东西**举着不放**——推完就没事了，举着是持续的请求。'
      + '余光里读到的是**剪影长高了一大截**（头顶多出 13 个单位的方块），'
      + '而且这个变化在它不动的时候也一直在。'
      + '道具环没换：罐子还在，owner_resolved（Jar Click）可以原样接上，'
      + '接的是「你把它接过去、盖子咔哒松开」。'
      + '注意「举累了往下沉」在这里做不了：爪子一落到躯干轮廓里就整块消失'
      + '（同色），罐底再往下就压到眼睛。所以「撑不住」只能靠发抖和'
      + '**身体往下坠而手还钉在原处**表达——这是几何逼出来的，不是选择，'
      + '但坠出来的那两格间隙反而比下沉更像脱力。',
    duration: 4800,
    // 罐子画在角色**身后**，爪子才会压在罐身上读作「抓着」。
    // 罐身 y-5..5：下沿必须停在 y5，那正好是躯干顶（举高一格之后）——
    // 再低一点爪子就整块缩进同色的躯干里看不见了，再高一点手就够不着罐子。
    // 眼睛在 y8，还剩三格余量。
    props: '<g class="jar motion"><g class="lid motion">'
      + '<rect x="3" y="-7" width="10" height="2" fill="#544942"/>'
      + '<rect x="4" y="-8" width="8" height="1" fill="#7A6A60"/></g>'
      + '<rect x="4" y="-5" width="8" height="10" fill="#BDE7E4"/>'
      + '<rect x="5" y="-4" width="1" height="7" fill="#FFF"/>'
      + '<rect x="6" y="0" width="4" height="4" fill="#F4D3E7"/>'
      + '<rect x="7" y="3" width="3" height="1" fill="#C98FBA"/></g>',
    splitLegs: true,
    layers: [
      // 撑住（长）→ 一阵抖 → 沉下来喘口气 → 重新顶上去（极端，停）。
      // 全程纯位移，不动 scaleY：身体一压缩，爪就跟着下来，罐子会压到眼睛。
      { sel: '.actor', name: 'ask-c1-body', poses: [
        p('translate(0,-1px)', 5), p('translate(1px,-1px)', 1), p('translate(-1px,-1px)', 1),
        p('translate(1px,0)', 1), p('translate(-1px,0)', 1), p('translate(0,1px)', 3),
        p('translate(0,-1px)', 1), p('translate(0,-2px)', 3), p('translate(0,-1px)', 1),
        // 收尾停在**顶高之后**而不是回到起手的高度：起手是 -1，这里是 -2，
        // 跨接缝时高度和横向各差一格。差 1px 的首尾在接缝处会连成
        // 一段一秒多的静止，那正是重做 working 时踩过的坑。
        p('translate(1px,-2px)', 2) ] },
      // 爪的 y 值把身体的 y 逐帧抵消掉（净值恒为 -6，顶那一拍是 -8），
      // 于是身体再怎么坠，手都钉在罐子上 y3-5：躯干顶在 y5，爪底也在 y5，
      // 正好紧贴而不重叠——差一格就整块看不见了。
      // 「东西不动、人在抖」比反过来更像在撑。
      { sel: '.left-claw', name: 'ask-c1-left', poses: [
        p('translate(3px,-5px)', 5), p('translate(2px,-5px)', 1), p('translate(4px,-5px)', 1),
        p('translate(2px,-6px)', 1), p('translate(4px,-6px)', 1), p('translate(3px,-7px)', 3),
        p('translate(3px,-5px)', 1), p('translate(3px,-6px)', 3), p('translate(3px,-5px)', 1),
        p('translate(2px,-4px)', 2) ] },
      { sel: '.right-claw', name: 'ask-c1-right', poses: [
        p('translate(-3px,-5px)', 5), p('translate(-4px,-5px)', 1), p('translate(-2px,-5px)', 1),
        p('translate(-4px,-6px)', 1), p('translate(-2px,-6px)', 1), p('translate(-3px,-7px)', 3),
        p('translate(-3px,-5px)', 1), p('translate(-3px,-6px)', 3), p('translate(-3px,-5px)', 1),
        p('translate(-4px,-4px)', 2) ] },
      // 罐子自己晃：手是稳的，晃的是重物——这才读作「快撑不住了」。
      // 顶那一拍跟着爪子上去两格（净 -8），罐底到 y3，离眼睛还有五格。
      { sel: '.jar', name: 'ask-c1-jar', origin: '8px 5px', poses: [
        p('rotate(-3deg)', 5), p('translate(1px,0) rotate(4deg)', 1),
        p('translate(-1px,0) rotate(-5deg)', 1), p('translate(1px,0) rotate(3deg)', 1),
        p('translate(-1px,0) rotate(-4deg)', 1), p('rotate(1deg)', 3), p('rotate(-2deg)', 1),
        p('translate(0,-2px) rotate(0)', 3), p('rotate(-1deg)', 1), p('rotate(-3deg)', 2) ] },
      { sel: '.lid', name: 'ask-c1-lid', origin: '8px -5px', period: 1600, poses: [
        p('rotate(-1deg)', 3), p('rotate(1deg)', 1), p('translate(0,-1px) rotate(0)', 1),
        p('rotate(1deg)', 2) ] },
      // 腿打颤：四条各走各的快周期，读作「撑得很吃力」而不是「在走路」
      { sel: '.leg-a', name: 'ask-c1-leg-a', period: 900, poses: [
        p('translateY(0)', 3), p('translateY(-1px)', 1) ] },
      { sel: '.leg-b', name: 'ask-c1-leg-b', period: 1100, poses: [
        p('translateY(0)', 4), p('translateY(-1px)', 1) ] },
      { sel: '.leg-c', name: 'ask-c1-leg-c', period: 800, poses: [
        p('translateY(-1px)', 1), p('translateY(0)', 3) ] },
      { sel: '.leg-d', name: 'ask-c1-leg-d', period: 1300, poses: [
        p('translateY(0)', 5), p('translateY(-1px)', 1) ] },
      // 抬头盯着罐子，偶尔看你一眼——「你看见了吗」
      { sel: '.eyes', name: 'ask-c1-eyes', period: 3100, poses: [
        p('translate(0,-1px)', 5), p('translate(0,0)', 2), p('translate(0,-1px)', 3),
        p('translate(0,1px)', 2) ] },
      { sel: '.blink', name: 'ask-c1-blink', period: 5300, poses: [
        p('scaleY(1)', 9), p('scaleY(.15)', 1), p('scaleY(1)', 4) ] },
    ],
  },

  // ------------------------------------------------------------------ c2
  {
    action: 'needs_owner',
    id: 'needs-owner-c2',
    title: 'One Shove',
    axis: '节奏 —— 从「持续挣扎」换成「安静很久 + 一次明显动作」',
    desc: '罐子已经推到你面前的地上，桌宠前倾着、手搭在盖子上、盯着你——'
      + '**这个姿势保持三分之二个循环**，其间只有呼吸和眼睛在动；'
      + '然后整身前扑一下，把罐子再往你那边顶一格，罐子晃两下没走远，'
      + '它退回原来那个姿势继续等。'
      + '这是六个里唯一为「长时间等待」专门做的：单次事件反而更显眼'
      + '（余光抓的是突变，不是持续运动），而每 4.8 秒只打扰你一次，'
      + '总打扰量比基线低一个量级。**几分钟不关掉它的前提就是这个。**'
      + '静止那段停在「递出去等着」的姿势上（前倾 2 格、手在盖子上），'
      + '不是中立姿势——你随时瞥一眼都读得到它在等。'
      + '道具环没换，owner_resolved 原样可用，只是罐子的落点从身侧挪到了右前方，'
      + 'Jar Click 的罐子位置要跟着挪，否则接上去罐子会瞬移。'
      + '（4800ms 下静默占 3.4s。这条轴本来还想要更长的静默，'
      + '但那要改契约时长，先按 4800 给保守版。）',
    duration: 4800,
    // 罐子在右前方地上（右 = 主人的方向，沿用基线里「往右推」的读法）。
    // 盖子 y7-10 落在眼睛的高度上，但 x14 起，离 x10 的右眼还有三格。
    props: '<g class="jar motion"><g class="lid motion">'
      + '<rect x="14" y="8" width="10" height="2" fill="#544942"/>'
      + '<rect x="15" y="7" width="8" height="1" fill="#7A6A60"/></g>'
      + '<rect x="15" y="10" width="8" height="8" fill="#BDE7E4"/>'
      + '<rect x="16" y="11" width="1" height="5" fill="#FFF"/>'
      + '<rect x="17" y="14" width="4" height="3" fill="#F4D3E7"/>'
      + '<rect x="18" y="16" width="3" height="1" fill="#C98FBA"/></g>',
    layers: [
      // 前两拍加起来占 48%，都是同一个「递出去」的姿势（差一格呼吸）；
      // 第四、五拍是那一下前扑，加起来只有 14%。这个对比就是全部。
      { sel: '.actor', name: 'ask-c2-body', poses: [
        p('translate(2px,1px) scaleY(.96)', 6), p('translate(2px,0) scaleY(.98)', 4),
        p('translate(1px,1px) scaleY(.92)', 3), p('translate(4px,0) scaleY(1.04)', 2),
        p('translate(5px,1px)', 1), p('translate(3px,1px) scaleY(.98)', 2),
        p('translate(2px,0) scaleY(1.02)', 3) ] },
      { sel: '.right-claw', name: 'ask-c2-right', poses: [
        p('translate(1px,-1px)', 6), p('translate(1px,-2px)', 4), p('translate(0,1px)', 3),
        p('translate(3px,-1px)', 2), p('translate(4px,0)', 1), p('translate(2px,-1px)', 2),
        p('translate(1px,0)', 3) ] },
      // 左爪那一侧什么都没有，所以幅度被夹在 -1..+1：
      // 往右超过 1 格就整只缩进同色的躯干里，往左超过 1 格就成了断肢。
      // 表情只能靠 y 做。前扑那一格甩到 -1 是唯一的例外，
      // 一帧（4.8%）而且正在高速位移，读作甩臂不是脱落。
      { sel: '.left-claw', name: 'ask-c2-left', poses: [
        p('translate(0,1px)', 6), p('translate(0,2px)', 4), p('translate(1px,2px)', 3),
        p('translate(0,-1px)', 2), p('translate(-1px,0)', 1), p('translate(0,1px)', 2),
        p('translate(1px,2px)', 3) ] },
      // 罐子被顶出去两格又晃回来：一个循环下来净位移为零，
      // 不然循环接缝处罐子会往回瞬移一大截
      { sel: '.jar', name: 'ask-c2-jar', origin: '19px 18px', poses: [
        p('rotate(2deg)', 6), p('rotate(1deg)', 4), p('rotate(2deg)', 3),
        p('translate(2px,0) rotate(6deg)', 2), p('translate(3px,0) rotate(8deg)', 1),
        p('translate(2px,0) rotate(4deg)', 2), p('rotate(3deg)', 3) ] },
      { sel: '.lid', name: 'ask-c2-lid', origin: '19px 9px', period: 2600, poses: [
        p('rotate(0)', 6), p('rotate(-2deg)', 1), p('rotate(1deg)', 1), p('rotate(0)', 3) ] },
      // 静止那段全靠眼睛撑着「还活着」。周期 3700 与身体错开，
      // 于是永远有东西在变，但变的是余光看不见的那一层——正是想要的。
      { sel: '.eyes', name: 'ask-c2-eyes', period: 3700, poses: [
        p('translate(1px,0)', 5), p('translate(1px,1px)', 1), p('translate(1px,0)', 3),
        p('translate(0,0)', 2), p('translate(1px,0)', 2), p('translate(2px,0)', 1),
        p('translate(1px,0)', 3), p('translate(1px,1px)', 1) ] },
      // 等的时候人不怎么眨眼
      { sel: '.blink', name: 'ask-c2-blink', period: 5900, poses: [
        p('scaleY(1)', 12), p('scaleY(.15)', 1), p('scaleY(1)', 5) ] },
    ],
  },

  // ------------------------------------------------------------------ c3
  {
    action: 'needs_owner',
    id: 'needs-owner-c3',
    title: 'Empty Claws',
    axis: '有无道具 —— 把罐子整个拿掉，只剩身体本身',
    desc: '没有任何道具。桌宠反复把身体拔高、双爪举到头顶两侧摊开，'
      + '再整个缩回去；举起来的时候身高从 7.7 个单位涨到 10 个，'
      + '**剪影每两秒吞吐一次**。'
      + '拿掉道具反而让语义更准：它手里什么都没有，它自己解决不了——'
      + '这正是 needs_owner 的意思。基线的罐子把「卡住」演成了一件具体的事，'
      + '而 Claude 卡住通常没有对应的实物。'
      + '和 success（Self High-five）的区别是双爪**分开摊着**不是碰到一起，'
      + '而且是循环不是一次性起跳。'
      + '**收尾必须另配：**它不开道具环，所以 owner_resolved 也得是纯姿态的——'
      + '双爪落回身侧、身体一口气松下来（scaleY 从 1.1 落回 1.0）、一次快眨眼。'
      + '现有的 Jar Click 在这个候选下用不上，硬接会凭空冒出一个罐子。',
    duration: 4800,
    layers: [
      // 支点在脚下，所以 scaleY 就是身高：头顶 = 15 - 9s。
      // .86 → 头顶 7.3；1.12 → 头顶 4.9。加上 translateY，一个循环的
      // 剪影高度从 7.3 走到 2.9，四格多的吞吐。
      { sel: '.actor', name: 'ask-c3-body', poses: [
        p('translate(0,2px) scaleY(.86)', 3), p('translate(0,1px) scaleY(.96)', 1),
        p('translate(0,-1px) scaleY(1.08)', 1), p('translate(0,-2px) scaleY(1.12)', 3),
        p('translate(1px,-2px) scaleY(1.10)', 1), p('translate(-1px,-1px) scaleY(1.06)', 1),
        p('translate(0,2px) scaleY(.88)', 3), p('translate(0,-1px) scaleY(1.04)', 1),
        p('translate(0,-2px) scaleY(1.10)', 2) ] },
      // 两个位置都必须在躯干轮廓之外，否则爪子直接消失：
      // 举起来 → y3-5（头顶之上），垂下去 → x0-2（身体左侧）。
      // 中间那些过渡帧确实会被躯干吃掉一两帧，但那反而像「甩上去」。
      { sel: '.left-claw', name: 'ask-c3-left', poses: [
        p('translate(0,1px)', 3), p('translate(1px,0)', 1), p('translate(2px,-4px)', 1),
        p('translate(3px,-6px)', 3), p('translate(2px,-6px)', 1), p('translate(3px,-5px)', 1),
        p('translate(0,2px)', 3), p('translate(2px,-3px)', 1), p('translate(3px,-6px)', 2) ] },
      { sel: '.right-claw', name: 'ask-c3-right', poses: [
        p('translate(0,1px)', 3), p('translate(-1px,0)', 1), p('translate(-2px,-4px)', 1),
        p('translate(-3px,-6px)', 3), p('translate(-2px,-6px)', 1), p('translate(-3px,-5px)', 1),
        p('translate(0,2px)', 3), p('translate(-2px,-3px)', 1), p('translate(-3px,-6px)', 2) ] },
      { sel: '.eyes', name: 'ask-c3-eyes', period: 2900, poses: [
        p('translate(0,1px)', 5), p('translate(0,0)', 1), p('translate(0,-1px)', 2),
        p('translate(0,1px)', 3) ] },
      // 眨得比别处频：没有道具可以表达焦虑，只能挂在脸上
      { sel: '.blink', name: 'ask-c3-blink', period: 4100, poses: [
        p('scaleY(1)', 5), p('scaleY(.15)', 1), p('scaleY(1)', 3), p('scaleY(.15)', 1),
        p('scaleY(1)', 3) ] },
    ],
  },

  // ------------------------------------------------------------------ c4
  {
    action: 'needs_owner',
    id: 'needs-owner-c4',
    title: 'Turned Away',
    axis: '朝向 —— 从「一直正面演给你看」换成「转向问题那边，只偶尔回头看你」',
    desc: '大半个循环里它是**侧着的**：眼睛都偏到左边、右爪缩进身体后面看不见了、'
      + '左爪往左伸去够罐子却够不着；然后突然转回正面、站直、盯你一拍，再转回去。'
      + '罐子留在原位不动——它不是在跟你交涉，它是在跟问题较劲，'
      + '回头那一下才是冲你来的。'
      + '余光读到的是**剪影的左右不对称在翻转**（右边那块爪一会儿有一会儿没有），'
      + '这比单纯的位移更容易被注意到，因为轮廓的拓扑变了。'
      + '代价是眼睛必须和身体同拍——朝向是靠眼睛偏移读出来的，'
      + '让眼睛走自己的周期就散了。所以这个候选的活跃度全压在四条腿上（倒腾脚 = 焦躁）。'
      + '道具环没换，owner_resolved 原样可用。',
    duration: 4800,
    props: SIDE_JAR,
    splitLegs: true,
    layers: [
      // 收尾停在**正面**（x0）而不是半转回去：起手是 -2，尾是 0，
      // 接缝处横向差两格。此前尾是 -1，和起手只差一格，
      // 结果两头加起来 40% 的循环停在几乎同一个姿势上——
      // 那正是 working 旧版栽过的接缝停顿。
      { sel: '.actor', name: 'ask-c4-body', poses: [
        p('translate(-2px,1px) scaleY(.94)', 4), p('translate(-3px,2px) scaleY(.88)', 2),
        p('translate(-2px,1px) scaleY(.94)', 1), p('translate(0,1px) scaleY(.98)', 1),
        p('translate(1px,-2px) scaleY(1.12)', 3), p('translate(1px,-1px) scaleY(1.06)', 1),
        p('translate(0,1px) scaleY(.98)', 1), p('translate(0,0) scaleY(1.02)', 2) ] },
      // 右爪缩到 x11-13 就被同色的躯干吃掉了——「转过去了，看不见那只手」。
      // 转正那一拍它回到 x13-15 原位（不能再往右，往右就脱离躯干）。
      { sel: '.right-claw', name: 'ask-c4-right', poses: [
        p('translate(-2px,0)', 4), p('translate(-2px,1px)', 2), p('translate(-1px,0)', 1),
        p('translate(0,1px)', 1), p('translate(0,-1px)', 3), p('translate(0,0)', 1),
        p('translate(-1px,1px)', 1), p('translate(-2px,1px)', 2) ] },
      // 左爪往左够罐子：那个方向上确实有东西，所以读作伸手而不是断肢
      { sel: '.left-claw', name: 'ask-c4-left', poses: [
        p('translate(-2px,0)', 4), p('translate(-3px,1px)', 2), p('translate(-2px,1px)', 1),
        p('translate(-1px,0)', 1), p('translate(0,-1px)', 3), p('translate(0,0)', 1),
        p('translate(-1px,0)', 1), p('translate(-2px,1px)', 2) ] },
      { sel: '.jar', name: 'ask-c4-jar', origin: '-4px 18px', poses: [
        p('rotate(-2deg)', 4), p('translate(-1px,0) rotate(-5deg)', 2), p('rotate(-3deg)', 1),
        p('rotate(-1deg)', 1), p('rotate(0)', 3), p('rotate(-1deg)', 1), p('rotate(-2deg)', 1),
        p('rotate(-3deg)', 2) ] },
      { sel: '.lid', name: 'ask-c4-lid', origin: '-4px 8px', period: 2600, poses: [
        p('rotate(0)', 5), p('rotate(-2deg)', 1), p('rotate(1deg)', 1), p('rotate(0)', 3) ] },
      // 这一层是整个候选的支点：眼睛偏到 x2/x8 就是「转过去了」，
      // 回到 x4/x10 就是「在看你」。必须和身体同拍。
      { sel: '.eyes', name: 'ask-c4-eyes', poses: [
        p('translate(-2px,0)', 4), p('translate(-2px,1px)', 2), p('translate(-1px,0)', 1),
        p('translate(0,0)', 1), p('translate(0,1px)', 3), p('translate(0,0)', 1),
        p('translate(-1px,0)', 1), p('translate(-2px,0)', 2) ] },
      { sel: '.blink', name: 'ask-c4-blink', period: 5500, poses: [
        p('scaleY(1)', 9), p('scaleY(.15)', 1), p('scaleY(1)', 4) ] },
      // 四条腿各走各的周期，小幅倒腾——站在那儿等人时脚不会老实
      { sel: '.leg-a', name: 'ask-c4-leg-a', period: 1900, poses: [
        p('translateY(0)', 6), p('translateY(-1px)', 1), p('translateY(0)', 3) ] },
      { sel: '.leg-b', name: 'ask-c4-leg-b', period: 2300, poses: [
        p('translateY(0)', 7), p('translateY(-1px)', 1), p('translateY(0)', 2) ] },
      { sel: '.leg-c', name: 'ask-c4-leg-c', period: 2100, poses: [
        p('translateY(0)', 5), p('translateY(-1px)', 1), p('translateY(0)', 4) ] },
      { sel: '.leg-d', name: 'ask-c4-leg-d', period: 1700, poses: [
        p('translateY(0)', 8), p('translateY(-1px)', 1), p('translateY(0)', 3) ] },
    ],
  },

  // ------------------------------------------------------------------ c5
  {
    action: 'needs_owner',
    id: 'needs-owner-c5',
    title: 'Slow Sink',
    axis: '进度 —— 从「原地重复」换成「越等越蔫」，循环里有单向的档位',
    desc: '一个循环分四档，每档之间是一次「咚」的塌陷：挺着 → 矮一截 → 再矮一截 → '
      + '整个趴到罐子上。头顶从 4.5 一路掉到 12，眼神跟着一档一档往下移，'
      + '最后半闭着看地。到底之后**很慢地重新提起一点劲**回到第一档——'
      + '不是弹回去，是「又攒了一点力气」，所以接缝处不突兀。'
      + '基线是原地重复，看十遍和看一遍一样；这个每一遍内部都有方向，'
      + '而且方向是「往下」——它不吵你，它是在你面前一点点垮掉，'
      + '这种「你不管我我就这样了」的读感比使劲挣扎更有说服力，也更不烦人。'
      + '三次塌陷是三个离散的突变，余光抓的正是这个；'
      + '而且塌下去之后的形状本身就在传递信息，不需要你正好赶上它动。'
      + '道具环没换，但收尾要多一拍：它是**趴着**的，'
      + 'owner_resolved 得先从趴着起身再拧盖（Jar Click 现在直接从站姿开始）。',
    duration: 4800,
    props: SIDE_JAR,
    layers: [
      // scaleY 就是身高（支点在脚下）：1.06 → 头顶 5.5，.56 → 头顶 10。
      // 每两个长停之间夹一个权重 1 的过渡帧，那一帧就是「咚」。
      // 躯干全程不旋转——crispEdges 下倾斜会渲染成锯齿平行四边形，
      // 「垮掉」只能靠下沉 + 纵向压缩。
      { sel: '.actor', name: 'ask-c5-body', poses: [
        p('translate(0,-1px) scaleY(1.06)', 3), p('translate(0,1px) scaleY(.94)', 1),
        p('translate(0,1px) scaleY(.86)', 4), p('translate(0,2px) scaleY(.74)', 1),
        p('translate(0,2px) scaleY(.70)', 4), p('translate(0,2px) scaleY(.60)', 1),
        p('translate(0,2px) scaleY(.56)', 3), p('translate(0,2px) scaleY(.72)', 1),
        p('translate(0,1px) scaleY(.88)', 1), p('translate(0,0) scaleY(.98)', 2) ] },
      // 左爪一档一档往罐子上垮，最后整只搭上去
      { sel: '.left-claw', name: 'ask-c5-left', poses: [
        p('translate(0,-1px)', 3), p('translate(-1px,0)', 1), p('translate(-2px,1px)', 4),
        p('translate(-2px,2px)', 1), p('translate(-3px,2px)', 4), p('translate(-3px,3px)', 1),
        p('translate(-4px,3px)', 3), p('translate(-3px,2px)', 1), p('translate(-2px,1px)', 1),
        p('translate(-1px,0)', 2) ] },
      // 右爪基本只在 y 上走，x 保持 0：往里挪一格就有一半缩进躯干里没了
      // （躯干被压扁之后横向没变，x13 那条边一直在）。只有「咚 3」那一帧
      // 往里收一格，作为塌陷的一个附加动作。
      { sel: '.right-claw', name: 'ask-c5-right', poses: [
        p('translate(0,-1px)', 3), p('translate(0,0)', 1), p('translate(0,1px)', 4),
        p('translate(0,2px)', 1), p('translate(0,3px)', 4), p('translate(-1px,3px)', 1),
        p('translate(0,4px)', 3), p('translate(0,3px)', 1), p('translate(0,2px)', 1),
        p('translate(0,1px)', 2) ] },
      // 罐子的拍子故意和身体错开一点：它是被靠上去的，不是同步动的
      { sel: '.jar', name: 'ask-c5-jar', origin: '-4px 18px', poses: [
        p('rotate(-1deg)', 8), p('rotate(-2deg)', 5), p('translate(0,1px) rotate(-4deg)', 4),
        p('rotate(-3deg)', 2), p('rotate(-2deg)', 2) ] },
      { sel: '.lid', name: 'ask-c5-lid', origin: '-4px 8px', period: 2900, poses: [
        p('rotate(0)', 5), p('rotate(-2deg)', 1), p('rotate(1deg)', 1), p('rotate(0)', 3) ] },
      // 视线跟着档位一档一档往下——「蔫」的读法主要在这里，不在身高。
      // 拍子落在身体的档位边界上（3/9/13/19），但**比塌陷早半拍**：
      // 眼神先垮，身体后垮，这个次序才像真的撑不住了。
      { sel: '.eyes', name: 'ask-c5-eyes', poses: [
        p('translate(0,0)', 3), p('translate(0,1px)', 6), p('translate(-1px,1px)', 4),
        p('translate(0,2px)', 6), p('translate(0,1px)', 2) ] },
      // 眨得又慢又重：闭上要走两级，睁开也要一级
      { sel: '.blink', name: 'ask-c5-blink', period: 5900, poses: [
        p('scaleY(1)', 7), p('scaleY(.4)', 1), p('scaleY(.15)', 2), p('scaleY(.5)', 1),
        p('scaleY(1)', 4) ] },
    ],
  },

  // ------------------------------------------------------------------ c6
  {
    action: 'needs_owner',
    id: 'needs-owner-c6',
    title: 'Locked Stare',
    axis: '视线 —— 从「眼睛一直在游移」换成「锁死不动，一个循环只慢慢眨一次」',
    desc: '它不跟罐子较劲了。罐子搁在身侧一动不动，桌宠正对着你站定，'
      + '**眼睛整整一个循环停在同一个位置**（一条只有一个姿态的图层），'
      + '身体只有极缓慢的一次重心来回，四千八百毫秒里慢慢眨一次眼，闭 0.6 秒。'
      + '这是六个里最不烦人的一个，可以挂几分钟不让人想关掉。'
      + '但要说实话：**这条轴解决不了余光问题。**余光看不见 3px 的眼睛，'
      + '它能提供的只是「你已经转过头之后」的存在感——'
      + '一只不眨眼盯着你的东西比一只在忙的东西更难移开视线。'
      + '它真正的余光信号是**由动到不动的反差**（从 working / thinking 切进来时，'
      + '动的东西突然停了，那一下是个突变），但那依赖前一个状态，单看循环读不出来。'
      + '所以它更适合当 c2 的第二段：先安静盯着，等久了再开始推。'
      + '道具环没换，owner_resolved 原样可用。'
      + '风险登记：完全不游移的眼睛容易被读成「动画卡住了」，'
      + '所以保留了那一次慢眨眼——去掉它更冷，但也更像程序挂了。',
    duration: 4800,
    props: SIDE_JAR,
    layers: [
      // 幅度全在 1-2 格之间，节奏很慢。全程偏向你那一侧（x 恒为正），
      // 不回中立位——「停住」也要停在一个有指向的姿势上。
      { sel: '.actor', name: 'ask-c6-body', poses: [
        p('translate(2px,1px)', 5), p('translate(2px,0)', 3), p('translate(1px,0)', 4),
        p('translate(1px,1px)', 2), p('translate(2px,2px)', 3), p('translate(1px,2px)', 1),
        p('translate(1px,0)', 2) ] },
      // 两只爪的 x 全程为 0：这个候选整体幅度极小，一旦把爪往里挪一格，
      // 它就有一半被同色躯干吃掉，剩下的半只在慢速里读作「缺了一块」。
      // 反正它现在什么都不做，手垂着不动才是对的。
      { sel: '.left-claw', name: 'ask-c6-left', period: 5300, poses: [
        p('translate(0,1px)', 6), p('translate(0,2px)', 2), p('translate(0,-1px)', 3) ] },
      { sel: '.right-claw', name: 'ask-c6-right', period: 4100, poses: [
        p('translate(0,1px)', 5), p('translate(0,2px)', 2), p('translate(0,-1px)', 3) ] },
      // 罐子几乎不动是刻意的：它已经放弃自己拧了，现在在等你
      { sel: '.jar', name: 'ask-c6-jar', origin: '-4px 18px', poses: [
        p('rotate(-1deg)', 8), p('rotate(0)', 1), p('rotate(-1deg)', 6) ] },
      // 只有一个姿态的图层：视线钉死。这是这个候选的全部主张。
      { sel: '.eyes', name: 'ask-c6-eyes', poses: [ p('translate(0,1px)', 1) ] },
      // 一个循环一次，闭上和睁开各走一级中间态 → 0.6 秒的慢眨
      { sel: '.blink', name: 'ask-c6-blink', poses: [
        p('scaleY(1)', 16), p('scaleY(.55)', 1), p('scaleY(.15)', 1), p('scaleY(.6)', 1),
        p('scaleY(1)', 5) ] },
    ],
  },
];
