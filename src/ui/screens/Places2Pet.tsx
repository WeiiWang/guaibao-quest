import { Companion, type Pose } from './adventure/Companion'
import './places2.css'

/**
 * v8.2 線 S：站在地方裡的寵物（腳底一塊影子，影子不跟著跳）。
 * iPad 橫向由外層 .pm-ledge 固定在左下角地面；直向與手機跟著內容走，不蓋到卡片（見 places2.css）。
 */
export function Places2Pet({ pose = 'happy', className = '' }: { pose?: Pose; className?: string }) {
  return (
    <span className={`pm-stander ${className}`}>
      <i className="pm-stander-shadow" aria-hidden />
      <Companion pose={pose} size="var(--pm-pet)" />
    </span>
  )
}
