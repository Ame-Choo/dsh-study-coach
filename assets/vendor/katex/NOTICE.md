# vendor/katex —— 从哪来的、什么许可

这一份是 [KaTeX](https://katex.org/) 0.16.47 的**发行产物**（不是源码），随 `dsh-study-coach`
一起发，让面板在没有网络、也不依赖宿主 `node_modules` 的情况下把数学排出来。

| 文件 | 是什么 | 许可 |
| --- | --- | --- |
| `katex.min.js` | KaTeX 本体（UMD，挂 `window.katex`） | MIT，见 `LICENSE` |
| `katex.min.css` | 样式。**改过一处**：每个 `@font-face` 原本挂 woff2/woff/ttf 三个源，这里只留 `fonts/*.woff2`（我们只发 woff2，留着另外两个会让浏览器白跑两趟 404） | MIT |
| `fonts/*.woff2`（20 个） | KaTeX 的排版字体（AMS / Main / Math / Size1-4 / Caligraphic / Fraktur / SansSerif / Script / Typewriter） | **SIL OFL 1.1**，全文见 `FONTS-OFL.txt` |

字体那一条是 KaTeX 自己的口径：代码 MIT，`fonts/` 下那批字体按 SIL OFL 1.1 发。KaTeX 的 npm
包里只带代码那份 `LICENSE`、没有字体许可文件，所以这里把 OFL 1.1 全文补上（取自
<https://openfontlicense.org/documents/OFL.txt>），head 里那几行 Copyright 占位符按原文保留。

**别手改这几个文件。** 要升版本就整包重抄（`assets/vendor/` 只是发行产物的一次拷贝），
`katex.min.css` 的 woff2 收窄也用同一套规则重做一遍。
