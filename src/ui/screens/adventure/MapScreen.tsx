import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../../../db/db'
import { repo } from '../../../db/repo'
import { localDateStr } from '../../../domain/date'
import { now as clockNow } from '../../../domain/clock'
import type { ChapterDef } from '../../../learning/chapter'
import { dailyChapterId, DAILY_NAME, mustSubject, SUBJECTS } from '../../../learning/subject'
import type { Progress, SubjectId } from '../../../learning/types'
import { Icon } from '../../components/Icon'
import { ScreenHeader } from '../../components/Header'
import { MaterialsChip } from '../../components/MaterialsChip'
import { useArtStatus } from '../../artProbe'
import { useNow, useToast } from '../../hooks'
import { useLearningSettings } from '../../learningHooks'
import { sayText } from '../../../learning/speech'
import type { Screen } from '../../App'
import { Companion } from './Companion'
import './adventure.css'
import './adventure-v5.css'
import { readSubject, writeSubject } from './subjectPref'

function emptyProgress(ch: ChapterDef): Progress {
  return {
    chapterId: ch.id,
    run: 1,
    stations: ch.stations.map(() => ({ done: false, independent: 0, total: 0 })),
    chestClaimed: false,
    completedRuns: 0,
    updatedAt: 0,
  }
}

type Pt = [number, number]
/**
 * 站點位置（佔場景寬高的 %），對應 scene-map-huaguoshan.png（1280×720）裡本來就有的那條山路：
 * 由左下角出發，過兩座小橋，爬上右上角的寶箱。前 5 個是站點，最後一個是寶箱。
 */
const POINTS: Pt[] = [[11, 84], [25, 78], [38, 62], [56, 46], [72, 33], [87, 11]]

/** 沒有場景圖時：把這些點連成平滑的山路（Catmull-Rom → Bezier），座標系 0–100 */
function smoothPath(pts: Pt[]): string {
  let d = `M ${pts[0][0]} ${pts[0][1]}`
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i]
    const p1 = pts[i]
    const p2 = pts[i + 1]
    const p3 = pts[i + 2] ?? p2
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6]
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6]
    d += ` C ${c1[0]} ${c1[1]}, ${c2[0]} ${c2[1]}, ${p2[0]} ${p2[1]}`
  }
  return d
}
const ROAD_PATH = smoothPath(POINTS)

/**
 * 冒險地圖：上方是科目分頁（數學、英文…），每個科目有自己的章節與進度（花果山、英文小島）；
 * 5 站由山腳往山頂，章末寶箱。底下是「今日冒險」大卡片（每天 5 題新題目）。
 * 場景固定 16:9；窄螢幕時可左右捲動，並自動捲到目前這一站。
 */
export function MapScreen({ onBack, go }: { onBack: () => void; go: (s: Screen) => void }) {
  const toast = useToast()
  const [subjectId, setSubjectId] = useState<SubjectId>(readSubject)
  const subject = mustSubject(subjectId)
  const ch = subject.chapter
  const today = localDateStr(useNow())
  // 換科目時 useLiveQuery 會先留著上一個科目的結果，所以結果上標記它屬於哪個科目，對不上就當作還在載入
  const progRaw = useLiveQuery(async () => (await db.progress.get(ch.id)) ?? emptyProgress(ch), [ch.id])
  const prog = progRaw?.chapterId === ch.id ? progRaw : undefined
  const dailyRaw = useLiveQuery(async () => ({ subject: subjectId, today, info: await repo.getDailyInfo(subjectId, clockNow()) }), [subjectId, today])
  const daily = dailyRaw?.subject === subjectId && dailyRaw.today === today ? dailyRaw.info : undefined
  const pickSubject = (id: SubjectId) => {
    writeSubject(id)
    setSubjectId(id)
  }
  const scrollRef = useRef<HTMLDivElement>(null)
  const sceneRef = useRef<HTMLElement>(null)
  const hasScene = useArtStatus('scene-map-huaguoshan') === 'ok'
  const [canScroll, setCanScroll] = useState(false)
  const { voiceOn } = useLearningSettings()
  // 點到鎖住 / 已通關的站：那顆圓鈕晃一下 + 一句語音（SPEC-v4 U10；只加回饋，不動關卡流程）
  const [wobble, setWobble] = useState<string | null>(null)
  const wobbleTimer = useRef<number | undefined>(undefined)
  useEffect(() => () => window.clearTimeout(wobbleTimer.current), [])
  const nudge = (key: string, say: string) => {
    window.clearTimeout(wobbleTimer.current)
    setWobble(key)
    wobbleTimer.current = window.setTimeout(() => setWobble(null), 560)
    sayText(say, { enabled: voiceOn })
  }

  const run = prog?.run
  const doneN = prog?.stations.filter((s) => s.done).length
  const ready = !!prog
  // 場景比視窗寬時，把目前這一站（全通關就是寶箱）捲到畫面中間；起點與目前這站一定在視野內
  useLayoutEffect(() => {
    const sc = scrollRef.current
    const scene = sceneRef.current
    if (!sc || !scene) return
    const fit = () => setCanScroll(scene.scrollWidth > sc.clientWidth + 4)
    fit()
    const idx = doneN === undefined ? 0 : doneN >= ch.stations.length ? ch.stations.length : doneN
    const x = (POINTS[idx][0] / 100) * scene.scrollWidth
    sc.scrollLeft = Math.max(0, Math.min(scene.scrollWidth - sc.clientWidth, x - sc.clientWidth / 2))
    const ro = new ResizeObserver(fit)
    ro.observe(sc)
    return () => ro.disconnect()
  }, [ready, run, doneN, ch.id, ch.stations.length])

  if (!prog) return <div className="splash">載入中…</div>

  const doneCount = prog.stations.filter((s) => s.done).length
  const allDone = doneCount === ch.stations.length
  const currentIdx = allDone ? -1 : doneCount // 0 起算
  const bg = `${import.meta.env.BASE_URL}art/scene-map-huaguoshan.png`

  const nextRun = async () => {
    const r = await repo.startNextRun(ch.id)
    if (!r.ok) toast(r.error, 'warn')
    else toast('新的一輪冒險開始了！題目會換新的喔', 'ok')
  }

  const pos = (k: number) => ({ ['--x' as string]: `${POINTS[k][0]}%`, ['--y' as string]: `${POINTS[k][1]}%` })

  return (
    <main className={`screen adv adv-map theme-${subject.theme} subject-${subject.id}`} data-testid="map" data-subject={subject.id}>
      <ScreenHeader title="冒險地圖" onBack={onBack} right={<MaterialsChip />} />

      <nav className="adv-subjects" role="tablist" aria-label="科目">
        {SUBJECTS.map((s) => (
          <button
            key={s.id}
            type="button"
            role="tab"
            aria-selected={s.id === subjectId}
            className={`adv-subject tone-${s.id}`}
            onClick={() => pickSubject(s.id)}
            data-testid={`subject-${s.id}`}
          >
            <span className="adv-subject-glyph" aria-hidden>{s.glyph}</span>
            <span className="adv-subject-name">{s.name}</span>
          </button>
        ))}
      </nav>

      <div className="adv-scroll" ref={scrollRef}>
        <section ref={sceneRef} className={`adv-scene ${hasScene ? 'has-art' : ''} scene-${subject.id}`} style={hasScene ? { ['--map-bg' as string]: `url("${bg}")` } : undefined}>
          {/* 沒有場景圖時才用 CSS 畫山丘與虛線山路；有場景圖就用圖裡本來的山路 */}
          {!hasScene && (
            <>
              <div className="adv-hills" aria-hidden>
                <i className="sun" />
                <i className="cloud c1" />
                <i className="cloud c2" />
                <i className="hill h1" />
                <i className="hill h2" />
                <i className="hill h3" />
              </div>
              <svg className="adv-road" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
                <path d={ROAD_PATH} vectorEffect="non-scaling-stroke" />
              </svg>
            </>
          )}

          <ol className="adv-path" aria-label={`${ch.name}的路`}>
            {ch.stations.map((s, k) => {
              const st = prog.stations[k]
              const state = st.done ? 'done' : k === currentIdx ? 'current' : 'locked'
              return (
                <li key={s.index} className={`adv-node st-${state} `} style={pos(k)} data-station-state={state}>
                  <button
                    type="button"
                    className={`adv-node-btn ${wobble === `s${s.index}` ? 'ux-wobble' : ''}`}
                    aria-disabled={state !== 'current'}
                    onClick={() => {
                      if (state === 'current') go({ name: 'stage', chapterId: ch.id, station: s.index })
                      else if (state === 'done') nudge(`s${s.index}`, '這一站過關囉，好棒！')
                      else nudge(`s${s.index}`, '還沒到喔，先去前面的站')
                    }}
                    data-testid={`station-${s.index}`}
                    aria-label={`第 ${s.index} 站 ${s.name}，${state === 'done' ? '已通關' : state === 'current' ? '出發' : '還沒解鎖'}`}
                  >
                    {state === 'locked' ? <Icon name="ui-lock" emoji="🔒" size="52%" /> : state === 'done' ? <span className="adv-check" aria-hidden>✓</span> : <span className="adv-num">{s.index}</span>}
                  </button>
                  <span className="adv-node-label">
                    {s.name}
                    {state === 'current' && <em> 出發！</em>}
                    {state === 'locked' && <em className="muted"> 還沒到</em>}
                    {st.done && <em className="muted"> 自己答對 {st.independent}/{st.total}</em>}
                  </span>
                  {state === 'current' && (
                    <span className="adv-pet-wrap">
                      <Companion pose="happy" size="var(--pet)" />
                    </span>
                  )}
                </li>
              )
            })}

            <li
              className={`adv-node chest ${allDone && !prog.chestClaimed ? 'ready' : ''} ${prog.chestClaimed ? 'opened' : ''} ${allDone ? 'st-open' : 'st-locked'}`}
              style={pos(5)}
            >
              <button
                type="button"
                className={`adv-node-btn ${wobble === 'chest' ? 'ux-wobble' : ''}`}
                aria-disabled={!allDone}
                onClick={() => {
                  if (allDone) go({ name: 'stage', chapterId: ch.id, station: ch.stations.length, ceremony: true })
                  else nudge('chest', '寶箱還鎖著，通關五站就能打開喔')
                }}
                data-testid="chest-node"
                aria-label={prog.chestClaimed ? '寶箱已經打開了' : allDone ? '打開寶箱' : '寶箱，通關 5 站就能打開'}
              >
                <Icon name="ui-chest" emoji="🎁" size="74%" />
                {!allDone && (
                  <span className="adv-chest-lock" aria-hidden>
                    <Icon name="ui-lock" emoji="🔒" size="100%" />
                  </span>
                )}
              </button>
              <span className="adv-node-label">{prog.chestClaimed ? '寶箱已打開' : allDone ? '打開寶箱！' : '章末寶箱'}</span>
            </li>
          </ol>
        </section>
      </div>

      {prog.chestClaimed && (
        <section className="adv-again" data-testid="run-complete">
          <p>這一輪的冒險完成了！想再玩一次嗎？題目會換新的。</p>
          <button className="adv-btn primary" onClick={nextRun} data-testid="next-run">再玩一次</button>
        </section>
      )}
      {allDone && !prog.chestClaimed && (
        <section className="adv-again">
          <p>5 站都通關了，寶箱在等你！</p>
        </section>
      )}

      {daily && (
        <section
          className={`adv-daily ${allDone || daily.done === 0 ? 'featured' : ''}`}
          data-testid="daily-card"
          data-done={daily.done}
          data-badge={daily.badgeToday ? 'true' : 'false'}
          aria-label={DAILY_NAME}
        >
          <span className="adv-daily-icon" aria-hidden><Icon name="ui-map" emoji="🗺️" size={72} /></span>
          <div className="adv-daily-text">
            <b>{DAILY_NAME}</b>
            <span data-testid="daily-text">
              {daily.done === 0
                ? '5 題新題目，每天都不一樣'
                : daily.badgeToday
                  ? '今天的徽章收好了！想再玩一次嗎？'
                  : '今天完成了！想再玩一次嗎？'}
            </span>
          </div>
          {daily.badgeToday && <span className="daily-medal" data-testid="daily-medal" role="img" aria-label="今日徽章">★</span>}
          <button
            type="button"
            className="adv-btn primary big"
            onClick={() => go({ name: 'stage', chapterId: dailyChapterId(subject.id), station: 1 })}
            data-testid="daily-go"
          >
            {daily.done ? '再玩一次' : '出發'}
          </button>
        </section>
      )}

      <section className="adv-foot-row" aria-label="章節進度">
        <p className="adv-map-hero">
          <b>{ch.subtitle}・{ch.name}</b>
          <span>已通關 {doneCount} / {ch.stations.length} 站{prog.run > 1 ? `（第 ${prog.run} 輪）` : ''}</span>
        </p>
        <div className="adv-upcoming">
          {subject.upcoming.map((c) => (
            <div key={c.id} className="adv-soon" aria-disabled="true">
              <Icon name="ui-lock" emoji="🔒" size={30} />
              <b>{c.name}</b>
              <span>即將開放</span>
            </div>
          ))}
        </div>
        {canScroll && <p className="adv-swipe-hint">左右滑動看整張地圖 ↔</p>}
      </section>
    </main>
  )
}
