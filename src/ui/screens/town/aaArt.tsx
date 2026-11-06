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
