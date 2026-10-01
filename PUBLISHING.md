# 发布流程

从「本地一个目录」到「别人能一键装」，四步。做完第 3 步就会出现在 DSH 插件市场里。

---

## 0. 先确认包里装了什么

```bash
cd dsh-study-coach
npm pack --dry-run
```

看输出的文件清单。**应该只有** `index.js` / `lib/**` / `assets/**` / `skills/**` / `cordis.patch.yml` / `README.md` / `PUBLISHING.md` / `AGENTS.md` / `design.md` / `LICENSE` / `package.json`。

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

## 2. 打话题标签 —— 这一步决定进不进市场

DSH 插件市场（`dshmarket`）的目录来自 **`awesome-dsh-plugin`**，它每天用 GitHub Actions 爬 **GitHub topic** 建目录：

| topic | |
| --- | --- |
| `dsh-plugin` | 必打 |
| `deepseek-harness` | 建议打 |

仓库网页 → 右上 `About` 齿轮 → `Topics` 填进去。或者命令行：

```bash
gh api -X PUT repos/<你>/dsh-study-coach/topics \
  -f 'names[]=dsh-plugin' -f 'names[]=deepseek-harness'
```

爬虫是**每天跑一次**的，所以打完标签不会立刻出现，等一天。目录 JSON 在
`https://awesome-dsh-plugin.com/plugins.json`，可以先去那儿 `Ctrl+F` 搜 `study-coach` 确认进去了。

市场还会从 `package.json` 读两样东西来判断兼不兼容，别写错：

- `engines.dsh` —— 作者声明的兼容 DSH 区间（本包写的是 `>=0.2.0-rc.1`）
- `peerDependencies` —— 依赖哪些宿主包

> 服务器声明是**只声明不拦截**的：官方 manifest 文档原话是
> "Compatibility is declarative. Current installers and loaders do not enforce
> `dsh.manifestVersion` or `engines.dsh`"。写错了不会当场报错，只会让市场把包标成不兼容，所以对齐实测版本就行。

---

## 3. 发 npm

```bash
npm login
npm publish
```

`publishConfig` 里已经写死 `access: public` + `registry.npmjs.org`，不用再加参数。

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

市场那边有 `updates.json` 会标出新版本，不用自己推。

---

## 发布前自查

- [ ] `node --test` 全绿，`skipped` 是 0
- [ ] `npm pack --dry-run` 的文件清单干净（没有 `node_modules` / `test` / `scratch`）
- [ ] `package.json` 里 `name` / `version` / `license` / `repository` / `keywords`（含 `dsh-plugin`）都对
- [ ] `dsh.manifestVersion: 1` 和 `dsh.bundle.patch: ./cordis.patch.yml` 还在
- [ ] `engines.node` 和 `engines.dsh` 跟实际测过的环境一致
- [ ] GitHub 仓库打了 `dsh-plugin` 话题
- [ ] `git status` 干净，没把 junction 的 `node_modules` 提交进去

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
