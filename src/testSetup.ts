import { loadBank } from './learning/bank'

// 單元測試的模組最上層就會用到 QUESTIONS（正式程式由 ProfileGate 等題庫載入），這裡先載好
await loadBank()
