# AGENTS.md — dsh-study-coach

## 改界面之前，先读 `design.md`

**这条是硬要求。** 面板的视觉规范全部写在 [`design.md`](design.md) 里：配色（近黑三层 / 白字
四级 / 一条信号青）、字号表与字重阶梯、间距刻度、组件（按钮 / 卡片 / 导航栏 / 表单 / 标签 /
列表 / 进度条 / 空态，每块都带能直接抄的 CSS）、**造型动机**（细规 / 角包 / 切角 / 斜纹 /
菱形 / 索引字 / 硬偏移，一个组件只许用一样）、层次与阴影、Do/Don't。

写新页面、或者动 `assets/style.css` / `assets/practice.css` / `assets/read.css` / `assets/graph.css` 之前：

1. 先读 `design.md`。
2. 色值、字号、字重、行高、间距、圆角一律照它的表来。**别现编一个 15.5px、7px 圆角，或者一个
   表里没有的色值** ——规范里没有的，先想清楚再发明，大多数时候你要的那一条已经在里面了。
3. 规则里**不写死色值**，一律走 `var(--x)`；`color-mix()` 混变量可以。
4. 唯一的事实来源是 `assets/style.css` 顶部的 `:root`（**深色，默认**）与 `html[data-theme="light"]`
   （纸白那一档）；造型那一层集中在同一个文件末尾的「方舟层」。
   `design.md` 与 CSS 不一致时，**以 CSS 为准，并把 `design.md` 改回来**。
5. 加了一个新 token、或者改了刻度，要一起动四处：`:root`、`html[data-theme="light"]`、
   `practice.css` / `graph.css` 里那些 `var(--x, 兜底色)` 的兜底值、以及 `lib/review.js` 顶上那两块色板。
6. 显示字体是 `assets/fonts/` 里的 Rajdhani（SIL OFL 1.1，随包发，`OFL.txt` 别删）。它没有汉字，
   **中文一律落回系统字族、也不加字距**；加字距的只有拉丁编号、数字、路径。

## 常用命令

```bash
node --test                 # 全量测试（不要写 node --test test/，这个 Node 上会把目录当测试文件跑挂）
node scripts/check-live.mjs # 探一遍正在跑的 DSH，看哪些路由还是旧代码
node scripts/preview.mjs    # 不用 DSH，直接把面板起在 19390（改前端时省一次重启）
```

`assets/*` 是每次请求现读磁盘的，改完刷新就见效；`lib/*` 是 DSH 启动时加载的，**必须重启 DSH**。

## `lib/client.js` 不是普通模块

它是**设置 → 学习教练**那一页（「设置 → 内置插件 → 学习教练」是同一个页面的另一个入口），宿主在浏览器里执行的一段脚本（壳子
`window.__ModuleLoader__.load({id, factory})`，跟 `dsh-talk` 一个形状）。改它之前记住：

1. `require` 只能取平台种子表里的模块（react / react/jsx-runtime / cordis / 静态 UI 库），
   外加 `package.json` 里 `dsh.client.inject` 列出的包。**多要一个没列进去的包 = 静默失败。**
2. `exports` 只导出 `apply` / `inject` / `name`；`inject` 是 cordis 服务名，
   `dsh.client.inject` 是客户端模块包名，两码事。
3. 样式走 DSH 主题 token `--dsw-alias-*`，**不要**用 `assets/style.css` 那套 `--ink` / `--card`
   ——那套在 DSH 页面里没有值。`test/client.test.js` 钉住了这一条。
4. `package.json` 的 `dsh.client` / `exports["./client"]` 改了要重启 DSH 才认（bundle 清单是启动时读的）。

插件自己那个网页面板（`assets/`）仍然照 `design.md` 走，两套配色体系别互相串。
