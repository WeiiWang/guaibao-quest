import { isStandalone } from '../../install'

const INK = '#4a3b35'
const LINE = '#cfc3b4'
const FOCUS = '#ff8a5c'

/** iPad 外框（自己畫的示意圖）；children 畫在 240x170 的螢幕座標裡 */
function Tablet({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <svg viewBox="0 0 260 190" role="img" aria-label={title} className="rl-guide-art">
      <rect x="4" y="4" width="252" height="182" rx="16" fill="#3a3330" />
      <rect x="14" y="14" width="232" height="162" rx="6" fill="#fffdf8" />
      {children}
    </svg>
  )
}

/** 通用的「分享」圖形：方框 + 向上箭頭 */
function ShareGlyph({ x, y, color = INK }: { x: number; y: number; color?: string }) {
  return (
    <g transform={`translate(${x} ${y})`} fill="none" stroke={color} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M-7 -2 h-2 v13 h18 v-13 h-2" />
      <path d="M0 5 V-11 M-5 -6 L0 -11 L5 -6" />
    </g>
  )
}

function ToolbarBase() {
  return (
    <>
      <rect x="14" y="14" width="232" height="26" rx="6" fill="#efe9df" />
      <rect x="66" y="20" width="118" height="14" rx="7" fill="#fff" stroke={LINE} />
    </>
  )
}

function StepOne() {
  return (
    <Tablet title="第一步：在 Safari 工具列按分享鈕">
      <ToolbarBase />
      <circle cx="214" cy="27" r="15" fill="none" stroke={FOCUS} strokeWidth="3" />
      <ShareGlyph x={214} y={27} />
      <rect x="40" y="70" width="180" height="70" rx="12" fill="#bfe2ff" />
      <text x="130" y="112" textAnchor="middle" fontSize="20" fontWeight="800" fill={INK}>乖寶任務</text>
    </Tablet>
  )
}

function StepTwo() {
  const row = (y: number, text: string, on = false) => (
    <g key={text}>
      <rect x="84" y={y} width="150" height="26" rx="6" fill={on ? '#ffe9de' : '#fff'} stroke={on ? FOCUS : LINE} strokeWidth={on ? 3 : 1} />
      <text x="96" y={y + 18} fontSize="13" fontWeight={on ? 800 : 500} fill={INK}>{text}</text>
      {on && (
        <g transform={`translate(214 ${y + 13})`} fill="none" stroke={INK} strokeWidth="2" strokeLinecap="round">
          <rect x="-8" y="-8" width="16" height="16" rx="4" />
          <path d="M0 -4 V4 M-4 0 H4" />
        </g>
      )}
    </g>
  )
  return (
    <Tablet title="第二步：在選單裡選加入主畫面">
      <ToolbarBase />
      <ShareGlyph x={214} y={27} />
      <rect x="76" y="44" width="166" height="126" rx="10" fill="#f6f1e8" stroke={LINE} />
      {row(54, '拷貝')}
      {row(86, '加入書籤')}
      {row(118, '加入主畫面', true)}
    </Tablet>
  )
}

function StepThree() {
  const dot = (x: number, y: number, c: string) => <rect key={`${x}-${y}`} x={x} y={y} width="30" height="30" rx="7" fill={c} />
  return (
    <Tablet title="第三步：回到主畫面，從乖寶任務的圖示打開">
      <rect x="14" y="14" width="232" height="162" rx="6" fill="#cfe8ff" />
      {dot(40, 38, '#fff')}
      {dot(92, 38, '#ffe7a8')}
      {dot(144, 38, '#cdeed9')}
      {dot(196, 38, '#ffd6cc')}
      {dot(40, 92, '#e8ddff')}
      {dot(92, 92, '#fff')}
      <image href={`${import.meta.env.BASE_URL}icon-192.png`} x="140" y="86" width="42" height="42" clipPath="inset(0 round 9px)" />
      <rect x="138" y="84" width="46" height="46" rx="11" fill="none" stroke={FOCUS} strokeWidth="3" />
      <text x="161" y="148" textAnchor="middle" fontSize="12" fontWeight="800" fill={INK}>乖寶任務</text>
    </Tablet>
  )
}

/** Safari 加到主畫面的圖解（全部自己畫，不用截圖、不用商標圖） */
export function InstallGuide() {
  const installed = isStandalone()
  return (
    <div className="card" id="rl-install-guide" data-testid="install-guide" data-installed={installed ? '1' : '0'}>
      <h2>加到主畫面（iPad）</h2>
      {installed ? (
        <p data-testid="install-done">已經是從主畫面打開的，不用再做。</p>
      ) : (
        <p className="lt-note">加到主畫面之後，孩子打開就是全螢幕，沒有網址列，也比較不會被瀏覽器清掉資料。</p>
      )}
      <ol className="rl-guide">
        <li>
          <StepOne />
          <p><b>1.</b> 用 <b>Safari</b> 打開乖寶任務，按工具列的<b>分享</b>鈕（方框加向上箭頭）。新版 Safari 可能收在「⋯」選單裡。</p>
        </li>
        <li>
          <StepTwo />
          <p><b>2.</b> 往下找到<b>加入主畫面</b>，再按<b>新增</b>。如果有「以網頁 App 打開」的選項，請保持開啟。</p>
        </li>
        <li>
          <StepThree />
          <p><b>3.</b> 之後都從主畫面的圖示打開。</p>
        </li>
      </ol>
      <p className="lt-note" data-testid="install-storage-note">
        iPad 上，主畫面版和 Safari 分頁的資料是分開存的。如果已經在 Safari 玩過：先在 Safari 的這一頁「下載備份檔」，再到主畫面版「從備份檔還原」。
      </p>
    </div>
  )
}
