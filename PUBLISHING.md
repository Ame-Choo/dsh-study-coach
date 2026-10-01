# 发布流程

从「本地一个目录」到「别人能一键装」，四步。**进不进市场由第 2 步决定**（条目 PR 合并才进列表，光打话题标签不算）；第 3 步发 npm 是让市场能显示下载量、装的时候走预构建包。

---

## 0. 先确认包里装了什么

```bash
cd dsh-study-coach
npm pack --dry-run
```

看输出的文件清单。**应该只有** `index.js` / `lib/**` / `assets/**` / `skills/**` / `cordis.patch.yml` / `README.md` / `CHANGELOG.md` / `docs/**` / `PUBLISHING.md` / `AGENTS.md` / `design.md` / `DEV.md` / `NOTES.md` / `LICENSE` / `package.json`。

`README.md` 里链到 `design.md`，所以 `design.md` 必须在包里，不然装完那个链接是死的；`AGENTS.md` 同理（它写的是「改界面前先读 design.md」这条规矩）。

不该出现：`node_modules/`（本机是指向 `~/.dsh/profiles/node_modules/@deepseek-ai` 的 junction，**千万别提交**）、`test/`、`scratch/`、`scripts/`。

`package.json` 的 `files` 字段是唯一依据；加删文件之后回头核一遍。

---

## 1. 建成 git 仓库

```bash
git init
git add .
git commit -m "dsh-study-coach 0.1.0"
```

`.gitignore` 已经排除 `node_modules/`、`*.tgz`、`scratch/`。

先在 GitHub 上建一个空仓库（建议名字就叫 `dsh-study-coach`），然后：

```bash
git remote add origin https://github.com/<你>/dsh-study-coach.git
npm run setup-repo          # 把 package.json 里的 OWNER 占位换成真实地址
git add package.json && git commit -m "填仓库地址"
git push -u origin main
```

`npm run setup-repo` 读的是 `git remote get-url origin`，https 和 `git@` 都认，一次性把 `repository` / `homepage` / `bugs` 三处填掉。

---

## 2. 打话题标签 + 提 PR 进列表 —— 这一步决定进不进市场

DSH 插件市场（`dshmarket`）的目录来自 **`awesome-dsh-plugin`**。**光打 GitHub topic 进不去**：那份列表的数据在
它仓库的 `data/plugins/<owner>__<repo>.yml` 里，一个插件一个文件，**只有 PR 合并了才会出现在列表里**
（两个 README 由脚本生成，别手工编辑，改了也会被打回）。topic 是**另一个硬要求**，不打照样被打回。两条都要办。

评审规则全文：[contributing.md](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/blob/main/contributing.md)。

### 2a. 打 topic

仓库网页 → 右上 `About` 齿轮 → `Topics` 填 `dsh-plugin`（必打）+ `deepseek-harness`（建议打）。或者命令行：

```bash
gh api -X PUT repos/<你>/dsh-study-coach/topics \
  -f 'names[]=dsh-plugin' -f 'names[]=deepseek-harness'
```

不带 `gh` 也行（本机就没装）：`git credential fill` 能取到本机 git 缓存的 GitHub token，拿它当
`Authorization: Bearer` 打 `PUT https://api.github.com/repos/<你>/dsh-study-coach/topics`，body 是
`{"names":["dsh-plugin","deepseek-harness"]}`。本仓库的 topic 就是这么打上的。

### 2b. 提 PR

fork `awesome-dsh-plugin`，新建**一个**文件 `data/plugins/Ame-Choo__dsh-study-coach.yml`（文件名是
`<owner>__<repo>`，不是 `<repo>`）：

```yaml
url: https://github.com/Ame-Choo/dsh-study-coach
name: Ame-Choo/dsh-study-coach
category: tools
description:
  en: 'Study coach for DeepSeek Harness: turns a course into a knowledge map of subject, module and unit, records mastery per unit in six stages, plans daily tasks against a materials index, keeps a wrong-answer book and spaced-repetition cards, and serves its own web panel.'
  zh: 'DSH 的学习教练：把一门课拆成知识地图（大类 / 模块 / 最小单元），逐单元记六档掌握度，按资料索引排每日任务，带错题本与记忆卡，并自带一个网页面板。'
```

`description.en` 是唯一必填，末尾要有句号；`zh` 写不了可以留空，维护者会补。**描述里带 `: `（冒号加空格）
必须加引号**，不加 YAML 会把它当成嵌套键。描述会被拿去跟源码逐句核对——**别写对不上的数字（「N 个工具」之类），
别写营销词**，夸大是主要打回原因。分类挑最接近的即可（本包是「给 agent 加一套学习管理工具 + 自带面板」，
所以 `tools`；挑歪了维护者直接改，不会打回）。

其余规矩：一个 PR 最多 3 条；**仓库满 1 天才收**（`scripts/check-submission.mjs` 里 `MIN_AGE_DAYS = 1`，按仓库
`created_at` 算满 24 小时；跟插件质量无关，只挡「PR 前几分钟才建号」的）。**早提没关系**：年龄那关没过时，
门禁自己在评论里写「nothing to do」，`regate.yml` 每 6 小时重跑一次，到点自己变绿，不用重开 PR、也不用空推一次。
（以前还有一条「提交数下限」，现在取消了——只卡年龄。）另外要有真实可用代码、在维护中。

CI 是两个 workflow：`PR check`（站点构建 + `awesome-lint` + 条目数 ≤3）先跑完，再由它触发的 `Submission gate`
接着查——门禁要带 token 查 GitHub API，所以拆成 `workflow_run` 单独一个：从你仓库的 `package.json` 读
`dsh.bundle`（**只声明 `dsh.client` 会在这里失败**，本包有 `dsh.bundle.patch`，过）→ 仓库年龄。挂了把修复
推到同一个分支即可，不用重开 PR。合并后等下一次构建，去 `https://awesome-dsh-plugin.com/plugins.json`
里 `Ctrl+F` 搜 `study-coach` 确认。

### 2c. 截图（可选，推荐）

市场详情页会像 App Store 那样展示截图，声明放在**你自己的仓库**里——`package.json` 旁边一个
`screenshots.json`（本仓库已经有了，就是 `docs/` 那四张）：

```jsonc
// screenshots.json（按展示顺序）
["docs/map.png", "docs/today.png", "docs/atlas.png", "docs/library.png"]
```

1-8 张，路径相对该文件、**不能跳出插件目录**（不能以 `/` 开头、不能含 `..`）；绝对 URL 也只收 GitHub 托管的
https。之后换截图推自己的仓库即可，不用再来提 PR。不声明也不影响收录，市场会退回从 README 抽图。

市场还会从 `package.json` 读两样东西来判断兼不兼容，别写错：

- `engines.dsh` —— 作者声明的兼容 DSH 区间（本包写的是 `>=0.2.0-rc.1`）
- `peerDependencies` —— 依赖哪些宿主包

> 服务器声明是**只声明不拦截**的：官方 manifest 文档原话是
> "Compatibility is declarative. Current installers and loaders do not enforce
> `dsh.manifestVersion` or `engines.dsh`"。写错了不会当场报错，只会让市场把包标成不兼容，所以对齐实测版本就行。

---

## 3. 发 npm

```bash
npm login          # 或者跳过，直接用带 Bypass 2FA 的 granular token（见下）
npm publish
```

`publishConfig` 里已经写死 `access: public` + `registry.npmjs.org`，不用再加参数。

### 2FA：`npm publish` 的第一道关（2026-10-02 实测）

账号开了 2FA 的话（本机这个号就是），`npm login` 写进 `.npmrc` 的那个会话 token **发不了包**：

```
E403 Two-factor authentication or granular access token with bypass 2fa enabled is required to publish packages.
```

两条路，选一条：

- **`npm publish --otp=123456`** —— 认证器 App（Google Authenticator / Microsoft Authenticator 之类）里那 6 位，30 秒一换。
- **建一个 granular token**（一劳永逸，之后 `npm publish` 不用再输码）：npmjs.com → 右上头像 → Access Tokens → Generate New Token → Granular Access Token，字段这么填：

  | 字段 | 填什么 |
  | --- | --- |
  | Token name | 随便，比如 `publish-dsh-study-coach` |
  | Expiration | 7 days（够发一次，过期再建一个） |
  | Packages and scopes | **All packages** + **Read and write** |
  | Organizations | 不动（No access） |
  | **Bypass 2FA** | **打开**（不开就还是上面那个 E403） |

  拿到的 `npm_...` 写进 `C:\Users\<你>\.npmrc` 一行：

  ```
  //registry.npmjs.org/:_authToken=npm_xxxxxxxx
  ```

  写完 `npm whoami` 能回你的用户名就说明对了。

**权限别选错那一档。** 下拉里是 `Read only` / `Read and write` / **`Read and write (stage only)`** 三档，选了第三档只会拿到：

```
E403 Cannot publish "dsh-study-coach": this token can only publish to a staging area,
and "dsh-study-coach" does not exist yet. Create it first with a direct-capable token,
then use `npm stage publish`.
```

暂存发布是给 CI 用的，要维护者 2FA 批准，而且**还不存在的包名走不了暂存**——第一个版本必须用能直接发布的 token 建出来。另外 npm 已宣布 **2027-01 起 bypass-2FA token 不再允许直接发布**，到时要换成 trusted publishing（GitHub Actions OIDC）或 stage-only + 网页批准。

发之前本地先真装一遍验证：

```bash
npm pack                                  # 产出 dsh-study-coach-0.1.0.tgz
cd ~/.dsh/profiles/desktop
pnpm add /path/to/dsh-study-coach-0.1.0.tgz
```

重启 DSH，打开 `http://127.0.0.1:19387/study`，能出面板就算通。

### 版本号

还没稳定，`0.x` 待着。改一次发一次：

```bash
npm version patch   # 0.1.0 → 0.1.1，修 bug
npm version minor   # 0.1.0 → 0.2.0，加功能
git push --follow-tags
```

---

## 4. 以后每次发版

```bash
node --test              # 全绿再发（数字看命令最后打印的 tests / pass / fail，别抄文档里的）
npm version patch
git push --follow-tags
npm publish
```

`.npmrc` 里留着那个带 Bypass 2FA 的 token 的话，`npm publish` 不会再问你要验证码；token 过期了就照 §3 再建一个。

市场那边有 `updates.json` 会标出新版本，不用自己推。

---

## 首次上线 GitHub：当时的体检记录（2026-10-02，四件都办完了）

以下都是 2026-10-02 在 Windows + node v24.21.0 上实测出来的，别照抄结论、照抄**怎么查**。

**仓库里已经有的**：`.github/workflows/ci.yml`（push main / PR / 手动；`ubuntu-latest`；node `22` 与 `24`；
`npm install --no-audit --no-fund` → 先探一下 `@deepseek-ai/*` 装没装上（装不上就跳过测试并给一条 warning，
不把「环境缺包」红成「用例失败」）→ `node scripts/ci-test.mjs` 跑测试，**失败用例写成 GitHub 注解**）、
`.gitattributes`（`* text=auto eol=lf` + 二进制白名单）、`.gitignore`、MIT `LICENSE`、这份 `PUBLISHING.md`、
`npm run setup-repo`、keywords 里的 `dsh-plugin`。

**已经查过的**：

| 查了什么 | 怎么查的 | 结果 |
| --- | --- | --- |
| 仓库自不自洽 | `git bundle create x.bundle --all` → 在别处 `git clone x.bundle` | 132 个 tracked、HEAD 对得上；`npm install` 后 **340 pass / 0 fail**（不装依赖直接跑就缺宿主的 `@deepseek-ai/dsh-tools`，那是环境，不是代码） |
| Linux 上跑不跑得起来 | 推到 GitHub 看 Actions | `ubuntu-latest` × node `22`/`24` 都是绿的：336 → 340 条用例，**跳过 2 条**（那两条要 pymupdf，runner 上没装）。红过一阵，原因全是测试自己写死了 Windows 的写法，另有一条真 bug（材料 id 撞号） |
| npm 上名字占没占 | `npm view dsh-study-coach version` | 404，没被占 |
| 包里装了什么 | `npm pack --dry-run` | 86 个文件 / 1.2 MB，只有源码 + 文档 + 截图 + 字体 |
| peer 区间对不对 | `npm view @deepseek-ai/dsh-tools versions` 等 | 线上有 `dsh-tools 0.2.0-rc.1/rc.2` 与 `cordis 4.0.4`，本机装的是 `0.2.0-rc.2` / `4.0.4`，两个区间都满足 |

**已经办掉的（2026-10-02）**：

1. ~~git 身份是占位的~~ → `Ame-Choo <ray060619@gmail.com>`，**全部 73 个 commit 一起重写过**
   （`git filter-branch --env-filter` + 清 `refs/original` + `gc --prune=now`，日期没动）。
2. ~~`OWNER` 占位~~ → `npm run setup-repo` 跑过，`repository` / `homepage` / `bugs` 都指着
   `https://github.com/Ame-Choo/dsh-study-coach`；remote 已配（推的时候经系统代理 `127.0.0.1:12450`，
   `git config` 里没写 proxy）。
3. ~~公开还是私有~~ → 仓库已经是**公开**的（要进 `dshmarket` 必须公开，爬虫只看得见公开仓库）。
4. ~~首屏~~ → README 顶上 CI / node / DSH / license 四颗徽章，下面一张知识地图大图 + 今日任务 / 资料图谱 / 档案
   三张并排，图在 `docs/`（也进了 `files` 白名单，npm 上的 README 才显示得出来）；另有一份 `CHANGELOG.md`。
   底图是拿演示数据在 `node scripts/preview.mjs` 上拍的，仓库里没有那些数据。
5. ~~本机路径~~ → `DEV.md` / `README.md` / `AGENTS.md` 里那几处 `F:\dshworkingspace(studyplugin…` 与
   `C:\Users\zongy\…` 已改成通用写法（`D:\code\…` / `C:\Users\<你>\…`）；测试夹具里那两个假的也换了
   （`test/panel.test.js` 测「cwd 里带括号」、`test/md.test.js` 测 Windows 路径不被 markdown 吃掉）。

**最后这几件也都办完了（2026-10-02）**：

1. ~~topic~~ → 已打：`dsh-plugin`（必打）+ `deepseek-harness` + `dsh`。要自己改就在仓库页 About 齿轮里改，
   或 `PUT /repos/{owner}/{repo}/topics`（带 token）。
2. ~~仓库描述~~ → 已写好（About 里那句：「DSH 的学习教练插件：把一门课拆成知识地图……」）。
3. ~~发 npm~~ → **已发布 `dsh-study-coach@0.1.0`**，注册表时间 `2026-10-01T18:57:54Z`，
   shasum `974387e3ab15850b85ec272d9784137d97351b0d`（与本地那个 `dsh-study-coach-0.1.0.tgz` 逐字节相同，
   即线上跑的就是本地测过 340 条用例的那份包）。`npm view dsh-study-coach version` 回 `0.1.0`，
   `repository.url` 指回本仓库，市场那边下载量排序会自动接上；条目里不用加任何字段
   （手写 `npm:` 键会被校验拒掉）。发的时候被 2FA 挡了两回，全过程与 token 该怎么建都记在 §3。
4. ~~提条目 PR~~ → **已提：[awesome-dsh-plugin#6341](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/pull/6341)**
   （分支 `Ame-Choo:add-study-coach`，就一个文件 `data/plugins/Ame-Choo__dsh-study-coach.yml`）。
   仓库是 2026-10-01T17:52Z 建的，**年龄那一关要到 2026-10-03 01:52（+08:00）才够**——早提是故意的，
   `regate` 会自己重跑，不用管；要改条目就往那个分支上推，PR 自动跟着更新。

---

## 发布前自查

（下面这些勾是 **0.1.0 这一版**的状态，2026-10-02；以后每次发版照着重过一遍。）

- [x] git 身份不是占位（`git log -1 --format='%an <%ae>'` → `Ame-Choo <ray060619@gmail.com>`）
- [x] `node --test` 全绿，`skipped` 是 0（本机 340 / pass 340 / fail 0 / skipped 0）
- [x] `npm pack --dry-run` 的文件清单干净（88 个文件 / 1.2 MB，没有 `node_modules` / `test` / `scratch`）
- [x] README 顶上那几颗徽章的仓库名对得上（CI 徽章指向 `Ame-Choo/dsh-study-coach`，另加了 npm 版本徽章），`docs/` 那几张图在包里
- [x] `CHANGELOG.md` 里有 `## [0.1.0] - 2026-10-02`
- [x] `package.json` 里 `name` / `version` / `license` / `keywords`（含 `dsh-plugin`）都对，`repository` / `homepage` / `bugs` 指着本仓库（`npm run setup-repo` 跑过一次）
- [x] `dsh.manifestVersion: 1` 和 `dsh.bundle.patch: ./cordis.patch.yml` 还在
- [x] `engines.node` 和 `engines.dsh` 跟实际测过的环境一致
- [x] GitHub 仓库打了 `dsh-plugin` 话题（+ `deepseek-harness`、`dsh`）
- [x] 仓库根有 `screenshots.json`，里面每张图在 `docs/` 里真实存在、路径没跳出插件目录
- [x] awesome 列表的条目 PR 提了（[#6341](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/pull/6341)；
      年龄那一关 ETA 2026-10-03 01:52+08:00，会自己转绿）
- [x] npm 发布了（`npm view dsh-study-coach version` → `0.1.0`，2026-10-01T18:57:54Z）
- [x] 推到 GitHub 之后 Actions 那条 CI 是绿的（`9b2b795` success；它是「别人克隆下来能不能跑」的唯一证据）
- [x] `git status` 干净，没把 junction 的 `node_modules` 提交进去

---

## 附：manifest 各字段什么意思

来自官方 `@deepseek-ai/dsh-package-manifest`：

| 字段 | 含义 |
| --- | --- |
| `name` + `version` | 唯一必填的两项 |
| `dsh.manifestVersion` | manifest 格式标识，当前声明值为 `1`；与 npm 包版本、Session 格式版本都无关 |
| `dsh.bundle.patch` | 一个 patch 路径，或有序数组；相对包根，启动器按顺序叠成一个 bundle 层 |
| `engines.node` / `engines.npm` | Node / npm 版本区间 |
| `engines.dsh` | 作者声明的兼容 DSH SemVer 区间，可以带预发布版本号 |

本包的 `cordis.patch.yml` 就干一件事：往 bundle 里插一条 `id: study-coach` / `name: dsh-study-coach`。
