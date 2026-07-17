# Maclawd animation QA — 2026-07-17

本轮覆盖 19 个新增动作：7 个剩余主状态、6 个 `working` 修饰和 6 个互动/
环境动作。此前已经验证的 5 个主状态保持不变。

## 自动检查

- 19/19 SVG 通过 XML 解析。
- 19/19 保留固定 `viewBox="-15 -25 45 45"`。
- 19/19 保留身体、双爪、四腿、双眼的固定源矩形。
- 19/19 使用身体色 `#DE886D` 与眼睛色 `#000000`。
- 742 帧以 10 fps、1000×1000 QA 分辨率完成渲染。
- 每个动作至少包含 4 个不同的实际渲染帧，不存在伪动态。
- 12/12 新增循环动作首帧与末帧字节一致。
- 所有透明像素边界均留在 1000×1000 画布内。
- 19/19 GIF 输出为 500×500。
- 机器可读 JSON 合同通过语法检查。
- 动态实验室加载 24 个 SVG object，浏览器没有资源失败。

## 视觉检查

- 休眠三连使用同一条紫色毛毯，并保留头部/闭眼可读性。
- 毛线错误动作由规则方框改为曲折连续线，避免读成 UI 面板。
- Blanket Pop、Wind-up Command 与 Edge Peek 的极限帧已内收，避免裁边。
- 24 个动作均在 96px 动态评审板检查轮廓与道具辨认度。
- 未使用文字、进度条、漂浮标点、光晕、速度线、烟雾或阴影来解释状态。

## 评审产物

- [`../previews/all-actions-96px.png`](../previews/all-actions-96px.png)
- [`../previews/complete-motion-lab.png`](../previews/complete-motion-lab.png)
- [`../previews/primary-phases.png`](../previews/primary-phases.png)
- [`../previews/modifier-phases.png`](../previews/modifier-phases.png)
- [`../previews/interaction-phases.png`](../previews/interaction-phases.png)
- `previews/<action>.gif`
- `previews/<action>-contact-sheet.png`
