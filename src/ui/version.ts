declare const __APP_VERSION__: string

/** 目前版本：build 時注入（短 commit + 日期，見 vite.config.ts）；單元測試沒有注入時是 dev */
export const APP_VERSION: string = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'dev'
