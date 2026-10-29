import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../../../db/db'
import { repo } from '../../../db/repo'
import { localDateStr } from '../../../domain/date'
import { now as clockNow } from '../../../domain/clock'
import type { ChapterDef } from '../../../learning/chapter'
import { getChapter } from '../../../learning/chapter'
import { challengeVisible, nodeWindow } from '../../../learning/chapter'
import { challengeChapterId, chaptersOf, dailyChapterId, DAILY_NAME, mustSubject, replayChapterId, SUBJECTS } from '../../../learning/subject'
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
import './adventure-v6.css'
import './adventure-v7.css'
import './adventure-h74.css'
import { Placement } from './Placement'
import { readChapter, readSubject, writeChapter, writeSubject } from './subjectPref'
import { usePetText } from '../../species'

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

/** 直向（寬 <= 高）：地圖縮到「所有節點都看得到」，不用橫向捲動（試玩審查 V7） */
function usePortrait(): boolean {
  const [p, setP] = useState(() => typeof matchMedia !== 'undefined' && matchMedia('(max-aspect-ratio: 1/1)').matches)
  useEffect(() => {
    const mq = matchMedia('(max-aspect-ratio: 1/1)')
    const on = () => setP(mq.matches)
    on()
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  return p
}

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
  const pt = usePetText()
  const toast = useToast()
  const [subjectId, setSubjectId] = useState<SubjectId>(readSubject)
  const subject = mustSubject(subjectId)
  const chapters = chaptersOf(subject)
  const [chapterPick, setChapterPick] = useState<string | null>(() => readChapter(readSubject()))
  // 章節有沒有開放（第 2 章以後要先通關前一章，這是唯一的鎖）與各章進度
  const unlocks = useLiveQuery(() => repo.getChapterUnlocks(), [])
  const allProg = useLiveQuery(() => db.progress.toArray(), [])
  const chosen = chapters.find((c) => c.id === chapterPick) ?? chapters[0]
  const ch = unlocks && unlocks[chosen.id] === false ? chapters[0] : chosen
  const today = localDateStr(useNow())
  // 換科目時 useLiveQuery 會先留著上一個科目的結果，所以結果上標記它屬於哪個科目，對不上就當作還在載入
  const progRaw = useLiveQuery(async () => (await db.progress.get(ch.id)) ?? emptyProgress(ch), [ch.id])
  const prog = progRaw?.chapterId === ch.id ? progRaw : undefined
  const dailyRaw = useLiveQuery(async () => ({ subject: subjectId, today, info: await repo.getDailyInfo(subjectId, clockNow()) }), [subjectId, today])
  const daily = dailyRaw?.subject === subjectId && dailyRaw.today === today ? dailyRaw.info : undefined
  const [placementDone, setPlacementDone] = useState(false)
  /** 已經開始做快速分級：做完時資料庫就不再「需要分級」，但結束畫面還要顯示完 */
  const [placementStarted, setPlacementStarted] = useState(false)
  const pickSubject = (id: SubjectId) => {
    writeSubject(id)
    setSubjectId(id)
    setChapterPick(readChapter(id))
  }
  const pickChapter = (id: string) => {
    writeChapter(subjectId, id)
    setChapterPick(id)
  }
  const scrollRef = useRef<HTMLDivElement>(null)
  const sceneRef = useRef<HTMLElement>(null)
  // 地圖背景：章節有自己的圖就用；沒有（還在生成）就用花果山的地圖換色調
  const baseArt = useArtStatus('scene-map-huaguoshan') === 'ok'
  const ownArt = useArtStatus(ch.scene ?? 'scene-map-huaguoshan') === 'ok' && !!ch.scene
  const hasScene = ownArt || baseArt
  const tinted = !!ch.scene && !ownArt
  // 站點位置：章節有自己的背景圖才用自己的位置，否則是花果山地圖的位置
  const points: Pt[] = ownArt && ch.points ? ch.points : POINTS
  const portrait = usePortrait()
  // 直向：只顯示節點外框那一段場景圖，寬度剛好填滿畫面；橫向維持整張圖
  const win = portrait ? nodeWindow(points) : { x0: 0, x1: 100 }
  const span = win.x1 - win.x0
  const [canScroll, setCanScroll] = useState(false)
  // 6–7 歲的快速分級、挑戰站要看年齡與進度
  const profile = useLiveQuery(() => repo.getLearnerProfile(), [])
  const placementDue = useLiveQuery(async () => ({ subject: subjectId, due: await repo.placementDue() }), [subjectId, placementDone])
  const challenge = useLiveQuery(async () => ({ chapter: ch.id, c: await repo.getChallenge(ch.id) }), [ch.id])
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
    const x = (points[idx][0] / 100) * scene.scrollWidth
    sc.scrollLeft = Math.max(0, Math.min(scene.scrollWidth - sc.clientWidth, x - sc.clientWidth / 2))
    const ro = new ResizeObserver(fit)
    ro.observe(sc)
    return () => ro.disconnect()
  }, [ready, run, doneN, ch.id, ch.stations.length, points])

  if (!prog) return <div className="splash">載入中…</div>

  const doneCount = prog.stations.filter((s) => s.done).length
  const allDone = doneCount === ch.stations.length
  const currentIdx = allDone ? -1 : doneCount // 0 起算
  const bg = `${import.meta.env.BASE_URL}art/${ownArt ? ch.scene : 'scene-map-huaguoshan'}.png`

  const nextRun = async () => {
    const r = await repo.startNextRun(ch.id)
    if (!r.ok) toast(r.error, 'warn')
    else toast('新的一輪冒險開始了！題目會換新的喔', 'ok')
  }

  const pos = (k: number) => ({ ['--x' as string]: `${((points[k][0] - win.x0) / span) * 100}%`, ['--y' as string]: `${points[k][1]}%` })
  // 直向：場景寬度 = 畫面寬度，比例跟著顯示範圍；背景圖放大到只露出這一段
  const sceneStyle = {
    ...(hasScene ? { ['--map-bg' as string]: `url("${bg}")` } : {}),
    ...(portrait
      ? {
          width: '100%',
          ['--g73-span' as string]: span,
          aspectRatio: `${(span * 16) / (100 * 9)}`,
          ...(hasScene ? { backgroundSize: `${10000 / span}% auto`, backgroundPosition: `${span >= 100 ? 0 : (win.x0 / (100 - span)) * 100}% 0` } : {}),
        }
      : {}),
  }

  return (
    <main className={`screen adv adv-map theme-${subject.theme} subject-${subject.id} chapter-${ch.id}`} data-testid="map" data-subject={subject.id} data-chapter={ch.id}>
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

      {chapters.length > 1 && (
        <nav className="adv-chapters" role="tablist" aria-label="章節">
          {chapters.map((c, i) => {
            const open = unlocks ? unlocks[c.id] !== false : !c.unlockAfter
            const p = allProg?.find((x) => x.chapterId === c.id)
            const done = p?.stations.filter((x) => x.done).length ?? 0
            const fresh = !p || (done === 0 && !p.chestClaimed && p.completedRuns === 0)
            const need = c.unlockAfter ? getChapter(c.unlockAfter)?.name : undefined
            return (
              <button
                key={c.id}
                type="button"
                role="tab"
                aria-selected={c.id === ch.id}
                aria-disabled={!open}
                className={`adv-chap ${open && c.id !== ch.id && fresh && c.unlockAfter ? 'new' : ''} ${wobble === `c-${c.id}` ? 'ux-wobble' : ''}`}
                data-testid={`chapter-${c.id}`}
                data-open={open ? 'true' : 'false'}
                onClick={() => (open ? pickChapter(c.id) : nudge(`c-${c.id}`, `${c.name}還沒開，先通關${need ?? '前一章'}喔`))}
              >
                <span className="adv-chap-num" aria-hidden>{open ? i + 1 : <Icon name="ui-lock" emoji="🔒" size={22} />}</span>
                <span>{c.name}</span>
                <small>{open ? `${done}/${c.stations.length}` : '還沒開'}</small>
              </button>
            )
          })}
        </nav>
      )}

      <div className="adv-scroll" ref={scrollRef}>
        <section ref={sceneRef} className={`adv-scene ${hasScene ? 'has-art' : ''} scene-${subject.id} ${tinted ? 'scene-tinted' : ''} ${ownArt ? 'scene-own' : ''}`} style={sceneStyle} data-portrait={portrait ? 'true' : undefined}>
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
                    aria-disabled={state === 'locked'}
                    onClick={() => {
                      if (state === 'current') go({ name: 'stage', chapterId: ch.id, station: s.index })
                      // v7.4 H1：已通關的站可以再玩一次（換新的題目，獎勵固定一份食物）
                      else if (state === 'done') go({ name: 'stage', chapterId: replayChapterId(ch.id), station: s.index })
                      else nudge(`s${s.index}`, '還沒到喔，先去前面的站')
                    }}
                    data-testid={`station-${s.index}`}
                    aria-label={`第 ${s.index} 站 ${pt(s.name)}，${state === 'done' ? '已通關，可以再玩一次' : state === 'current' ? '出發' : '還沒解鎖'}`}
                  >
                    {state === 'locked' ? <Icon name="ui-lock" emoji="🔒" size="52%" /> : state === 'done' ? <span className="adv-check" aria-hidden>✓</span> : <span className="adv-num">{s.index}</span>}
                    {state === 'done' && (
                      <span className="h74-replay-tag" data-testid={`replay-tag-${s.index}`} aria-hidden>
                        <i>↻</i>再玩
                      </span>
                    )}
                  </button>
                  <span className="adv-node-label">
                    {pt(s.name)}
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
      {/* v7.4 J5：提示緊貼在地圖下面（原本在最下面的章節列裡，手機會掉到摺線以下、看不到） */}
      {canScroll && <p className="adv-swipe-hint" data-testid="swipe-hint">左右滑動看整張地圖 ↔</p>}

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

      {!placementDone && (placementStarted || (subjectId === 'math' && placementDue?.subject === subjectId && placementDue.due)) && <Placement onStart={() => setPlacementStarted(true)} onDone={() => setPlacementDone(true)} />}

      <section className="adv-foot-row" aria-label="章節進度">
        <p className="adv-map-hero">
          <b>{ch.subtitle}・{ch.name}</b>
          <span>已通關 {doneCount} / {ch.stations.length} 站{prog.run > 1 ? `（第 ${prog.run} 輪）` : ''}</span>
        </p>
        {/* v7.4 H1：不用鎖頭和「即將開放」（會讓孩子覺得快玩完了），改成溫和的預告：阿悟正在探路 */}
        <div className="adv-upcoming">
          {subject.upcoming.map((c) => (
            <div key={c.id} className="adv-soon h74-soon" data-testid="soon-item">
              <Icon name="ui-map" emoji="🧭" size={30} />
              <b>{c.name}</b>
              <span>{pt('阿悟正在探路')}</span>
            </div>
          ))}
        </div>
        {challenge?.chapter === ch.id && challengeVisible(prog, profile?.ageBand) && (
          <button
            type="button"
            className="q7-challenge"
            data-testid="challenge-go"
            data-badge={challenge.c.badgeAt !== undefined ? 'true' : 'false'}
            onClick={() => go({ name: 'stage', chapterId: challengeChapterId(ch.id), station: 1 })}
          >
            <span className="q7-challenge-icon" aria-hidden>{challenge.c.badgeAt !== undefined ? '🏅' : '⚡'}</span>
            <span className="q7-challenge-text">
              <span>挑戰站</span>
              <small data-testid="challenge-best">{challenge.c.plays > 0 ? `最高連對 ${challenge.c.best} 題` : '連續答對，不給提示'}</small>
            </span>
          </button>
        )}
      </section>
    </main>
  )
}
