# dsh-study-coach

DSH 的学习教练插件。把一门课拆成知识地图，逐单元记掌握度、排每日任务，并给学生一个看得见进度的网页面板。同源挂在 DSH 自己的 web 服务器上，面板地址 `/study`。

- 对话里的 agent 用 15 个 `study_*` 工具读写全部数据；
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
| 对话里的 agent | 用 15 个 `study_*` 工具读和写全部数据；随包 `skills/study-coach/SKILL.md` 是工作法 |
| 学生 | 只在面板上看：自评档位、勾任务，以及在对话页 / 悬浮窗里直接跟教练说话。学习内容本身对他只读，全由 agent 写 |

## 插件是框架，数据在别处

**这个仓库里只有代码，一条学习内容都没有。** 学生的目标、知识地图、掌握度、任务、材料清单——全都是数据，全都落在数据根目录里，跟插件代码分开：

```
<数据根>/
├── registry.json          有哪几个学习目标、现在用哪个
├── profiles/<目标 id>/    一个学习目标一份，里面就是下面那几张表
│   ├── profile.json       学习目标、材料清单、基本工具
│   ├── map.json           知识地图（大类 / 模块 / 最小单元，单元上挂着网课和练习的路径）
│   ├── mastery.json       每个知识点的状态、证据、复习时间
│   ├── tasks.json         按日期分的每日任务
│   ├── analysis.json      每份材料通读之后的结论：教学定位、每章讲什么、例题习题范围、难度
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
| `study_record` | 记一条掌握度证据，推进状态。带 `mistake` 就是「这次错了，顺带把错题记下来」（`origin` 必填，标成「已订正」必须同时有 `cause` 和 `fix`）；带 `mistakeId` 则只改那条错题的状态，不新增证据、不动档位 |
| `study_mistakes` | 读错题本：错在哪一步、错因、订正、该哪天复做、现在到哪一档。可按 `status` / `pointId` 筛 |
| `study_plan` | 排每日任务：`add` / `toggle` / `update` / `remove` |
| `study_material` | 加/删材料 |
| `study_tool_level` | 记基本工具的水平 |
| `study_archive` | 读某一级的掌握档案（`level=group/module/point` + `key`），含进度、逐点状态、证据流水 |
| `study_ability` | 学生的总体能力：读大盘（`action=get`）或写一句判词（`action=set`） |
| `study_library` | 管学习目标本身：`list` / `create` / `select` / `rename` / `remove` |
| `study_files` | 看材料目录：`list` 列目录 / `stat` 看存在 / `url` 换成 `/study/file` 链接 |
| `study_pages` | 把扫描版 PDF 的某几页渲成编号 PNG（`材料/路径 + from/to`），拿去看图认页码——「这一页讲的是哪个知识点」只能这么看出来 |
| `study_book` | 整本书拆成页级索引：`action=info` 数页数、读书签 / `action=build` 后台把每一页渲成 `p0007.png` / `action=pages` 查某个单元在哪些教辅的哪几页 |
| `study_focus` | 番茄钟：`action=start` 起一轮（`minutes` / `kind=work\|break` / `taskId` / `label`）/ `action=stop` 停掉 / `action=status` 看还剩多久。**存的是绝对时刻不是倒计时**，所以起完就别管了，别轮询等它 |
| `study_todo` | 清单：`action=add` / `toggle` / `patch` / `remove` / `list`（可按 `status=open\|today\|done` 筛）。这是学生自己想办的事，跟 `study_plan` 排的学习任务是两码事 |
| `study_guide` | 在面板顶上放一句指引，把学生叫回对话 |
| `study_inbox` | 读学生在面板上的留言，读完标掉 |

这 19 个工具是写给别人家 agent 用的，不是写给人看的：每个描述都交代「什么时候调、参数从哪儿拿、返回怎么读、跟别的工具什么顺序」，参数不对会直接抛中文错误。输出 schema 用 `additionalProperties: false` 把数组条目的字段钉死了（`modules[].points[].id`、`tasks[].id`、`materials[].id`、`items[].id`），因为 `study_record` / `study_plan` / `study_material` / `study_analysis` 的必填输入就得从这些数组里取。

「先把整本教辅读一遍、分析它教什么」这件事不是靠谁记得，是写死在随包 SKILL.md 第 2 节里的：材料登记完就得通读，结论写进 `study_analysis`，画地图和排任务都从这份结论里取。册子厚就分批喂 `chapters`，或者拉几个子 agent 并行读——同一个 `no` 会覆盖，读到哪写到哪。

写 schema 时踩过的两条宿主规矩，改代码前先看一眼：

- 每个 `object` 节点都得显式写 `additionalProperties`（`true` 或 `false`），不写会被 schema 编译器拒；写了 `false` 就必须把字段列全，多一个字段返回值就违规。所以返回给模型的对象都走 `pickTask` / `pickModule` 这类投影函数裁字段。
- `required` 要么不写、要么写 `true`。写 `false` 会抛 `parameters.X.required must be true when present`。这意味着一部分必填只能靠描述和 `execute` 里的中文报错拦（比如 `study_map` 只在 `action=set` 时必填 `modules`，无法用 schema 表达）。

「一次只推进一档」这条也是工具自己实现的：`study_record` 里填跳了会被压回上一档，返回的 `summary` 里写「跳档」。

配套还有一份随包技能文档 `skills/study-coach/SKILL.md`（工作法：怎么问目标、怎么把材料变成地图、六档怎么判、任务怎么排、哪些事不许做）。预设里 `skill-filesystem` 那一行用 `customSkillDirs` 指向包内 `skills/`，由 agent 按需加载。

## HTTP 接口

读：`/study/api/state`、`/study/api/summary`、`/study/api/point/:id`、`/study/api/practice`、
`/study/api/archive`、`/study/api/ability`、`/study/api/library`、`/study/api/tasks`、
`/study/api/mistakes`、`/study/api/review`、`/study/api/materials`、`/study/api/material`、
`/study/api/point/pages`、`/study/api/toolbox`。

写：`/study/api/goal`、`/study/api/materials`、`/study/api/materials/remove`、`/study/api/tools`、
`/study/api/inbox`、`/study/api/map/module`、`/study/api/map/replace`、`/study/api/map/confirm`、
`/study/api/mastery`、`/study/api/ability`、`/study/api/library`、`/study/api/task`、
`/study/api/task/update`、`/study/api/task/remove`、`/study/api/task/toggle`、
`/study/api/practice/ask`、`/study/api/reset`、`/study/api/materials/import`、
`/study/api/materials/build`、`/study/api/material/upload`、`/study/api/focus`、`/study/api/todo`。

还有两条不走 router 的：`/study/page?path=…` 把拆出来的页图发出去（只放行数据根 `pages/` 底下的文件），
`/study/api/material/upload` 是流式收上传（超过 300 MB 直接拒，让用户改走「粘贴本机路径」）。

实现见 `lib/routes.js`，它不碰 cordis，所以能脱开 DSH 单测。`/study/api/inbox` 与
`/study/api/practice/ask` 是**异步**的（要把话投进会话），`lib/handler.js` 那边是
`await router(...)`，别改成同步调用。

静态资源只从 `assets/` 出，路径穿越会被挡回 404。

## 开发

```bash
git clone <仓库地址>
cd dsh-study-coach
npm install          # 只为拿到 @deepseek-ai/* 的宿主包，用来跑测试
node --test
```

`test/plugin.test.js` 会假装自己是 DSH：造一个 ctx，把 `apply()` 真跑一遍，
再把 `/study` 的 handler 挂到真 HTTP 服务器上打请求。改完东西先跑它。

两道额外的护栏：

- `test/schema.test.js` 请宿主的 `defineTool` + `validateJsonSchemaValue` 把 9 个工具真跑一遍（写进临时档案），schema 跟返回值对不上就会当场失败。这台机器解析不到宿主包时这条会跳过 —— 跑完看一眼 `skipped` 是不是 0。
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

这是按「方向纠正」改的一版，规矩变了：

- **学习目标、材料、知识地图，只有对话那边能写**（`study_goal` / `study_material` / `study_map`）。面板上原来那几个表单已经拆掉 —— 学生自己在面板里填目标是错的，目标得是问出来的。
- 面板上还能做的三件事：点知识点自评六档、勾掉今天做完的任务、确认地图草稿（「看过了，就这样」）。
- 面板顶上那句指引由 `study_guide` 写，没写就是一句兜底提示（"想改目标、加材料、回对话里说"）。
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
- 画布能拖（按住空白处拖）、能滚轮缩放（0.4x 到 2.4x）。右上角两个按钮：复位视图、全部收起。
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
- 做题页是独立页面 `assets/practice.html` + `practice.js` + `practice.css`，六档和配色抽到了 `assets/stages.js`（只给这页用；面板 `panel.js` 仍留着内联那份，少一个加载失败就白屏的可能）。`lib/handler.js` 里给 `/study/practice` 单开了分支。
- **掌握度百分比**：`lib/store.js` 加了 `STAGE_SCORE`（没接触过 0 / 见过 0.2 / 能跟做 0.4 / 能独立做 0.6 / 熟练稳定 0.8 / 能讲明白 1）、`progressOf()`（一组知识点算平均）、`progressByGroup()`（按大类、按模块各算一份）。`Store.snapshot()` 现在多返回 `progress: { overall, groups, modules }`，面板直接用，不用再算。
- 面板下面那份列表改成了**两层折叠**：默认只有大类（后面跟百分比条），点开才见模块（也带百分比），再点开才是最小单元和自评按钮。从图谱上点一个圆点，它所在的大类和模块会自动撑开、滚到那一条。
- **三级图标重叠**是个真 bug，已修：`assets/graph.js` 递归往下传 y 的时候是 `baseY + node.top`，漏掉了父节点自身那半截高度（`node.y - node.subH / 2`），所以两个模块的第二层起点都算成 0。改成 `baseY + node.y - node.subH / 2 + node.top` 之后，单元圆点间距恢复正常。顺手给单元加了 `kg-unit-bg` 底色，看着像一张卡片。
- `POST /study/api/map/module` 原来只认 `body.id`，不收 `group`，大类会丢。现在两种形状都吃（裸模块或 `{ module: {...} }`），并且 `group` 存得住。

## 补：每级档案、总体能力、任务跳转、目标库、全部 agent 化

这一版按「六点新要求」改的，都落在同一套数据上：

- **每级一份掌握档案**：`lib/store.js` 的 `archiveFor(map, mastery, level, key)` 给大类 / 模块 / 单元三级各生成一份账（`progress` / `total` / `touched` / `avgConfidence` / `byStage` / `due` / 逐点状态与证据流水 / 该级证据汇总）。面板上大类的头、模块的头、单元那行后面各挂一个「档案」小按钮，弹层里就是它。工具侧是 `study_archive`，HTTP 侧是 `GET /study/api/archive?level=&key=`。三级算的是同一套东西，所以「函数 60%」跟它底下模块的百分比永远对得上。
- **总体能力**：`abilityReport(state)` 横着把所有大类、所有点、所有基本工具、最近七天的完成节奏摊成一份大盘，外加一句判词（`judgement {text, level, updatedAt}`，由 `study_ability action=set` 写）。面板顶部那张「总体能力」卡就是它：大盘百分比 + 六段构成条 + 各大类 / 卡住的地方 / 该复习了 / 最近七天四块。工具侧 `study_ability`，HTTP 侧 `GET|POST /study/api/ability`。
- **任务能跳过去，也能改能删**：任务多了 `note`；`taskView()` 把一条任务摊成带按钮的形状——命中 `target` 那个单元就自动补上「看这节网课」（`point.video`）、「这一节的讲义」（`point.practice`）、「做题 / 看掌握度」（`/study/practice?point=`）；`kind=watch` 的任务改成**看课优先**：「看这节网课」排第一，最后一个按钮是「看完去做练习」（同一页，只是把练习接在看课后面）。面板上任务行里可以**改**（标题 / 类型 / 分钟）和**删**。工具侧 `study_plan` 从 `add|toggle` 扩成 `add|toggle|update|remove`；HTTP 侧多了 `POST /study/api/task/update` 和 `POST /study/api/task/remove`。
- **学习目标库**：`lib/library.js` 的 `Library` 类把「档案根 → 每个目标一个子目录」管起来（`list / create / select / rename / remove`，删掉是移到回收站，最后一个删不掉）。换目标、加一门课、清掉不学的，面板最后一张卡上就能做；工具侧是 `study_library`，HTTP 侧是 `GET|POST /study/api/library`。老的单档案根仍然能用（`library.supported` 是 false，那几个 action 会老实说「装不下第二个」）。
- **文件工具**：`study_files`（`list` 列目录 / `stat` 看存在 / `url` 换成 `/study/file` 链接），只能看登记过的材料范围内的路径，好让 agent 在写 `video` / `practice` / `open` 之前先确认文件真在。
- **全部 agent 化**：随包 `skills/study-coach/SKILL.md` 新增第 9 节「面板、档案、目标库、文件」，讲清面板上有什么、每一级档案什么时候翻、总体能力判词什么时候写、目标库怎么切、文件工具怎么用；并把「不许把面板/档案/目标库当摆设」「不给打不开的路径」写进禁令。`study_report` 的返回里 `panelUrl` 现在是必读项。
- **通用性**：`lib/`、`assets/`、`skills/` 里没有作者测试用的学科内容了（举例一律中性化）。测试 fixture 里的线性代数 / 行列式是故意留的中性数据。
- 测试从 89 个加到 **92 个**：新增 `test/panel.test.js`，用最小 DOM stub 把 `assets/panel.js` 真的跑一遍（渲染 + document 事件委托 + 表单提交），断言总体能力卡、三级档案按钮、任务跳转链接、改删任务、目标库、以及草稿地图的定稿按钮都在。`test/schema.test.js` 也扩到覆盖 `study_archive` / `study_ability` / `study_files` / `study_plan update+remove` / `study_library` 全序列。

## 补：改完代码怎么生效（这条最坑，先看这里）

面板的 js / css 是**每次请求现读磁盘**的，服务端路由是 **DSH 启动时加载**的。所以「改了 `lib/` 没重启 DSH」会变成最难查的一种状态：页面看着是新的，按钮点下去全 404 —— 响应体是 `{"ok":false,"error":{"code":"not-found","message":"unknown study route"}}`。热重载、禁用再启用插件、改 `cordis.patch.yml` 都换不掉已经加载的模块，**只能重启 DSH**。

两个自查 / 自救的小工具：

- `node scripts/check-live.mjs`：探一遍正在跑的实例（默认 19387、19388），逐条打印「新 / 旧」。有缺的说明进程里跑的还是旧代码，退出码 1。
- `node scripts/preview.mjs`：不用 DSH，直接把面板起在 19390（`DSH_STUDY_PREVIEW_PORT` 可换）。改前端时省一次重启；DSH 那头还是旧代码、又不想现在重启时，也能拿它临时用。数据目录跟 DSH 那份是同一处，别两边同时写。

面板自己也会防这一手：开机时先探一遍那五条新路由，缺了就顶上挂一条横幅，写清楚缺哪几样、为什么会这样、怎么办（`probeCapabilities()` / `staleCard()`）；真的点到那些按钮，也是 toast 说一句，而不是默默开出一个 404 页。

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

- `store.js` 的 `upsertAnalysis` 把 `marks` 存下来（`marksOf` 裁字段：label 和 page 缺一个就丢，page 只留数字）；`study_analysis` 的章节 schema 和 `pickChapter` 都带上了它。
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
| `/study/map` | 知识地图 | 三层下钻、单元自评、确认草稿 |
| `/study/ability` | 能力 | 大盘数字、各大类、薄弱环节、待复习、最近七天、错题本 |
| `/study/library` | 档案 | 换目标 / 改名 / 删除（进回收站可恢复）、材料、学习目标、基本工具 |
| `/study/materials` | 资料 | 资料书架：一本拆到哪、归到哪个单元，按页直达；右栏登记新资料 |
| `/study/toolbox` | 工具 | 二级菜单装小工具：番茄钟、清单（以后往这儿加） |
| `/study/coach` | 对话 | 整页就是一个聊天窗口：听教练说、直接回话；顶上能选 DSH 里哪个会话 |

- 服务端认页靠 `lib/handler.js` 的 `PANEL_PAGES`：`/study` 和 `/study/<这些段>` 都送同一份 `panel.html`，页面自己按 `location.pathname` 认（`resolvePage()`）。认不出的段回 404，别的一概不变。
- 导航走 **`pushState` 前端切页**，不往服务端整页跳——因为服务端路由是 DSH 启动时加载的，改完 `lib/` 没重启时子页面会回 JSON 404，整页跳过去人看到的是一屏报错。前端切页让旧服务端也能用，地址栏仍是真地址。
- 默认配色改成**浅色**（暖骨白 + 鼠尾草绿），`html[data-theme="dark"]` 是暖暗版；`?theme=` / 顶栏那个按钮切换。

对话那条线（`lib/chat.js`）：

- `sessionController` 是 DSH 的**可选**服务，和 `lib/bridge.js` 一样**不写进 `inject`**，拿不到就 `available:false`，对话页直说「没接通 / 原因 / 重新连接」，绝不白屏。
- `createChat({resolve, timeoutMs})` 给三个方法：`available`、`sessions()`（会话清单：滤掉子会话，按 `updatedAt` 倒序）、`history({sessionId, maxMessages})`（只用 `sessionController.follow()` 拿第一帧 snapshot 就退订，翻成面板要的 `{id, role, text, time, tools, steps}`；`system` / `step` / 会话日志之类一律丢，留最近 `CHAT_MAX_MESSAGES = 60` 条、单条正文截到 `CHAT_MAX_CHARS = 4000` 字）。**不用 `page()`**——它要 `throughSeq`，得先问 `projections()` 拿 `asOfSeq`，形状没侦察到；`follow` 一次就给窗口化 records + cursor。
- HTTP 三条：`GET /study/api/chat/sessions`、`GET /study/api/chat?sessionId=&max=&sessions=1`、`POST /study/api/chat/send {text, sessionId?, mode?}`（`mode` 只收 `queue` / `steer`，复用 `lib/bridge.js` 的投递通道）。
- 面板侧：**整页对话**和**右下角悬浮窗**是同一份状态（`chat` 对象）两处渲染，`paintChat()` 一次把 `#chat-log` 和 `#float-log` 都刷掉。开着对话页或悬浮窗时**每 2.5 秒拉一次快照**，标签页切到后台、或者两者都关掉就把定时器停掉（`syncChatPolling()` + `chatVisible()`）；只有指纹变了才重画，正在输的字和滚到一半的位置都不动。**通道没接通就别开定时器**（会留一个永远停不下来的 interval，`node --test` 会因此跑不完）。
- 悬浮窗：FAB（`[data-act="float-open"]`）在主页以外的每一页都在，点开是简化版——只有消息列表 + 一个输入框，不显示工具胶囊和时间戳，`×` 关掉、`Esc` 也关；`Enter` 发送、`Shift+Enter` 换行。
- 侧栏模式下一屏只放得下一张卡，所以**换页时自动把那一页的主卡摊开**（`openFirstCard()` 只在换页和首次加载时调一次，放进 `render()` 里会让折叠按钮按不动）。

三条路由同样是**服务端代码 → 必须重启 DSH 才生效**。没重启时对话页会直接说「服务端还没重启」，而不是装作坏了。

### 五、对话页做成完整聊天窗口，外加一颗悬浮窗

上一版里对话页是「主栏看对话 + 边栏写留言」两块。这一版把**面板上的留言口整个删掉**，对话页只剩一个占满一屏的聊天窗口，另外在每一页右下角挂一颗悬浮窗，随时能问一句。

- **删的只是面板那半边。** `inbox.json`、`study_inbox` 工具、`POST /study/api/inbox`、`study_report` 里的 `inboxItems`、`study_guide` 全都没动——它们是 agent 侧的通道，不归这次改。面板里 `inboxCard()`、留言表单、`kind === 'inbox'` 那条提交分支一并删掉；`test/panel.test.js` 里那条「面板留言能写进档案」现在是直接打 HTTP 验的。
- **对话页占满一屏。** `PAGE_CARDS.coach` 只剩主栏一张卡，`pageCards()` 给它一个 `chat-page` 类（两个分支都得带，漏一个 `--test` 会当场报出来）。CSS 里 `html[data-mode="browser"] .chat-page .card { height: calc(100vh - 136px) }`，`.chat-log` 改成 `flex:1; min-height:0` 在里面滚，输入框不再被消息推下去。窄屏（≤560px）让高度跟着 `100dvh` 走。
- **悬浮窗和整页共用一份状态。** 同一个 `chat` 对象渲染两处，`paintChat()` 一次把 `#chat-log` 和 `#float-log` 都刷掉，所以点开悬浮窗就是接着刚才那段说。悬浮窗是简化版：只留消息列表 + 输入框，不显示工具胶囊和时间戳；`×` 或 `Esc` 关掉，`Enter` 发送、`Shift+Enter` 换行。FAB 在主页以外的每一页都在。
- **定时器判据跟着改。** `syncChatPolling()` 原来只看 `page === 'coach'`，现在看 `chatVisible()`（在对话页**或**悬浮窗开着）；两者都不满足就 `clearInterval`。这条不只是省电：`node --test` 的假 DOM 里，一个停不下来的 interval 会让整个测试进程跑不完。
- **脱开 DSH 也能看长相。** `DSH_STUDY_PREVIEW_CHAT=1 node scripts/preview.mjs` 会挂一份假对话，不必重启 DSH 就能把对话页和悬浮窗点一遍。真跑起来那段对话仍是 `sessionController` 给的。
- **顶上能挑会话。** 他那台 DSH 上开着好几个会话时，对话页和悬浮窗顶上那颗下拉就能选——`GET /study/api/chat?sessions=1` 给清单，选中项按 `updatedAt` 倒排的当前会话。只有一条会话时**不给下拉**，改成一行静态的「当前会话：X」（摆一颗只有一个选项、点不动的控件还不如直接写出来）。清单只在**对话页**或**悬浮窗开着**的时候才拉（`loadChat({ withSessions: page === 'coach' || ui.float })`），别的时候省一趟接口。
- **两个容易踩的地方。** ①`loadChat` 收清单时要判空：`Array.isArray(out.sessions) && out.sessions.length ? out.sessions : (chat && chat.sessions) || []`——不判的话，一次没带 `sessions=1` 的请求会用空数组把刚拉到的清单冲掉（悬浮窗一关一开就没得选了）。②点开悬浮窗时得补拉一次：`load()` 跑的那会儿 `ui.float` 还是 `false`，清单是空的。

### 六、错题本：不新开一张表，挂在证据上

参考 `good-learning-skill`（MIT）里「错题本」那一节之后补的。它的错题本是**产出物**——排版成 PDF 给人打印；这边的错题本是**档案的一部分**，得能跟掌握度、跟知识点、跟复习日期对上。所以没另建 `mistakes.json`：一条错题就是某条证据的细节，分开存迟早会对不上。

- **存哪儿**：`mastery.json` 里 `points[<id>].evidence[i].mistake`。`normalizeMistake()` 产出 `{id, origin, step, cause, fix, redoAt, status, at, updatedAt}`，`at` 是「什么时候错的」，`updatedAt` 是「最后一次改动」。
- **规矩写在代码里，不写在提示词里**：`status` 只有 `待验证 / 已订正 / 已复做对` 三档，**标后两档必须同时有 `cause` 和 `fix`**，否则直接抛错；`origin` 缺失、`redoAt` 不是 `YYYY-MM-DD`、`status` 写了个不认识的词，一样抛。这条是整套设计里最值得抄的一条手法——业务规矩做成数据自校验，才真的是规矩，不然只是提醒。
- **订正不算证据**：`study_record` 传 `mistakeId` 时只改那条错题（`patchMistake`），**不新增证据、不动档位**。「改对了答案」和「掌握了」是两件事，档位得靠另一条证据推。
- **读的入口**：工具 `study_mistakes`（可按 `status` / `pointId` 筛）和 `GET /study/api/mistakes`，两边读同一个 `mistakesOf(map, mastery, {status, pointId, limit})`。排序键是 `at` 不是 `updatedAt`——改一下状态就把老错题顶到最上面，学生看到的第一条会跳来跳去。
- **面板**：「能力」页多一张错题本卡（按状态筛 + 每条「再练」），`capabilities.mistakes` 探针失效时整张卡不出现；做题页多一个「这题做错了」入口（填题号 + 错在哪），走 `POST /study/api/practice/ask` 的第三个 `mode: 'mistake'`，投出去的 prompt 以 `【面板·错题】` 开头，里面直接写着「用 `study_record` 记下来」。
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
3. 要落盘的话在 `lib/store.js` 的 `FILES` 里加一份文件、`Store.default()` 里给个初值。

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



