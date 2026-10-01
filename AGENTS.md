# AGENTS.md — dsh-study-coach

## 改界面之前，先读 `design.md`

**这条是硬要求。** 面板的视觉规范全部写在 [`design.md`](design.md) 里：配色（面三层 / 字四级 /
一个动作绿）、字号表与字重阶梯、间距刻度、组件（按钮 / 卡片 / 导航栏 / 表单 / 标签 / 列表 /
进度条 / 空态，每块都带能直接抄的 CSS）、层次与阴影、Do/Don't。

写新页面、或者动 `assets/style.css` / `assets/practice.css` / `assets/graph.css` 之前：

1. 先读 `design.md`。
2. 色值、字号、字重、行高、间距、圆角一律照它的表来。**别现编一个 15.5px、7px 圆角或者
   `#f6f5f0`** ——规范里没有的，先想清楚再发明，大多数时候你要的那一条已经在里面了。
3. 规则里**不写死色值**，一律走 `var(--x)`；`color-mix()` 混变量可以。
4. 唯一的事实来源是 `assets/style.css` 顶部的 `:root`（浅色）与 `html[data-theme="dark"]`（深色）。
   `design.md` 与 CSS 不一致时，**以 CSS 为准，并把 `design.md` 改回来**。
5. 加了一个新 token、或者改了刻度，要一起动三处：`:root`、`html[data-theme="dark"]`、
   以及 `practice.css` / `graph.css` 里那些 `var(--x, 兜底色)` 的兜底值。

## 常用命令

```bash
node --test                 # 全量测试（不要写 node --test test/，这个 Node 上会把目录当测试文件跑挂）
node scripts/check-live.mjs # 探一遍正在跑的 DSH，看哪些路由还是旧代码
node scripts/preview.mjs    # 不用 DSH，直接把面板起在 19390（改前端时省一次重启）
```

`assets/*` 是每次请求现读磁盘的，改完刷新就见效；`lib/*` 是 DSH 启动时加载的，**必须重启 DSH**。
