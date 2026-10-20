import { useRef, useState } from 'react'

interface Props {
  /** 輸入滿 4 碼時呼叫；回傳錯誤訊息則顯示並清空 */
  onComplete: (pin: string) => string | void | Promise<string | void>
  label?: string
  disabled?: boolean
}

export function PinPad({ onComplete, label = '請輸入 4 位數 PIN', disabled }: Props) {
  const [digits, setDigits] = useState('')
  const [error, setError] = useState('')
  const [shake, setShake] = useState(false)

  // 用 ref 記錄輸入，避免快速連點時讀到舊的 render 值而掉碼
  const digitsRef = useRef('')
  const submitting = useRef(false)

  const press = async (d: string) => {
    if (disabled || submitting.current) return
    const next = (digitsRef.current + d).slice(0, 4)
    digitsRef.current = next
    setDigits(next)
    setError('')
    if (next.length === 4) {
      submitting.current = true
      let err: string | void
      try {
        err = await onComplete(next)
      } finally {
        digitsRef.current = ''
        submitting.current = false
      }
      setDigits('')
      if (err) {
        setError(err)
        setShake(true)
        window.setTimeout(() => setShake(false), 450)
      }
    }
  }

  const backspace = () => {
    if (submitting.current) return
    digitsRef.current = digitsRef.current.slice(0, -1)
    setDigits(digitsRef.current)
    setError('')
  }

  return (
    <div className={`pinpad ${shake ? 'shake' : ''}`}>
      <p className="pin-label">{label}</p>
      <div className="pin-dots" aria-label={`已輸入 ${digits.length} 碼`}>
        {[0, 1, 2, 3].map((i) => (
          <span key={i} className={i < digits.length ? 'on' : ''} />
        ))}
      </div>
      <p className="pin-error" role="alert">{error}</p>
      <div className="pin-keys">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
          <button key={d} type="button" className="key" disabled={disabled} onClick={() => press(d)}>
            {d}
          </button>
        ))}
        <span />
        <button type="button" className="key" disabled={disabled} onClick={() => press('0')}>0</button>
        <button type="button" className="key ghost" disabled={disabled} onClick={backspace} aria-label="刪除">
          ⌫
        </button>
      </div>
    </div>
  )
}
