import { HATS } from '../../domain/hats'
import { HAT_POSES, HAT_STAGES } from '../../art/hats'
import { PetSprite, type PetPose } from '../components/PetSprite'
import { speciesKind, speciesName, type Species } from '../../domain/species'
import '../wardrobe.css'

/**
 * 開發用：#hatpreview（#hatpreview/crown 指定帽子；v7.5 #hatpreview/crown/rabbit 指定物種，量好兔兔、虎虎的錨點後用來目視檢查）。每個階段 × 每個姿勢各一格，全部戴同一頂帽子，
 * 用來目視檢查「頭頂錨點表」（art/hats.ts）有沒有對準。
 */
export function HatPreview({ hat, species = 'monkey' }: { hat: string; species?: Species }) {
  return (
    <main className="wd-preview" data-testid="hat-preview" data-species={species}>
      <h1>
        帽子錨點檢查：{HATS.find((h) => h.id === hat)?.name ?? hat}（{speciesName(species)}）
      </h1>
      {HAT_STAGES.map((stage) => (
        <section key={stage}>
          <h2>{`${stage === 'baby' ? '幼' : '成'}${speciesKind(species)}`}</h2>
          <ul>
            {HAT_POSES.map((pose) => (
              <li key={pose} data-pose={`${stage}-${pose}`}>
                <div className="wd-preview-box">
                  <PetSprite pet={{ stage, feedCount: 30, name: speciesName(species), species }} mood="happy" pose={pose as PetPose} hat={hat} />
                </div>
                <span>{pose}</span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </main>
  )
}
