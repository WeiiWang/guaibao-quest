/** 開發與 e2e 用：網址 #crash 進來會在 render 時丟錯，驗證錯誤邊界（見 App.tsx 的 screenFromHash）。 */
export function CrashProbe(): never {
  throw new Error('crash-probe：測試用的錯誤')
}
