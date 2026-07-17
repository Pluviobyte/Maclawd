# Maclawd animation QA — V4.1 — 2026-07-17

本轮对 12 个主状态、5 个活动修饰和 6 个互动/环境动作进行全套小尺寸复审。18 个视觉上需要优化的动作重新渲染；保留的动作继续由同一实验室加载检查。

## 自动检查

- 26 个 SVG 源文件全部通过 XML 解析（23 个当前动作、1 个历史兼容入口、2 个机械原型）。
- 26/26 保留 `viewBox="-15 -25 45 45"`。
- 26/26 保留身体、双爪、四腿、双眼的固定源矩形。
- 26/26 使用身体色 `#DE886D` 与眼睛色 `#000000`。
- 18 个 V4 动作共渲染 324 个确定性 Chromium 帧，并输出 18 个 GIF。
- 修复预览器在小视口只截取 500px SVG 左上角的问题；18/18 GIF 现在都包含至少两个不同的实际渲染帧。
- 14 个 V4 循环动作的首帧与末采样帧逐字节一致。
- 三份机器可读 JSON 合同通过语法解析。
- 动态实验室加载 23 个当前动作；`working.command` 映射到 generic `working`，不重复占一个视觉动作。
- `prefers-reduced-motion` 下身体动画计算值为 `none`。

## 视觉检查

- 在 64px 与 96px 两档同时检查身体轮廓、双眼、道具接触与裁边。
- `thinking`、`working`、`error`、`low_battery` 已改成无道具身体动作。
- 阅读、写作、构建、测试、同步改为单一大轮廓，不再用三个脚边小物讲故事。
- 委派只保留两个大助手；求助只保留一个位于身体侧面的清晰玻璃罐。
- 休眠链只使用一条连贯毛毯，睡眠时脸与爪保持可见。
- 未使用文字、进度条、漂浮标点、光晕、速度线、烟雾或阴影。
- `sleeping` 已改为俯视床铺构图；床垫、枕头、闭眼、被面双爪和呼吸起伏在暂停帧也能读成平躺睡觉。用户明确指定的硬边像素 `Zzz` 是漂浮标点规则的唯一例外。
- 新睡眠循环输出 26 帧、9 个不同帧，首尾闭合。

## 评审产物

- [`../previews/all-actions-v4-96px.png`](../previews/all-actions-v4-96px.png)
- [`../previews/all-actions-v4-64px.png`](../previews/all-actions-v4-64px.png)
- [`../previews/complete-motion-lab-v4.png`](../previews/complete-motion-lab-v4.png)
- `previews/<action>-v4.gif`
