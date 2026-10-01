# dsh-study-coach

DSH 的学习教练插件。把一门课拆成知识地图，逐单元记掌握度、排每日任务，并给学生一个看得见进度的网页面板。同源挂在 DSH 自己的 web 服务器上，面板地址 `/study`。

- 对话里的 agent 用 21 个 `study_*` 工具读写全部数据；
- 学生只在面板上看：自评档位、勾任务，以及在面板里直接跟教练对话（整页一个聊天窗口，顶上能选是 DSH 里哪个会话；右下角还有一颗悬浮窗）。

**这个仓库里只有代码，一条学习内容都没有**——学生的目标、地图、掌握度全在数据目录里（见下面「插件是框架，数据在别处」）。

## 安装

先决条件：DSH `>= 0.2.0-rc.1`，Node `>= 22.13.0`。

### 一、插件市场（最省事）

DSH 里装了插件市场（`dshmarket`）的话，打开搜 `study-coach` 点安装。市场目录是按 GitHub `dsh-plugin` 话题自动收录的，所以这个仓库带着这个话题标签就会出现在里面。

### 二、让对话里的 agent 装

直接跟 DSH 说「装一下 `dsh-study-coach` 这个插件」——agent 有 `plugin_manager` 的 `install_bundle`，装完会告诉你结果。

### 三、命令行

在**你自己的 profile 目录**里装（不是这个仓库）：

```bash
cd ~/.dsh/profiles/desktop        # 或者你的 profile 名
pnpm add dsh-study-coach          # 已发 npm 时
pnpm add github:<你>/dsh-study-coach   # 走 GitHub，没发 npm 也行
```

然后把包名加进 profile `package.json` 的 `dsh.profile.bundles` 数组：

```json
"dsh": { "profile": { "bundles": ["dsh-study-coach"] } }
```

### 四、本地源码（改代码不用发版）

```bash
cd ~/.dsh/profiles/desktop
pnpm add link:/绝对路径/dsh-study-coach
```

同样把 `dsh-study-coach` 加进 `dsh.profile.bundles`。

### 装完必须重启 DSH

插件的 HTTP 路由是**进程启动时**挂上去的，不重启不生效。数据不受重启影响。
改代码之后怎么判断「现在跑的到底是新的还是旧的」，见下面「补：改完代码怎么生效」——
那里有两个自查脚本（`scripts/check-live.mjs`、`scripts/preview.mjs`）。

### 卸载

删掉 `dsh.profile.bundles` 里那一项、`pnpm remove dsh-study-coach` 即可。**学习数据不在插件里**（默认在 `~/.dsh/study-coach/`），卸载、升级、重装都不会动它。要换地方就设环境变量 `DSH_STUDY_ROOT`。

## 它管什么

- **学习目标**：学什么、到什么程度、每天多少分钟、最晚什么时候。
- **知识地图**：大类 → 模块 → 最小单元三层（最小单元就是一节网课），草稿定稿两态（定稿前随便改，定稿后改动会退回草稿）。
- **掌握度**：每个知识点记六档状态 + 置信度 + 证据链 + 下次复习时间。六档是
  `没接触过 / 见过 / 能跟做 / 能独立做 / 熟练稳定 / 能讲明白`。
  证据不是分数，是「哪次自评、哪道题、哪张照片」，可追溯。
- **基本工具**：运算、查资料、画图这类横向能力，不属于任何知识点，但决定学得多快，单独一张表。
- **每日任务**：某天要看的课、要做的题、预计多少分钟，可勾完成、可改可删；每条都带跳转按钮，学生点一下直接开那一节网课 / 那份练习 / 做题页。
- **材料**：教辅、网课目录、真题的登记表（名字 + 路径 + 备注）；登记过的东西可以用 `study_files` 列目录、拿到 `/study/file` 链接。
- **每级掌握档案**：大类 / 模块 / 单元三级各一份细账（进度、碰过几个、平均把握、该复习几个、逐点证据）。面板上每级后面一个「档案」小按钮就打开它。
- **总体能力**：横着看全部大类、知识点、基本工具，加最近七天的完成节奏，给一句判词。
- **学习目标库**：一个目标一份档案，可以新建、切换、改名、删掉（回收站），互不打扰。

## 两个使用者

| | 谁 |
| --- | --- |
| 对话里的 agent | 用 21 个 `study_*` 工具读和写全部数据；随包 `skills/study-coach/SKILL.md` 是工作法 |
| 学生 | 面板上他能自己动手的只有几样：自评档位、勾改加今天任务、管清单、切/新建档案、过记忆卡、点「拆成页图」，以及在对话页 / 悬浮窗里直接跟教练说话。**学习内容本身只由 agent 写** —— 目标、材料、地图、错题、画像、每天排什么，都在对话里说 |

## 界面风格：动 CSS 之前先读 `design.md`

面板的视觉规范全部写在仓库根的 **[`design.md`](design.md)** 里：配色（近黑三层 / 白字四级 /
一条信号青）、字号表与字重阶梯、间距刻度、组件（按钮 / 卡片 / 导航栏 / 表单 / 标签 / 列表 /
进度条 / 空态，每块都带能直接抄的 CSS）、**造型动机**（细规 / 角包 / 切角 / 斜纹 / 菱形 /
索引字 / 硬偏移）、层次与阴影、Do/Don't。

**写任何新页面、或者改 `assets/*.css` 之前先读它**，色值、字号、间距、圆角一律照里面的来，
别再现编一个 15.5px 或者 7px 圆角。

唯一的事实来源是 `assets/style.css` 顶部的 `:root` 变量表（**深色，默认**）与
`html[data-theme="light"]`（纸白那一档）；造型那一层集中在同一个文件末尾的「方舟层」。
`design.md` 解释它为什么是这样、什么时候该用哪一个；**两边不一致时以 CSS 为准，
并把文档改回来**。

## 插件是框架，数据在别处

**这个仓库里只有代码，一条学习内容都没有。** 学生的目标、知识地图、掌握度、任务、材料清单——全都是数据，全都落在数据根目录里，跟插件代码分开：

```
<数据根>/
├── registry.json          有哪几个学习目标、现在用哪个
├── profiles/<目标 id>/    一个学习目标一份，里面就是下面那几张表
│   ├── profile.json       学习目标、材料清单、基本工具、总体能力判词
│   ├── map.json           知识地图（大类 / 模块 / 最小单元，单元上挂着网课和练习的路径）
│   ├── mastery.json       每个知识点的状态、证据、错题、复习时间
│   ├── tasks.json         按日期分的每日任务
│   ├── analysis.json      每份材料通读之后的结论：教学定位、每章讲什么、例题习题范围、难度
│   ├── toolbox.json       番茄钟的当前状态 + 清单
│   ├── memory.json        艾宾浩斯记忆卡与它们的排期
│   ├── student.json       学生画像：一条条挂着证据的判断
│   ├── guide.json         面板顶上那句指引
│   └── inbox.json         学生在面板上留的话
├── trash/                 删掉的目标挪这儿，不是真删
└── scratch/pages/         拆页时渲出来的 PNG，过程产物，随时可清
```

默认根目录是 `~/.dsh/study-coach/`（放用户目录，所以插件升级、重装都不会动到学生的东西），换地方就设环境变量 `DSH_STUDY_ROOT`。面板「我的学习档案」那张卡会把实际路径写在下面。

一个**学习目标**对应一份档案目录：换一门课就是换一份档案，互不打扰。所以同一台机器上可以同时学 A、B、C 三门，各有各的地图、掌握度和任务表。

写盘是「先写临时文件再改名」，所以中途断电不会留半个文件。读的时候 JSON 坏了会退回默认值而不是崩掉。

## 对话里的工具

| 工具 | 干什么 |
| --- | --- |
| `study_report` | 一次读全貌（目标、地图、掌握度、今日任务），并给出面板地址 |
| `study_goal` | 改学习目标 |
| `study_map` | 写知识地图：`set` 整份替换 / `append` 追加模块 / `confirm` 定稿。三层结构（大类 `group` → 模块 → 最小单元，最小单元就是一节网课），每个最小单元要挂 `video`（那一节网课的路径）和 `practice`（配套练习的路径） |
| `study_analysis` | 把一份材料通读的结论写下来：教学定位、跟别的材料怎么配、每章页码范围 / 例题 / 习题 / 难度 / 教学作用。做题页的页码题号就从这儿出 |
| `study_record` | 记一条掌握度证据，推进状态。往「能独立做 / 熟练稳定 / 能讲明白」推的时候该单元必须先有够数的 `quiz` / `photo` 证据，否则直接拒（见下节「硬闸门」）。带 `mistake` 就是「这次错了，顺带把错题记下来」（`origin` 必填，标成「已订正」必须同时有 `cause` 和 `fix`）；带 `mistakeId` 则只改那条错题的状态，不新增证据、不动档位 |
| `study_mistakes` | 读错题本：错在哪一步、错因、订正、该哪天复做、现在到哪一档。可按 `status` / `pointId` 筛 |
| `study_plan` | 排每日任务：`add` / `toggle` / `update` / `remove` |
| `study_material` | 加/删材料。`kind` 六选一：`book` 教辅 / `video` 网课 / `notes` 讲义 / `past` 真题 / **`ai` AI 出题** / `other`。写错的类别会被拒（以前照单全收，材料会从所有分组里悄悄漏掉） |
| `study_tool_level` | 记基本工具的水平 |
| `study_archive` | 读某一级的掌握档案（`level=group/module/point` + `key`），含进度、逐点状态、证据流水（`evidence[].id` 就是写学生画像时要挂的那个） |
| `study_ability` | 学生的总体能力：读大盘（`action=get`）或写一句判词（`action=set`，可以带 `from` 说明这句判词综合了学生画像里哪几条判断） |
| `study_student` | 学生画像：`action=list`（默认）/ `add` / `patch` / `remove`。一条一句结论（不超过 120 字，类别 `习惯\|强项\|弱项\|偏好\|背景`），**必须挂 `evidence`**（证据 id 从 `study_archive` 的 `evidence[].id` 拿）。挂不上就不许记 |
| `study_library` | 管学习目标本身：`list` / `create` / `select` / `rename` / `remove` |
| `study_files` | 看材料目录：`list` 列目录 / `stat` 看存在 / `url` 换成 `/study/file` 链接 |
| `study_pages` | 把扫描版 PDF 的某几页渲成编号 PNG（`材料/路径 + from/to`），拿去看图认页码——「这一页讲的是哪个知识点」只能这么看出来 |
| `study_book` | 整本书拆成页级索引：`action=info` 数页数、读书签 / `action=build` 后台把每一页渲成 `p0007.png` / `action=pages` 查某个单元在哪些教辅的哪几页 |
| `study_focus` | 番茄钟：`action=start` 起一轮（`minutes` / `kind=work\|break` / `taskId` / `label`）/ `action=stop` 停掉 / `action=status` 看还剩多久。**存的是绝对时刻不是倒计时**，所以起完就别管了，别轮询等它 |
| `study_todo` | 清单：`action=add` / `toggle` / `patch` / `remove` / `list`（可按 `status=open\|today\|done` 筛）。这是学生自己想办的事，跟 `study_plan` 排的学习任务是两码事 |
| `study_card` | 记忆卡：`action=add`（`front` / `back` / `kind` / `pointId`）/ `due` 拿该背的 / `review`（`id` + `grade=忘了\|模糊\|记住\|秒答`）/ `patch` / `remove` / `list`。排期由服务端按艾宾浩斯算，**跟掌握度是两套账** |
| `study_guide` | 在面板顶上放一句指引，把学生叫回对话 |
| `study_inbox` | 读学生在面板上的留言，读完标掉 |

这 21 个工具是写给别人家 agent 用的，不是写给人看的：每个描述都交代「什么时候调、参数从哪儿拿、返回怎么读、跟别的工具什么顺序」，参数不对会直接抛中文错误。输出 schema 用 `additionalProperties: false` 把数组条目的字段钉死了（`modules[].points[].id`、`tasks[].id`、`materials[].id`、`items[].id`），因为 `study_record` / `study_plan` / `study_material` / `study_analysis` 的必填输入就得从这些数组里取。

「先把整本教辅读一遍、分析它教什么」这件事不是靠谁记得，是写死在随包 SKILL.md 第 2 节里的：材料登记完就得通读，结论写进 `study_analysis`，画地图和排任务都从这份结论里取。册子厚就分批喂 `chapters`，或者拉几个子 agent 并行读——同一个 `no` 会覆盖，读到哪写到哪。

写 schema 时踩过的两条宿主规矩，改代码前先看一眼：

- 每个 `object` 节点都得显式写 `additionalProperties`（`true` 或 `false`），不写会被 schema 编译器拒；写了 `false` 就必须把字段列全，多一个字段返回值就违规。所以返回给模型的对象都走 `pickTask` / `pickModule` 这类投影函数裁字段。
- `required` 要么不写、要么写 `true`。写 `false` 会抛 `parameters.X.required must be true when present`。这意味着一部分必填只能靠描述和 `execute` 里的中文报错拦（比如 `study_map` 只在 `action=set` 时必填 `modules`，无法用 schema 表达）。

「一次只推进一档」这条也在 `gateStage()` 里：`study_record` 里填跳了会被压回上一档，返回的 `summary` 里写「跳档」；面板那颗自评按钮跳档时返回 `clamped: true`，`note` 里说一句「你点的 X 跳档了，先落在 Y」。

压档之后还有一道**硬闸门**：往「能独立做 / 熟练稳定 / 能讲明白」推的时候，该单元底下必须先有够数的「真做过」证据（`kind` 是 `quiz` 或 `photo`），不够就直接抛错，写清楚现在有几条、还差几条。`STAGE_NEEDS = { 能独立做: 1, 熟练稳定: 2, 能讲明白: 3 }`、`WORK_KINDS = ['quiz', 'photo']` 都在 `lib/schema.js`（`lib/store.js` 转出来，`import … from './store.js'` 的老写法照样能拿到）。

这道门只有一份实现：**`lib/map.js` 的 `gateStage()`**。教练的工具和学生自己在面板上点的那颗档位按钮走的是**同一条** —— 以前那条路是直通的（他点一下「能讲明白」，档位就真成了能讲明白，门只管得住教练），可档位只有一份账，门就分不出两条路。自评被挡下来时**不报错**：记下他的说法、档位不动，返回里的 `note` 说清还差几条、`advanced: false`，面板把这句话原样 toast 出来（`practice.js` 那条还会用返回的 `point.stage` 重画档位条）。`test/mirrors.test.js` 钉住这两条规矩不许在别处重抄（`STAGE_NEEDS` 只许在 `lib/map.js` 里被读）。

闸门跑在**压过之后的**档位上，所以跳档落地到一个设门的档时照样挡得住（`M1.2` 在「能跟做」上直接填「熟练稳定」，压成「能独立做」，那道门过不去）。「能跟做」及以下不设门——那几档本来就只是「见过 / 跟着走过」，允许自评。

配套还有一份随包技能文档 `skills/study-coach/SKILL.md`（工作法：怎么问目标、怎么把材料变成地图、六档怎么判、任务怎么排、哪些事不许做）。预设里 `skill-filesystem` 那一行用 `customSkillDirs` 指向包内 `skills/`，由 agent 按需加载。

## HTTP 接口

读（20 条）：`/study/api/state`、`/study/api/summary`、`/study/api/point/:id`、`/study/api/practice`、
`/study/api/archive`、`/study/api/ability`、`/study/api/library`、`/study/api/tasks`、
`/study/api/mistakes`、`/study/api/review`、`/study/api/materials`、`/study/api/material`、
`/study/api/material/tree`、`/study/api/point/pages`、`/study/api/toolbox`、`/study/api/memory`、
`/study/api/student`、`/study/api/chat`、`/study/api/chat/sessions`、`/study/api/panel`。

写（27 条）：`/study/api/goal`、`/study/api/materials`、`/study/api/materials/remove`、
`/study/api/materials/import`、`/study/api/materials/build`、`/study/api/tools`、
`/study/api/inbox`、`/study/api/map/module`、`/study/api/map/replace`、`/study/api/map/confirm`、
`/study/api/mastery`、`/study/api/ability`、`/study/api/library`、`/study/api/library/restore`、
`/study/api/task`、`/study/api/task/update`、`/study/api/task/remove`、`/study/api/task/toggle`、
`/study/api/practice/ask`、`/study/api/focus`、`/study/api/todo`、`/study/api/memory`、
`/study/api/student`、`/study/api/chat/send`、`/study/api/panel`、`/study/api/reset`、
`/study/api/material/upload`。

`/study/api/material/upload` 是流式收上传（超过 300 MB 直接拒，让用户改走「粘贴本机路径」），
收完之后一样进 router；真正在 router 之前就拦下的只有 `/study/page?path=…`（把拆出来的页图
发出去，只放行数据根 `pages/` 底下的文件）和 `/study/file?path=…`。

实现见 `lib/routes.js`，它不碰 cordis，所以能脱开 DSH 单测。`/study/api/inbox` 与
`/study/api/practice/ask` 是**异步**的（要把话投进会话），`lib/handler.js` 那边是
`await router(...)`，别改成同步调用。

静态资源只从 `assets/` 出，路径穿越会被挡回 404。

## 开发

> 要动代码，先翻 **[`DEV.md`](DEV.md)**：它是给下一个改这个仓库的人（大概率是个 agent）写的地图——
> 请求链路、数据落盘、加一条 API / 加一个工具 / 加一个面板子页面各要动哪几处、测试 harness 怎么用、
> 本地怎么验收、怎么发版、以及一页踩过的坑。下面这一节只留最小上手。

```bash
git clone <仓库地址>
cd dsh-study-coach
npm install          # 只为拿到 @deepseek-ai/* 的宿主包，用来跑测试
node --test
```

`test/plugin.test.js` 会假装自己是 DSH：造一个 ctx，把 `apply()` 真跑一遍，
再把 `/study` 的 handler 挂到真 HTTP 服务器上打请求。改完东西先跑它。

### 代码长什么样

一层一层往下，谁都不回头 import 谁：

| 文件 | 管什么 |
| --- | --- |
| `index.js` | 插件入口：定数据根、造 `Store` 与 `Library`、把 router / handler / 工具注册起来 |
| `lib/schema.js` | 常量表、`nowIso`、各种空档案的默认形状。**零依赖的叶子**，谁都可以 import |
| `lib/store.js` | 盘上那一层：读写 JSON、`Store.snapshot()`。`export * from './schema.js'`，老调用点照旧从 `./store.js` 取常量 |
| `lib/map.js` | 地图 / 掌握度 / 错题 / 每级档案 / 总体能力 / 任务视图 |
| `lib/analysis.js` | 材料通读的结论、页级归类 |
| `lib/notice.js` | 面板顶上那句指引、学生留言 |
| `lib/memory.js`、`lib/toolbox.js`、`lib/student.js` | 记忆卡排期、番茄钟与清单、学生画像，都是纯函数，不碰磁盘也不碰 HTTP |
| `lib/library.js` | 档案根 → 每个学习目标一个子目录，外加回收站 |
| `lib/paths.js` | 页图目录与上传目录只算这一处（`pagesRootOf` / `uploadRootOf`） |
| `lib/routes.js` | 所有 `/study/api/*`；不碰 cordis，所以能脱开 DSH 单测 |
| `lib/handler.js` | `/study/*` 的静态页、文件、页图、上传 |
| `lib/tools.js` | 21 个 `study_*` 工具的定义与 execute |
| `lib/review.js` | 今日复盘那张 2048×1180 的海报（服务端现拼 SVG） |
| `lib/bridge.js`、`lib/chat.js` | 往 DSH 会话里投递、读会话快照。都是**可选**服务，拿不到就 `available:false` |
| `lib/pages.js`、`lib/build-pages.mjs` | 把扫描版 PDF 一页一张渲成 `p0007.png`；拆书走子进程，免得把面板进程僵住 |
| `lib/preset.js` | 「学习教练」这个 agent 预设的定义（直接 `agentPresets.register`，不走 patch） |
| `lib/panel-server.js` | 插件自己起的那个本地小服务器，绕开 DSH 内嵌浏览器「不许开 DSH 自己」的限制 |
| `assets/` | 面板 `panel.*`、做题页 `practice.*`、读卷页 `read.*`、图谱 `graph.*`、六档表 `stages.js`、URL 规则 `urls.js`、小 markdown 渲染器 `md.js`、启动规则 `boot.js` |

`assets/` 那一摊的规矩写在 [design.md](design.md) 里，**动 CSS 或新写页面之前先读它**。

两道额外的护栏：

- `test/schema.test.js` 请宿主的 `defineTool` + `validateJsonSchemaValue` 把 21 个工具真跑一遍（写进临时档案），schema 跟返回值对不上就会当场失败。这台机器解析不到宿主包时这条会跳过 —— 跑完看一眼 `skipped` 是不是 0。
- `test/preset.test.js` 查预设定义的结构、平台开关、人设文案，以及 `skills/study-coach/SKILL.md` 的 frontmatter 合不合规（`name` 必须 kebab-case）。

本机开发时的 `node_modules/@deepseek-ai` 是个 junction（Windows）／软链，指到
`~/.dsh/profiles/node_modules/@deepseek-ai`，这样不装依赖也能解析到宿主的包。
它是链接不是拷贝，`.gitignore` 已经把 `node_modules/` 排除；干净 clone 之后跑
`npm install`，npm 会自己按 `peerDependencies` 去 npm 上拉这两个包。

发布流程（打标签、发 npm、进市场）写在 [PUBLISHING.md](PUBLISHING.md)。

## 还没做

- 拍照上传作业与自动批改（现在只能靠 `study_record` 的 `kind=photo` 记一条文字结论，图片本身进不了档案）。
- 摸底卷自动出题（现在是在对话里出，判完记 `study_record`）。
- 侧栏页签（走 dsh-better-sidebar 的 `registerTab`），现在面板只在自己那个端口上。
- 学生账号 / 多学生。现在一台机器一份档案根，多的是「一个学生多个学习目标」。

## 两个地址

- `http://127.0.0.1:19387/study` —— 挂在 DSH 自己的 web 服务上，同源。系统浏览器直接开。
- `http://127.0.0.1:19388/study` —— 插件自己起的独立端口（默认 19388，被占就往后挪一位）。DSH 内嵌 Browser 页签不许打开 DSH 自身的地址，只认这条。

两条地址是同一个 handler，接口路径完全一样，面板代码不用改。独立端口只监听 127.0.0.1，DSH 关掉它就跟着关。

## 补：对话负责写，面板负责看

> **从这里往下都是改动流水**，一条一条记着当时为什么这么改。里面的
> 「工具从 7 个变 9 个」「测试 93 → 101 个」都是**那一次的快照**，不是今天的数字——
> 今天的真值一律以代码为准：工具数看 `lib/tools.js` 末尾 `buildTools` 返回的那个数组，
> 测试数看 `node --test` 最后打印的 `tests`。

这是按「方向纠正」改的一版，规矩变了：

- **学习目标、材料、知识地图，只有对话那边能写**（`study_goal` / `study_material` / `study_map`）。面板上原来那几个表单已经拆掉 —— 学生自己在面板里填目标是错的，目标得是问出来的。
- 面板上还能做的三件事：点知识点自评六档、勾掉今天做完的任务、确认地图草稿（「看过了，就这样」）。
- 面板顶上那句指引由 `study_guide` 写。**没写就整条不画**（早先垫过一句「本页仅供查看，改动请在对话里提」，每页都挂着：既是废话，也不准——面板上能动手的其实不少）。
- 面板底下有个留言口，学生留的话进 `inbox.json`；下次对话用 `study_inbox` 读，读完标掉。（**这个口后来删了**，面板改成直接开一个对话窗口打 `POST /study/api/chat/send`；`inbox.json` 与 `study_inbox` 还在，见「补：五」。）
- 档案文件从 4 个变 6 个：多了 `guide.json`（面板指引）和 `inbox.json`（学生留言）。
- 工具从 7 个变 9 个：多了 `study_guide`、`study_inbox`。`study_report` 的返回里也带上了 `guide` 和 `inboxItems`。
- HTTP 多一条：`POST /study/api/inbox {text}`。

## 补：材料要先读一遍

- 多了一份 `analysis.json`：每份材料通读之后的结论（整份的教学定位 `role`、跟别份材料怎么配 `pairing`、每章的页码范围 / 例题 / 习题范围与题量 / 难度 / 这一章的教学作用），由 `study_analysis` 写。`chapters` 可以分批喂，同一个 `no` 是字段级合并——这一批没写的字段留着上一批的，所以能一边读一边写。
- `study_report` 和 `study_material` 返回的材料条目多了 `analyzed`（通读过没有）和 `chapterCount`（记了几章）；后来又加了 `pagedCount`（其中几章已经拆到具体页码，见文末「教辅拆到页」）。
- 材料删掉时它的分析一起删（`dropAnalysis`），免得以后重新登记同名材料时撞上旧结论。
- 工具从 9 个变 10 个，多的是 `study_analysis`。
- 随包 SKILL.md 第 2 节加了一整段「材料到手别急着排任务，先通读一遍」：怎么抽 PDF 文本（系统 python 有 pypdf）、扫描件怎么看（`read_image`）、厚册子怎么分批或拉子 agent、每章要记哪几样、`coverage` 怎么老实填。画地图和排任务都要从这份结论里取，没读就排作业，页码题号多半是错的。

## 补：图谱、「打开」按钮、文件服务

- 面板上的知识地图是画出来的**三层折叠树**：大类 → 模块 → 最小单元。默认只摆大类（一科就那么几个），点大类展开模块，点模块展开单元——不是一上来全摊平。
- 最小单元旁边挂着两个小按钮：「看课」开那一节网课，「做题」进那一节的**做题页**。单元本身点一下还是自评，跟下面的列表联动（会滚到那一条）。
- 没挂网课的「看课」按钮是灰的，点了不会干瞪眼——它会替你往 `inbox.json` 留一句（「M1.1 xxx 这一节还没挂网课，帮我配上」），下次对话读到就补路径。
- 画布**能拖着挪**（中间有一版按用户当时那句「拖动可以关掉」把平移整条拆过，后来又催「不是让你改成不可动的吗」；再后来 m21561 又让装回来——所以现在是**有平移**的）：按住画布拖就行，**挪过 4px 才算拖**，拖起来光标变抓手、画布跟手；按在右上角那两颗工具按钮上的不算拖。普通滚轮照旧滚页面，**要缩放按住 Ctrl／⌘ 滚轮**（0.4x 到 2.4x）。右上角两个按钮：复位视图、全部收起。**「按住板块挪一下再松手」不算点**——拖过 4px 就让松开时那一发 click 失效，免得拖完画布顺手把板块折叠掉。索引板与工具箱钉在视口上（它们挂在 `<svg>` 上、不在视图层里），拖动画布时不动。
- 实现在 `assets/graph.js` + `assets/graph.css`。布局是确定性递归——子树高度求和、父节点摆在这块高度的中间，没有力导向、没有动画循环，所以好测。窗口大小变了会重排（防抖 160ms）。
- 展开状态和视图位置存在模块级的 `state` 里，跨调用保留：自评一下不会把画布弹回原位。
- 面板是**动态** import 它的——图谱模块没了或者写坏了，顶多少画一张图，自评那些按钮不受影响。
- 每个任务多了 `open` 字段（要打开的那份东西：本地绝对路径或 http 链接）。面板上非空就渲染成一个「打开」链接，走 `GET /study/file?path=...`，`target="_blank"`。
- `GET /study/file` 只放行**已登记材料里的文件，或者材料文件夹底下的文件**——不然面板就成了随便读硬盘的后门。找不到或不在范围内回 404。
- 点到的如果是**文件夹**（看课入口给的正是一节课的文件夹）就渲染一个目录页：`目录` 标记、文件名一条行、点进去接着开、上面有「上一层」。学生因此能从一节网课里自己挑要播哪个题型，而不是被按在一个 mp4 上。
- 它支持 Range 请求（206 + `content-range`），所以视频能拖进度条；`content-type` 按扩展名给：mp4 / m4v / webm / mov / mkv / mp3 / pdf / txt / md。

## 补：做题页、折叠式掌握度、重叠 bug

- **做题页**：`/study/practice?point=<知识点 id>`。图谱上单元的「做题」按钮、以及别处要练哪一节，都开这页。页里四块：这一节（看课 / 打开配套练习 / 出处）、教辅里对应哪儿（逐章列出页码、习题号、难度，带「翻开」链接）、想练手（「让 AI 出几道新题」写进 `inbox.json`）、我现在到哪一档（六档自评）。
- 章节靠 `GET /study/api/practice` 给：它把所有已分析的章节摊平，再拿知识点的 `source` 去对（章号或章节名），一个都对不上就把整份教辅摆出来——总比空着强。实现在 `lib/routes.js` 的 `chaptersFor()`。
- 做题页是独立页面 `assets/practice.html` + `practice.js` + `practice.css`，六档和配色抽到了 `assets/stages.js`。**这一段当时写的是「只给这页用，面板那份还内联着」——后来收掉了**：面板与图谱都改成从 `assets/stages.js` 取，`test/mirrors.test.js` 钉住前后端那几张表不许再各写一份。`lib/handler.js` 里给 `/study/practice` 单开了分支。
- **掌握度百分比**：`lib/map.js` 里有 `STAGE_SCORE`（没接触过 0 / 见过 0.2 / 能跟做 0.4 / 能独立做 0.6 / 熟练稳定 0.8 / 能讲明白 1）、`progressOf()`（一组知识点算平均）、`progressByGroup()`（按大类、按模块各算一份）。`Store.snapshot()` 多返回 `progress: { overall, groups, modules }`，面板直接用，不用再算。
- 面板下面那份列表改成了**两层折叠**：默认只有大类（后面跟百分比条），点开才见模块（也带百分比），再点开才是最小单元和自评按钮。从图谱上点一个圆点，它所在的大类和模块会自动撑开、滚到那一条。
- **三级图标重叠**是个真 bug，已修：`assets/graph.js` 递归往下传 y 的时候是 `baseY + node.top`，漏掉了父节点自身那半截高度（`node.y - node.subH / 2`），所以两个模块的第二层起点都算成 0。改成 `baseY + node.y - node.subH / 2 + node.top` 之后，单元圆点间距恢复正常。顺手给单元加了 `kg-unit-bg` 底色，看着像一张卡片。
- `POST /study/api/map/module` 原来只认 `body.id`，不收 `group`，大类会丢。现在两种形状都吃（裸模块或 `{ module: {...} }`），并且 `group` 存得住。

## 补：每级档案、总体能力、任务跳转、目标库、全部 agent 化

这一版按「六点新要求」改的，都落在同一套数据上：

- **每级一份掌握档案**：`lib/map.js` 的 `archiveFor(map, mastery, level, key)` 给大类 / 模块 / 单元三级各生成一份账（`progress` / `total` / `touched` / `avgConfidence` / `byStage` / `due` / 逐点状态与证据流水 / 该级证据汇总）。面板上大类的头、模块的头、单元那行后面各挂一个「档案」小按钮，弹层里就是它。工具侧是 `study_archive`，HTTP 侧是 `GET /study/api/archive?level=&key=`。三级算的是同一套东西，所以「函数 60%」跟它底下模块的百分比永远对得上。
- **总体能力**：`abilityReport(state)` 横着把所有大类、所有点、所有基本工具、最近七天的完成节奏摊成一份大盘，外加一句判词（`judgement {text, level, updatedAt}`，由 `study_ability action=set` 写）。面板顶部那张「总体能力」卡就是它：大盘百分比 + 六段构成条 + 各大类 / 卡住的地方 / 该复习了 / 最近七天四块。工具侧 `study_ability`，HTTP 侧 `GET|POST /study/api/ability`。
- **任务能跳过去，也能改能删**：任务多了 `note`；`taskView()` 把一条任务摊成带按钮的形状——命中 `target` 那个单元就自动补上「看这节网课」（`point.video`）、「这一节的讲义」（`point.practice`）、「做题 / 看掌握度」（`/study/practice?point=`）；`kind=watch` 的任务改成**看课优先**：「看这节网课」排第一，最后一个按钮是「看完去做练习」（同一页，只是把练习接在看课后面）。面板上任务行里可以**改**（标题 / 类型 / 分钟）和**删**。工具侧 `study_plan` 从 `add|toggle` 扩成 `add|toggle|update|remove`；HTTP 侧多了 `POST /study/api/task/update` 和 `POST /study/api/task/remove`。
- **学习目标库**：`lib/library.js` 的 `Library` 类把「档案根 → 每个目标一个子目录」管起来（`list / create / select / rename / remove`，删掉是移到回收站，最后一个删不掉）。换目标、加一门课、清掉不学的，面板最后一张卡上就能做；工具侧是 `study_library`，HTTP 侧是 `GET|POST /study/api/library`。老的单档案根仍然能用（`library.supported` 是 false，那几个 action 会老实回「这个档案根只装得下一个档案，换不了」）。
- **文件工具**：`study_files`（`list` 列目录 / `stat` 看存在 / `url` 换成 `/study/file` 链接），只能看登记过的材料范围内的路径，好让 agent 在写 `video` / `practice` / `open` 之前先确认文件真在。
- **全部 agent 化**：随包 `skills/study-coach/SKILL.md` 新增第 9 节「面板、档案、目标库、文件」，讲清面板上有什么、每一级档案什么时候翻、总体能力判词什么时候写、目标库怎么切、文件工具怎么用；并把「不许把面板/档案/目标库当摆设」「不给打不开的路径」写进禁令。`study_report` 的返回里 `panelUrl` 现在是必读项。
- **通用性**：`lib/`、`assets/`、`skills/` 里没有作者测试用的学科内容了（举例一律中性化）。测试 fixture 里的线性代数 / 行列式是故意留的中性数据。
- 测试从 89 个加到 **92 个**：新增 `test/panel.test.js`，用最小 DOM stub 把 `assets/panel.js` 真的跑一遍（渲染 + document 事件委托 + 表单提交），断言总体能力卡、三级档案按钮、任务跳转链接、改删任务、目标库、以及草稿地图的定稿按钮都在。`test/schema.test.js` 也扩到覆盖 `study_archive` / `study_ability` / `study_files` / `study_plan update+remove` / `study_library` 全序列。

## 补：改完代码怎么生效（这条最坑，先看这里）

面板的 js / css 是**每次请求现读磁盘**的，服务端路由是 **DSH 启动时加载**的。所以「改了 `lib/` 没重启 DSH」会变成最难查的一种状态：页面看着是新的，按钮点下去全 404 —— 响应体是 `{"ok":false,"error":{"code":"not-found","message":"unknown study route"}}`。热重载、禁用再启用插件、改 `cordis.patch.yml` 都换不掉已经加载的模块，**只能重启 DSH**。

两个自查 / 自救的小工具：

- `node scripts/check-live.mjs`：探一遍正在跑的实例（默认 19387、19388），逐条打印「新 / 旧」。有缺的说明进程里跑的还是旧代码，退出码 1。
- `node scripts/preview.mjs`：不用 DSH，直接把面板起在 19390（`DSH_STUDY_PREVIEW_PORT` 可换）。改前端时省一次重启；DSH 那头还是旧代码、又不想现在重启时，也能拿它临时用。数据目录跟 DSH 那份是同一处，别两边同时写。

面板自己也会防这一手：开机时先探一遍那几条新路由，缺了就顶上挂一张体检卡，写清楚缺哪几样、坏在哪儿、为什么会这样、怎么办（`probeCapabilities()` / `healthReport()` / `healthCard()`）；真的点到那些按钮，也是 toast 说一句，而不是默默开出一个 404 页。

### 体检卡：不是「有没有坏」，是「现在最该动哪儿」

原来顶上那条只是一句「服务端还是旧代码」（`staleCard()`），坏消息和好建议混在一句里，学生看完也不知道先干什么。现在它分三档：

| 档 | 意思 | 例子 |
| --- | --- | --- |
| **挡路的** | 不修的话页面上有一整块是坏的；但他自己修不了，只能重启 DSH | 服务端还是旧代码 |
| **该修的** | 不挡路，但拖着迟早出事 | 知识地图还是草稿；学习目标还缺 3 项；2 份材料登记了但没通读；画像里 1 条判断引的证据找不到了；今天排了 90 分钟、比每天能学的多 30 分钟；错题本 3 道挂着「待验证」 |
| **顺手能做的** | 现在不做也没什么 | 一份材料都还没登记；5 个单元还没挂练习材料；一条掌握度证据都还没记；今天有 2 张记忆卡到点了 |

几个刻意的选择：

- **每条都带一句「为什么」，不只是一句结论。** 「学习目标还缺 3 项」后面必须写清缺的是 `outcome` / `deadline` / `minutesPerDay`，以及「没有分钟数就只能靠猜着排任务」——不然它只是又一个要关掉的提醒。
- **能自己修的都配一颗跳转按钮**，`data-nav` 直接换页（点击处理器读的是 `event.target.closest('[data-nav]')`，所以 `<button>` 也行，不限于 `<a>`）。**挡路那一档偏偏不给按钮**：这不是学生点得回去的问题，给了反而是误导。
- **三档全空就整张卡消失**，不占地方。所以主页上有没有体检卡、多长，本身就是一句「现在这摊子有多干净」。
- **判据全部来自已有的数据**（`state.map.status`、`profile` 的三个字段、`analysis.byMaterial`、`student.orphans`、今天的 `minutes` 合计、`mistakes.byStatus['待验证']`、`memory.dueTotal`），没有为这张卡新加任何字段——能算出来的东西不存第二份。

## 补：面板能指挥对话了，练什么在做题页里定

这一版解决三件事（面板说不了话、教辅页码查不出来、任务与练习各说各的）。

### 一、面板 → 对话 的那条线（`lib/bridge.js`）

原先面板只能说「留了话」，写进 `inbox.json` 就完了，得等学生下回在对话里开口我才翻得到。现在真投递：

- `createBridge({ resolve })` 拿 host 的 `sessionController`，`send(text)` 走
  `prompt({ requestId, sessionId, mode: 'queue', content: [{type:'text',text}] }, signal)`，
  把面板上的话当成一条真正的用户消息送进会话——**我立刻就会被叫起来**。
- 挑哪个会话：`list()` 本来就按活动时间倒排，取第一个 `sessionId && !parentSessionId && origin !== 'subagent'` 的；投成功就把 `sessionId` 记住，下一句不再挑。
- `sessionController` **不写进 `inject`**：是个可选增强，缺了面板照样能用（留言先存着），写进去反而会让整个插件在有服务缺席的机器上装不上。`ctx.get('sessionController')` 外面裹了 try/catch。
- **投不出去不丢话**：`inbox` 路由永远先把话存进 `inbox.json`，再试投递，返回体里 `pushed` / `pushError` 如实说。面板据此说「发出去了，他马上就能看到」还是「先存下了（原因），回对话里跟我说一声」。

### 二、「教辅里对应哪儿」为什么一直是空的

两个原因叠在一起，都不是显示问题：

1. **`analysis.json` 是空的**——四份登记过的材料一份都没跑过 `study_analysis`，所以 `chaptersFor` 没东西可给。
2. **匹配逻辑本身是坏的**：`Number(String(c.no).replace(/\D/g,''))` 把章号 `1.1` 压成 `11`，永远配不上 `source` 里的 `[1,1,2]`。改成 `chapterNoOf` + `mentionsNo`（整段相等才算，相邻章号里的 `1.1` 不算命中 `1.1` 章）。

顺带把形状改对了：讲义常常是**一章一份 PDF、页码各自从 1 起**，所以条目带 `file` 字段（`upsertAnalysis` 与 `study_analysis` 的 chapters 都加了），点「翻开」直接开那一份，而不是开一整个目录。三段兜底：

- 按章号/标题直接命中 → 用命中的章节；
- 写法不同（只写章号、或章号带标题）→ 松一点再匹配一次；命中章节没带 `file` 而这一节自己的 `practice` 章号对得上 → 借它的文件填上；
- 全落空 → 用 `point.practice` 造一条「这一节的讲义」摆出来；连 `practice` 都没有，才退回整份材料。

### 三、做题页：练什么当场定

`GET /study/api/practice` 那页现在有四块：这一节（看课 / 翻讲义）、教辅里对应哪儿、**练什么你定**、自评档位。「练什么」三选一，走同一个 `POST /study/api/practice/ask`：

| mode | 干什么 |
| --- | --- |
| `ai` | 拼一句「【面板·做题】我想练「M1.1 定义与几何意义」…给我出几道题」投进对话，我接着出题 |
| `self` | 写一句（重做错题 / 背公式 / 专练某一类）+ 分钟数，直接用 `addTask` 落成今天的任务，不打扰对话 |

「刷现成的」那块列的是能直接翻开的：这一节的讲义、命中的章节文件、以及 `kind=past` 的真题材料。投递结果（`pushed` / `pushError`）原样回给页面，成没成如实说。

### 四、任务以网课为主线

`taskLinks()` 现在看 `kind`：`watch` 的任务「看这节网课」排第一，末尾是「看完去做练习」；顺序反了学生一点就跳过课直接做题。面板上 `assets/panel.js` 的 `taskView` 副本同步了这个规则。

### 测试

93 → **101 个**：新增 `test/bridge.test.js`（7 个：没有服务 / 空话 / 挑会话跳过子 agent / 投成功记住会话 / 投递被拒不抛 / 挑不到 / resolve 抛错）和 `test/ask.test.js`（1 个长用例，把「页面按钮 → 服务端 → 假 sessionController」整条线跑通，连「通道断了话也要留下」和 11.1 不被 1.1 误伤都钉住了）。`test/panel.test.js` 里任务跳转那几条换成看课优先的顺序断言。

## 补：教辅拆到页 —— 从「哪一份」到「第几页」

上一版只到「这一节对应哪一章、那一章有几页」。学生的原话是：这样点进去还得自己翻十六页找。这一版把页码那条链子接通了。

### 一、为什么必须拆成图

扫描版讲义**就是一页一张位图**：`pypdf` 看 `/XObject` 只有一个 `/Image`，`extract_text()` 对前几页返回 0 个字符。所以「这个知识点在第 6 页」这句话，**只能把那一页渲成图片、看一眼、才知道**。

### 二、`lib/pages.js`

- `findPython(home)`：`DSH_STUDY_PYTHON` → `<home>/.dsh/dsh-runtimes/dsh-primary-runtime/dependencies/python/python.exe` → `DSH_PYTHON` → `python` / `python3`。给的是不存在的路径就继续往后找，不把死路径当答案。
- `renderPages(pdfPath, { outDir, from, to, dpi })` → `{ ok, dir, total, pages:[{ page, file }] }`。内联一段 python（`import pymupdf`）逐页存 `p%04d.png`，**已经渲过且非空的页直接跳过**，所以重复调不重来。一次最多 40 页，越界、缺 pymupdf、文件不在都给各自的人话，不糊一句「失败了」。
- `pagesDirFor(root, pdfPath)`：路径 sha1 前十位做后缀，同一份 PDF 永远落同一个目录。
- 图片落在档案目录下的 `scratch/pages/`，**不进工作区**——那是过程产物，重渲一份就没了，不该混在插件源码里。

### 三、`study_pages` 这个工具

`study_pages({ materialId 或 pdfPath, from, to, dpi })`。`materialId` 指向一个装着好几份 PDF 的目录时会报错并给一份现成的路径，不替你瞎挑。

用法写死在它的描述和 SKILL.md 第 2 节里：**渲一小段 → 逐张 `read_image` → 边看边记「这一页是哪个知识点」→ `study_analysis` 把这些写进对应章节的 `marks`**。`marks` 每条形如 `{ label: '这一页讲什么', page: '6', pointId: 'M1.1' }`。

### 四、页码怎么变成「一键跳转」

- `lib/analysis.js` 的 `upsertAnalysis` 把 `marks` 存下来（`marksOf` 裁字段：label 和 page 缺一个就丢，page 只留数字）；`study_analysis` 的章节 schema 和 `pickChapter` 都带上了它。
- `GET /study/api/practice` 除 `chapters` 外多返回一个 **`pageHits`**：把命中的 mark 摊平，带上 `file` / `materialId` / `no` / `title`。判定在 `marksFor()`：**有 `pointId` 就只认 pointId**（那是 agent 亲手绑的），没有才退回标题互含，且 label 至少 3 个字——章号相近的两份讲义不会互相误伤。
- 做题页把这些渲染成一排页码按钮：「这一页讲什么 · 第 6 页」，链接是 `/study/file?path=…` 拼 `#page=6`——Chrome 自带的 PDF 阅读器认这个 fragment，点开直接在那一页。
- 一份材料**没拆过页**时，页面底下直说：「这几章现在只到『哪一份文件』，还没到『第几页』。让我把这份讲义拆成一页一页看一遍，就能按知识点直接跳到页码。」这跟「坏了」是两回事，得让学生看出来。
- `study_report` 的 `materials[]` 和 `get /study/api/state` 都带 `chapterCount` 与 `pagedCount`，一眼看得出哪份材料还停在校级。

### 五、怎么知道自己那份材料到没到页

一份材料 `marks` 全空时，做题页底下会直说「只到哪一份文件，还没到第几页」；`study_report` 的 `materials[]` 和 `GET /study/api/state` 都带 `chapterCount` 与 `pagedCount`（`pagedCount` 是带页码的章数），一眼看得出哪份还停在校级。补的办法就是同一套流程：`study_pages` 拆页 → 逐张看 → 写 `marks`，`pagedCount` 会一格一格涨上去。

**一条容易踩的坑**：讲义 PDF 的物理页往往和书上印的页码差一截（印「2」的那页是 PDF 第 1 页）。`marks` 里记的必须是**物理页**，因为浏览器 PDF 阅读器的 `#page=N` 认物理页，记印数就会整体跳偏。

### 六、测试

107 → **112 个**：新增 `test/pagemarks.test.js`（2 个：`marks` → `pageHits` 整条链，含「页码按从小到大排」「pointId 对不上的不能借给别人」「没拆过页就诚实地空着」）和 `test/practice-ui.test.js`（3 个：真跑 `assets/practice.js`，断言渲染出 `.pg-btn` 且 `href` 带 `#page=4` / 没拆页时那句实话 / 点「让 AI 出几道」真的把 `{pointId, mode:'ai', text}` 递到 `/study/api/practice/ask`）。`test/pages.test.js` 里那条 marks 落盘的断言也跟着变严了。

## 补：两种界面模式 + 多科目任务

### 一、两种模式

同一份面板，两种用法，页面自己判断，也能手切：

| 模式 | 什么场合 | 长什么样 |
| --- | --- | --- |
| **侧栏** | 挤在 DSH 内嵌 Browser 那条窄栏里 | 每张卡折成一条按钮，只留卡名；默认只铺开「今天要做的」，点哪张开哪张。留白收紧、字号小一号 |
| **浏览器** | 系统浏览器整页打开 | 卡片全铺开，两栏网格，宽卡横跨整行 |

怎么定：地址上带 `?mode=sidebar` / `?mode=browser` 说了算（说了就记进 `localStorage`）；没说过就看环境——**嵌在框里**（`window.self !== window.top`）或者**屏宽 < 680**，按侧栏来。顶栏右上角有切换按钮，点一下立刻重画。

所以两条地址各自配一个模式刚好：

- `http://127.0.0.1:19388/study?mode=sidebar` —— 内嵌 Browser 页签，窄栏
- `http://127.0.0.1:19387/study?mode=browser` —— 系统浏览器，整页

做题页（`/study/practice`）跟着面板的模式走，侧栏模式下自动收窄。切换按钮和 `?mode=` 是同一个开关，`test/panel.test.js` 里两种路径都断言过。

**这不是 DSH 的侧栏页签**。真正的侧栏页签要写客户端插件（注册 `sidebar.panellist` 的图标 + `main` 那个 keyed 槽位），现在这套是服务端插件 + 自己那两页，DSH 只负责把地址嵌进去。

### 二、多科目任务

`profileId` 一路通到底：任务不再只属于「当前档案」，而是属于某一门课。

- `POST /study/api/task`、`/task/update`、`/task/remove`、`/task/toggle` 都收 `profileId`，不传就落到当前在用的那门。
- `GET /study/api/tasks?all=1&date=…` 一次给全部科目：`profiles:[{id,title,subject,active,progress,modules,points,day:[…]}]`，每门课的 `day` 都是拿**它自己那张地图**算的跳转按钮（所以线性代数的任务不会带上高数的看课链接）。
- **打错的 `profileId` 必须报 404**，不能顺手造一门新课出来——`Library.store(id)` 对没见过的 id 是会懒建目录的，所以路由先用名册查一遍（`test/tasks.test.js` 第一条就盯这个）。

面板那一栏的交互：多门课时顶部一排科目筛选（`全部 / 高数 2 / 线代 1`），每门课自带进度条与完成计数；「＋ 加一条任务」的表单里能直接选排给哪一门，不用先切过去；勾、改、删都带着 `data-profile`，认门不认 id。

### 三、测试

112 → **121 个**：新增 `test/tasks.test.js`（4 个：错的 `profileId` 不许建档案 / 带与不带 `profileId` 各落各门 / `all=1` 每门各带各的跳转按钮 / 勾改删认门）、`test/tools-library.test.js`（3 个：`study_plan` 带 `profileId` 排给另一门课、写错名字当场报错且不建档案、单档案的根照旧能用），`test/panel.test.js` 加 2 个（多科目分组的渲染与加删走查、两种模式的默认判定与切换、折叠不留重复内容）。

工具那边也跟着通了：`study_plan` 收 `profileId`，返回里带 `profileId`——**给别的科目排任务不用先 `study_library select` 切过去**。

### 四、分页面 + 面板里直接看对话

面板原来是一张长纸，什么都堆在上面。现在拆成**一个主页面 + 七个子页面**，顶栏是文字导航：

| 路径 | 页 | 干什么 |
| --- | --- | --- |
| `/study` | 主页 | 一屏说清「现在什么水平、今天还剩什么、下一步点哪儿」，只放入口不放编辑表单 |
| `/study/today` | 今日任务 | 逐条勾、改、删，加一条 |
| `/study/map` | 知识地图 | 三层下钻、单元自评、确认草稿；下面接**「掌握度」**那一节（整体饼图 + 各大类，行尾「档案」展开细账）；再下面是错题本（一栏到底，学生画像不在这儿，在档案页） |
| `/study/atlas` | 学习 | 资料图谱：挑一份材料，按它自己的目录摊成大类 → 模块 → 最小单元三层，每层都能直接打开对应那一页 / 那一段；没标的交给教练 |
| `/study/library` | 档案 | 综合学生档案（这个人现在什么水平）→ 学习档案 → 掌握度 → 材料；边栏是学习目标、**学生画像**、基本工具 |
| `/study/materials` | 资料 | 资料书架：一本拆到哪、归到哪个单元，按页直达；右栏登记新资料 |
| `/study/toolbox` | 工具 | 二级菜单装小工具：番茄钟、清单（以后往这儿加） |
| `/study/coach` | 对话 | 整页就是一个聊天窗口：听教练说、直接回话；顶上能选 DSH 里哪个会话 |

**「能力」那一页已经并进知识地图页了**（掌握度那一节就是它），老的 `/study/ability` 照旧能开——只是落到地图页上，别让收藏夹里那条链接 404。

**面板服务自己的开关不在这儿**——它属于「这台插件怎么跑」，不是「这个学生学到哪了」，所以只有一个地方管它：**DSH 的设置**（见下面「补：设置界面」）。

- 服务端认页靠 `lib/handler.js` 的 `PANEL_PAGES`：`/study` 和 `/study/<这些段>` 都送同一份 `panel.html`，页面自己按 `location.pathname` 认（`resolvePage()`）。认不出的段回 404，别的一概不变。这份名单**可以比导航多几项**，但多出来的必须是写明了的老地址（并掉的页面不能 404）：多出来的那几个要同时出现在 `resolvePage()` 的 `alias` 表里，`test/pages-consistency.test.js` 钉着这条。
- 导航走 **`pushState` 前端切页**，不往服务端整页跳——因为服务端路由是 DSH 启动时加载的，改完 `lib/` 没重启时子页面会回 JSON 404，整页跳过去人看到的是一屏报错。前端切页让旧服务端也能用，地址栏仍是真地址。
- 默认配色是**「罗德岛终端」**（近黑冷灰底 + 白字 + 一条信号青只指当前 / 动作 / 进度，方角、细规、角包、索引字），`html[data-theme="light"]` 是同一套造型的纸白版；`?theme=` / 顶栏那个按钮切换。规范见 `design.md`。

对话那条线（`lib/chat.js`）：

- `sessionController` 是 DSH 的**可选**服务，和 `lib/bridge.js` 一样**不写进 `inject`**，拿不到就 `available:false`，对话页直说「没接通 / 原因 / 重新连接」，绝不白屏。
- `createChat({resolve, timeoutMs})` 给三个方法：`available`、`sessions()`（会话清单：滤掉子会话；宿主发会话投影时**只留「学习教练」模式的**，按 `updatedAt` 倒序；回包里 `filtered` 说明这次到底筛没筛）、`history({sessionId, maxMessages})`（只用 `sessionController.follow()` 拿第一帧 snapshot 就退订，翻成面板要的 `{seq, time, role, text, tools}`；`CHAT_EVENT_TYPES` 那张白名单之外的事件一律丢，留最近 `CHAT_MAX_MESSAGES = 60` 条、单条正文截到 `CHAT_MAX_CHARS = 4000` 字）、`create()`（面板那颗「＋ 新建」用：`sessionController.create(newSessionRequest())` → `rememberFresh(id)`，这台机器上一个学习教练会话都没有时当场开一个）。**不用 `page()`**——它要 `throughSeq`，得先问 `projections()` 拿 `asOfSeq`，形状没侦察到；`follow` 一次就给窗口化 records + cursor。
- **只画「人说的话」。** 白名单是 `CHAT_EVENT_TYPES = ['user/message', 'assistant/message']`。两个理由都是实测的：①**工具事件是正文的十几倍**——拿正在跑的 DSH 拉一次，173 条里只有 6 条是人话，不筛的话一屏「调用 pwsh（3 步）」把正文冲没；这一轮用了哪些工具，`assistant/message` 自带的 `tools` 已经折成一行「用了 read、edit」，够用。②`user/message` 里混着**宿主注入的整段 `<system-reminder>`**（AGENTS.md 全文），不筛就会当成学生说的话整段画出来。另外**没有正文的 assistant 步**（一轮里只带工具调用的那些）也丢——画出来只有一排「（这一步没有正文）」。要往回加类型，往 `CHAT_EVENT_TYPES` 里写、再在 `toMessages` 里补一段映射。
- HTTP 四条：`GET /study/api/chat/sessions`、`GET /study/api/chat?sessionId=&max=&sessions=1`、`POST /study/api/chat/send {text, sessionId?, mode?}`（`mode` 只收 `queue` / `steer`，复用 `lib/bridge.js` 的投递通道）、`POST /study/api/chat/new {}`（面板「＋ 新建」：当场开一个学习教练会话，回 `{ok, sessionId, agentPreset}`；宿主没有 `create` 就回 501）。
- 面板侧：**整页对话**和**右下角悬浮窗**是同一份状态（`chat` 对象）两处渲染，`paintChat()` 一次把 `#chat-log` 和 `#float-log` 都刷掉。开着对话页或悬浮窗时**每 2.5 秒拉一次快照**，标签页切到后台、或者两者都关掉就把定时器停掉（`syncChatPolling()` + `chatVisible()`）；只有指纹变了才重画，正在输的字和滚到一半的位置都不动。**通道没接通就别开定时器**（会留一个永远停不下来的 interval，`node --test` 会因此跑不完）。
- 悬浮窗：FAB（`[data-act="float-open"]`）在主页以外的每一页都在，点开是简化版——只有消息列表 + 一个输入框，不显示工具胶囊和时间戳，`×` 关掉、`Esc` 也关；`Enter` 发送、`Shift+Enter` 换行。**展开的窗子按住标题栏能拖走，收起成那颗图标也能直接拖**（位置记在 `localStorage`，两态共用同一处，刷新还在老地方；窗子双击标题栏、图标右键回右下角）。那颗图标是手画的 SVG（`FAB_ICON`：右上切角的对话方块 + 两行短规 + 左下小尾巴），不再用 emoji。
- 侧栏模式下一屏只放得下一张卡，所以**换页时自动把那一页的主卡摊开**（`openFirstCard()` 只在换页和首次加载时调一次，放进 `render()` 里会让折叠按钮按不动）。

三条路由同样是**服务端代码 → 必须重启 DSH 才生效**。没重启时对话页会直接说「服务端还没重启」，而不是装作坏了。

### 五、对话页做成完整聊天窗口，外加一颗悬浮窗

上一版里对话页是「主栏看对话 + 边栏写留言」两块。这一版把**面板上的留言口整个删掉**，对话页只剩一个占满一屏的聊天窗口，另外在每一页右下角挂一颗悬浮窗，随时能问一句。

- **删的只是面板那半边。** `inbox.json`、`study_inbox` 工具、`POST /study/api/inbox`、`study_report` 里的 `inboxItems`、`study_guide` 全都没动——它们是 agent 侧的通道，不归这次改。面板里 `inboxCard()`、留言表单、`kind === 'inbox'` 那条提交分支一并删掉；`test/panel.test.js` 里那条「面板留言能写进档案」现在是直接打 HTTP 验的。
- **对话页占满一屏。** `PAGE_CARDS.coach` 只剩主栏一张卡，`pageCards()` 给它一个 `chat-page` 类（两个分支都得带，漏一个 `--test` 会当场报出来）。CSS 里 `html[data-mode="browser"] .chat-page .card { height: calc(100vh - 136px) }`，`.chat-log` 改成 `flex:1; min-height:0` 在里面滚，输入框不再被消息推下去。窄屏（≤560px）让高度跟着 `100dvh` 走。
- **悬浮窗和整页共用一份状态。** 同一个 `chat` 对象渲染两处，`paintChat()` 一次把 `#chat-log` 和 `#float-log` 都刷掉，所以点开悬浮窗就是接着刚才那段说。悬浮窗是简化版：只留消息列表 + 输入框，不显示工具胶囊和时间戳；`×` 或 `Esc` 关掉，`Enter` 发送、`Shift+Enter` 换行。FAB 在主页以外的每一页都在。
- **定时器判据跟着改。** `syncChatPolling()` 原来只看 `page === 'coach'`，现在看 `chatVisible()`（在对话页**或**悬浮窗开着）；两者都不满足就 `clearInterval`。这条不只是省电：`node --test` 的假 DOM 里，一个停不下来的 interval 会让整个测试进程跑不完。
- **脱开 DSH 也能看长相。** `DSH_STUDY_PREVIEW_CHAT=1 node scripts/preview.mjs` 会挂一份假对话，不必重启 DSH 就能把对话页和悬浮窗点一遍。真跑起来那段对话仍是 `sessionController` 给的。
- **顶上能挑会话。** 他那台 DSH 上开着好几个会话时，对话页和悬浮窗顶上那颗下拉就能选——`GET /study/api/chat?sessions=1` 给清单，选中项按 `updatedAt` 倒排的当前会话。只有一条会话时**不给下拉**，改成一行静态的「当前会话：X」（摆一颗只有一个选项、点不动的控件还不如直接写出来）。清单只在**对话页**或**悬浮窗开着**的时候才拉（`loadChat({ withSessions: page === 'coach' || ui.float })`），别的时候省一趟接口。清单里**只有「学习教练」模式的会话**（见文末「补：面板里的对话只认『学习教练』模式的会话」）：筛过时行尾标一句「只看学习模式」，一个都没筛出来时写一句「还没有⋯⋯新建对话时把预设选成『学习教练』」，不摆空下拉。
- **两个容易踩的地方。** ①`loadChat` 收清单时要判空：`Array.isArray(out.sessions) && out.sessions.length ? out.sessions : (chat && chat.sessions) || []`——不判的话，一次没带 `sessions=1` 的请求会用空数组把刚拉到的清单冲掉（悬浮窗一关一开就没得选了）。②点开悬浮窗时得补拉一次：`load()` 跑的那会儿 `ui.float` 还是 `false`，清单是空的。
- **浮窗能拖着走，收起成图标也能拖。** 展开时按住标题栏（`.float-head`），收起时**整颗图标都是抓手**（`pointerdown` 先看 `target.closest('.fab')`）——两态挪的是同一份 `ui.floatPos`（`floatBox()` 一次找 `.float`、没有再找 `.fab`；合成一个选择器会把测试里只认 `'.float'` 的 `__query` 桩打空），所以图标拖到哪儿、点开的小窗就在哪儿，收起来又回同一处。落点记在 `localStorage` 的 `study-coach:float-pos`（`FLOAT_POS_KEY`），拖过的位置**每帧重画都带着**（`ui.floatPos` → 行内 `left/top`，加个 `moved` 类把 `right/bottom` 让开）——不然 2.5 秒刷一次快照，窗子每次都自己跳回右下角。拖动用**指针事件**（鼠标 / 触屏 / 触控笔一套），监听挂在 `document` 而不是窗子自己身上：拖到窗口外面再松手也得收到 `pointerup`，挂元素上会漏，那就变成「手松了它还跟着鼠标跑」。落点由 `clampPos()` 按在视口里（整扇都看得见；视口比窗子还小就贴左上角），窗口 resize 之后会重新按一次，**每次重画也会按一次**（`clampFloatToView()`）——位置可能是在外接屏上拖的，换回笔记本再打开不能让它落在屏幕外。拖动期间**直接改元素样式、不整页重画**——重画会把输入框里的字和消息列表滚到一半的位置弄丢。复位有两条路：窗子**双击标题栏**、图标**右键**（`contextmenu`）——图标状态没地方双击，第一下就把窗子点开了；两条都走 `resetFloatPos()`（清 `ui.floatPos` + `saveFloatPos(null)`）。**拖完那一下不能算「点开」**：挪过 3px 才置 `moved`，`pointerup` 时 `floatNudged = fromFab && moved`，紧接着的 click 分支先看它、吃掉一次就清掉（拖标题栏不吃点击）。标题栏上那两颗按钮照旧是按钮（`pointerdown` 里遇到 `button` 直接放行）。

### 六、错题本：不新开一张表，挂在证据上

参考 `good-learning-skill`（MIT）里「错题本」那一节之后补的。它的错题本是**产出物**——排版成 PDF 给人打印；这边的错题本是**档案的一部分**，得能跟掌握度、跟知识点、跟复习日期对上。所以没另建 `mistakes.json`：一条错题就是某条证据的细节，分开存迟早会对不上。

- **存哪儿**：`mastery.json` 里 `points[<id>].evidence[i].mistake`。`normalizeMistake()` 产出 `{id, origin, step, cause, fix, redoAt, status, at, updatedAt}`，`at` 是「什么时候错的」，`updatedAt` 是「最后一次改动」。
- **规矩写在代码里，不写在提示词里**：`status` 只有 `待验证 / 已订正 / 已复做对` 三档，**标后两档必须同时有 `cause` 和 `fix`**，否则直接抛错；`origin` 缺失、`redoAt` 不是 `YYYY-MM-DD`、`status` 写了个不认识的词，一样抛。这条是整套设计里最值得抄的一条手法——业务规矩做成数据自校验，才真的是规矩，不然只是提醒。
- **订正不算证据**：`study_record` 传 `mistakeId` 时只改那条错题（`patchMistake`），**不新增证据、不动档位**。「改对了答案」和「掌握了」是两件事，档位得靠另一条证据推。
- **读的入口**：工具 `study_mistakes`（可按 `status` / `pointId` 筛）和 `GET /study/api/mistakes`，两边读同一个 `mistakesOf(map, mastery, {status, pointId, limit})`。排序键是 `at` 不是 `updatedAt`——改一下状态就把老错题顶到最上面，学生看到的第一条会跳来跳去。
- **面板**：知识地图页（图谱下面那张「掌握度」卡的下一节）多一张错题本卡（按状态筛 + 每条「再练」），`capabilities.mistakes` 探针失效时整张卡不出现；做题页多一个「这题做错了」入口（填题号 + 错在哪），走 `POST /study/api/practice/ask` 的第三个 `mode: 'mistake'`，投出去的 prompt 以 `【面板·错题】` 开头，里面直接写着「用 `study_record` 记下来」。
- **档案跟着一起出**：`study_archive` 的证据行**有错题才带 `mistake` 字段**（写成 `mistake: item?.mistake ?? null` 会被宿主的 `additionalProperties: false` 拒掉，报 `"evidence[0].mistake" is not a declared property`）。
- **一个踩过的坑**：`findMistake()` 返回的是 `{ pointId, item }`，错题在 `hit.item.mistake` 上——写成 `hit.mistake` 不会报错，只会静默拿到 `undefined`，症状是 `study_record` 更新完返回的 `mistakeStatus` 是空串。

### 七、今日复盘图：把版式搬过来，别把运行时搬过来

「今日」页下面多一张图：中间一行日期和大类数，左右各挂几张卡片，每张卡是一个今天动过的单元，带错题的卡片左边那颗点变红。它来自 `good-learning-skill`（MIT）的 `references/visual-map-design.md` 和 `scripts/render_summary_map.py`。

**没有直接用那份 Python。** 原实现是 Python + Pillow 画 PNG，装完想画张图就得先给对方机器装 Python（`--png` 那路还要 Pillow）。这里的做法是把**版式常量搬进 JS、服务端现拼 SVG 字符串**（`lib/review.js`）：

- 2048×1180 固定画布、`CARD_W=596`、`CARD_H=252`、每侧行位 `ROWS = {1:[494], 2:[270,718], 3:[196,494,792]}`、左右列 x = 74 / 1378，配色是六对 accent/tint，曲线用三次贝塞尔手写路径——都是照抄的。
- **没跟过来的**是 PNG 那条路：2× 超采样 + LANCZOS 缩回、高斯模糊伪造投影、手抄第二遍的 PNG 坐标。SVG 里一个 `<feDropShadow>` 就够了，也不用维护两套坐标。
- **数据自己来**：`buildReview(state, {date})` 把「当天有证据的单元 + 当天有错题的单元 + 当天有任务的单元」并起来，按「有错题 > 证据多 > 任务多」排，最多 6 个，前一半走左、后一半走右。**一个单元都没动过就返回 `null`**，面板那边整张卡不出现——空白的一天硬凑一张图只会更难看。
- **最值钱的那条照抄了**：`reviewSvg()` 里硬校验 `error_count` 必须等于带错题的分支数（`error_count 是 0，但带错题的分支有 1 个`），另外还拦分支不是 1—6 个、`side` 不是 left/right、某一侧超过 3 个。跟错题本那条一个思路：规矩写成数据自校验，才不是口号。
- **参考实现的两个毛病没跟**：第 7 种 `category` 在原实现里直接 `IndexError`（这边按调色板循环取色）；分类药丸宽度原实现写死 62，装不下「集合与常用逻辑用语」这种大类名（这边按字宽撑开）。
- **版式没有文本测量、也不自动换行**，文案长了会直接溢出卡片，所以 `clip(value, units)` 按字号把每段裁到预算内（CJK 算一个字宽、半角算 0.55）。`core_subtitle` 一开始放的是教练判词，实测会顶到中心块边上——改成结构化的「2 个大类 · 5 个单元」，判词挪到 `core_foot`。量字宽要用 PIL 找墨迹包围盒，但**块边缘的抗锯齿像素会被当成墨迹**，x 范围得内缩几个像素再算。
- **两个入口**：`GET /study/api/review?date=` 给 `{date, data, svg}`；面板把 `svg` 直接嵌进卡片，右上角一颗「下载 SVG」把它当文件存下来。侧栏模式版心太窄，缩到 100% 字看不清，所以那边给 820px 下限横着滑。

**一个踩过的坑**：卡片工厂必须返回 `<section class="card …">`。`fold(id, label, html)` 是靠 `html` 开头那段来拼外层 `class` 的——返回 `<div class="review">` 会拼成 `class="card<div class="review""`，浏览器把这段 class 解析得乱七八糟，症状是**卡片没有卡框、卡头消失、内容却还在**，看截图很容易以为是 CSS 问题。`test/panel.test.js` 里留了一条看门狗：`assert.doesNotMatch(html, /class="card[^"]*</)`。

### 八、资料库：从「哪一份」到「第几页」再到「归哪个单元」

前面几节解决了「教辅拆到页」，这一节把它变成一个**成体系的东西**：一份资料进来之后，知道自己有多少页、每一页属于哪个最小单元、哪些页拆成图了；学生点开一个知识点，能看到「教辅 A 占 10—12 页、教辅 B 占 30 页」，点页码直接翻过去。

面板上多了一个「资料」页（`/study/materials`），左边是书架，右边是导入。**但这条线的主角不是面板，是工具**——面板只是把工具写下的数据画出来，agent 不来登记、不来拆图、不来归类，书架就是空的。

#### 一、数据放在哪：原件一个字节都不搬

衍生数据全部落在插件数据根，**不碰用户原来的文件夹**：

```
~/.dsh/study-coach/
  profiles/<档案>/pages/<书名的去掉扩展名部分>-<sha1(路径)前10位>/
      manifest.json          拆图清单：总页数、dpi、rendered、rendering、书签、时间
      p0001.png  p0002.png … 每一页一张图，文件名就是物理页码
  uploads/                   网页上传进来的原件（up-<base36>-<rand>）
```

目录名带路径哈希，所以**同一本书换个位置再来一次也认得出来**；`p0007.png` 反过来一眼能看出这是第 7 页。`manifest.json` 里的 `rendering` 是「正在拆」的旗子，跑完才落 `false`——面板靠它显示进度，agent 靠它避免重复起一个拆图进程。

#### 二、六个动作

| 谁 | 动作 | 落到哪 |
| --- | --- | --- |
| agent | `study_book action=info` | `analysis` 里的 `pageCount` / `pageDir` / `dpi` / `toc` |
| agent | `study_book action=build` | 后台进程逐页渲图 + `manifest.json` |
| agent | `study_pages` + `read_image` | 把目录页渲出来看，抄成 `toc` |
| agent | `study_analysis action=save`（`toc` + `spans`） | `analysis` 里的页级索引 |
| agent | `study_book action=pages` | 查某个单元在哪些教辅的哪几页 |
| 学生 | 资料页点「拆成页图」/「看页级归类」 | 直接打那两条 HTTP |

**为什么 `build` 要起子进程**：`renderBook` 内部是 `execFileSync` 调 python 渲页，164 页要二十来秒、三百页一分多钟。留在面板进程里会把整个 HTTP 服务冻住，所以 `lib/build-pages.mjs` 是个独立的一次性进程（`detached` + `unref`，起完就撒手）。工具返回时就明说「别在这儿等」。

**页码一律是物理页**：`p0003.png` 里印的可能是「4」。教辅的印数和 PDF 物理页常常差 1，页级索引必须记物理页——因为面板的「打开」按钮拼的是 `#page=N`，PDF 阅读器认的是物理页。

#### 三、归类只写区间，不写逐页

```json
{ "from": 12, "to": 15, "pointId": "M1.4", "kind": "例题", "note": "含参讨论" }
```

一本两百页的教辅逐页写 JSON 又长又容易写错，而且**页与页之间的边界本来就是对不齐的**。所以入参只收区间，落盘时 `spansOf` 把相邻、同单元、同 `kind` 的合并成一段，`expandSpans` 反过来算出「哪些页还没归」——那个 `gaps` 就是「这本还没读完」的诚实答案，**排作业前必须看一眼**，不然会给学生指到一段还没归类的页上。

`kind` 只有六种：`讲解 / 例题 / 习题 / 目录 / 答案 / 其他`。面板上缩成一个字（讲 / 例 / 练 / 目 / 答 / 他）。

#### 四、跨两本教辅找同一节

`pagesForPoint(analysis, materials, pointId)` 是这条线的收口：遍历所有登记的材料，把各自命中的区间按**材料登记顺序**排、材料内部**按页码**排。

**刻意不做全局按页数重排**——那样会把同一本书里本来连着的好几段打散（A 书 10—12 页、A 书 40—42 页本来是一整块，插进 B 书的 20 页之后就读不出「这本书要先看完哪段」了）。

做题页那张「按页直达」卡就是这么来的：每本教辅一段，段头写清「哪一本、占哪几页、是什么页」，下面一排页码按钮。**拆出来的页是链接，没拆的是灰的**——不给死链，这是这条线里最容易犯的错（归了类不等于图已经渲出来了）。

#### 五、导入的两条路

- **粘贴本机路径**：原地登记，原件不动。填文件夹会先列清单让你看一眼（`{files, dirs}`，每个文件带 `known` 标记），确认了再 `all: true` 整夹登记，已经登记过的跳掉。**这是给电脑上已经有一堆教辅的人用的。**
- **网页选文件上传**：手机、别人那边拿来的走这条。`lib/handler.js` 里是**边收边写盘**（不是先 `Buffer.concat` 再存）——一百兆的书整个进堆会把进程撑爆。超过 300 MB 直接拒，文案让用户改走「粘贴路径」。

上传走的是 `content-type: application/octet-stream` + `x-file-name` 头，**不是 JSON 体**，所以面板里另写了一个 `uploadFile()`，没走通用的 `api()`。

#### 六、页图怎么发出去

`/study/page?path=…` 只放行数据根 `pages/` 底下的文件，别的路径一律 404（`allowedPage()` 里 `resolve` 之后比对前缀）。**原先 `/study/file` 只放行登记过的材料路径**，拆出来的图在那个范围之外——这是「面板取不到页图」的根因，所以另开了一个出口，而不是把 `pages/` 塞进材料清单。

#### 七、测试

`test/book.test.js`（10 条，页级索引的纯函数）、`test/shelf.test.js`（8 条，导入 / 拆图 / 书架 / 按单元找页，靠注入假的 `spawnBuild` 不起真进程）、`test/booktool.test.js`（6 条，三个工具的 `info` / `build` / `pages`）、`test/panel.test.js` 的资料页断言、`test/practice-ui.test.js` 的「按页直达」两条。

写 `Store.update` 的时候踩过一次：`upsertAnalysis` 返回的是**那一份材料的条目**，而 `update('analysis', fn)` 要 fn 返回**整个 analysis**。写成 `store.update('analysis', (a) => upsertAnalysis(a, id, patch))` 会把整份文件写成一个条目——正确写法是 `{ upsertAnalysis(a, id, patch); return a }`。

## 补：工具栏目 —— 番茄钟和清单

面板上多了一个「工具」页（`/study/toolbox`）。它是**容器不是功能**：页面左边一条二级菜单（`TOOLS` 注册表），右边画选中的那个小工具。以后往里加东西就三步：

1. 写一个 `xxxCard()`，返回一张 `<section class="card …">`；
2. 往 `TOOLS` 数组里加一条 `{ id, label, hint, card: () => xxxCard() }`；
3. 要落盘的话在 `lib/schema.js` 的 `FILES` 里加一份文件、`Store.default()` 里给个初值。

`PAGE_CARDS.toolbox.main` 只有一条 `['tool', '小工具', currentToolCard]`，卡 id 用的是 `tool` 而不是跟二级菜单联动——**卡 id 是折起来之后刻在按钮上的那个身份，跟着二级菜单变会让侧栏的折叠状态当场失忆**。

#### 一、番茄钟只存绝对时刻

`toolbox.json` 的 `focus` 里存的是 `endsAt`（ISO 时刻）、`startedAt`、`phase`，**不存「还剩多少秒」**：

```json
{ "running": true, "endsAt": "2026-10-01T09:25:00.000Z", "startedAt": "2026-10-01T09:00:00.000Z",
  "phase": "work", "workMinutes": 25, "breakMinutes": 5, "today": "2026-10-01",
  "todayMinutes": 107, "todayRounds": 3, "log": [] }
```

好处是刷新、关页面、出门吃饭、DSH 重启都不影响它算得对不对——剩余时间永远是 `endsAt - now` 现算出来的。所以：

- 服务端**没有任何常驻定时器**。每次读（`GET /study/api/toolbox`）和每次写之前都顺手 `settleFocus()`：到点了就结算成一条日志、累加今天的分钟数、把 `phase` 翻到休息，然后 `running` 置回 false。
- 面板上那个 500 ms 的 `syncFocusTicker()` **只是显示刷新，不是真相来源**：它从 `#focus-clock` 的 `data-ends` 现算剩余，只为了数字能动。它只在「工具页 + 正在跑 + 页面可见」时才开，一离开就 `clearInterval`。
- **一轮走完不自动接下一轮**。学生走开半小时回来，不该看到「你正在第 4 个番茄」——他什么都没按过。
- **中途停不算完整番茄**：`stopFocus()` 按实际坐了几分钟写一条 `partial: true` 的日志，分钟数照算，但 `todayRounds` 不加。不这么写的话，「开一下再关」就是刷番茄数的口子。

`requireMinutes` 拦 1—180 之外的整数（含小数、字符串），读的时候也夹一次——档案是 JSON，手改坏、跨版本迁移都可能留下 `workMinutes: 999`。

#### 二、清单跟「今天」不是一回事

`study_todo` 管的是**学生自己想办的事**（背 20 个单词、整理错题），`study_plan` 管的是**教练排的学习计划**。两拨人写的两拨东西，混一张表就会出现「这任务是谁排的」说不清。

排序写死在 `listTodos` 里：没做完的在前，各自按 `at` 倒序；`status` 认 `open` / `today` / `done` 三档。文字必填、最多 120 字、`due` 必须是 `YYYY-MM-DD`，同一条可挂 `pointId`（做题页那条例题错在哪，起番茄钟时能直接挂过去）。

#### 三、测试

`test/toolbox.test.js`（9 条）：只存绝对时刻、走完一轮的结算、中途停记半截、同时只能跑一个钟、时长上下限与坏数据夹回、跨天清零、清单校验与排序、`study_focus` / `study_todo` 两个工具、三条路由与中文报错。

#### 四、`fold()` 那个坑

侧栏模式靠 `fold()` 把卡片折成一行名字，它要从卡片工厂返回的 `<section class="card focus" data-card="focus">` 里**只取 class 属性**：

```js
const own = (html.slice(0, at).match(/class="card([^"]*)"/) || ['', ''])[1]
```

以前写的是「砍到第一个 `>` 再去掉头尾引号」，那套只有 `<section class="card xxx">` 这种单个属性的卡才成立。工具页那张卡多带了一个 `data-card`，砍出来的就成了 ` focus" data-card="focus`，拼进去变成：

```html
<section class="card focus" data-card="focus open" data-card="tool">
```

`open` 掉进了 `data-card` 里 —— 卡永远折着，点折叠按钮还拿错误的 `dataset.card` 去 toggle。症状是「浏览器模式好好的，一侧栏就展不开」。

## 补：记忆卡 —— 让要背的东西按艾宾浩斯回来

工具页的第三个格子。管的是「背没背下来」，跟 `mastery`（会不会做题）是两张表：`memory.json` 里只有卡片，挂不挂 `pointId` 都不影响排期。挂了的话，做题页和知识地图能顺着找到相关的卡。

#### 一、阶梯是固定的七级

```js
export const CARD_STEPS = [10, 60, 540, 1440, 2880, 8640, 44640]  // 分钟
```

10 分 / 1 时 / 9 时 / 1 天 / 2 天 / 6 天 / 31 天，就是艾宾浩斯那条曲线最常用的复现点。`step` 记的是**已经走完几级**，不是等级编号。

四档自评怎么挪：

| 自评 | 结果 |
| --- | --- |
| 忘了 | 退回 0 级，10 分钟后再来（记一次 lapse） |
| 模糊 | 退一级，按退到那级的时间回来 |
| 记住 | 进一级 |
| 秒答 | 进两级；**连着三次秒答直接毕业** |

走到头（`minutes` 为 `null`）或者 `streak >= 3` 就毕业：`dueAt = null`，不再排。

#### 二、新卡是「立刻到期」的

`addCard` 给的 `step` 是 0、`dueAt` 是现在——写下来那一下本来就该看一遍。所以 10 分钟那一级**不是**靠「记住」走出来的，它是「忘了 / 模糊」之后的回来间隔。这条容易搞反：新卡的第一次复习就在当下。

#### 三、复习盒子和筛子互不干涉

`GET /study/api/memory` 一次回三样：全库统计（`stats` / `soon` / `dueTotal`）、**该背的那一队**（`dueItems`，永远是不带筛子的）、以及按 `status` 筛出来的列表（`items`）。

面板上复习盒子只认 `dueItems`，所以换筛子不会把手上这张卡抽走——学生正在背，顺手点一下「已经背下来」看看清单，卡不该没。列表里**只写正面**：翻答案之前不该先被列表剧透。

`listCards` 先数全库、再筛、再排，所以 `due` / `waiting` / `graduated` 是全库计数；面板上「还没到点」那一档的数是 `total - due - graduated` 减出来的（`cardStats` 不给 waiting）。

#### 四、改内容不许动排期

`patchCard` 拿 `normalizeCard` 过一遍之后，**显式把 `step / dueAt / graduatedAt / lapses / streak / reviews / at` 从原卡恢复**。不这么写的话，`normalizeCard` 的默认值会把一张背到第 5 级的卡悄悄打回 0 级——学生只是改了个错别字。

```js
const next = normalizeCard(patch, card, card.id)
next.step = card.step; next.dueAt = card.dueAt; /* … */
```

#### 五、四档自评别只给两颗上底色

一开始给「记住 / 秒答」加了实心底色，截图一看像已经选中了。现在四颗一律不填充，只按记得牢不牢改字色和边框（红 → 琥珀 → 主色 → 绿），像一把尺子。

#### 六、测试

`test/memory.test.js`（7 条）：阶梯四档、建卡校验（正反面必填、类型白名单、超 200 字）、复习与 lapse、毕业的两条路（走完七级 / 连三次秒答）、清单排序与筛选与 `limit`、`leftText` 与 `cardStats` 与 `memoryBody`、改内容不重置排期、删除。

面板那条在 `test/panel.test.js`：正面朝上不给答案、翻过来四档都在、自评打的是 `review`、换筛子不抽走手上这张、空正面背面本地拦下不打接口。

## 补：AI 出题 —— 一份卷子就是一份材料

需求是「资料界面加个 AI 入口，让他出的练习自动归到一类，跟 xx 教辅平级」。做法**不是新开一张练习表**，而是给材料加一个类别 `ai`（现在一共有六种）：

```
材料 = 教辅 | 网课 | 讲义 | 真题 | AI 出题 | 其他
```

教练出的卷子正文写成 `ai/` 目录下一份 `.md`，然后照常 `study_material action=add kind=ai`。于是它自动获得材料已有的一切：书架上有位置、分析里有章节与 `spans`、`pagesForPoint` 会把它算进「这一节该练什么」。

#### 一、为什么复用材料，而不是另起一张表

另起一张表意味着「按单元找练习」要在两个地方各查一遍、再合并；而 `pagesForPoint` 早就把「同一节在各份材料里的位置」收在一个函数里了。加一个类别只改一层——**类别白名单**——比新造一条数据线少一半代码。

代价是「页」这个词被撑开了：教辅的一段是页码，AI 卷的一段是**题号**。所以 `spans` 的 `from/to` 对 AI 卷写题号，两个 UI 都按 `material.kind === 'ai'` 切换单位（「第 3 页」→「第 3 题」）。

#### 二、类别现在是要校验的

原先 `POST /study/api/materials` 是 `kind: item.kind || 'other'`——照单全收。写错一个字母（`textbook`）这份材料**不报错**，只是从任何分组里悄悄漏掉。现在工具和路由都按 `MATERIAL_KINDS` 校验，不在表里回 `400 材料类别只能是 …，收到「X」`。

这条改动是被一个老测试抓出来的：`test/store.test.js` 的「材料可以加可以删」当时就用了垃圾类别 `textbook` 并断言 200。**测试里用假数据是可以的，但用「格式合法、值非法」的假数据会把校验缺失一直盖住。**

#### 三、书架按类别分组

`assets/panel.js` 的 `shelfCard()` 按 `KIND_ORDER = ['book', 'ai', 'notes', 'past', 'video', 'other']` 分组，每组一个中文小标题（教辅在前，AI 卷紧随其后——它是「学生手上还有什么可做」的一部分）。**只有多于一组时才出小标题**，否则书架顶上会多一行没有信息量的「教辅 1 份」。

行渲染抽成了 `renderShelfRow(s)`，AI 行跟教辅行是两套动作：

| | 教辅 | AI 卷 |
| --- | --- | --- |
| 状态徽标 | 拆完了 16 页 / 未拆 | AI 出的卷 |
| 副信息 | N 页 · 有文字层 · N 个单元 | 覆盖 M1.4 · N 份卷 · N 题有索引 |
| 动作 | 看页级归类、拆成页图 | 打开这份卷、按 M1.4 做题 |
| 展开 | 有页级归类详情 | 没有 |

`shelfState()` 对 AI 卷要**短路**：它没有本机原件也没有页图，不短路的话会按「原件不在了」报一条红字——那是给教辅准备的判断。

#### 四、入口在面板，生成在对话

资料页右栏多了一张「让 AI 出题」：三颗类型药丸（随堂小测 / 背诵清单 / 错题变式）+ 单元下拉 + 一句话要求。它**不自己出卷**，只是把这三样拼成 prompt，走已有的 `POST /study/api/practice/ask`（`mode: 'ai'`）投进对话——出题、写文件、登记材料都是对话那头的 agent 干的。

这条边界值得留着：面板读数据、对话写数据，是这一整个插件从第一天起的分工（见上面「对话负责写，面板负责看」）。面板要是自己调一次模型，就得自己处理失败、重试、断流，还得把结果写回去。

prompt 里带了四步收尾指令，最后一步是「告诉他去资料页书架打开、或做题页点 AI 出题」——**生成完不登记等于没生成**，学生看不见。

#### 五、做题页的联动（需求 5）

「资料页和做题页联动」落到两处：

- 进去的路：AI 行上每个单元一颗「按 M1.4 做题」→ `/study/practice?point=M1.4`。
- 出来的路：做题页「按页直达」里，同一节的教辅和 AI 卷并排——教辅给 `第 10 页`，AI 卷给 `第 1 题`，点题号直接**打开读卷页**（下一节）。上面那张「材料对应位置」也会列 AI 卷，带一颗 `AI 出题` 标签。

「材料对应位置」这个标题原来叫「教辅对应位置」——加了 AI 卷之后就不准了：学生看到「第 1 章 随堂小测 · M1.4」会以为那也是一本教辅。

#### 六、测试

`test/store.test.js` 的类别校验（`textbook` 被拒且不落盘、`ai` 落盘且 `path` 为空）、`test/tools.test.js` 的 `study_material` 校验、`test/panel.test.js` 的书架分组与 AI 入口（挑类型 / 挑单元 / 递一句话，断言打的是 `/study/api/practice/ask` 而不是别的）、`test/practice-ui.test.js` 的两条（按页直达里的 AI 行用「题」；材料对应位置认出 AI 卷、不写「仅能打开整份 PDF」）。

## 补：读卷页 —— AI 生成的东西按面板排版摊开

原先的毛病：AI 出一份卷子，正文是 `.md`，面板上点开走的是 `/study/file`——浏览器把 markdown **当纯文本倒出来**，`## 第 3 题`、`**|2A|**` 原样露着，跟这个 web 的版式毫无关系。学生要看的是一份卷子，不是一份源码。

现在 `.md` / `.markdown` / `.txt` 一律走**读卷页** `/study/read?path=…`，其余（PDF、视频、文件夹）照旧 `/study/file`。判据只有一处：

- `assets/urls.js` 是这条规则的**唯一实现**。`openPath(target, page)` 决定一个材料路径该往哪儿开：文档 → 读卷页（`page` 变成 `#qN`），其它 → `/study/file` 拼 `#page=N`，`http(s)` 和站内路径原样放行。宿主那半边按 `lib/urls.js`（一行 `export * from '../assets/urls.js'`）引同一份。
- 接线三处：面板的资料卡与 AI 卷按钮（`assets/panel.js`）、做题页的 `openLink()`（`assets/practice.js`）、任务按钮（`lib/map.js` 的 `taskLinks()`）。**再要有第四处，先想清楚为什么不能走 `openPath`。**
- `assets/md.js` 是渲染器，不是通用 markdown 实现：标题 → `hN` 并生成侧栏目录；`第 N 题` / `N.` / `N、` / `**N.**` 都认，认出来的题号会钉一个 `id="qN"`，页面顶上自动长出一排「第 N 题」按钮；`## 参考答案`（`参考解答`/`解答`/`解析` 同）整节折进 `<details>`，**点开之前看不见**；表格、引用、代码块、分隔线都画。不认 LaTeX、HTML、嵌套列表。**先转义再替换**，`<img src=x onerror=…>` 只会成一行字面量。
- 页面 `assets/read.html` + `read.js` + `read.css`，版式照 `design.md`（版心 900、卡头那条 accent 竖条、`practice.css` 的同款规矩）。页尾留一颗「看原文」通向 `/study/file`，想读源码的时候有路。
- 服务端 `GET /study/api/doc?path=…`（`lib/handler.js`）：只在**已登记材料**范围内（复用 `allowedTarget`），非文件 → 400 `not-file`，后缀不在 `.md/.markdown/.txt` → 415 `not-text`，超 `MAX_DOC_BYTES`（512 KB）截断并回 `truncated: true`（读的时候只读到上限，不整份进内存）。

`test/md.test.js`（渲染器 12 条）、`test/read.test.js`（服务端 8 条）、`test/read-ui.test.js`（页面 7 条）钉住它；`scripts/check-live.mjs` 多了 `/study/read`、`/study/api/doc?path=` 两条探针和一次 `read.js` 记号检查，好分辨「新页面配旧路由」这种状态。

写卷子的格式约定在 `skills/study-coach/SKILL.md`「卷子写成什么格式，面板才画得好看」那一节——**那是给 agent 看的**，它决定学生在读卷页上看到什么。

## 补：学生画像 —— 结论要能追回到哪一次

`mastery` 里每条证据是**流水**（L1）：「10 月 1 日，M1.4，quiz，第九组第 3 题做错」。它一条条攒着，谁也不会去读第 40 条。

学生画像（L2）是**结论**：「含参讨论时容易漏掉 A=∅ 那一支」。一句话，读完就知道下次该怎么教。存在 `student.json`，**跟 mastery 分开**：流水一直涨、寿命长；结论要能被推翻改写，寿命短。混在一起的话，「上次的判断是什么」会被新证据淹没。

#### 一、一条判断必须挂证据，挂不上就不许记

```
判断 = { id, kind, text(≤120 字), evidence: [{pointId, key}], note, at, updatedAt }
```

`kind` 五选一：习惯 / 强项 / 弱项 / 偏好 / 背景。`evidence` 至少一条，`lib/student.js` 的 `normalizeEvidence()` 会逐条验：

- 编一个不存在的 id → `没有任何一条证据的 id 是「e-xxx」。别编 id，去 study_archive 里看真有哪些`
- 只给 id、全库对上不止一条 → 让它把 `pointId` 一起写上
- 单元号不在当前地图里 → `地图里没有这个单元：M9.9`
- 单元对、但那一条不在这个单元下 → 指出该去 `study_archive` 重看一眼

**这条约束就是这层跟「随口评价」的分界线**，也是它跟向量库的分界线：兑不上要显式报出来，不是算个相似度蒙混过去。

#### 二、证据从匿名行变成有 id 的了

原来证据就是 `{kind, at, note}`——一行流水，匿名无所谓。但 L2 要一条条挂回去，没 id 就只能挂到整个单元，那等于「我记得你这一节学得不好」，说不出是哪一次让你这么想。

所以 `recordEvidence` 现在发 `id: 'e-…'`（`newEvidenceId()`），`study_archive` 的 `evidence[]` 也跟着端出来。**加 id 之前记的老证据**没有 id，档案里按 `evidenceKey()` 的同一套算法推一个：`单元@时刻`，同一毫秒同一单元撞了才补 `#序号`。两边必须同算法，否则今天抄下来的引用明天就兑不上。

#### 三、兑不上的显式记账，不隐藏

判断不会过期，但它引的那次可能没了：地图重画换了单元 id、证据被删。`auditFacts()` 把它们列出来（`地图里没这个单元了` / `这条证据找不到了`），面板照实画：

- 卡头写 `3 条判断 · 1 条要修`
- 那一格写「集合的表示 **证据没了**」
- 底下补一句「在对话里说一声，让教练核一下」

静默过滤掉是最省事的写法，也是最坏的：学生会慢慢不信这张卡。

#### 四、L3 判词可以引用 L2

`abilityReport` 的 `judgement` 多了 `from`（判断 id 数组），`study_ability action=set` 可以带 `from`。这样面板顶上的「这句判词综合了哪几条」，也是能点回去的。

`setAbility` 里 `from` 不传就留上一次的——只改措辞的时候，不该把「综合了哪几条」冲掉。

#### 五、写和读的分工

写只有两条路，都在对话里：`study_student` 工具，或面板上删（`fact-del` → `POST /study/api/student {action:'remove'}`）。面板**不能加也不能改**——加一条判断要先去 `study_archive` 挑证据，那是 agent 的活。

`study_report` 加了 `studentFacts`（只给 `id / kind / text / note / evidenceCount`，不摊开证据）——**开场读完它就等于认了一遍这个人**，这就是这一层最直接的收益。要看细节再调 `study_student` 或直接读 `/study/api/student`。

#### 六、测试

`test/student.test.js` 7 条：证据 id 与老数据推 key、`addFact` 的四类拒绝、改措辞与改证据互不冲掉、`byKind` 每档都在、证据/单元消失后 `ok:false` 与 `orphans`、`renderFact` 一真一假、路由层（400 文案 + 被拒的不落盘）、工具层（`study_report.studentFacts`、`study_ability.from`）、档案里 `evidence[].id` 跟 `evidenceKey()` 同算法。面板那条在 `test/panel.test.js`（`学生画像：一句话带着当年的那次证据，证据没了要当着面说`）。

---

## 补：设置界面（面板服务的开关，只在 DSH 设置里）

插件原来只有一个地址：DSH 自己 webServer 上的 `/study`。内嵌浏览器不许开 DSH 自身的 origin，所以还起了**第二个**：插件自己监听 `127.0.0.1:19388`（被占往后试 20 个）的独立端口。第二个能关、能换端口，就得有地方按开关——这个地方**只有一个**：DSH 的设置。

插件自己的网页面板里**不设**这一页。理由：那是「这台机器上这个插件怎么跑」，不是「这个学生学到哪了」，而网页面板整个是给学生看的（改什么都得回对话里跟教练说）。运行参数混进去，学生点错了整个面板就打不开了。

### 一、设置存在哪

`~/.dsh/study-coach/settings.json`，**不**在学习档案（`profiles/<id>/*.json`）里：

```json
{ "version": 1, "panel": { "autoStart": true, "port": 19388 } }
```

档案是「这一个学习目标学到哪了」，一个目标一份；这份是「这台机器上这个插件怎么跑」，全局一份。切换学习目标不该把端口改掉，所以 `lib/settings.js` 自己读写、不进 `Store` 的 `FILES` 那张表。

- **读宽容**：文件不在、半截 JSON、字段全乱，一律退回默认值，不抛——盘上那份被人手改坏不该拦住插件启动。
- **写严格**：`validateSettings()` 逐项过关才落盘，不合格抛中文错（`panel.port 要是 1024—65535 之间的整数，收到「80」`）。静默吞掉最坑：存的是 99999，页签上显示的还是旧端口，人以为存上了。
- 默认端口只写在 `lib/panel-server.js` 的 `DEFAULT_PORT` 一处，`lib/settings.js` 从那儿 import。

### 二、两个地址，别混

| | 谁 | 能不能关 |
| --- | --- | --- |
| `/study`（同源） | 挂在 DSH 自己的 webServer 上，`ctx.effect(() => ctx.webServer.register({kind:'prefix',path:'/study',handler}))` | 关不掉，也不用关；系统浏览器直接开 |
| `http://127.0.0.1:<port>/study`（独立端口） | `createPanelControl()` 起的第二个 HTTP 服务，复用同一个 handler | 能启动 / 停止 / 重启 / 换端口；**这是给 DSH 内嵌浏览器用的** |

`autoStart` 为真时插件一加载就起独立端口；关掉之后，要用的时候到设置里的「学习教练」点一下。

### 三、接口

- `GET /study/api/panel` → `{ ok, supported, running, port, url, preferred, hintUrl, error, settings, note }`。`deps.panel` 缺席（`scripts/preview.mjs` 之外的直接 `createRouter`）回 `supported:false` + 一句为什么。
- `POST /study/api/panel`，两种写法都收，也可以一起给：
  - `{ action: 'start' | 'stop' | 'restart' }`
  - `{ panel: { autoStart, port } }` 或扁平的 `{ autoStart, port }`（页签上就俩控件，扁平更好写）
  - 起 / 重启一律听**设置里那个端口**，不是「这次请求里顺手存的那个」——先改端口再点重启是两次请求，只在当次请求里找端口，重启就会回到旧端口上而界面上写着新端口。改了端口没重启会回一句 `note` 说清现在听的还是旧的。

这条路由只有 DSH 设置页签在用；网页面板不碰它。

### 四、DSH 里挂的两处（客户端半边）

**设置 → 学习教练**：左边自己一栏，跟「通用」「模型」「内置插件」「智能体预设」同层。另外「设置 → 内置插件 → 学习教练」也有一个同名页签，老习惯从那儿找的人也有路。这一半的文件是 `lib/client.js`，**不是普通 ESM 模块**，是宿主在浏览器里执行的一段脚本：

> 为什么两处都挂：`settings.section` 才是 DSH 契约里「一个 list 条目就是一个设置页」那个座位，插件自己的页挂在这儿才找得到；`settings.plugins.tab` 是「内置插件」页**里面**的页签，只挂它，人得先想到去点开那一页。两处各挂各的，谁挂不上都不影响另一个。

```js
window.__ModuleLoader__.load({ id: 'dsh-study-coach', factory: (require) => { … } })
```

跟 `dsh-talk` / `dsh-client-ui-settings-plugins` 一个形状。三条规矩：

1. `require` 只能取平台种子表里的模块（react / react/jsx-runtime / cordis / 静态 UI 库），外加 `package.json` 里 `dsh.client.inject` 列出的包。**`require` 一个没列进去的包 = 静默失败。**
2. 只导出 `apply` / `inject` / `name`，宿主按这三个接线。`inject` 是 cordis 服务名（`['slots']`），`dsh.client.inject` 是客户端模块包名，两码事。
3. 文案不用走 locale（这一页没有要翻译的东西），`slots.register` 的 `label: () => '学习教练'` 直接给字符串。

注册座位是 **`settings.plugins.tab`**（一个 list 座位，`{ id, order, label }`）。同一个包里也带了 `settings.section`（设置导航里一整块顶级分区）的用法参考，但这个插件用 tab 更贴。

**样式走 `--dsw-alias-*` 那一套**（`--dsw-alias-bg-layer-1`、`--dsw-alias-border-l2`、`--dsw-alias-brand-primary`、`--dsw-alias-label-primary` …），**不要**用插件自己面板的 `--ink` / `--card` / `--accent`——那是另一套配色体系，在 DSH 的页面里根本没有值，混进来就是一片透明。`test/client.test.js` 拿一条正则钉住了这件事。

页签里三块，**「面板服务」排在最前**（启动 / 停止 / 重启；跑着时多一颗「打开网页面板 ↗」，停着时那颗换成「启动并打开 ↗」）、**「网页面板」**（地址 + 今天 / 地图 / 能力 … 每页直达）、**「启动设置」**（首选端口 + 加载时自启）。主按钮**不实心**：品牌色只用来描边 + 左侧一道信号条——因为填充色之上那层文字色不在公开 token 表里，拿 `--dsw-alias-bg-base` 当文字色的按钮会被别的插件（壁纸那类改写别名层的）变成一片空白。fetch 打的是同源的 `/study/api/panel`（`/study` 也挂在 DSH 自己的 webServer 上，所以没有跨域）。

### 五、测试

- `test/settings.test.js` 7 条：读宽容（不在 / 半截 JSON / 顶层不是对象 / 字段全乱）、写严格（四类非法值 + 抛了不落盘 + 不提 panel 就当没改）、`createPanelControl`（起停重启、重复 start 不换端口、并发 start 合流到一次、首选端口被占往后挪且 `info().preferred` 还是用户写的那个）、路由层（没控制器时的 GET/POST、状态与开关与存端口、被挡住的不落盘）、独立端口那半端得出面板页面和静态资源。
- `test/client.test.js` 12 条：只跟平台要 react、bundle id = 包名、`apply` 之后两个座位都挂上、拿不到 slots 也不炸、跳转入口覆盖各页、样式只用 `--dsw-alias-*`（面板那套 `--ink` / `--card` 一条正则钉死）；这一版又加三条：**CSS 里不许出现 `--dsw-alias-bg-base`**（它是背景语义，壁纸那类插件会把它改成 `transparent`，「跳转按钮看不见内容」就是这么来的）、每个别名引用都要带实色兜底、按状态渲染出来的按钮标签与禁用态（跑着时只有一颗 primary 且是「打开网页面板 ↗」，停着时是「启动」，状态没读回来一律禁用）。
- 网页面板那侧没有新增测试——它压根没多出界面。

### 六、一个真 bug（顺手修的）

`server.close()` 只等已有连接自己断。浏览器跟面板一直是 keep-alive，**点「停止」或「重启」就会一直转圈**——而浏览器永远不松手。`lib/panel-server.js` 的 `close()` 里先 `server.closeAllConnections()` 再 `close()`。

## 补：面板里的对话只认「学习教练」模式的会话

面板的对话页原来列的是 `sessionController.list()` 里的**每一个**非子会话。同一台机器上开着别的会话（比如我干活那个编程会话），学生一点进来就会先看见它，`lib/bridge.js` 挑会话又是「取最近那个」，面板说出去的话有可能掉进跟你学习无关的会话里。现在这条线只认 `agentPreset === 'study-coach'`（`lib/preset.js:59` 的 `PRESET_ID`）。

- **判据只能从会话投影里拿。** `SessionSummary` 上没有 `agentPreset`（也没有 `title`），DSH 自己也是读投影的（asar 里那句注释写得很直白：*Reconstruction reads the `agentPreset` Session projection, never the header*）——`item.projections.values.agentPreset`。所以不必逐会话 `inspect()`，一次 `list()` 就够。
- **判据集中在 `lib/session-preset.js`**：`presetOf(item)`（取不到一律回 `''`；宿主写 `null` 就是「没选预设」）、`hasPresetChannel(items)`、`learningSessions(items) → { items, filtered }`。`lib/chat.js` 和 `lib/bridge.js` 都走它，别在两处各写一遍。
- **老宿主不许被筛成空白。** 整份清单里没有任何 `projections.values` 时 `filtered:false`、原样放行——面板也据此决定说不说「只看学习模式」（`filtered` 才说）。这两件事必须分开：`filtered:false` 是「这次没敢筛」，不是「筛完正好没有」。
- **`history({sessionId})` 也核一遍。** 面板直接带一个别的会话 id 上来时，先自己拉一次清单，不在名单里就回 `ok:false` + 一句「这个会话不是「学习教练」模式的，面板不读它的对话」，**不去读那条日志**。
- **投递宁可不投。** `bridge.pickSession()` 现在返回 `{ sessionId, filtered }`；`remember()` 记下的 id 也不直接信了（学习工具在编程会话里照样调得到，`preferredFromList` 标记的才是从筛选后的清单里挑出来的），一个学习会话都没有时回「没有「学习教练」模式的对话，这句话先存着」——话仍然留在 `inbox.json` 里，不掉。
- **面板那侧**：`chatPicker()` 空清单时不再不吭声，会分两种说法（`filtered === false` → 「没读到会话清单。」；否则 → 「还没有「学习教练」模式的对话 —— **点右边那颗 ＋ 新建 开一个**，这一页就接上了。」），有清单且筛过时行尾挂一句「只看学习模式」（`.chat-only`），会话选择右边永远挂一颗「＋ 新建」。
- **面板自己开得出来一个。** 这台机器上原本一个学习教练会话都没有（19 个 `cordis` + 2 个 `standard` + 几个 IM），严格筛完对话页就是空态——所以给了颗「＋ 新建」：`POST /study/api/chat/new` → `chat.create()` → `sessionController.create({ agentPreset: PRESET_ID })`，回来把 id 塞进 `ui.chatSession` 并就地重画。**刚开出来的会话先记一笔**：`create()` 回来的那一瞬间投影还没落地，严格筛会把学生自己刚建的那个筛掉——`lib/session-preset.js` 的 `rememberFresh(sessionId)` / `isFresh(sessionId)` 是那张放行表，`learningSessions()` 与 `history()` 都认它；预设号只在 `newSessionRequest()` 里出现一次，路由里不再写一遍。
- **测试**：`test/session-preset.test.js` 7 条（判据、六种投影形态、老宿主放行、非数组不炸、fresh 放行、`newSessionRequest`）、`test/chat-sessions.test.js` 6 条（真 `createChat` + 假 controller：只列学习会话 / 显式塞别的 id 读不到 / 老宿主不拦 / 一个都没有时不读别人日志 / 新建出来读得到 / 建不出来说清楚）、`test/chat.test.js` 3 条（含 `POST /study/api/chat/new` 的端到端）、`test/panel.test.js` 25 条（含「会话选择旁边那颗「＋ 新建」」）、`test/bridge.test.js` 13 条。全量 291 条。
- **记账**：`lib/` 改了 → **要重启 DSH 才生效**（`assets/*` 那条刷新即可）。
- 顺带记一笔没修的：`SessionSummary` 上没有 `title`，`lib/chat.js` 的 `summaryView` 读 `item.title` 永远是空串，清单那行就退化成「cwd 尾段 / 前 8 位」。要真标题得另想门路。

## 补：表情包走图片通道、新消息靠广播通道

用户报的两件事：**「表情包在 web 端加载不出来」**、**「收到的消息要手动刷新才显示」**。都在面板（`assets/panel.js`）这一侧，根子却一个在图库、一个在浏览器。

**表情包为什么「加载不出来」。** 面板把消息当纯文本画，`[表情: 得意闭眼拳头…]` 只会原样显示成一段字。而 DSH 那边的图库在**另一个 origin** 上：`dsh-meme` 用 `webServer.register({ kind:'prefix', path:'/dsh-memes' })` 把图挂在 DSH 自己的端口（19387），`/dsh-memes-api?packId=all` 与 `/dsh-memes/<packId>/<path>` 都只有那边认；面板那两个 origin（19388 与 DSH 的 `/study` 前缀）上这些路径一律 404。也**没法做代理**——`webServer` 服务只有 `register` / `registerUpgrade` / `registerFallback` / `tapIndex` 那几个方法，**没有 `port` 属性**，插件里拿不到 DSH 的端口号。

所以 `lib/memes.js` 直接**读盘上的图库**（`node:sqlite` 只读打开；`createRequire` 懒加载，老 Node 取不到 sqlite 就认成「没图库」，不炸）：

- 两个根：用户包 `<DSH_MEME_HOME || homedir()>/.dsh/meme-packs`（注意跟 `DSH_HOME` 不是一回事），内置包扫每个 profile 的 `node_modules/dsh-meme/memes`。一个包 = `index.db` + `manifest.json` + `memes/<tag>/<file>`。
- 表就是 dsh-meme 自己那张：`memes(path, tag, file_name, file_hash, caption, keywords, mtime, captioned_at)`——`caption` 正好是 `[表情: …]` 里那串描述，`path` 正好是相对包目录的图片路径。
- 认图顺序：描述折成「去空白 / 去标点 / 小写」之后**逐字相等** → 包含（`row.fold.includes(q)`，或者描述里含着一小段、`q.includes(row.fold)`）→ 关键词全含；多个候选取最短那个。折过不到 2 个字不猜。非图片扩展名、以及 `path` 越出包目录的行一律丢。
- 路由：`GET /study/api/meme?q=<描述>` 命中就发字节（`content-type` 按扩展名，`cache-control: public, max-age=86400`）；找不到 404（「图库里没有这一张」）、没给 `q` 400、这个进程没接图库 503。另有 `GET /study/api/meme/info`（几个包、多少张）方便排查。索引在内存里缓存 5 分钟（`createMemes({ ttlMs })`）。
- 面板这一侧是 `chatText()`：把 `[表情: 描述]` 换成 `<img class="chat-meme" src="/study/api/meme?q=…" alt="描述" loading="lazy">`——**`alt` 就是那句描述**，图没命中时浏览器直接显示这行字，不留破图；`.chat-meme` 方角细边、最大 220px（浮窗 160px）。
- 发图片字节走的是 `handler.js` 新加的 `sendRaw(res, raw)`；路由返回 `{ code, raw: { type, body, cache } }` 时 handler 直接写字节，不再 JSON 化。

**「要手动刷新才显示」为什么不是加个轮询就完事。** 面板本来 2.5 秒轮询一次，但**浏览器会把后台标签页里的定时器压到一分钟一次甚至冻住**，切回来也不补一次——学生常常在 DSH 那边说完一句再切回面板，看见的自然是旧的。定时器节流是浏览器行为，改不掉；服务端的推送不受影响。所以加了 `lib/events.js`（唯一一份）与 `GET /study/api/events`：

- 接上先发 `event: hello`（之前还写一行注释帧，免得代理压着响应头不放），之后每 2.5 秒一帧 `event: tick`；写操作想立刻刷面板可以 `events.publish('chat')`，会推 `event: change`。
- **没有订阅者就不跑定时器**；`res` 的 `close` / `error` 一律退订（否则那条长连接会一直挂在进程里）；定时器 `unref()`，别拖住 `node --test` 退出。`ctx.effect` 里注册 `events.stop()`，插件卸载时把订阅全掐掉。
- 面板 `new EventSource('/study/api/events')`，`hello` / `change` / `tick` 三个事件都去 `refreshChat({ pushed: true })`——**推送那一帧在后台也照刷**（切回来内容就是新的）。轮询定时器反过来只在**前台**挂着；切回前台由 `visibilitychange` 立刻补一次、再重新挂上。没有 `EventSource` 的老浏览器自动退回纯轮询，行为跟以前一样。
- 路由按 HEAD 也算 GET 找（HTTP 语义：只要头不要体），所以 `/study/api/events` 可以直接 HEAD 探活。

- **测试**：`test/memes.test.js` 6 条（折字、两个根、认图顺序、TTL 缓存、图被删、HTTP 段发真字节）、`test/events.test.js` 5 条（头与帧、心跳、退订、真 SSE 流读到 hello 与 tick、没接通道 503）、`test/panel.test.js` 加 1 条（`[表情: …]` 渲成 `<img class="chat-meme">` + 推一帧就拉一次 + 离开这一页把长连接收掉）。全量 303 条。
- **记账**：`lib/` 与路由都改了 → **要重启 DSH**（新路由是启动时注册的）；`assets/*` 刷新即可。重启前面板里表情包还是文字（`/study/api/meme` 404），消息也还得手动刷。

## 补：正文走 markdown，数学交给 KaTeX

用户报的：**「web 端数学语言是 markdown 格式显示，你需要让 markdown 在 web 端正常显示」**。面板原来把教练的话当纯文本画，`**判据**`、`- 先配方`、`$x^2+y^2=1$` 全是源码。

**没有引 marked，用的是我们自己那份 `assets/md.js`。** 它本来是给读卷页写的（commit `acfafa7`），全仓只此一份渲染器 —— 读卷页、做题页、面板共用，多写一份就等于以后三处各修一遍。这一批只给它加了数学与一个 `extras` 钩子。

**KaTeX 随包发，不走 CDN、也不依赖别人装的包。** `assets/vendor/katex/`（25 个文件 / 561KB）：

- `katex.min.js`（katex 0.16.47，MIT）；`katex.min.css`（**改写过的**：20 个 `@font-face` 的 `src` 从 woff2/woff/ttf 三个源只留 `url(fonts/X.woff2) format("woff2")`，省掉 20 个 woff、20 个 ttf）；`fonts/*.woff2` 20 个。
- **许可分两份**：代码 MIT（`LICENSE`），**字体是 SIL OFL 1.1**（`FONTS-OFL.txt`；npm 包里没有单独的字体许可文件，是从 OFL 官方那份取的全文），`NOTICE.md` 里把两者分开写清。随包发（`package.json` 的 `files` 已含 `assets`）。
- 为什么不从 CDN 拉：这台机器不保证联网，而面板是本地服务 —— 拉了就等于把「能不能看数学」押在网上。为什么不 `import` profile 里那份 `katex`：pnpm 布局下它是别的插件带进来的传递依赖，哪天那个插件没了它就没了。

**机制（`assets/md.js`）**：

- 数学认四种写法：行内 `$…$`、`\(…\)`，独立成行 `$$…$$`、`\[…\]`（`INLINE_MATH_RE` 里 `$` 前后不许贴数字，`\$` 不算钱）。
- 有 KaTeX 就 `renderToString(tex, { displayMode, throwOnError: false, strict: 'ignore', trust: false })`；**没装上或排不出来就退回一段等宽 `<code class="md-math">` 源码，绝不把 `$` 原样吐出来**（装不上也看得懂）。
- `inline()` 的顺序是**安全边界**：① 代码段 → ② 数学 → ③ `extras` → ④ `escapeHtml` → ⑤ 链接 → ⑥ 粗/斜/删除线 → ⑦ 回填插槽（`\u0000N\u0000` 占位）。**数学必须赶在转义之前抠出来**，`\frac` 的反斜杠才是给 KaTeX 的；`extras` 的产物进插槽、不再过转义（它自己负责转义）。
- **反斜杠保护**：markdown 会把 `\`+标点当转义吃掉，而真实消息里 Windows 路径是常态（实测线上 11 条消息里就有 `C:\Users\<你>\.dsh\study-coach\pages\…`）——所以抠完数学才转义，`\.` 不会被吞掉（截图里那条路径原样出来了）。
- `extras` 是给调用方的钩子：面板的 `[表情: 描述]` 走它（`MEME_EXTRA`），`chatText()` 内部就是 `renderMarkdown(text, { extras: [MEME_EXTRA] })` —— 这样「表情包出图」与「markdown 排版」不会互相踩。

**接线**：三个页面外壳（`assets/panel.html` / `read.html` / `practice.html`）各加一行 katex 的 `<link>` 与 `<script>`（UMD，装成 `window.katex`）；`assets/panel.js` 加 `import { inline as mdInline, renderMarkdown } from './md.js'`，`chatText()` 改走 `renderMarkdown`，错题本那三行（错步 / 错因 / 订正）走 `mdInlineText()`（行内，不套 `<p>`）。`.chat-text` 的 `white-space` 从 `pre-wrap` 改成 `normal`——**md.js 吐的 HTML 块之间带换行，`pre-wrap` 会把它画成空行**，段落里的单换行由 md.js 自己转 `<br>`。气泡里的块级样式（`.chat-text .md-*`）收在 `assets/style.css`，标题在气泡里不放大、外边距收窄；`.md-math` / `.md-block-math` / `.katex` 是三个页面共用的，也放在 `style.css` 里。KaTeX 的 `throwOnError:false` 会用**它自己的红**（内联 `#cc0000`）标认不出的公式，深色底上跟这套配色打架 → 一条 `.katex-error { color: var(--bad) !important; }` 压回去（压内联样式只能用 `!important`）。

**测试**：`test/md.test.js` 15 条（新增三条：没装 KaTeX 时退回源码且不吐 `$`、`\$` 与「花了 $5 到 $8」不当公式、Windows 路径的反斜杠不动、`$<img …>$` 被转义；KaTeX 在场时四次调用的 `display` 档；`extras` 的产物不进转义），`test/panel.test.js` 那条加了粗体 / 列表 / 公式三条断言。视觉上是拿一个临时离线样张在 headless 浏览器里截的图（那种样张是当晚的临时物，早已删掉；现在要看页面就用 `node scripts/preview.mjs`，19390）：`x²+y²=1`、`∫₀¹`、`lim (1+1/n)ⁿ` 都排出来了，Windows 路径原样。

- **记账**：只动了 `assets/*` 与三个 html（`lib/` 没碰）→ **刷新页面即可**，不必重启 DSH。

## 补：知识图谱重做成「关卡面」

用户说「今日复盘那个设计很好……参考一下明日方舟的关卡那种平面设计风格」，重点是知识图谱。复盘图（`lib/review.js`）已经把那套语言立起来了（方角、零模糊硬偏移、索引字、左侧信号条、分类色连线），图谱这次是把它搬到**可交互**的平面上——一动一静，所以手法要更省：棋盘格底 + 分区板块 + 正交连线，其余交给排版。`design.md` 的硬规矩照旧（圆角 0、一屏三处青以内、一个组件只用手法里的一样）。

- **布局与连线**：三列**定宽**（大类 176 / 模块 168 / 单元行）。连线从贝塞尔改成**正交折线**（`M 右沿 y H 中缝 V ky H 左沿`）——折线才是「电路/管线」的语言，贝塞尔太软。子树高度仍是确定性递归（没有力导向、没有动画循环），窗口变化防抖重排。
- **分区底板**：每个大类一块 `.kg-band` 板块（方角、1px `--line`、左上角包），左侧一条 `.kg-rail` 索引轨：两位索引号 `.kg-ord`（Rajdhani + `tabular-nums`）+ 每个单元一枚刻线 + 一段百分比量尺 `.kg-gauge`。**该复习的大类**在板块左边贴一条斜纹 `.kg-band-hatch`（`repeating-linear-gradient(115deg, var(--warn) …)`）——info 不靠颜色也能看出来。
- **档位点是菱形**（`rect` + `rotate(45deg)`，圆角 0 那套手法的「菱形」），颜色仍取 `--stage-N`；**选中**的单元是放大的菱形光晕 `.kg-halo`（全图只有一个）加一条 `.kg-row-mark` 行标。
- **进度**：大类沿板块底沿、模块贴左沿、索引板里一条 258×3 的条。**信号青只给「选中 / 进度」**，`0%` 时回灰（`.kg-pct.is-zero`）。
- **索引板（HUD）**：`.kg-plate` 写 `KNOWLEDGE MAP` + 「N 大类 · N 模块 · N 单元」+ 总体进度 + 进度条 + 「已接触 x/y · 斜纹＝该复习」；**钉在画布视口上**——它跟工具箱「全部收起 / 复位视图」、那句 `.kg-hint` 一样，**直接挂在 `<svg>` 上、不进视图层 `.kg-view`**，所以压根不吃 `translate(t) scale(k)`，拖动画布时它们一动不动。**别给 HUD 补反向变换**：早先误以为要补 `translate(-t/k) scale(1/k)`，结果它们反而跟着鼠标乱飞（用户报的就是这个），`test/graph.test.js` 现在改钉「HUD 的 `transform` 始终是空、parentNode 就是 `<svg>`」。
- **面板那侧多了「简报条」**（`mapCard()`）：`KNOWLEDGE MAP` 眉标 + 总体进度 + 四格统计（模块 / 单元 / 已接触 / 平均把握）+ 六档色带 + 六档图例（菱形小点，不是胶囊）。原来那句解释图谱怎么用的 `<p class="dim">` 留着。
- **几何常量全在 `assets/graph.js` 顶上**（`GROUP_W` / `MOD_W` / `STAGE_X` / `DUE_X` / `BTN_X` / `HEAD_Y` …）。加装饰请**另起 class**：`test/graph.test.js` 按 `.kg-box`（必须正好等于大类数）、`.kg-dot`（按可见单元数）、`.kg-halo`（全图 ≤1）的数量断言，别拿它们当底板或图例。
- **两个坑**（都踩了）：①单元行的按钮与行槽原来用**绝对坐标**（忘了 `x +`）→ 全跑到模块列去；栏位宽度是定死的，按钮与行槽一律 `x + 常量` 起排。②折叠时也要报得出「N 个模块 / N 节」→ 用 `node.children.length`，不是这次画出来的子数（原来折叠着显示「空」）。
- **第二版又往里做了一层**（用户说「设计还是太单调了」之后）：
  · **连线连到空白处**：`drawNode` 里子节点的基线少了父节点那一截——`ky = baseY + node.top + kid.y`，而根节点的 `node.y` 在布局里是**绝对中心**，`node.y - node.subH/2 ≠ 0`。现在 `const kidBase = baseY + node.y - node.subH / 2 + node.top`，连线终点与递归都走 `kidBase + kid.y`，拐点再补一枚 5×5 方点 `.kg-joint`。`test/graph.test.js` 加了一条「每一条连线都落在子节点的中心线上」（从每条 `.kg-link` 的 `d` 里取第 4 个数，必须命中某个 `.kg-box` / `.kg-unit-bg` 的中心线）。
  · **缩放会把东西带乱飘**：像素↔viewBox 原来按 1:1 算（`vw = host.clientWidth`），盒子尺寸与 CSS 渲染尺寸一旦不一致，锚点就偏。现在先把指针换算回 viewBox：`const scale = Math.min(box.width / vw, box.height / vh) || 1`、`px = (clientX - box.left) / scale`、`py = (clientY - box.top) / scale`，`<svg>` 也加了 `preserveAspectRatio="xMinYMin meet"`（比例变了也钉左上角）。测试「滚轮缩放钉在指针底下」盯这一条——**写它的时候我自己把纵轴也喂了 `tx`**，换算助手要拆成 `atX` / `atY`，一个函数管两轴是错的。
  · **板块做成关卡面**：抬头条 `.kg-band-head`（两位索引字 + 竖规 + 横向进度槽 + 右端百分比）、右侧压淡的大索引字 `.kg-index`、两条电路通道竖线 `.kg-col`、右沿刻度 `.kg-scale`、左上右下角包 `.kg-frame`、左沿竖进度 `.kg-vgauge` / `.kg-vgauge-fill`、以及整块可点的透明热区 `.kg-band-hit`（**拖过画布的那一下不算点**，用 `panned` 判）。
  · **单元行做成表**：隔行斑马纹 `.kg-unit-row.is-alt`、编号格右边一道竖规 `.kg-cell-rule`、行底线 `.kg-row-rule`；模块**收起**时在右边摆一条「格带」`.kg-cells`——一节一个 9px 方格子、颜色取那一节的档位（没接触过的压暗），收着也看得出里面几节、读到哪儿了。
  · 又多了两个几何常量（`HEAD_BAR_H`、`CELL_RULE_X`）；加装饰照旧**另起 class**，别借 `.kg-box` / `.kg-dot` / `.kg-halo`。
- **记账**：这一批只动 `assets/graph.js` / `assets/graph.css` / `assets/panel.js` / `assets/style.css`（`lib/` 没碰）→ **刷新页面即可**。视觉验收走 `node scripts/preview.mjs`（19390，不碰正在跑的 DSH）；当年那些临时离线样张不在仓库里（也别往工作区根上堆）。

## 补：复盘图常驻，今日任务照复盘图那套版式

用户说：「1.今天复盘能不能做成常驻 2.『今天』能不能改成『今日任务』，然后图形设计搞今日复盘的同款，我认为这一块是你图形界面做的一个很完美的案例」。两句都要：**复盘图从「今日任务页下面那张」变成主页与今日任务页都在的常驻卡**；**今日任务页本身照复盘图（`lib/review.js` 那张 SVG）的版式重做**。

**① 常驻。** `loadReview()` 原来只在 `page === 'today'` 时拉（注释写着「省一趟请求和 9 KB」），现在 `page === 'today' || page === 'home'`；主页 `homePage()` 结尾那行 `<div class="cards">` 从只有「教练的指引」改成 `fold('review', '今日复盘图', reviewCard())` 打头。另外把 `loadReview()` 的判据从「`data` 和 `svg` 都得有」放宽成**只要求 `svg` 是字符串**：`lib/review.js` 刻意做到「这一天什么都没动过就返回 `null`」，面板原来因此整张卡不出现——常驻之后不能这样，**空的一天也得有卡**，于是 `reviewCard()` 多了一条空态分支：标题照旧，正文写「今天还没记过一笔。勾掉一条今日任务、判一道题、或在知识地图上自评一个单元，这张图立刻就有内容。」，不放「下载 SVG」（没图可下）。

**② 今日任务页照复盘图重做。** 复盘图的抬头是「眉标 `DAY REVIEW · 今日复盘` / 大字标题 / `2026-10-01 · 周四` / 右上状态药丸」，量尺在标题下面。今日任务页现在是同一套：

- 卡片从 `<section class="card">` 变成 `<section class="card day">`，抬头换成 `.day-hero`：`.eyebrow` 写 `TODAY · 今日任务`，`.day-title-row` 里左边 `<h2 class="day-title">今日任务</h2>`（`font-size: var(--fs-hero)`，与复盘图的大标题同一档）、右边方角状态块 `.day-pill`（`完成 1/1 · 25 分钟 / 60`；一门课都没排时写「今天还没排任务」；超预算 `.over` 转 `--warn`），下面 `.day-sub` 写 `2026-10-01 · 周四`，再下面一条 7px 方角量尺 `.day-gauge`（轨道 `--line-2` 压半透明、填充 `--accent`、超预算转 `--warn`，`role="img"` + `aria-label="今日完成度 P%"`）。
- **周几是面板自己算的**：`panel.js` 原来没有这个助手，新加 `WEEKDAYS` 与 `weekdayOf(date)`（按 `YYYY-MM-DD` 拆段后 `new Date(y, m-1, d)`，非法回空串）。别拿 `new Date('2026-10-01')` 直接啃——那是 UTC 解析，东八区会差一天。
- 任务行从 `<li class="done">` 变成三栏网格 `<li class="task-item …">`：`grid-template-areas: "ord title meta" / "ord note note" / "ord act act"`，第一栏是两位序号 `.task-ord`（Rajdhani、等宽数字、`--faint`），左侧一条 2px 信号条——**`is-next`（第一条没做完的）给 `--accent`，其余 `--line-2`、做完的 `--line`，一屏只有一条青**。序号是**全页连续**的（`tasksCard()` 里一个 `seq` 计数器），不是每门课从 01 重来。侧栏模式那套媒体查询把网格换成两栏（`"ord title" / "ord meta" / "ord note" / "ord act"`），元信息改左对齐。
- **记账**：只动 `assets/panel.js` / `assets/style.css` / `test/panel.test.js`（`lib/` 没碰）→ **刷新页面即可**。测试 `test/panel.test.js` 27 条、全量 309 条；harness 多了一个 `review` 选项（`review: null` 才测得到空态分支）。

**③ 主页上那两张卡后来又删了（用户改口）。** 中间一度把「今日任务」与「今日复盘图」都挂到主页（`fold('today', …) + fold('review', …) + fold('guide', …)`），用户看过之后说「主页的今日任务和今日复盘删了吧」，于是收回去：`homePage()` 那个 `.cards` 只剩 `fold('guide', '教练的指引', guideCard())`，`load()` 里复盘图的触发条件也退回 `page === 'today'`（主页不再为它多跑一趟 9 KB）。**今日任务页本身一点没动**（照旧 `.day-hero` 抬头 + 复盘图卡）。教训记一条：**主页是「路口」，活儿在各自那一页**——`test/panel.test.js` 那条「今日任务与复盘图都不在主页：主页只留路口，活儿在各自那一页」就是钉这个（断主页没有 `data-card="today"` / `data-card="review"` / `data-act="task-toggle"`，且没打 `/api/review?date=`）。

**④ 同一轮用户说「知识地图的拖动可以关掉」，于是画布不再跟着鼠标拖。** `assets/graph.js` 里 `pointerdown/pointermove/pointerup/pointercancel/pointerleave` 那整套平移连同 `dragging`/`captured`/`panned` 三个状态一起删掉，`.kg-band-hit` 的 click 里那句 `if (panned) return` 也没用了；`assets/graph.css` 的 `cursor: grab`、`.kg-svg.is-panning`、`touch-action: none` 一并去掉（触屏上现在能正常滚页面）。**滚轮缩放留着**（锚点逻辑没动）、`复位视图` / `全部收起` 也还在，所以看得到的地方够用；面板上那句提示语同步改成「滚轮可缩放」。测试也换了契约：`test/graph.test.js` 从「空白处能拖动画布」改成「画布不跟鼠标拖（拖动关掉了）；滚轮还是能缩放」，HUD 那条改为**先用滚轮把视图层推走**再断言索引板/工具箱的 `transform` 仍是 `null`。
**④-回滚（后来那轮）：平移又装回来了。** 用户 m21561 一句「然后知识图谱的拖动功能加回来吧」——`assets/graph.js` 末尾重写了那节（`PAN_SLOP = 4` / `PAN_MAX = 1` / `scaleOf()` / `inTools()`），`assets/graph.css` 的 `cursor: grab` 与 `.kg-svg.is-panning, .kg-svg.is-panning * { cursor: grabbing }` 也回来了；**没要回 `touch-action: none`**（触屏上照旧能滚页面，指针被浏览器接管时 `pointercancel` 会把平移收干净）。测试从「一动不动」改回「挪过 4px 才动、拖完那一下不吃点击」，另有一条盯「按在工具箱上不算拖」。**教训**：`assets/graph.js` 里这类「用户当时不要、后来又要」的交互，注释里要写清是谁哪一轮要的，别把「别再装回来」写成永久规矩。

- 顺手记一笔**既有**毛病（不是这批改出来的）：窄屏 420px 下整页有横向溢出，体检卡右端那颗按钮会被切在视口外。用**没动过**的 `/study/ability` 在同一宽度截图，溢出位置一模一样 → 病根在共用部分（顶栏或体检卡），跟今日任务这张卡无关，留待下一轮定位。


## 补：对话不再跳顶；资料读不动就转给教练；「学习」页看资料图谱

用户一次提了三件：「1.资料的路径读取这个地方，如果说 web 端自动读取失败，则直接转发给 AI 2.对话每次发信息之后都会自动跳转到最顶上，我还得手动拖到下面，这个要修一下 3.资料，不管是网课还是教辅，都要让 agent 在其最小单元标注在知识图谱的位置，比如说 M1.1 这种格式……然后可以增加一个学习的界面……根据知识图谱和现有资料来建立资料图谱」。

**① 发完消息跳回最顶上。** 病根在 `paintChat()`（`assets/panel.js`）：它先用 `scrollHeight - scrollTop - clientHeight < 60` 算出「本来贴着底么」，然后 `host.innerHTML = chatLog(snapshot)`，再 `if (stick) host.scrollTop = host.scrollHeight`。**它默认浏览器换 `innerHTML` 时会保留 `scrollTop`** —— 换进去的内容一多，那一下就被重置到 0，于是「发一条、跳到顶」。现在 `paintChat()` 自己把位置管起来：换 DOM 之前记下 `{ top, stick }`，换完先把 `scrollTop` 放回 `top`（贴底时直接落到底），消息里的图/公式晚一步撑开时再补一次。另外**换会话**（不是刷新）强制落到底 —— 那是「看最新几句」的意图，不该停在旧位置上。`test/panel.test.js` 有一条『对话：换会话落到底，刷新不把人甩回最上面』钉着。

**② web 端读不动，就把这件事转给教练。** 资料页原来只把失败写在卡片上（`shelfState()` 的「原件不在了」、拆图抛错的 toast、`shelfDetail()` 的「读不出来：…」），人还得自己想「那我该干嘛」。现在三处出口都调 `forwardToCoach()`：把「哪一份 / 什么路径 / 为什么读不动 / 请读完按最小单元归位」投进学习教练会话（`POST /study/api/chat/send`），然后 toast 一句「已经交给教练了」。**同一份、同一个理由只投一次**（`acted` 那张表按 `materialId + 理由` 记），刷新不会刷出一串重复消息。

**③ 「学习」页：资料图谱（后来整页重做过一次，见下面「第二版」）。** 第一版是**客户端**拿知识图谱当骨架、拿每份材料的 `points` 往上贴：抬头复用今日任务那套 `.day-hero`，一排材料筹码写名字 + 单元数，再按**大类 → 模块 → 单元**列，两边数据（`/study/api/state` 的 `state.map.modules` + `/study/api/materials` 每份的 `points`）一拼就成。**材料写名字、不写 A/B/C**（用户：「教辅的名字要显示它的名字而不是一串字母」），行里放不下就走 `shortMatTitle()`（去年份、「新高考/高考/中考」、「数学」，超 11 字掐中间），**全名永远在 `title` 里**。没材料对上的单元写「还没有材料对上」；`points` 为空的那几份列在末尾，每份一颗「让教练标一遍」→ 走 `forwardToCoach({annotate: true})`，措辞是「资料没标到知识图谱，交给你」。**新页面要记账**：`lib/handler.js:27` 的 `PANEL_PAGES` 里得加上 `'atlas'`，否则 `/study/atlas` 直接 404；这条是 `lib/` 改动 → **要重启 DSH**。

**③-第二版：整页推倒重做，按材料自己的目录摊三层。** 用户看过之后说「资料图谱推倒重做吧，按照资料的目录或者文件夹分类来做三层：大类、模块、最小单元，以及对应链接来」——于是骨架搬到服务端：

- 新增 `lib/material-tree.js`（入口 `materialTree({ material, shelf, spans, list, tree })`）+ `GET /study/api/material/tree?materialId=`，回 `{ ok, material, basis, truncated, groups, loose }`。`basis` 四选一：**`agent`（教练用 `study_analysis` 的 `tree` 写下来的，优先）**、`toc`（书按目录摊）、`spans`（目录没读过，一段一段的页级索引自己当单元）、`folder`（path 是文件夹的，按子目录当模块、文件名当单元）。三个上限常量 `MAX_MODULES = 400` / `MAX_UNITS = 1200` / `MAX_PAGES_PER_UNIT = 12`。
- **书那棵树只信目录**——第一版拿「和模块页范围有交叠的 spans」当单元，而分析里的 spans 常是**整专题一条**，于是同一句话被抄进该专题每个模块、单元 id 跟模块名对不上（真数据里 `1.2 常用逻辑用语` 那行写着 `M1.1`），用户一句「完全是乱的啊」推倒重来。现在的规矩：大类 = level 1、模块 = level 2、最小单元 = level 3；**目录没有第三级就不许再造一层**，`module.leaf === true`，模块自己就是最小单元。页级 spans 只在「目录压根没读过」时当兜底。
- 面板：`loadAtlas()` 只在这一页拉一次树；**一次只挑一份材料**（`ui.atlasPick`），那排筹码就是切换器；折起来的大类/模块记在 `ui.atlasShut`（键 `g:大类序号` / `m:大类序号:模块序号`），纯客户端不打服务端。三级 DOM 是 `.atlas-group` → `.atlas-mod` → `li.atlas-unit`。**leaf 模块**的头不带 caret、不给 `data-act`（点了没东西可折）、计数写「最小单元」、链接直接挂模块那一行；单元行的 `.atlas-id` 写名字（人话），挂了 pointId 的旁边单挂一枚 `.atlas-kind.atlas-point` 筹码（`M1.1` 这种）——名字和 id 是两件事，缺一个都看不出「这段归到哪儿」。
- **给 agent 的那个接口**（用户问「是不是也要给 agent 一个接口然后让 agent 根据 prompt 做比较好」）：`study_analysis action=save` 多一个 `tree` 参数，形状就是大类 → 模块 → 最小单元（单元那层可省）。`lib/analysis.js` 的 `treeOf()` 只认形状（没大类名的、不是对象的直接丢），`upsertAnalysis` 里是**整份覆盖**：传了就换、不传就不动、`tree: []` 清掉退回自动摊。服务端 `materialTree()` 有它就优先。面板 `srcHint`：`basis === 'agent'` 写「这三层是教练读过之后写下来的」，否则写「按它自己的目录自动摊的——教练读过一遍再写下来会更准」+ 一颗「让教练核一遍」（`data-act="atlas-annotate"`）。`skills/study-coach/SKILL.md` 新增一节「顺手写「资料图谱」」教它什么时候值得写、`tree` 怎么写。
- **每一层都给链接**：`atlasLinks()` 走 `assets/urls.js` 的 `openPath()`，`linkLabel()` 按扩展名说话（`.pdf` → 打开 PDF、视频扩展名 → 打开视频、`.md/.txt` → 打开正文、`kind === 'folder'` → 打开文件夹、其余 → 打开），页图最多 4 颗 `P10` 这种直链 `/study/page?path=`。**判扩展名只许切 `#`，别切 `?`**——写成 `split(/[?#]/)` 会把 query 一起切掉，`/study/file?path=…pdf` 里的 `.pdf` 就看不见了（踩过）。
- `tree.loose`（封面、目录、答案这些没归到任何模块的页）单开一块「没归到目录里的」，标题退回内容类型；一条 pointId 都没有的那几份收进 `.atlas-blank`（「这份材料还没挂到最小单元上」）+「交给教练去标」。
- 版本守卫：`probeCapabilities()` 里 `alive('/study/api/material/tree')`（缺参新代码回 400、旧代码 404）→ `capabilities.tree`；没有它就说「去重启 DSH」，别说「还没标」。
- **顺手修掉一个真 bug**：面板的 `today()` 原来按**本地日期**算，而服务端（`lib/routes.js` / `lib/map.js`）用的是 `toISOString().slice(0, 10)` 的 **UTC 日期**——东八区一过 16:00，面板就显示「明天」、任务列表看着是空的，而活儿就在那儿。现在两边一套口径（`assets/panel.js:233`）。
- 测试：`test/material-tree.test.js` 11 条（`folderTree` / `bookTree` / leaf / `agentTree` / `basis` 分流都拿假 `list`、假 toc、假 tree 喂）、`test/tools.test.js` 里多一条 `study_analysis` 写 `tree` 的行为测试（写歪的节点丢掉、不传保留、空数组清掉）、`test/panel.test.js` 33 条，全量 **328 条**。
- 真数据上重看（精讲册）：11 个大类、57 条内容、已挂到单元 43 条；`专题一 … 4 个模块 · 4 条内容 P9-16` → `1.1 集合 [M1.1] 最小单元 P10-11 打开 PDF [P10][P11]`、`1.2 常用逻辑用语 [M1.4] P12-13`——**两级就两级，不再有重复的单元行**。网课那份 = `basis: folder`、单元是 mp4 文件名配「打开视频」。第一版那条「已知数据侧瑕疵」就这么消掉了。



### 七、跳转按钮「看不见内容」的病根（壁纸插件 + 别名层）

用户报了「设置 → 学习教练 → 网页面板 那个跳转按钮看不见内容」。不是没渲染，是**按钮有面、字是透明的**：

- 旧样式把主按钮写成 `background: var(--dsw-alias-brand-primary); color: var(--dsw-alias-bg-base)`。`--dsw-alias-bg-base` 是**背景**语义（页面底色），不是「填充色之上的文字色」。装了 `dsh-plugin-wallpaper-engine` 之后，它在壁纸激活时把整套别名层改写：`--dsw-alias-bg-base: transparent`（`lib/client.js:183`、`:225`），顺带把 `bg-layer-1/2/3` 换成玻璃配方、`border-l1/l2` 换成 `rgba(180,180,180,.35)`、`brand-primary` 换成 `var(--we-accent,#4f8cff)`（`:708`）。于是 `color: transparent` —— 剩下一个空白方块。
- **公开的 `--dsw-alias-*` 允许集只有 14 个**（`bg-base / bg-layer-1 / bg-layer-2 / bg-overlay / border-l1 / border-l2 / brand-primary / label-primary / label-secondary / state-{error,idle,success,warn}-primary / specific-sidebar-fill`），**里面没有「填充色之上那层文字色」**，所以这一页干脆不做实心填充：品牌色只描边 + 左侧一道 3px 信号条，文字走 `label-primary`。
- **每个别名引用都要写实色兜底**：`var(--dsw-alias-brand-primary, #4f8cff)`。别名层不属于我们，谁都可能改写它。
- 怎么验的（没有 DSH 也能看）：当时搭了一个临时离线壳子——迷你 React + `toDom()` + `window.fetch` 桩，`?bundle=old|new&theme=light|dark&we=0|1&state=running|stopped` 四个开关，两套 token（DSH 正典 / 壁纸插件改写）；旧 bundle 从 git 导出成一个临时 js。壳子里能把 computed style 直接打到页面上：**旧 bundle 量出 `.sc-btn.primary color = rgba(0, 0, 0, 0)`，新 bundle 是 `rgb(0, 0, 0)`**。那套壳子是当晚的临时物（在工作区根，不在仓库里），现在已经删了——要复现就照这个思路现搭一个，或者装了 `dsh-plugin-wallpaper-engine` 之后拿 `scripts/preview.mjs` 直接看。顺带两条环境经验：Edge 必须用老 `--headless`（`--headless=new` 会报 `Multiple targets are not supported in headless mode`），`--dump-dom` 在它上面零输出、别指望。


## 补：「能力」页并进知识地图页（整体饼图 + 各大类）

用户说：「能力部分可以删掉，合并到知识图谱部分的下面，知识图谱下面本来就有个能力的同一种东西，这位于做成饼图，饼图的下面是大类名字，也是依据知识图谱的大类，掌握程度用不同颜色表示……然后档案按键保留，就在饼图下面的大类名字旁边，一点就展开掌握的详情，然后整体的掌握程度也要有个地方写出来」。

- **导航里不再有「能力」**（`assets/panel.js` 的 `PAGES` 删掉那一项），它的两节并进 `PAGE_CARDS.map` 的 `main`：`[['map','知识地图',mapCard], ['ability','掌握度',abilityCard], ['mistakes','错题本',mistakesCard]]`。地图页现在是「图谱 → 掌握度 → 错题本」三节，**一栏到底**——`aside` 原来摆着学生画像，用户看过之后说「地图页的删了」，现在画像只在档案页那一张（见本文末「学生画像也摆一份到档案页」）。
- **图谱卡里那份重复的大类列表搬走了**：`mapCard()` 末尾的 `${groupedBlocks(modules)}` 去掉，`groupedBlocks()` 现在只由 `abilityCard()` 调用一次。之前两处各铺一份同样的「大类 + 进度条 + 档案」，看着像两件事，其实是一件事。
- **饼图是「整体四档分布」**：`masteryBands(byStage, total)` 把六档并成四档（`MASTERY_BANDS`：熟练掌握 = 熟练稳定 + 能讲明白 → `--stage-6`；大概掌握 = 能独立做 → `--stage-4`；薄弱 = 能跟做 + 见过 → `--stage-2`；完全不会 = 没接触过 → `--stage-1`），`masteryPie()` 用 `stroke-dasharray` 画环（`pathLength="100"`，每段的 `stroke-dashoffset` 累加），圆心写「整体掌握度 N%」。颜色只取 `--stage-*` 那四个 token —— 深色和浅色两套色板都靠它们自动换。**「整体的掌握程度也要有个地方写出来」就是圆心那个数字 + 图例那一列百分比 + `一共 N 个单元：熟练掌握 …` 那行。**
- **饼图下面是大类名字**（`<h3 class="sub">各大类</h3>` + `<div class="grouped">`），行尾还是那枚「档案」（`archiveBtn('group', name)`），点行首箭头就地展开模块 → 最小单元；按 `.sub` 分节往下是薄弱环节 / 待复习 / 最近七天。
- **老地址不能 404**：`lib/handler.js` 的 `PANEL_PAGES` 里 `'ability'` 留着（服务端继续发 panel.html），`resolvePage()` 里加一张 `alias = { '/study/ability': 'map' }` 把它落到地图页。`test/pages-consistency.test.js` 从「两边一模一样」改成「PAGES 里的每一项都必须在 PANEL_PAGES 里；PANEL_PAGES 多出来的只能是 `LEGACY_PAGES` 里写明理由的老地址，而且 alias 表要对得上」。
- 顺手改口的地方：主页入口卡 `总体能力` → `掌握度`（指 `/study/map`）；`STALE_NEED` 里那两句描述、体检卡那两处 `data-nav`；`lib/client.js` 的设置页链接表（去掉「能力」、补上「学习」）。
- **这一批不用重启 DSH**：`PANEL_PAGES` 只删不增，`lib/client.js` 每次页面加载现读，`assets/*` 刷新即可。


## 补：知识地图彻底不可动；掌握度也挂到档案页

- **还剩下两条「会动」的路，这一轮也堵上了**（用户原话：「不是让你把知识图谱改成不可动的吗」）：
  · **拖过的那一下不算点。** 平移早拆了，但在板块/单元上按住挪一段再松手，浏览器照样发一枚 `click`，把那一块折叠掉——布局一收，看着就像地图自己动。现在 `assets/graph.js` 记下按下的位置（模块级 `pressAt`、`watchDrag(svg)`），松手时算一次 `draggedFromPress(event)`：**按下的元素就是点中的元素**、距按下 ≤1500ms、位移 >4px，三个都成立才让这枚 click 失效。五个 click 处理器各在开头挡一下：`.kg-btn`、`.kg-band-hit`、模块/大类节点 `g`、单元节点 `g`、`.kg-tool`（复位视图 / 全部收起）。键盘派发的 click 前面没有 `pointerdown`，不受影响；按下这头、松手那头（点的目标根本不是同一块）也不拦。
  · **普通滚轮不再缩放。** `svg` 的 `wheel` 头一句 `if (!event.ctrlKey && !event.metaKey) return`——不 `preventDefault`，页面照旧跟着滚；**要缩放按住 Ctrl／⌘ 滚轮**（0.4x–2.4x，锚点逻辑没动）。面板提示语同步改成「画布本身拖不动，要缩放按住 Ctrl 滚轮（左上角那块索引板钉着不跟走）」。
- **掌握度也挂到档案页**（用户原话：「掌握度在档案页面也要加一个」）：`PAGE_CARDS.library.main` = `[['library','学习档案',libraryCard], ['ability','掌握度',abilityCard], ['materials','材料',materialsCard]]`——跟地图页**同一张** `abilityCard()`、同一个展开 id `ability`，不另写一份；`PAGES` 里 library 的 hint 补成「学习目标、材料、基本工具、掌握度」。
- 测试跟着改口：`test/graph.test.js` 六处 `wheel` 派发补 `ctrlKey: true`，两条用例名改成「滚轮要按住 Ctrl／⌘ 才缩放…；光滚轮不动画面」与「画布不跟鼠标拖（拖动整条路都拆了）；缩放要按住 Ctrl／⌘ 滚轮」，新增「在板块上按住挪一段再松手：那一发 click 不算点，板块不折叠」（**要在同一个节点上派发 `pointerdown` 与 `click`**——判据里比了 `event.target`）；`test/panel.test.js` 的档案页那条补 `data-card="ability"` + `pie-slice` + 「整体掌握度」。全量 **316 pass / 0 fail**。
- **这一批只动 `assets/*` 与测试**：刷新面板即可，不用重启 DSH。

## 补：看课直接落到那一讲；做题把教练叫来

用户一次提了两件事（原话：「教练布置作业的时候的规范是根据现在对学生水平的了解，掌握度，结合知识图谱和资料图谱布置，
注意要他思考学生现在到底需要什么，然后他想到的资料可以起到什么作用，其次我需要你把知识地图的看课和做题区域重做，
看课的话自动指向特定文件，做题的话就直接跳转 AI 教练让他布置」）。前半件是**写给教练的规矩**，后半件是**两个按钮的活法**。

### 一、布置作业的规范：先过三关（`skills/study-coach/SKILL.md`）

落在第 6 节「排每日任务」里的新小节「布置作业之前，先过这三关」——四步：**他现在在哪儿**（`study_report` 的档位与
该复习的、`study_mistakes` 待验证 / 该复做的、`study_archive` 的最近表现、`study_student` 的判断、基本工具表；
证据不够就先出一道题看看）、**他现在到底需要什么**（一句话说清：概念没分清 / 看得懂下不了手 / 能跟做但独立不了 /
做错了要纠 / 该复习 / 该背到点）、**哪份材料的哪一段能干什么活**（知识地图管「练哪个单元」、资料图谱管「去哪儿练」；
翻 `study_analysis` 的 `role` / `pairing` 和每章的 `pages` / `examples` / `exercises` / `marks`；讲解用精讲册例题段、
上手用基础题、独立做变式、对答案用答案册、定时练用真题，别把三本书都排上）、**落成成对任务**（watch + practice、
`target` 写 pointId、`minutes` 不超 `minutesPerDay`，每条都能回答「为什么是这一份这一段这些题」）。
后面跟六条「别做的」（别排整本书 / 别只看不练 / 别排刚做对过的 / **材料没通读就别写页码题号** / 别越档位 / 别把该复习的压掉）。

### 二、看课：从「打开那个文件夹」变成「打开那一讲」

- 新路由 `GET /study/api/point/media?point=<id>`（`lib/routes.js` → `lib/material-tree.js` 的 `videoForPoint()`）：
  把这一份单元交给地图里的每个单元，命中的那一讲回 `{ video: { file, url, kind, title, material, materialId, level, why, … } }`。
- 三档评分：**100** 图谱里写着同一个 `pointId`（资料图谱最准）、**80** 名字 key 完全相等、**60** 互相包含且短的那边 ≥5 字、
  **40** 最长公共子串 ≥6；再往下模块名 / 大类名只算「这一部分」（20 / 10，`level: 'part'`）。
  `nameKey()` 去序号、标点、空白，**还去连词 `与和及`**——`基础知识与基本例题` 与 `基础知识&基本例题` 必须算同一件东西。
- 同分比三档 `[score, aff, kindRank]`：`aff = coverOf(父目录名, 这一节的名字)`，用的是**两字片段的交集个数**
  （比最长公共子串更看整体重叠）；**只跟这一节的名字比，不掺模块 / 大类名**——父目录跟模块名本来就是同一个名字，
  互相加成会把长文件夹名抬起来。
- **收口很紧：只有 `score >= 60` 且命中的不是文件夹，才敢直接开那个文件**；其余一律 `partHit()` 退成那个文件夹
  （里面正好只有一讲就展开成那一个 mp4），再没有才用它自己挂的 `point.video`，最后才空手。
- **踩过两回**：① `sharedRun(key, uk) >= 3` 太松——「题型1」人人有，真数据 67 个单元里有一串全指到同一个
  `05.题型1：集合间的基本关系.mp4`；② 拿父目录跟模块名互相加成抬分。收紧后同一批真数据复核：
  **67 个单元 42 个落到具体 mp4、25 个落到文件夹、0 个空手**，`M1.1 集合基础知识与基本例题` 落到
  `02.模块一 基础知识 集合\04.基础知识&基本例题.mp4`、`M1.4 逻辑基础知识与基本例题` 落到
  `03.模块一 基础知识 逻辑\14.基础知识与基本例题.mp4`，两份都不串。
- 面板侧 `openLesson(point)`：有 `video.url` 就打开；命中是文件夹（或不是「资料图谱里写着」那一档）再补一条
  toast（「对到这一部分的目录「…」（里面 N 个视频）」）——**得让他知道没落到单集**。旧服务端（`capabilities.media` 为假）
  才退回 `point.video`，再没有才发那句「这一节尚未关联网课」的 inbox。

### 三、做题：不跳做题页了，把教练叫来布置

- `askCoachForWork(point)`（`assets/panel.js`）往 `/study/api/chat/send` 递四行话：想练哪个单元（带 `pointId` 和标题）、
  先看掌握度 / 该复习的 / 最近的错题、再从材料里挑出具体那一段（哪份材料、第几页 / 第几题）并说清为什么挑它、
  最后用 `study_plan` 落一条今天的任务；发完 `go('coach', '/study/coach')` 直接就位。
- 同一个单元只递一次（`FORWARDED` 的键 `'work|' + point.id`），**发送失败要把那条键删掉**，不然重试一次都没了。
- 两颗按钮**永远活着**：`assets/graph.js` 里不再拿 `point.video` / `point.practice` 决定 `is-empty`，
  点下去要干什么由 `openMaterial(kind, point)` 分派（`test/graph.test.js` 钉着）。
- 面板开机探针多了一条 `/study/api/point/media`（`capabilities.media`），体检卡也跟着多一条「按资料图谱找那一讲」；
  探针按「缺参新代码回 400、旧代码回 404」认新旧。

### 四、测试与生效

- `test/material-tree.test.js` 15 条（视频目标解析、pointId 命中、PDF 不算看课、只对到「这一部分」时摆文件夹、
  **两个文件夹里都有「基础知识」那种课靠父目录分开**）、`test/shelf.test.js` 9 条（真 tmp 目录 + 真 store 走一遍
  `/study/api/point/media`）、`test/graph.test.js` 两条按新行为改口、`test/panel.test.js` 加了 `MEDIA` 夹具与两条断言。
- 这一批动了 `lib/material-tree.js` 与 `lib/routes.js`（**→ 要重启 DSH**），`assets/*` 刷新即可。

## 补：四层掌握度、综合学生档案、两份档案一起更新

用户一次提了三件事（原话：「掌握度模块针对每个大类、模块、最小单元都要给一个四层掌握度，在档案界面增加一个学生档案（综合性的），
然后学生每次有完成作业，听完课都要更新两个学生档案，一个是掌握度模块的档案（并且同步更新掌握度），一个是总体评价」）。
当天他还提过一个「看完了」按钮，**后来自己撤了**（原话：「算了，看完了那个功能也不太必要，删了吧，
然后让教练在每次布置任务的时候看看学生档案就行了，然后需要的时候更新档案就行了」）——那一整套已经删干净，
判断「他有没有在学」只看下面这两份档案。

### 一、四层掌握度：大类、模块、最小单元各一条

`MASTERY_BANDS` 那四档（熟练掌握 = 熟练稳定 + 能讲明白 / 大概掌握 = 能独立做 / 薄弱 = 能跟做 + 见过 /
完全不会 = 没接触过）原来只在整体饼图上用，现在每一级都给一条：

- `bandIndexOf(stage)` → `MASTERY_BANDS.findIndex`，认不出的档位按「完全不会」算；
- `bandCounts(points)` → `{ counts, total }`，`points` 是这一级底下所有最小单元；
- `bandStrip(points)` → 72×6 的四段色带，`title` 写「熟练掌握 n · 大概掌握 n · 薄弱 n · 完全不会 n（共 N 个单元）」，
  `total` 为 0 就回空串（别画一条空的）；挂在 `groupedBlocks()` 的大类头与 `moduleBlock()` 的模块头；
- `bandCells(stage)` → 单元那一行的四格小灯，最左那格永远亮，`style="--c:档色"`；挂在 `pointRow()` 的 `.stage-tag` 之前。

色带 / 灯只用 `--stage-1…6` 那几个 token。**踩过一次**：`bandStrip` 里顺手用了 `r2()`，而那是 `masteryPie()` 的局部函数，
整张卡直接 `r2 is not defined` 渲染不出来。

### 二、综合学生档案卡（档案页最上面那一张）

`studentFileCard()` 把原来散在各处的结论揉成一份：总体评价（`state.ability.judgement` + 粗档位）、
一组数字（整体掌握度 % / 碰过几个单元 / 平均把握 / 薄弱几个 / 该复习几条 / 离目标几天）、四层色带与四档计数、
最近七天的节奏柱、前 4 条学生画像（`state.student.facts`，带类别标签）、基本工具表、错题三档计数，
末尾写明「这套档案是教练每次看完作业、听完课更新出来的」。

它是**只读汇总**——改数据仍走对话里的 `study_ability` / `study_student`，没给它加写接口。
`PAGE_CARDS.library` 的 main 因此变成 `[['who','学生档案',studentFileCard], ['library','学习档案',libraryCard],
['ability','掌握度',abilityCard], ['materials','材料',materialsCard]]`（掌握度那张跟地图页是**同一张** `abilityCard()`）。

### 三、两份档案一起更新（写进 `SKILL.md` 与布置作业的规矩）

第 7 节「收作业」里新增「收完作业 / 听完课：两份档案一起更新」：**掌握度档案**用 `study_record` 记证据
（作业 `quiz` / `photo`、上课 `lesson`，note 写清哪天哪份材料什么表现），一次只推一档，`nextReview` 跟档位
（见过 1 / 能跟做 2 / 能独立做 4 / 熟练稳定 7 天），错了就挂 `mistake`（`origin` 必填，`cause` + `fix` 齐了才能标「已订正」）；
**总体评价**用 `study_ability action=set` 写判词、`from` 填综合了哪几条画像，`study_student` 只在有挂得上证据的新结论时才动。
顺序是「先流水后结论」，时机是当场（他交作业 / 说听完课 / 说「这节课听完了」）。

第 6 节「排每日任务」的「布置作业之前，先过这三关」开头又钉了一遍：**动手排任务之前先看这两份档案**
（掌握度档的当前档位与该复习的、学生画像、总体评价），跟眼前这一次对不上就顺手更新掉——不看档案排出来的活儿
是在猜；**档位只有 `study_record` 的 `stage` 一个入口**，面板上任何一颗按钮都不许直接改档。

### 四、今日任务那一行只留「打开 / 改 / 删除」

用户原话：「然后布置的东西加在今日任务里，今日任务的打开 看这节网课 这一节的讲义 做题 / 看掌握度 改 删除
这几个功能只需要留下打开 改 删除就可以了」。所以任务行不再挂一串跳转：

- 面板 `taskView()` 与工具那半吃的 `lib/map.js` 的 `taskLinks()` **是同一套挑法**（两边别漂）：
  `task.open`（教练指的「就做这一份这一段」）→ 单元的 `video` → 单元的 `practice`，都没有就**不给按钮**；
- 一颗按钮的 label 一律是「打开」，URL 照旧走唯一的门牌规则 `openPath()`（md / txt 进读卷页，其余走 `/study/file`）；
- 「观看本节网课 / 本节讲义 / 看完后做题 / 做题 / 查看掌握度」**全部删掉，不许加回来**——要练哪个单元，
  走知识地图上那颗「做题」，让教练按学生档案挑材料页码与题号（第 6 节那四步）；
- 「改」「删除」是任务行自己画的按钮，跟跳转无关，照旧。

### 五、测试与生效

- `test/panel.test.js` 的「今天页」那条改成「一行只留打开 / 改 / 删除」（一颗 `open-link`、旧按钮全不许出现），
  掌握度页补了四层色带与四格灯断言，档案页补了学生档案卡断言，学习页把「看完了」那三步换成「网课那行只有类型筹码 + 打开视频」；
  `test/ask.test.js` 里任务按钮那几条也改成「只给一颗 `kind: 'open'`」；
  全量 `node --test` = **333 pass / 0 fail / 0 skipped**（少了 `test/watched.test.js` 那 3 条）。
- 这一批动了 `lib/`（`schema.js` / `store.js` / `routes.js` 里删掉 watched 那一套、`map.js` 的 `taskLinks`）
  → **要重启 DSH**；`assets/*` 刷新即可。

### 六、学生画像也摆一份到档案页（随后地图页那张删了）

用户说（m21687）：「学生画像加到档案里，学习目标下面」。所以档案页边栏是
`[['goal','学习目标',goalCard], ['student','学生画像',studentCard], ['tools','基本工具',toolsCard]]`，
画像卡就在「学习目标」正下方。

- 数据源是 `student.json`（写走对话里的 `study_student`），全仓只此一张 `studentCard()`；展开 id 是 `student`。
- `STALE_NEED` 里那条的说明跟着改成「档案页「学习目标」下面那张画像卡」，
  `PAGES` 的 `library.hint` 补上「学生画像」；`test/panel.test.js` 的档案页那条钉住边栏次序
  `goal → student → tools` 与 `<h2>学生画像</h2>`。
- **看完之后用户又说「地图页的删了」（m21774）**，于是 `PAGE_CARDS.map` 的 `aside` 整条删掉、
  地图页变成一栏到底，学生画像只剩档案页这一张。`test/panel.test.js` 相应地：画像那条用例走
  `/study/library`（原来走 `/study/ability`），画像的断言都收在一个 `card()` 局部函数里读
  `data-card="student"` 到 `</section>` 那一段——因为档案页那张「学生档案」(`who`) 也列前 4 条判断，
  拿整页断言会被它带红；「两栏/一栏」那条改成断言地图页**没有** `aside` 也没有 `data-card="student"`。
- 只动 `assets/panel.js` + 测试 + 文档 → **刷新页面即可，不用重启 DSH**；全量 `node --test` 仍是 333 pass。
- 教训：**「也摆一份」反悔时要把旧的那张一起收掉**，否则同一张卡在两页各出现一次，用户会以为是两件事。

### 七、换页要顺手把那一页的数据补上（用户报的「一开始进去读取不到数据」）

用户说（m21952）：「有的功能一开始进去的时候读取不到数据，刷新一下浏览器就是正常的了」。

- **病根**：`assets/panel.js` 的 `go(id, path)` 换页时只做 `page = id; openFirstCard(id); render()`
  + `pushState`，**从不补取这一页的数据**；而「今日复盘 / 书架 / 资料图谱 / 番茄钟 / 对话清单」
  这些是各页专属的，只在 `load()`（开机那一刻、或表单提交后）里按 `page === …` 条件拉。
  于是从主页点进「资料 / 学习 / 工具 / 今日任务」全是空的；而这些页的地址已经被 `pushState` 改成
  真地址了，**按 F5 正好从那一页重新开机**，数据就齐了——「刷新一下浏览器就正常了」就是这么来的。
- **修法**：新增 `async function fillPage({ fresh = false } = {})`（`assets/panel.js:593`），
  把「这一页要的」那六份集中到一处：复盘图（today）、书架（materials / atlas）、资料图谱（atlas）、
  番茄钟（toolbox）、记忆卡（toolbox 且选了那个小工具）、对话快照与会话清单（coach / 浮窗 / 整份重来）。
  每份都写 `(fresh || !x)`：`load()` 走 `fillPage({ fresh: true })`（整份重来），换页只补缺的。
  **顺序也在这儿管**——`loadAtlas()` 要读 `shelf`，所以书架必须排在它前面。
  `go()` 返回那一趟 `fillPage()` 的 promise，补完若还停在这一页就再 `render()` 一次
  （先画再补，切页不空窗）；导航那条 click 分支 `await go(...)`，`popstate` 也一样接上。
- **规矩**：以后再加「只有某一页要」的数据，一律挂进 `fillPage()`，别只写进 `load()`
  ——AGENTS.md 里也钉了这一条。
- 回归测试是 `test/panel.test.js` 的「换页时把那一页的数据补上，不用按 F5」：从主页起，
  数着精确路径断言点 today 才有 `/api/review?date=`、点 atlas 才有 `materialId=mat-1` 且书架排在它前面、
  点回 materials 不重复拉书架、点 toolbox 才拉番茄钟。全量 `node --test` = **334 pass / 0 fail / 0 skipped**。
- 只动 `assets/panel.js` + 测试 + 文档 → **刷新页面即可，不用重启 DSH**。



