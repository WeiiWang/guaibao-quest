import { useCallback } from 'react'
import { playSfx } from '../learning/sfx'
import { speak } from '../learning/speech'
import { peekArt } from './artProbe'
import { useLearningSettings } from './learningHooks'
import './ux.css'

/**
 * 統一的「小成功」回饋（SPEC-v4 線 U 第 7 項）：短音效 + 一句語音 + 星星/愛心粒子。
 * 取代只靠 toast 小字的成功提示，不識字的小孩也看得懂、聽得懂。
 * - 音效遵守家長的「音效」開關（soundOn）、語音遵守「語音」開關（voiceOn）
 * - prefers-reduced-motion：粒子不位移，只原地淡入淡出
 * - 全部用 DOM + Web Animations API，不經過 React 狀態（動畫期間不會被重新渲染打斷）
 */
export type FeedbackKind = 'buy' | 'craft' | 'task' | 'poop' | 'place' | 'undo'

interface Spec {
  /** 短音效；null = 這個情境已經有自己的音效（例如清便便的「啵」） */
  sfx: 'correct' | 'reward' | 'tap' | null
  /** 一句短語音（也是畫面上的字幕） */
  phrase: string
  particle: 'star' | 'heart'
  count: number
}

export const FEEDBACK: Record<FeedbackKind, Spec> = {
  buy: { sfx: 'reward', phrase: '買到囉！', particle: 'star', count: 9 },
  craft: { sfx: 'reward', phrase: '做好了！', particle: 'star', count: 12 },
  task: { sfx: 'correct', phrase: '好棒喔！', particle: 'star', count: 8 },
  poop: { sfx: null, phrase: '乾淨了！', particle: 'heart', count: 6 },
  place: { sfx: 'correct', phrase: '放好了！', particle: 'heart', count: 6 },
  undo: { sfx: 'tap', phrase: '好，退回囉', particle: 'star', count: 0 },
}

export interface FeedbackOpts {
  /** 音效開關（家長設定）；預設開 */
  soundOn?: boolean
  /** 語音開關（家長設定）；預設開 */
  voiceOn?: boolean
  /** 粒子從哪裡冒出來：螢幕座標，或一個元素（取中心）；沒給就從畫面中央偏上 */
  at?: { x: number; y: number } | Element | null
  /** 覆寫語音 / 字幕（例如「買到香蕉囉」） */
  phrase?: string
}

const reduced = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches

const originOf = (at: FeedbackOpts['at']): { x: number; y: number } => {
  if (at && 'getBoundingClientRect' in at) {
    const r = at.getBoundingClientRect()
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
  }
  if (at) return at
  return { x: window.innerWidth / 2, y: window.innerHeight * 0.4 }
}

function particleNode(kind: Spec['particle'], px: number): HTMLElement {
  const box = document.createElement('span')
  box.style.cssText = `display:grid;place-items:center;width:${px}px;height:${px}px;font-size:${px * 0.8}px;line-height:1`
  if (kind === 'star' && peekArt('ui-star') === 'ok') {
    const img = document.createElement('img')
    img.src = `${import.meta.env.BASE_URL}art/ui-star.png`
    img.alt = ''
    img.style.cssText = 'width:100%;height:100%;object-fit:contain'
    box.appendChild(img)
  } else box.textContent = kind === 'star' ? '⭐' : '💗'
  return box
}

/** 粒子：從原點往四周噴出再淡掉。回傳實際放了幾顆 */
function burst(kind: FeedbackKind, spec: Spec, from: { x: number; y: number }): number {
  if (spec.count <= 0) return 0
  const layer = document.createElement('div')
  layer.className = 'fb-burst'
  layer.dataset.testid = 'fb-burst'
  layer.dataset.kind = kind
  layer.setAttribute('aria-hidden', 'true')
  document.body.appendChild(layer)
  const calm = reduced()
  let done = 0
  for (let i = 0; i < spec.count; i++) {
    const px = 26 + (i % 3) * 8
    const el = particleNode(spec.particle, px)
    el.className = 'fb-particle'
    el.dataset.testid = 'fb-particle'
    el.style.left = `${from.x - px / 2}px`
    el.style.top = `${from.y - px / 2}px`
    layer.appendChild(el)
    const ang = (Math.PI * 2 * i) / spec.count - Math.PI / 2 + (i % 2 ? 0.25 : -0.15)
    const dist = 70 + (i % 4) * 22
    const dx = Math.cos(ang) * dist
    const dy = Math.sin(ang) * dist - 24
    const frames: Keyframe[] = calm
      ? [{ opacity: 0 }, { opacity: 1, offset: 0.3 }, { opacity: 0 }]
      : [
          { transform: 'translate(0,0) scale(0.3)', opacity: 0 },
          { transform: `translate(${dx * 0.7}px, ${dy * 0.7}px) scale(1.1)`, opacity: 1, offset: 0.35 },
          { transform: `translate(${dx}px, ${dy + 36}px) scale(0.8)`, opacity: 0 },
        ]
    const a = el.animate(frames, { duration: calm ? 900 : 950, delay: i * 25, easing: 'cubic-bezier(.2,.7,.4,1)', fill: 'both' })
    const fin = () => {
      done += 1
      if (done >= spec.count) layer.remove()
    }
    a.finished.then(fin, fin)
  }
  return spec.count
}

/**
 * 播一次小成功回饋。回傳這次實際做了什麼（單元測試與 e2e 可驗證）。
 * 不會丟例外：沒有 WebAudio / 語音 / DOM 時就只做得到的那幾件。
 */
export function celebrateSmall(kind: FeedbackKind, opts: FeedbackOpts = {}): { sound: boolean; voice: boolean; particles: number } {
  const spec = FEEDBACK[kind]
  const soundOn = opts.soundOn !== false
  const voiceOn = opts.voiceOn !== false
  let sound = false
  let voice = false
  let particles = 0
  try {
    if (spec.sfx && soundOn) {
      playSfx(spec.sfx, true)
      sound = true
    }
    voice = speak(opts.phrase ?? spec.phrase, { enabled: voiceOn })
    if (typeof document !== 'undefined') particles = burst(kind, spec, originOf(opts.at))
    window.dispatchEvent(new CustomEvent('gq-feedback', { detail: { kind, sound, voice, particles } }))
  } catch {
    /* 回饋失敗不影響遊戲 */
  }
  return { sound, voice, particles }
}

/** 元件用：自動帶入家長的音效 / 語音開關 */
export function useCelebrateSmall() {
  const { soundOn, voiceOn } = useLearningSettings()
  return useCallback((kind: FeedbackKind, opts: Omit<FeedbackOpts, 'soundOn' | 'voiceOn'> = {}) => celebrateSmall(kind, { ...opts, soundOn, voiceOn }), [soundOn, voiceOn])
}
