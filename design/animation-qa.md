# Maclawd animation QA — V5.4 — 2026-07-17

本轮在 V5.3 身体优先基线上补齐运行时生命周期与生命感动作。38 个动作继续取消完整横向底座，**Top-down Sleep** 仍无床垫，只保留贴身枕头、毛毯和 Zzz。

V5.4 的 15 个新增视觉动作中，只有 `owner_resolved` 与 `recovering` 使用道具，用来闭合已有罐子与篮子的状态故事；其余 13 个完全依赖身体、眼神、重心和四腿表达。没有新增光标、通知、网络、电池或充电器图标。

## 自动检查

- 41 个 SVG 源文件全部通过 XML 解析（38 个当前动作、1 个历史兼容入口、2 个机械原型）。
- 38/38 当前动作保留 `viewBox="-15 -25 45 45"`。
- 38/38 当前动作保留身体、双爪、四腿、双眼的固定源矩形。
- 38/38 当前动作使用身体色 `#DE886D` 与眼睛色 `#000000`。
- 全套 V5.4 在 96px 共渲染 1547 个确定性 Chromium 帧，并以相同时序渲染 64px 检查帧，输出 38 个 GIF。
- 38/38 GIF 至少包含两个实际帧；15 个新增 GIF 分别包含 4–10 个不同像素帧，没有静态假 GIF。
- 38/38 动作满足 `max-width <= 48px` 的横向包围盒硬门；新增动作最大值为 48px。
- 四份机器可读 JSON 合同通过语法解析。
- 动态实验室和同屏 QA 板均加载 38 个当前动作；`working.command` 与 `ambient.power_connected` 作为复用映射，不重复占视觉动作。

## 视觉检查

- 在 64px 与 96px 两档检查身体轮廓、双眼、场景识别、接触关系、横向包围盒与裁边。
- `idle`、`success`、点击、双击、落地和低电量为纯身体动作，不再依赖软垫。
- 拼图、工作牌、书、信纸、积木、测试玩具和同步线轴都与身体重叠、贴在单侧或纵向叠放。
- `delegating` 删除地面路径，助手纵向接力；`needs_owner` 删除餐垫；`error` 删除地面条，仅保留会扣住身体的篮子。
- `drag` 的双爪抓住中央吊环，不再抓横向木杆；`edge` 的纵向帘幕保留，因为它不造成横向铺陈。
- 未使用 UI 面板、进度条、光晕、速度线、烟雾或阴影。
- `sleeping` 按用户明确要求保留硬边像素 `Zzz`，仍是漂浮标点规则的唯一例外。
- `launching` 与 `quitting` 使用相反的展开/收拢轮廓；`moving` 用四腿交替和领先视线，不使用速度线。
- `waiting`、`paused` 与普通 `idle` 分别以三次点爪、内收定格和自然观察区分。
- `owner_resolved` 让罐盖保持接触式松开；`recovering` 让篮子始终贴近身体并在最后恢复站姿，没有脱离角色的漂浮效果。
- 三个 idle 变体只在身体内部做护理、挪腿和点头；环境反应不绘制光标、通知或网络图标。
- 长页面浏览器实验室通过 38 卡加载检查；静态审查截图使用同一批确定性 96px 帧，避免离屏 `<object>` 在截图工具中不绘制。

## 评审产物

- [`../previews/all-actions-v5-96px.png`](../previews/all-actions-v5-96px.png)
- [`../previews/all-actions-v5-64px.png`](../previews/all-actions-v5-64px.png)
- [`../previews/complete-motion-lab-v5.png`](../previews/complete-motion-lab-v5.png)
- `previews/<action>-v5.gif`（38 个）
