/* ══ 一上电就定下模式与配色 ═════════════════════════════════════════════════
 * 这份是 <head> 里的**普通脚本**，不是 module：它必须在第一次绘制之前跑完，
 * 否则页面会先按一种模式画出来、再跳成另一种，那一闪很难看。
 *
 * 规则只有这一份。面板和做题页都在 <head> 里引它，panel.js 只把结果读出来用，
 * 自己不再算一遍 —— 以前 HTML 里抄一份、panel.js 里又抄一份，阈值 680 写在三处，
 * 改一处忘了另一处就开始漂。
 *
 * 结果挂在 window.StudyBoot 上：{ MODE_KEY, THEME_KEY, NARROW, mode, theme,
 * resolveMode, resolveTheme, save }。
 * ═════════════════════════════════════════════════════════════════════════ */
(function () {
  var MODE_KEY = 'study-coach:mode'
  var THEME_KEY = 'study-coach:theme'
  /** 比这窄就当侧栏。整条规则里唯一的魔数。 */
  var NARROW = 680

  function read(key) {
    try {
      return window.localStorage.getItem(key) || ''
    } catch (e) {
      return ''
    }
  }

  function save(key, value) {
    try {
      window.localStorage.setItem(key, value)
    } catch (e) {
      /* 存不下就这次算数 */
    }
  }

  /** 地址上 ?name= 说了什么。没有 location（测试里）就当没问。 */
  function asked(name) {
    try {
      return new URLSearchParams((window.location && window.location.search) || '').get(name) || ''
    } catch (e) {
      return ''
    }
  }

  /** 是不是嵌在框里。跨域读 top 会抛，那也说明是嵌着的。 */
  function framed() {
    try {
      return window.self !== window.top
    } catch (e) {
      return true
    }
  }

  /** ?mode= 说了算（说了就记住）；没说过就看环境——嵌在框里或者屏很窄，按侧栏来。 */
  function resolveMode() {
    var want = asked('mode')
    if (want === 'sidebar' || want === 'browser') {
      save(MODE_KEY, want)
      return want
    }
    var saved = read(MODE_KEY)
    if (saved === 'sidebar' || saved === 'browser') return saved
    var narrow = Number(window.innerWidth) > 0 && Number(window.innerWidth) < NARROW
    return framed() || narrow ? 'sidebar' : 'browser'
  }

  /** 亮色是默认，暗色是同色系的暖暗版，晚上看不刺眼。 */
  function resolveTheme() {
    var want = asked('theme')
    if (want === 'light' || want === 'dark') {
      save(THEME_KEY, want)
      return want
    }
    return read(THEME_KEY) === 'dark' ? 'dark' : 'light'
  }

  var boot = {
    MODE_KEY: MODE_KEY,
    THEME_KEY: THEME_KEY,
    NARROW: NARROW,
    save: save,
    resolveMode: resolveMode,
    resolveTheme: resolveTheme,
  }
  boot.mode = resolveMode()
  boot.theme = resolveTheme()

  var root = document.documentElement
  if (root && root.dataset) {
    root.dataset.mode = boot.mode
    root.dataset.theme = boot.theme
  }
  window.StudyBoot = boot
})()
