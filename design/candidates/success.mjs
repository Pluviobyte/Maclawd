/**
 * success（完成）的手工候选。
 *
 * 现行实现是 Self High-five：2900ms，无道具，起跳、双爪在头顶碰到、落回。
 * 它是全产品**唯一的正反馈时刻**，而且触发条件很严——只有 end_turn 才播，
 * 所以它出现时是真的完成了。正因如此，它的难点不是「怎么庆祝」，
 * 而是**分寸**：一天跑几十轮，一个每次都夸张庆祝的桌宠会变成噪音。
 *
 * 三个与其它动作不同的前提，直接决定了这六个候选怎么写：
 *
 * 1. **它是 oneshot。** 播一次就回到底下的状态，没有接缝要接。
 *    所以 README 第 2 条「首尾姿态必须不同」对它不适用——反过来，
 *    **结束时回到中性姿态是优点**：接下去就是 idle，不回中性会硬切一下。
 *    其余硬约束（不等分、整数位移、不倾斜躯干、爪不外扩、道具不遮脸）全部照守。
 *
 * 2. **它可以有起承转合。** 循环态做不到的自由：最长的一拍可以是「停住」，
 *    而不必担心跨接缝连成一段静止。这里每一个候选都有一个明确的**重音拍**，
 *    而且六个的重音落点各不相同。
 *
 * 3. **收敛也是设计。** 六个里有三个（c1 / c4 / c6）比现行实现小得多。
 *    如果全是大动作，用户就只能在「吵」和「更吵」之间选。
 *
 * 六条轴，一人换一条（相对现行实现）：
 *
 *   c1  情绪基调  兴奋 → 如释重负。不跳，只把憋着的一口气放掉
 *   c2  道具      无道具 → 有交付物。端着的那块活放到身侧地上，空着爪结束
 *   c3  朝向      面向你 → 先转向刚才干活的那一侧确认，再转回来
 *   c4  身体部位  双爪过头顶 → 只用腿。四条腿轮踏收一记轻跺，爪子不参与
 *   c5  时间尺度  一个动作 → 一个完整小节：完成 → 回味 → 归位
 *   c6  幅度      起跳 → 一次点头。全身只有 1 格垂直位移
 *
 * 重复几十次之后仍然不烦人的是 **c6**，其次 c1——理由写在各自的注释里。
 */

/** 缩写：造一串姿态，[transform 或完整声明, 权重]。与 motion-poses.mjs 同一套约定。 */
const p = (transform, weight = 1) => [transform, weight];

export const CANDIDATES = [
  // ------------------------------------------------------------------ c1
  // 如释重负。整个动作只有一件事：把憋着的那口气放掉。
  //
  // 「泄下去」用下沉 + 纵向压缩表达（躯干不许倾斜，垮/松都只能这么写），
  // 最长的一拍落在**松到底**那一格——1/3 的时长停在那里，
  // 后面的回正反而分成两拍慢慢来。先塌后回，这个不对称就是「松口气」的读法；
  // 反过来（慢慢塌、突然回）读出来会是「被吓了一跳」。
  //
  // 那次**长眨眼**（.15 保持 500ms，是普通眨眼的四五倍）是这个候选的核心。
  // 慢眨眼在动物身上读作放松，快眨眼读作紧张，成本一样，读感完全相反。
  //
  // 它没有任何「给你看」的成分——不举爪、不面向你、不发出信号。
  // 所以它耐重复：你没在看的时候它也这么演，你看到的时候也不会被打断。
  {
    action: 'success',
    id: 'success-c1',
    title: 'Exhale',
    axis: '情绪基调 — 兴奋换成如释重负：不跳、不举爪，只把憋着的一口气放掉',
    desc: '绷着的身体停一拍，然后一口气泄下去——下沉加纵向压缩，配一次 500ms 的慢眨眼。不跳、不举爪，是「终于完了」不是「我做到了」。',
    duration: 2400,
    layers: [
      { sel: '.actor', name: 'success-c1-body', poses: [
        p('translate(0,-1px) scaleY(1.03)', 3), // 还绷着——起手就不是中性，对比才成立
        p('translate(0,0) scaleY(1)', 1),
        p('translate(0,2px) scaleY(.9)', 5),    // 一口气泄到底，停住（最长的一拍）
        p('translate(0,1px) scaleY(.95)', 1),
        p('translate(0,0) scaleY(1)', 3),       // 回正比塌下去慢，分两拍
        p('translate(0,-1px) scaleY(1.02)', 1), // 补吸一口
        p('translate(0,0) scaleY(1)', 2) ] },   // 收在中性——下一秒就是 idle
      { sel: '.left-claw', name: 'success-c1-left', poses: [
        p('translate(0,-1px)', 4), p('translate(1px,1px)', 1), p('translate(1px,2px)', 4),
        p('translate(0,1px)', 2), p('translate(0,0)', 3), p('translate(0,-1px)', 1),
        p('translate(0,0)', 2) ] },
      // 右爪与左爪权重不同（17 vs 16），落点整体错开——
      // 两只爪完全同拍会读成「机械臂」，差半格就活了
      { sel: '.right-claw', name: 'success-c1-right', poses: [
        p('translate(0,-1px)', 3), p('translate(-1px,1px)', 1), p('translate(-1px,2px)', 5),
        p('translate(0,2px)', 2), p('translate(0,0)', 3), p('translate(0,-1px)', 1),
        p('translate(0,0)', 2) ] },
      { sel: '.eyes', name: 'success-c1-eyes', poses: [
        p('translate(0,-1px)', 2),  // 还盯着刚才那件事
        p('translate(0,0)', 1), p('translate(0,1px)', 6), // 视线垂下来——松气时人不看人
        p('translate(-1px,0)', 2), p('translate(0,0)', 4) ] },
      { sel: '.blink', name: 'success-c1-blink', poses: [
        p('scaleY(1)', 4), p('scaleY(.15)', 3), p('scaleY(.6)', 1), p('scaleY(1)', 6) ] },
    ],
  },

  // ------------------------------------------------------------------ c2
  // 把做完的东西放下。端着的那块活降到地上，松爪，直起身——空着爪结束。
  //
  // 换的是道具轴，但换法不是「拿个东西挥一挥」：**完成这件事发生在物件上，
  // 不在角色身上**。它开头有、结尾没有，中间那一次转移就是全部内容。
  // 庆祝需要理由，而「东西已经交出去了」自带理由；动作本身完全不激动。
  //
  // 摆位是这个候选唯一难的地方，第一版全部推翻重来：
  //   · 放在身前（y11-15）会被躯干（x2-13 y6-13）挡掉上半截，只在两腿的
  //     空当里露出两条缝——画出来才发现道具几乎是隐形的。
  //   · 落到脚下（x2-13 y15-19）又会读成「站在一块台子上」，
  //     契约明令禁止地毯/台面这类横向底座。
  //   · 爪子往身体内侧收超过 1 格就整个藏进躯干里（同色），
  //     所谓「双爪捧着」画出来是没有爪子。
  //   所以块走**身体左侧的空档**（x-5..1）：那片背景一直是空的，
  //   从端着到落地全程无遮挡，落点离最外侧那条腿（x3-4）还有两格，
  //   是「放在旁边」而不是「站在上面」。
  //
  // 爪从**侧面**扶着块（爪 y9-11 咬住块的右下角），不是从下面托着：
  // 托着的话，块的底边落到地面（y15）时爪必须降到 y15-17，整只爪陷进地里。
  // 侧扶只要降到 y13-15，正好是腿的高度。这条也是画成字符网格才看出来的。
  {
    action: 'success',
    id: 'success-c2',
    title: 'Set It Down',
    axis: '道具 — 从无道具换成有交付物：端着的活放到身侧地上，空着爪直起身',
    desc: '把端着的方块降到身侧地上，松爪，空着爪直起身。庆祝的证据是那个交付物，不是姿势。',
    duration: 3300,
    // 身前：做完的那块活。用的是 working 一系的青色块，接得上「这是活儿」的读法。
    // 画在身前，爪的左半格被块盖住——那正是「握在手里」的画法
    propsAfter: '<g class="done-block motion"><rect x="-5" y="7" width="6" height="4" fill="#7BC8C4"/>'
      + '<rect x="-4" y="8" width="3" height="1" fill="#BDE7E4"/></g>',
    layers: [
      { sel: '.actor', name: 'success-c2-body', poses: [
        p('translate(0,0)', 3),
        p('translate(0,1px) scaleY(.97)', 1),
        p('translate(0,2px) scaleY(.93)', 6),   // 蹲下把它放到地上——最长的一拍
        p('translate(0,2px) scaleY(.94)', 1),   // 松爪的那一格身体还没起来
        p('translate(0,0)', 4),
        p('translate(0,-1px) scaleY(1.02)', 3), // 直起来，比中性还高一格：空手了
        p('translate(0,1px)', 2),               // settle
        p('translate(0,0)', 2) ] },
      // 左爪扶着块。爪的**绝对**高度 = 躯干位移 + 这里的相对位移，
      // 必须逐格等于块的位移，否则块会从爪里飘走：
      //   0% 0+0=0 ·  14% 1+1=2 ·  18% 2+2=4 —— 与块的 0 / 2 / 4 对齐
      { sel: '.left-claw', name: 'success-c2-left', poses: [
        p('translate(0,0)', 3), p('translate(0,1px)', 1), p('translate(0,2px)', 6),
        p('translate(0,0)', 1),     // 松开：一格里抬开两格，块留在原地
        p('translate(0,1px)', 4),   // 身体起来了爪却落后一格——惯性
        p('translate(0,0)', 7) ] },
      // 块只在前 18% 里动，之后一直待在地上——它不跟着身体起来，
      // 这就是「已经不在我手里了」的全部说明
      { sel: '.done-block', name: 'success-c2-block', poses: [
        p('translate(0,0)', 3), p('translate(0,2px)', 1), p('translate(0,4px)', 18) ] },
      // 右爪没拿东西，走自己的分母（19）——跟扶着的那一侧同拍会读成机械臂。
      // 蹲下时它相对躯干再垂两格：空着的那只手是松的
      { sel: '.right-claw', name: 'success-c2-right', poses: [
        p('translate(0,0)', 5), p('translate(-1px,1px)', 1), p('translate(-1px,2px)', 6),
        p('translate(-1px,0)', 2), p('translate(0,0)', 5) ] },
      { sel: '.eyes', name: 'success-c2-eyes', poses: [
        p('translate(-1px,1px)', 3),   // 看着手里的东西（在左侧，所以视线偏左）
        p('translate(-1px,2px)', 2),   // 跟着它落到地上
        p('translate(-1px,1px)', 6),
        p('translate(0,0)', 2), p('translate(0,-1px)', 4) ] }, // 抬眼看你
      { sel: '.blink', name: 'success-c2-blink', poses: [
        p('scaleY(1)', 6), p('scaleY(.15)', 1), p('scaleY(1)', 5),
        p('scaleY(.15)', 1), p('scaleY(1)', 2) ] },
    ],
  },

  // ------------------------------------------------------------------ c3
  // 回头看一眼。先转向刚才干活的那一侧确认，再转回来对着你。
  //
  // 换的是朝向轴。现行实现是从头到尾正面对着你举爪——那是「表演给你看」。
  // 这个候选把顺序倒过来：**它先确认活儿真做完了，然后才想起你在看**。
  // 于是那记面向你的胸口抬起（最长的一拍）就不是庆祝，是「跟你说一声」。
  //
  // 朝向的变化靠三件事合成：躯干横向位移 2 格、视线先右后中、
  // 以及左右爪**不对称**——右爪抬起对着成果，左爪落在后面。
  // 不用旋转：crispEdges 下倾斜的躯干会渲成锯齿平行四边形（README 第 5 条）。
  //
  // 爪的位移只往身体内侧走：左爪不往左、右爪不往右（README 第 6 条）。
  // 「向右看」的那一下如果让右爪也往右伸，就会从躯干上掉下来一块。
  {
    action: 'success',
    id: 'success-c3',
    title: 'Look Back',
    axis: '朝向 — 从全程面向你，换成先转向刚才干活的那一侧确认、再转回来',
    desc: '先转向刚干完活的那一侧确认、点一下头，再转回来朝你抬起胸口。眼里先有活儿，才有你。',
    duration: 3000,
    layers: [
      { sel: '.actor', name: 'success-c3-body', poses: [
        p('translate(0,0)', 1),
        p('translate(2px,0)', 4),    // 转过去，停住看
        p('translate(2px,1px)', 1),  // 对着成果点一下
        p('translate(2px,0)', 2),
        p('translate(1px,0)', 1),    // 回身要快——一拍带过
        p('translate(0,-1px)', 4),   // 面向你，胸口抬起（最长的一拍）
        p('translate(0,0)', 2) ] },
      { sel: '.left-claw', name: 'success-c3-left', poses: [
        p('translate(0,0)', 1), p('translate(1px,1px)', 4), p('translate(1px,0)', 2),
        p('translate(0,-1px)', 6), p('translate(0,0)', 3) ] },
      { sel: '.right-claw', name: 'success-c3-right', poses: [
        p('translate(0,0)', 1),
        p('translate(-1px,-1px)', 5),  // 抬起来对着成果
        p('translate(-1px,0)', 1),
        p('translate(-2px,-2px)', 4),  // 转回来时收到胸前，比左爪高一格
        p('translate(-1px,-1px)', 2), p('translate(0,0)', 3) ] },
      { sel: '.eyes', name: 'success-c3-eyes', poses: [
        p('translate(0,0)', 1), p('translate(1px,0)', 6),  // 视线先到，身体后到
        p('translate(1px,1px)', 1), p('translate(0,0)', 2),
        p('translate(0,-1px)', 4), p('translate(0,0)', 3) ] },
      { sel: '.blink', name: 'success-c3-blink', poses: [
        p('scaleY(1)', 7), p('scaleY(.15)', 1), p('scaleY(1)', 9) ] },
    ],
  },

  // ------------------------------------------------------------------ c4
  // 一记收尾的脚点子。四条腿从右到左轮踏，最后并一记轻跺。
  //
  // 换的是身体部位轴：双爪过头顶 → 只用腿。爪子**一条图层都不写**，
  // 让它们跟着躯干走——「手上什么都没做」本身就是这个候选的态度。
  //
  // 躯干只被腿带起 2 格，而且那 2 格是踏步的结果不是庆祝的姿势。
  // 所以它幅度小、时长短（2.1s，六个里第二短），但节奏是密的：
  // 四条腿的轮踏在前半段每 6-7% 落一格，读作一串鼓点。
  //
  // 起跳那一段（50%-69%）四条腿一起向上 2 格：滞空时脚要收起来。
  // 落地在 69%，眨眼紧跟在 65% ——先眨眼再落地，落地才有分量。
  {
    action: 'success',
    id: 'success-c4',
    title: 'Heel Click',
    axis: '身体部位 — 从双爪过头顶换成只用腿：四条腿轮踏收一记轻跺，爪子不参与',
    desc: '四条腿从外到内轮踏四拍，最后并拢跺一记。爪子一条图层都没写——只用下盘庆祝。',
    duration: 2100,
    splitLegs: true,
    layers: [
      { sel: '.actor', name: 'success-c4-body', poses: [
        p('translate(0,0)', 3),
        p('translate(0,-1px)', 1),             // 轮踏带起来的小起伏
        p('translate(0,0)', 2),
        p('translate(0,-1px)', 1),
        p('translate(0,1px) scaleY(.95)', 1),  // 蓄力
        p('translate(0,-2px)', 3),             // 弹起来，停住
        p('translate(0,1px) scaleY(.94)', 2),  // 落地
        p('translate(0,0)', 3) ] },
      // 轮踏从最外侧的右腿起，往左推：d → c → b → a，每条差一格
      { sel: '.leg-d', name: 'success-c4-leg-d', poses: [
        p('translateY(0)', 1), p('translateY(-2px)', 1), p('translateY(0)', 6),
        p('translateY(-2px)', 3), p('translateY(0)', 5) ] },
      { sel: '.leg-c', name: 'success-c4-leg-c', poses: [
        p('translateY(0)', 2), p('translateY(-2px)', 1), p('translateY(0)', 5),
        p('translateY(-2px)', 3), p('translateY(0)', 5) ] },
      { sel: '.leg-b', name: 'success-c4-leg-b', poses: [
        p('translateY(0)', 3), p('translateY(-2px)', 1), p('translateY(0)', 4),
        p('translateY(-2px)', 3), p('translateY(0)', 5) ] },
      { sel: '.leg-a', name: 'success-c4-leg-a', poses: [
        p('translateY(0)', 4), p('translateY(-2px)', 1), p('translateY(0)', 3),
        p('translateY(-2px)', 3), p('translateY(0)', 5) ] },
      // 前半段眼睛几乎不动：这不是做给你看的，是它自己收个尾
      { sel: '.eyes', name: 'success-c4-eyes', poses: [
        p('translate(0,0)', 6), p('translate(0,1px)', 2), p('translate(0,0)', 3),
        p('translate(0,-1px)', 4), p('translate(0,0)', 2) ] },
      { sel: '.blink', name: 'success-c4-blink', poses: [
        p('scaleY(1)', 11), p('scaleY(.15)', 1), p('scaleY(1)', 5) ] },
    ],
  },

  // ------------------------------------------------------------------ c5
  // 完成 → 回味 → 归位。六个里唯一有**余韵**的那个。
  //
  // 换的是时间尺度轴：4.4s，比现行实现长一半。多出来的时间不是用来加动作的，
  // 是用来**停**的——中间那一拍占 26%（约 1.1 秒）几乎不动，
  // 只有呼吸、一次慢眨眼和视线放空。这是六个里唯一「什么都没发生」的一段，
  // 也正是它的全部意义：做完之后有个空白，然后才想起还有别人在。
  //
  // 身体那一段没有写成一格死保持，而是拆成「停住 + 一次深呼吸」两格。
  // 死保持 1.7 秒在像素画里读起来像掉帧，加一格 1 单位的起伏就变成活的。
  //
  // 结尾特意压回中性并多留 3 格：oneshot 播完接的就是 idle，
  // 收在中性姿态才接得上，收在极端姿态会硬切一下。
  {
    action: 'success',
    id: 'success-c5',
    title: 'Savour',
    axis: '时间尺度 — 从一个动作换成一个完整小节：完成 → 回味（停住一拍）→ 归位',
    desc: '推完最后一下，直起身停住回味（最长的一拍占 1.1 秒，只剩呼吸和慢眨眼），再归位。一个完整小节，不是一个动作。',
    duration: 4400,
    layers: [
      { sel: '.actor', name: 'success-c5-body', poses: [
        p('translate(0,1px) scaleY(.96)', 2),   // 还压在活儿上——最后一下
        p('translate(0,0)', 1),
        p('translate(0,-2px) scaleY(1.03)', 2), // 直起来
        p('translate(0,-1px)', 5),              // 停住（最长的一拍）
        p('translate(0,-2px) scaleY(1.02)', 3), // 回味里的一次深呼吸
        p('translate(0,0)', 2),
        p('translate(0,1px) scaleY(.97)', 1),   // settle
        p('translate(0,0)', 3) ] },
      { sel: '.left-claw', name: 'success-c5-left', poses: [
        p('translate(1px,2px)', 2), p('translate(1px,1px)', 1),
        p('translate(0,-1px)', 3),      // 松开
        p('translate(0,0)', 6),         // 垂在身侧
        p('translate(1px,-1px)', 2),    // 想起你——抬一下，像打了个招呼
        p('translate(0,0)', 4) ] },
      { sel: '.right-claw', name: 'success-c5-right', poses: [
        p('translate(-1px,2px)', 2), p('translate(-1px,0)', 2),
        p('translate(-1px,-2px)', 2),   // 抬起来看了看自己的爪
        p('translate(-1px,-1px)', 5), p('translate(0,0)', 4),
        p('translate(-1px,-1px)', 2), p('translate(0,0)', 2) ] },
      { sel: '.eyes', name: 'success-c5-eyes', poses: [
        p('translate(0,1px)', 3),        // 看着刚做完的
        p('translate(0,0)', 2),
        p('translate(-1px,-1px)', 6),    // 放空——回味不看具体的东西
        p('translate(0,-1px)', 3), p('translate(0,0)', 4),
        p('translate(0,1px)', 1), p('translate(0,0)', 2) ] },
      // 回味中一次慢眨眼（.15 保持两格再半开），末尾一次普通的
      { sel: '.blink', name: 'success-c5-blink', poses: [
        p('scaleY(1)', 6), p('scaleY(.15)', 2), p('scaleY(.55)', 1), p('scaleY(1)', 8),
        p('scaleY(.15)', 1), p('scaleY(1)', 3) ] },
    ],
  },

  // ------------------------------------------------------------------ c6
  // 一次点头。1.5 秒，全身只有 1 格垂直位移，爪子一条图层都不写。
  //
  // 换的是幅度轴，而且换到头：这是「还能被读出来的最小的完成」。
  // 再小就只剩眨眼，那会和 idle 的眨眼混在一起，等于没有反馈。
  //
  // 关键在**眼睛与躯干反着走**：躯干下沉时眼睛也往下 1 格，
  // 于是脸相对躯干又低了一格——没有脖子的角色靠这个读出「点头」。
  // 两层同向的话只会读成整体下蹲。
  //
  // 这是六个里我认为一天几十次之后仍然不烦人的那个：
  //   · 1.5 秒，比现行实现短一半，插播时几乎不占用注意力
  //   · 没有跳跃、没有道具出现又消失，余光里只是「动了一下」
  //   · 收在中性姿态，接回 idle 完全无缝
  // 代价是它**弱**——如果只有它，用户可能会问「刚才是不是没反应」。
  // 所以它更适合作为默认，把 c2 / c3 留给「跑完一整轮长任务」那种时刻。
  {
    action: 'success',
    id: 'success-c6',
    title: 'Just a Nod',
    axis: '庆祝的幅度 — 收敛到极限：一次点头，全身只有 1 格位移，爪子完全不动',
    desc: '看你一眼，点一下头，回到站姿。全身只有 1 格垂直位移，眼睛比躯干多沉一格——造出「没有脖子的点头」。',
    duration: 1500,
    layers: [
      { sel: '.actor', name: 'success-c6-body', poses: [
        p('translate(0,0)', 3),
        p('translate(0,-1px)', 1),             // 极小的预备抬——没有预备的点头读成抽搐
        p('translate(0,1px) scaleY(.96)', 4),  // 点下去，停住
        p('translate(0,0)', 1),
        p('translate(0,-1px)', 1),             // 回来时略过一点
        p('translate(0,0)', 5) ] },            // 站定，剩下的时间什么都不做
      // 眼睛比躯干多沉一格，脸相对躯干更低——这就是「没有脖子的点头」
      { sel: '.eyes', name: 'success-c6-eyes', poses: [
        p('translate(0,0)', 2),
        p('translate(0,-1px)', 1),  // 先看你一眼，点头才有对象
        p('translate(0,1px)', 5),
        p('translate(0,0)', 3), p('translate(0,-1px)', 1), p('translate(0,0)', 4) ] },
      { sel: '.blink', name: 'success-c6-blink', poses: [
        p('scaleY(1)', 5), p('scaleY(.15)', 1), p('scaleY(1)', 9) ] },
    ],
  },
];
