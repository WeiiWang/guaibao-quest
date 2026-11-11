import { useEffect, useState } from 'react'
import { useArtStatus } from '../../artProbe'
import { Art } from '../../components/Art'

// v8.4 線 AA：3D 圖還沒生好時的退路。不用 emoji 當主圖：小車、房子、相機、紅綠燈都是自己畫的簡單 SVG，不破版。

const HOUSE_ROOF: Record<string, string> = { red: '#ef6f6c', blue: '#5b9be6', yellow: '#f5c542' }

/** 俯視的小紅車（車頭朝上） */
export function CarTopSvg() {
  return (
    <svg viewBox="0 0 64 96" width="100%" height="100%" aria-hidden>
      <rect x="4" y="16" width="10" height="20" rx="4" fill="#3d3a44" />
      <rect x="50" y="16" width="10" height="20" rx="4" fill="#3d3a44" />
      <rect x="4" y="62" width="10" height="20" rx="4" fill="#3d3a44" />
      <rect x="50" y="62" width="10" height="20" rx="4" fill="#3d3a44" />
      <rect x="9" y="6" width="46" height="86" rx="20" fill="#ec5f5b" stroke="#c94440" strokeWidth="3" />
      <path d="M17 32 Q32 22 47 32 L44 42 Q32 37 20 42 Z" fill="#bfe6ff" />
      <rect x="18" y="46" width="28" height="30" rx="10" fill="#f47c78" />
      <circle cx="19" cy="12" r="4" fill="#fff4b8" />
      <circle cx="45" cy="12" r="4" fill="#fff4b8" />
    </svg>
  )
}

/** v8.5 俯視的消防車（車頭朝上）：紅車身、白梯子、藍色警示燈 */
export function FireTopSvg() {
  return (
    <svg viewBox="0 0 64 96" width="100%" height="100%" aria-hidden>
      <rect x="3" y="14" width="10" height="20" rx="4" fill="#3d3a44" />
      <rect x="51" y="14" width="10" height="20" rx="4" fill="#3d3a44" />
      <rect x="3" y="64" width="10" height="20" rx="4" fill="#3d3a44" />
      <rect x="51" y="64" width="10" height="20" rx="4" fill="#3d3a44" />
      <rect x="8" y="4" width="48" height="90" rx="12" fill="#e5433d" stroke="#b82f2a" strokeWidth="3" />
      <path d="M15 24 Q32 16 49 24 L47 33 Q32 29 17 33 Z" fill="#bfe6ff" />
      <rect x="20" y="9" width="24" height="7" rx="3.5" fill="#4fa8ec" stroke="#fff" strokeWidth="1.5" />
      <rect x="14" y="38" width="36" height="50" rx="6" fill="#f2625c" />
      <path d="M24 42 V86 M40 42 V86 M24 48 H40 M24 56 H40 M24 64 H40 M24 72 H40 M24 80 H40" stroke="#fff" strokeWidth="3" strokeLinecap="round" fill="none" />
      <circle cx="17" cy="8" r="3" fill="#fff4b8" />
      <circle cx="47" cy="8" r="3" fill="#fff4b8" />
    </svg>
  )
}

/** v8.5 俯視的冰淇淋車（車頭朝上）：粉粉的車身、條紋棚子、車頂一支大甜筒 */
export function IceTopSvg() {
  return (
    <svg viewBox="0 0 64 96" width="100%" height="100%" aria-hidden>
      <rect x="3" y="16" width="10" height="20" rx="4" fill="#3d3a44" />
      <rect x="51" y="16" width="10" height="20" rx="4" fill="#3d3a44" />
      <rect x="3" y="62" width="10" height="20" rx="4" fill="#3d3a44" />
      <rect x="51" y="62" width="10" height="20" rx="4" fill="#3d3a44" />
      <rect x="8" y="5" width="48" height="88" rx="16" fill="#ffd9e6" stroke="#f0a3bd" strokeWidth="3" />
      <path d="M16 28 Q32 19 48 28 L46 37 Q32 33 18 37 Z" fill="#bfe6ff" />
      <rect x="13" y="42" width="38" height="44" rx="10" fill="#fff6e6" />
      <path d="M13 52 H51 M13 64 H51 M13 76 H51" stroke="#ffb3cc" strokeWidth="5" />
      <path d="M24 60 L32 84 L40 60 Z" fill="#f0b973" stroke="#d49448" strokeWidth="1.5" strokeLinejoin="round" />
      <circle cx="32" cy="55" r="10" fill="#ff8fb3" stroke="#fff" strokeWidth="2" />
      <circle cx="29" cy="52" r="2.5" fill="#fff" opacity="0.8" />
      <circle cx="18" cy="11" r="3" fill="#fff4b8" />
      <circle cx="46" cy="11" r="3" fill="#fff4b8" />
    </svg>
  )
}

/** v8.5 洗車站：藍色的小棚子，兩支大刷子，上面冒泡泡 */
export function WashSvg() {
  return (
    <svg viewBox="0 0 100 100" width="100%" height="100%" aria-hidden>
      <ellipse cx="50" cy="92" rx="42" ry="6" fill="rgb(0 0 0 / 0.12)" />
      <rect x="12" y="40" width="14" height="50" rx="6" fill="#ff8fb3" stroke="#e0728e" strokeWidth="2" />
      <rect x="74" y="40" width="14" height="50" rx="6" fill="#ffd34d" stroke="#e0a92a" strokeWidth="2" />
      <path d="M12 50 H26 M12 60 H26 M12 70 H26 M12 80 H26 M74 50 H88 M74 60 H88 M74 70 H88 M74 80 H88" stroke="#fff" strokeWidth="3" opacity="0.7" />
      <path d="M6 46 Q50 4 94 46 L94 52 Q50 26 6 52 Z" fill="#4fa8ec" stroke="#2f7fc4" strokeWidth="2.5" strokeLinejoin="round" />
      <circle cx="38" cy="22" r="8" fill="#fff" stroke="#bfe6ff" strokeWidth="2" />
      <circle cx="55" cy="14" r="10" fill="#fff" stroke="#bfe6ff" strokeWidth="2" />
      <circle cx="68" cy="25" r="6" fill="#fff" stroke="#bfe6ff" strokeWidth="2" />
      <path d="M44 58 q6 9 0 14 q-6 -5 0 -14 Z M58 62 q5 8 0 12 q-5 -4 0 -12 Z" fill="#8fd0ff" />
    </svg>
  )
}

/** v8.5 車庫：一個開著門的小車庫，裡面停著下一台車（車子另外疊上去） */
export function GarageSvg() {
  return (
    <svg viewBox="0 0 88 88" width="100%" height="100%" aria-hidden>
      <path d="M6 40 L44 10 L82 40 V80 Q82 84 78 84 H10 Q6 84 6 80 Z" fill="#fff4dd" stroke="#e0b25e" strokeWidth="4" strokeLinejoin="round" />
      <path d="M2 42 L44 8 L86 42" fill="none" stroke="#ef8a5c" strokeWidth="8" strokeLinecap="round" strokeLinejoin="round" />
      <rect x="18" y="38" width="52" height="46" rx="6" fill="#6f6a7c" />
    </svg>
  )
}

/** 斜上方看的小房子（屋頂顏色 = 乘客想去的顏色） */
export function HouseSvg({ color }: { color: string }) {
  return (
    <svg viewBox="0 0 100 100" width="100%" height="100%" aria-hidden>
      <ellipse cx="50" cy="90" rx="40" ry="7" fill="rgb(0 0 0 / 0.12)" />
      <rect x="18" y="44" width="64" height="44" rx="10" fill="#fff4dd" stroke="#e6cfa4" strokeWidth="3" />
      <path d="M8 50 Q50 6 92 50 Q50 40 8 50 Z" fill={HOUSE_ROOF[color] ?? color} stroke="rgb(0 0 0 / 0.12)" strokeWidth="2" strokeLinejoin="round" />
      <rect x="41" y="60" width="18" height="28" rx="9" fill="#b7835a" />
      <circle cx="29" cy="62" r="6" fill="#bfe6ff" />
      <circle cx="71" cy="62" r="6" fill="#bfe6ff" />
    </svg>
  )
}

/** 圓胖的相機 */
export function CameraSvg() {
  return (
    <svg viewBox="0 0 100 80" width="100%" height="100%" aria-hidden>
      <rect x="30" y="6" width="22" height="14" rx="6" fill="#f5c542" />
      <rect x="6" y="14" width="88" height="60" rx="18" fill="#f48fb1" stroke="#d96b93" strokeWidth="3" />
      <circle cx="50" cy="44" r="21" fill="#fff" />
      <circle cx="50" cy="44" r="15" fill="#5a6b8c" />
      <circle cx="44" cy="38" r="5" fill="#cfe3ff" />
      <circle cx="80" cy="26" r="5" fill="#fff4b8" />
    </svg>
  )
}

/** 掛在牆上的小畫框（去畫廊） */
export function GalleryFrameSvg() {
  return (
    <svg viewBox="0 0 64 64" width="100%" height="100%" aria-hidden>
      <path d="M22 12 L32 4 L42 12" fill="none" stroke="#8a6a4a" strokeWidth="3" strokeLinejoin="round" />
      <rect x="6" y="12" width="52" height="46" rx="8" fill="#e8b46e" stroke="#b9823f" strokeWidth="3" />
      <rect x="13" y="19" width="38" height="32" rx="4" fill="#bfe3ff" />
      <path d="M13 44 L26 31 L35 40 L41 34 L51 44 V51 H13 Z" fill="#8fd18a" />
      <circle cx="42" cy="26" r="4" fill="#ffd23f" />
    </svg>
  )
}

/** 有 3D 圖就用 3D 圖，沒有就用自己畫的 SVG（不是 emoji） */
export function ArtOr({ name, alt = '', children }: { name: string; alt?: string; children: React.ReactNode }) {
  const st = useArtStatus(name)
  if (st === 'ok') return <Art name={name} alt={alt} className="aa-art" />
  return <span className="aa-art aa-art-svg">{st === 'no' ? children : null}</span>
}

/** 場景圖（.jpg）在不在：GameShell 的背景用到還沒生好的場景時，玩法自己鋪一層底色 */
export function useSceneOk(name: string): boolean | null {
  const [ok, setOk] = useState<boolean | null>(null)
  useEffect(() => {
    let alive = true
    const img = new Image()
    img.onload = () => alive && setOk(true)
    img.onerror = () => alive && setOk(false)
    img.src = `${import.meta.env.BASE_URL}art/${name}.jpg`
    return () => {
      alive = false
    }
  }, [name])
  return ok
}
