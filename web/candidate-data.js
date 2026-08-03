/* 由 scripts/build-candidates.mjs 生成，请勿直接编辑。 */
window.MaclawdCandidates = [
  {
    "action": "delegating",
    "id": "delegating-c1",
    "title": "Shadow Split",
    "axis": "助手的形态 — 助手不是另一种小生物，是主角自己剥离出去的分身",
    "desc": "主角下蹲蓄力、弹起，一个和自己同形的深色分身从身体里脱出来，往侧面滑走、到边缘淡掉；主角站直目送，眼睛跟着它走。子代理就是「另一个我」——这个候选把那句话直接画出来，不需要观众建立「小家伙 = 子代理」的额外联想。【一个 vs 多个】一个子代理时只有右边那个分身；两个及以上时 .helper-b（左边的分身）同时出现，左右对称地各走一个方向，读作「一分为二」。【表达 N】不好扩：三个以上分身会把主角围住，读成「被自己包围」而不是「派了三个」。它换的是形态，不是数量。【不像埋头干】主角全程没有操作任何东西，只有一次蓄力和一次目送。",
    "source": "src/animations/cand-delegating-c1.svg",
    "durationMs": 4800
  },
  {
    "action": "delegating",
    "id": "delegating-c2",
    "title": "Long Toss",
    "axis": "交接的方式 — 抛，不递：包裹有滞空，主角在它落地前就空手了",
    "desc": "后仰蓄力，把包裹抛出一条弧线，最高点停最久——那一拍主角已经空着手，包裹还在天上，接手在下面抬爪等着。包裹落到它头顶那一瞬间被砸得一沉（落怀里会正好盖住它的脸），顶着走两步，主角同时弯腰摸下一个。「递过去」两只手一直连在一起，「抛过去」中间有一段谁都没拿着——那段滞空就是「已经不归我管了」。【一个 vs 多个】一个子代理时只有近处那个接手；两个及以上时 .helper-b（更高更小、抱着上一件正在走远的那个）出现，周期 4200 与主循环错开，于是画面上永远有一件在飞、一件在被搬走。【表达 N】靠远处那条走廊上的助手数，可以再排第三个更小更高的，但三个之后深度线索就用完了。【不像埋头干】抛完之后有明确的「空手」段，那是 working 里不会出现的。",
    "source": "src/animations/cand-delegating-c2.svg",
    "durationMs": 5000
  },
  {
    "action": "delegating",
    "id": "delegating-c3",
    "title": "Dispatch Desk",
    "axis": "主角的位置 — 退到左边的调度台上，全程不碰任何东西",
    "desc": "主角站到画面左侧的台子上，右爪抬起指向右边，**指住那一拍是全循环最长的**；被指的助手扛着包裹往右走、出画、下一个补上。主角自己手上什么都没有，全程只有指、看、换重心三件事。六个里唯一一个「主角不在画面中央、也不接触任何道具」的构图——「我只负责分配」这句话靠位置和空手说，不靠动作。【一个 vs 多个】一个子代理时只有下面那条道；两个及以上时 .helper-b（更高那条道上更小的那个）出现，周期 3900 与主循环互质，两条道永远错开，读作「两边各跑各的」。【表达 N】天然按「道」扩：每多一个子代理加一条更高更小的道，主角的动作一个字都不用改——这一点最接近 working.tiers 想要的东西。【注意】主角的偏移是靠每一帧的 translate(-7px,-3px) 做的，prefers-reduced-motion 下动画被整体关掉，主角会掉回画面中央、站在台子旁边。要采用它得给这个动作单独写一条静止姿势。",
    "source": "src/animations/cand-delegating-c3.svg",
    "durationMs": 5200
  },
  {
    "action": "delegating",
    "id": "delegating-c4",
    "title": "Handoff Ghost",
    "axis": "助手在不在画面里 — 一个助手都不画，只画「东西被拿走了」",
    "desc": "画面上只有主角和包裹。主角把包裹举到身侧递出去、举着等一拍，然后包裹**加速**往右抽走（一拍 6 格、下一拍 9 格）、出画淡掉；主角被带得往回一缩，目送，再从脚边捡起下一个。助手一个都不画，靠三件事说清「被人接走了」：抽走的加速度、主角的反冲、以及那只还张着的空爪。好处是构图最干净——135px 下其余五个都要挤两三个小家伙，这个不用。【一个 vs 多个】数量落在**包裹**上而不是助手上：一个子代理时只有那个黄包裹；两个及以上时 .helper-b（脚边那个青色包裹）出现，周期 3400，自己走自己的节奏被抽走，于是画面上两件东西在被并行取走。【表达 N】可以按包裹数扩到三四件，但它们都从同一个人手里出去，读作「东西多」比读作「人多」自然。【不像埋头干】主角的动作只有举起和松手，没有任何反复操作。",
    "source": "src/animations/cand-delegating-c4.svg",
    "durationMs": 4600
  },
  {
    "action": "delegating",
    "id": "delegating-c5",
    "title": "Round Trip",
    "axis": "循环结构 — 派出去 → 等 → 收回来，一个完整回合而不是均匀接力",
    "desc": "一个循环是一件完整的事：交出包裹（两拍，快）→ **空手等着（最长的一拍，占三成，主角沉下来、点脚、盯着信使走的方向）** → 信使带着东西回来 → 接过、点一下头。包裹出去是黄的、回来是青的（关键帧直接换 fill），所以「回来的不是同一件东西，是结果」这件事不用讲。现在的实现是均匀接力，从头到尾一个节奏；这个候选把 SubagentStart 到SubagentStop 的整个回合画进了一个循环里。【一个 vs 多个】变的是**等待时间**：一个子代理时那段空手真的空着，主角在点脚；两个及以上时 .helper-b（更高那条道上的第二个信使，周期 4200 与 5600 错开）在空档里进出，主角几乎没有闲着的时候。「派得越多越没空」——这是六个里唯一一个变体改的是节奏而不是元素数量的。【表达 N】按信使数扩，每个用一个互质周期，回合自然交错。【不像埋头干】最长的一拍是**什么都没干**，working 里不可能有这一拍。",
    "source": "src/animations/cand-delegating-c5.svg",
    "durationMs": 5600
  },
  {
    "action": "delegating",
    "id": "delegating-c6",
    "title": "Tether Lines",
    "axis": "数量的表达 — N 靠线的条数，主角的动作与 N 无关",
    "desc": "主角右爪握着一根线轴，三条线从线轴上往右拉出去，每条线的另一头挂着一个远处的小方块——那就是一个子代理。三条线各自以 2900 / 3700 / 4300 的周期一收一放（各自在忙，永不同步），主角被拽着微微后仰、偶尔收一下线，眼睛在三条线之间来回。【一个 vs 多个】线的条数就是数量，主角的关键帧一帧都不用改：一个子代理时只留 .tether-a；≥2 时 .helper-b 出现；.helper-c 是留给 ≥3 的那条——**采用这个候选要给 helper-c 补一条和 helper-b 一样的 display:none 规则**，否则一个子代理时会露出三条线。【表达 N】六个里唯一一个真正按 N 线性扩展的：加一条线 = 加一个子代理，线的长短还能顺带表达「跑了多久」。这正是 working.tiers 想要的形状——delegating 的 one/two 变体只是它的二值前身。【不像埋头干】主角是被三条线拽着的那一端，不是在操作任何东西；它唯一的动作是「拉住」和「看」。",
    "source": "src/animations/cand-delegating-c6.svg",
    "durationMs": 5000
  },
  {
    "action": "error",
    "id": "error-c1",
    "title": "Pinned Between",
    "axis": "被困的方式 —— 从「被一个东西扣住」换成「卡在两个东西中间」",
    "desc": "两块厚板从左右夹住。往上顶想从缝里挤出去，顶到最高卡住，滑回来，板又收紧一格。困住它的不是一个盖子，是两边同时的挤压。",
    "source": "src/animations/cand-error-c1.svg",
    "durationMs": 4800
  },
  {
    "action": "error",
    "id": "error-c2",
    "title": "Caught Mid-Reach",
    "axis": "有无道具 —— 从「有一个篮子」换成「画面里什么都没有」",
    "desc": "动作做到一半停住了：一只爪还举在半空，身体绷着维持不住，掉一格又勉强撑回去。没有任何东西困住它，停下来的是它自己。",
    "source": "src/animations/cand-error-c2.svg",
    "durationMs": 4800
  },
  {
    "action": "error",
    "id": "error-c3",
    "title": "Under the Crate",
    "axis": "情绪 —— 从「挣扎」换成「认命」（困住的方式照旧，只换态度）",
    "desc": "一个倒扣的浅筐罩住了下半身。它试了一下，筐纹丝不动，于是就站在那儿不试了。整套里唯一一个「放弃」写在动作里的。",
    "source": "src/animations/cand-error-c3.svg",
    "durationMs": 4800
  },
  {
    "action": "error",
    "id": "error-c4",
    "title": "Losing Ground",
    "axis": "循环结构 —— 从「挣脱↔被碰倒」的往复换成单向下滑，没有「站稳」这一拍",
    "desc": "顺着一面墙往下滑。中间卡住过一次，但每一拍都比上一拍低，一次都没有站回去。墙上的横档是不动的参照物，滑了多少一眼看得出。",
    "source": "src/animations/cand-error-c4.svg",
    "durationMs": 4800
  },
  {
    "action": "error",
    "id": "error-c5",
    "title": "Under the Pile",
    "axis": "构图 —— 从「角色是主体」换成「障碍物是主体」，角色被淹没",
    "desc": "塌下来的一堆东西埋掉了整个身子，只剩一条露着眼睛的横带和一只搭在外面的爪。画面主体是那堆东西；角色只是从里面露出来的一小块。",
    "source": "src/animations/cand-error-c5.svg",
    "durationMs": 4800
  },
  {
    "action": "error",
    "id": "error-c6",
    "title": "Wrong Way Up",
    "axis": "朝向 —— 从「正面站立」换成「翻倒」，整个角色转了 90°",
    "desc": "被地上翘起的一块板绊翻，横躺着。蹬两下没翻回来，就不蹬了。翻不过身的乌龟——困住了但完全没死，这个基调最直白的一版。",
    "source": "src/animations/cand-error-c6.svg",
    "durationMs": 4800
  },
  {
    "action": "idle",
    "id": "idle-c1",
    "title": "Room Scan",
    "axis": "注意力朝向 —— 从「一直看着你」换成「在屋里各处看」，视线带头、身体晚半拍跟随",
    "desc": "视线在左端、右端、上方三个落点之间巡，每处都盯住不动，身体晚半拍才转过去。",
    "source": "src/animations/cand-idle-c1.svg",
    "durationMs": 5600
  },
  {
    "action": "idle",
    "id": "idle-c2",
    "title": "Settled Sit",
    "axis": "重心 —— 从站立换成坐下：躯干压到八成高、外侧腿向外摊开，剪影整个变矮",
    "desc": "坐在原地，重心在左右之间慢慢换边，外侧两条腿摊开撑着，脸仍然保持在高处。",
    "source": "src/animations/cand-idle-c2.svg",
    "durationMs": 5600
  },
  {
    "action": "idle",
    "id": "idle-c3",
    "title": "Pocket Stone",
    "axis": "有无道具 —— 从空手换成手里有颗小石子，无聊时来回倒手、翻面",
    "desc": "胸前托着一颗石子，托很久、翻一下、倒到另一只爪里，再托很久。",
    "source": "src/animations/cand-idle-c3.svg",
    "durationMs": 5600
  },
  {
    "action": "idle",
    "id": "idle-c4",
    "title": "Still Life",
    "axis": "呼吸的可见度 —— 从 1 格起伏压到 2% 缩放（余光里等于没动），生命感全部移到眼睑",
    "desc": "身体几乎不动，一个循环只挪一次；眨眼却有单眨、双眨、半眨、慢眨四种节奏。",
    "source": "src/animations/cand-idle-c4.svg",
    "durationMs": 5600
  },
  {
    "action": "idle",
    "id": "idle-c5",
    "title": "Footwork",
    "axis": "腿参不参与 —— 腿从完全钉死换成唯一持续在动的部位，四只脚各走互质周期",
    "desc": "身体在四条腿上左右慢慢倒，四只脚各按自己的节奏抬起、挪一格、落下，从不同时。",
    "source": "src/animations/cand-idle-c5.svg",
    "durationMs": 5600
  },
  {
    "action": "idle",
    "id": "idle-c6",
    "title": "Drift and Return",
    "axis": "循环结构 —— 从各层错拍的均匀循环换成全层同周期的三段式：观察 → 走神 → 回神",
    "desc": "看一会儿前方，视线飘走出神（连眨都不眨），最后眨一下回过神来，重新看向前方。",
    "source": "src/animations/cand-idle-c6.svg",
    "durationMs": 5600
  },
  {
    "action": "needs_owner",
    "id": "needs-owner-c1",
    "title": "Held High",
    "axis": "求助的方式 —— 从「推给你」换成「举着等你来拿」",
    "desc": "双爪把罐子整个举过头顶，撑住不放；撑久了手发抖、腿打颤、重心左右晃，然后深吸一口气再顶高一格。基线是把东西推开，这个是把东西**举着不放**——推完就没事了，举着是持续的请求。余光里读到的是**剪影长高了一大截**（头顶多出 13 个单位的方块），而且这个变化在它不动的时候也一直在。道具环没换：罐子还在，owner_resolved（Jar Click）可以原样接上，接的是「你把它接过去、盖子咔哒松开」。注意「举累了往下沉」在这里做不了：爪子一落到躯干轮廓里就整块消失（同色），罐底再往下就压到眼睛。所以「撑不住」只能靠发抖和**身体往下坠而手还钉在原处**表达——这是几何逼出来的，不是选择，但坠出来的那两格间隙反而比下沉更像脱力。",
    "source": "src/animations/cand-needs-owner-c1.svg",
    "durationMs": 4800
  },
  {
    "action": "needs_owner",
    "id": "needs-owner-c2",
    "title": "One Shove",
    "axis": "节奏 —— 从「持续挣扎」换成「安静很久 + 一次明显动作」",
    "desc": "罐子已经推到你面前的地上，桌宠前倾着、手搭在盖子上、盯着你——**这个姿势保持三分之二个循环**，其间只有呼吸和眼睛在动；然后整身前扑一下，把罐子再往你那边顶一格，罐子晃两下没走远，它退回原来那个姿势继续等。这是六个里唯一为「长时间等待」专门做的：单次事件反而更显眼（余光抓的是突变，不是持续运动），而每 4.8 秒只打扰你一次，总打扰量比基线低一个量级。**几分钟不关掉它的前提就是这个。**静止那段停在「递出去等着」的姿势上（前倾 2 格、手在盖子上），不是中立姿势——你随时瞥一眼都读得到它在等。道具环没换，owner_resolved 原样可用，只是罐子的落点从身侧挪到了右前方，Jar Click 的罐子位置要跟着挪，否则接上去罐子会瞬移。（4800ms 下静默占 3.4s。这条轴本来还想要更长的静默，但那要改契约时长，先按 4800 给保守版。）",
    "source": "src/animations/cand-needs-owner-c2.svg",
    "durationMs": 4800
  },
  {
    "action": "needs_owner",
    "id": "needs-owner-c3",
    "title": "Empty Claws",
    "axis": "有无道具 —— 把罐子整个拿掉，只剩身体本身",
    "desc": "没有任何道具。桌宠反复把身体拔高、双爪举到头顶两侧摊开，再整个缩回去；举起来的时候身高从 7.7 个单位涨到 10 个，**剪影每两秒吞吐一次**。拿掉道具反而让语义更准：它手里什么都没有，它自己解决不了——这正是 needs_owner 的意思。基线的罐子把「卡住」演成了一件具体的事，而 Claude 卡住通常没有对应的实物。和 success（Self High-five）的区别是双爪**分开摊着**不是碰到一起，而且是循环不是一次性起跳。**收尾必须另配：**它不开道具环，所以 owner_resolved 也得是纯姿态的——双爪落回身侧、身体一口气松下来（scaleY 从 1.1 落回 1.0）、一次快眨眼。现有的 Jar Click 在这个候选下用不上，硬接会凭空冒出一个罐子。",
    "source": "src/animations/cand-needs-owner-c3.svg",
    "durationMs": 4800
  },
  {
    "action": "needs_owner",
    "id": "needs-owner-c4",
    "title": "Turned Away",
    "axis": "朝向 —— 从「一直正面演给你看」换成「转向问题那边，只偶尔回头看你」",
    "desc": "大半个循环里它是**侧着的**：眼睛都偏到左边、右爪缩进身体后面看不见了、左爪往左伸去够罐子却够不着；然后突然转回正面、站直、盯你一拍，再转回去。罐子留在原位不动——它不是在跟你交涉，它是在跟问题较劲，回头那一下才是冲你来的。余光读到的是**剪影的左右不对称在翻转**（右边那块爪一会儿有一会儿没有），这比单纯的位移更容易被注意到，因为轮廓的拓扑变了。代价是眼睛必须和身体同拍——朝向是靠眼睛偏移读出来的，让眼睛走自己的周期就散了。所以这个候选的活跃度全压在四条腿上（倒腾脚 = 焦躁）。道具环没换，owner_resolved 原样可用。",
    "source": "src/animations/cand-needs-owner-c4.svg",
    "durationMs": 4800
  },
  {
    "action": "needs_owner",
    "id": "needs-owner-c5",
    "title": "Slow Sink",
    "axis": "进度 —— 从「原地重复」换成「越等越蔫」，循环里有单向的档位",
    "desc": "一个循环分四档，每档之间是一次「咚」的塌陷：挺着 → 矮一截 → 再矮一截 → 整个趴到罐子上。头顶从 4.5 一路掉到 12，眼神跟着一档一档往下移，最后半闭着看地。到底之后**很慢地重新提起一点劲**回到第一档——不是弹回去，是「又攒了一点力气」，所以接缝处不突兀。基线是原地重复，看十遍和看一遍一样；这个每一遍内部都有方向，而且方向是「往下」——它不吵你，它是在你面前一点点垮掉，这种「你不管我我就这样了」的读感比使劲挣扎更有说服力，也更不烦人。三次塌陷是三个离散的突变，余光抓的正是这个；而且塌下去之后的形状本身就在传递信息，不需要你正好赶上它动。道具环没换，但收尾要多一拍：它是**趴着**的，owner_resolved 得先从趴着起身再拧盖（Jar Click 现在直接从站姿开始）。",
    "source": "src/animations/cand-needs-owner-c5.svg",
    "durationMs": 4800
  },
  {
    "action": "needs_owner",
    "id": "needs-owner-c6",
    "title": "Locked Stare",
    "axis": "视线 —— 从「眼睛一直在游移」换成「锁死不动，一个循环只慢慢眨一次」",
    "desc": "它不跟罐子较劲了。罐子搁在身侧一动不动，桌宠正对着你站定，**眼睛整整一个循环停在同一个位置**（一条只有一个姿态的图层），身体只有极缓慢的一次重心来回，四千八百毫秒里慢慢眨一次眼，闭 0.6 秒。这是六个里最不烦人的一个，可以挂几分钟不让人想关掉。但要说实话：**这条轴解决不了余光问题。**余光看不见 3px 的眼睛，它能提供的只是「你已经转过头之后」的存在感——一只不眨眼盯着你的东西比一只在忙的东西更难移开视线。它真正的余光信号是**由动到不动的反差**（从 working / thinking 切进来时，动的东西突然停了，那一下是个突变），但那依赖前一个状态，单看循环读不出来。所以它更适合当 c2 的第二段：先安静盯着，等久了再开始推。道具环没换，owner_resolved 原样可用。风险登记：完全不游移的眼睛容易被读成「动画卡住了」，所以保留了那一次慢眨眼——去掉它更冷，但也更像程序挂了。",
    "source": "src/animations/cand-needs-owner-c6.svg",
    "durationMs": 4800
  },
  {
    "action": "success",
    "id": "success-c1",
    "title": "Exhale",
    "axis": "情绪基调 — 兴奋换成如释重负：不跳、不举爪，只把憋着的一口气放掉",
    "desc": "绷着的身体停一拍，然后一口气泄下去——下沉加纵向压缩，配一次 500ms 的慢眨眼。不跳、不举爪，是「终于完了」不是「我做到了」。",
    "source": "src/animations/cand-success-c1.svg",
    "durationMs": 2400
  },
  {
    "action": "success",
    "id": "success-c2",
    "title": "Set It Down",
    "axis": "道具 — 从无道具换成有交付物：端着的活放到身侧地上，空着爪直起身",
    "desc": "把端着的方块降到身侧地上，松爪，空着爪直起身。庆祝的证据是那个交付物，不是姿势。",
    "source": "src/animations/cand-success-c2.svg",
    "durationMs": 3300
  },
  {
    "action": "success",
    "id": "success-c3",
    "title": "Look Back",
    "axis": "朝向 — 从全程面向你，换成先转向刚才干活的那一侧确认、再转回来",
    "desc": "先转向刚干完活的那一侧确认、点一下头，再转回来朝你抬起胸口。眼里先有活儿，才有你。",
    "source": "src/animations/cand-success-c3.svg",
    "durationMs": 3000
  },
  {
    "action": "success",
    "id": "success-c4",
    "title": "Heel Click",
    "axis": "身体部位 — 从双爪过头顶换成只用腿：四条腿轮踏收一记轻跺，爪子不参与",
    "desc": "四条腿从外到内轮踏四拍，最后并拢跺一记。爪子一条图层都没写——只用下盘庆祝。",
    "source": "src/animations/cand-success-c4.svg",
    "durationMs": 2100
  },
  {
    "action": "success",
    "id": "success-c5",
    "title": "Savour",
    "axis": "时间尺度 — 从一个动作换成一个完整小节：完成 → 回味（停住一拍）→ 归位",
    "desc": "推完最后一下，直起身停住回味（最长的一拍占 1.1 秒，只剩呼吸和慢眨眼），再归位。一个完整小节，不是一个动作。",
    "source": "src/animations/cand-success-c5.svg",
    "durationMs": 4400
  },
  {
    "action": "success",
    "id": "success-c6",
    "title": "Just a Nod",
    "axis": "庆祝的幅度 — 收敛到极限：一次点头，全身只有 1 格位移，爪子完全不动",
    "desc": "看你一眼，点一下头，回到站姿。全身只有 1 格垂直位移，眼睛比躯干多沉一格——造出「没有脖子的点头」。",
    "source": "src/animations/cand-success-c6.svg",
    "durationMs": 1500
  },
  {
    "action": "thinking",
    "id": "thinking-c1",
    "title": "Head Scratch",
    "axis": "有无外物 — 拿掉全部道具，读感只能靠姿态本身撑住（当前版本靠手里那块拼图）",
    "desc": "一只爪搭在头顶偏左，偶尔挠两下；重心慢慢在两边挪，最长的一拍压在爪的那一侧。",
    "source": "src/animations/cand-thinking-c1.svg",
    "durationMs": 4600
  },
  {
    "action": "thinking",
    "id": "thinking-c2",
    "title": "Turned Away",
    "axis": "朝向 — 背对着你，脸整个不可见（当前版本与其余五个都是正面）",
    "desc": "转过去不理你，只看得到壳在缓慢起伏、头那一端左右微转，爪偶尔在身侧动一下。",
    "source": "src/animations/cand-thinking-c2.svg",
    "durationMs": 4600
  },
  {
    "action": "thinking",
    "id": "thinking-c3",
    "title": "Three Options",
    "axis": "思考的比喻 — 从「把玩一个东西」换成「在摊开的三块之间比对、挑一块」，思考的对象是复数且可见",
    "desc": "三块碎片摊在脚前，爪在它们之间移动；正在被考虑的那块亮起来、抬高一格。最长的停顿停在双爪悬在中间那块上方、还没落下的时候。",
    "source": "src/animations/cand-thinking-c3.svg",
    "durationMs": 4600
  },
  {
    "action": "thinking",
    "id": "thinking-c4",
    "title": "Three Beats",
    "axis": "节奏结构 — 从均匀的「动-顿-动-顿」换成「长静默 → 突然一动 → 落进另一个静默」，一个循环推进三段",
    "desc": "三段静默，每段之间抽动一次。每次抽动之后停在和上一段不同的姿势上——不是弹回原样，是往前挪了一步。",
    "source": "src/animations/cand-thinking-c4.svg",
    "durationMs": 4600
  },
  {
    "action": "thinking",
    "id": "thinking-c5",
    "title": "Settled",
    "axis": "有没有「想通了」的收尾 — 循环里包含一次结论（当前版本循环里全是「还在想」）",
    "desc": "头顶三个小点各自明灭，收拢成中间那一个的瞬间身体挺起来一拍，随即散开重来。",
    "source": "src/animations/cand-thinking-c5.svg",
    "durationMs": 4600
  },
  {
    "action": "thinking",
    "id": "thinking-c6",
    "title": "Hands Stop",
    "axis": "头与身的分离 — 道具、构图、姿势全部沿用当前实现，只把眼睛从身体的拍子里拆出来（视线周期 1300ms，身体 4600ms）",
    "desc": "拼图停在爪里几乎不转，视线以三倍多的速度扫来扫去、停住、再扫。手上的活停了，脑子没停。",
    "source": "src/animations/cand-thinking-c6.svg",
    "durationMs": 4600
  }
];
