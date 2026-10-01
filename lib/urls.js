/* 宿主那半边的门牌：材料路径 → 面板地址。
 *
 * 规则本体在 `assets/urls.js`（面板与宿主共用同一份，没有第二份可以走偏）。
 * 这里只是把它转出来，好让 `lib/` 里的代码能按 `../urls.js` 引，
 * 不必写一串相对路径爬到 assets 去。 */
export * from '../assets/urls.js'
