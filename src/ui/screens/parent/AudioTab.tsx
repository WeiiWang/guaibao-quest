import { repo } from '../../../db/repo'
import { playSfx } from '../../../learning/sfx'
import { isSpeechSupported, speak } from '../../../learning/speech'
import { useLearningSettings } from '../../learningHooks'
import './learning.css'

function Switch({ label, desc, on, onChange, testId }: { label: string; desc: string; on: boolean; onChange: (v: boolean) => void; testId: string }) {
  return (
    <div className="lt-switch-row">
      <div>
        <b>{label}</b>
        <p className="lt-note">{desc}</p>
      </div>
      <button role="switch" aria-checked={on} aria-label={label} className={`lt-switch ${on ? 'on' : ''}`} onClick={() => onChange(!on)} data-testid={testId}>
        <i />
        <span>{on ? '開' : '關'}</span>
      </button>
    </div>
  )
}

/** 音效 / 語音開關 */
export function AudioTab() {
  const { soundOn, voiceOn } = useLearningSettings()
  const supported = isSpeechSupported()
  return (
    <section className="lt" data-testid="audio-tab">
      <div className="card">
        <h2>音效與語音</h2>
        <Switch label="音效" desc="答對、答錯、獲得獎勵時的聲音。" on={soundOn} testId="sound-switch" onChange={(v) => void repo.setLearningSettings({ soundOn: v })} />
        <Switch label="語音唸題" desc="用國語唸出題目與提示。關閉後只顯示字幕。" on={voiceOn} testId="voice-switch" onChange={(v) => void repo.setLearningSettings({ voiceOn: v })} />
        {!supported && <p className="form-msg warn">這個裝置的瀏覽器不支援語音，題目只會顯示字幕。</p>}
        <div className="row-actions" style={{ justifyContent: 'flex-start' }}>
          <button className="btn" onClick={() => playSfx('correct', true)}>試聽音效</button>
          <button className="btn" disabled={!supported} onClick={() => speak('數一數，有幾根香蕉？', { enabled: true })}>試聽語音</button>
        </div>
      </div>
    </section>
  )
}
