import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import type { AgeBand } from '../domain/types'
import { AGE_BANDS, AGE_LABEL } from '../learning/profile'
import { DEFAULT_SPECIES, speciesName, speciesOf, type Species } from '../domain/species'
import { SpeciesPicker } from '../ui/components/SpeciesPicker'
import { Modal } from '../ui/components/Modal'
import { PinPad } from '../ui/components/PinPad'
import { useToast } from '../ui/hooks'
import { useProfiles } from './context'
import { profiles } from './manager'
import { registry, type ChildProfile } from './registry'
import '../ui/screens/parent/learning.css'
import './profiles.css'

function AgeChoices({ value, onChange }: { value: AgeBand | undefined; onChange: (b: AgeBand) => void }) {
  return (
    <div className="lt-choices" role="radiogroup" aria-label="孩子的年齡">
      {AGE_BANDS.map((b) => (
        <button
          key={b}
          type="button"
          role="radio"
          aria-checked={value === b}
          className={`lt-choice ${value === b ? 'on' : ''}`}
          data-testid={`child-age-${b}`}
          onClick={() => onChange(b)}
        >
          {AGE_LABEL[b]}
        </button>
      ))}
    </div>
  )
}

/** 家長設定裡的「孩子們」：新增、改名與年齡、刪除（要 PIN） */
export function ChildrenManager() {
  const toast = useToast()
  const ctx = useProfiles()
  const list = useLiveQuery(() => registry.list(), [])
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState<ChildProfile | null>(null)
  const [deleting, setDeleting] = useState<ChildProfile | null>(null)
  // v7.5：要刪掉的孩子養的是哪一隻（刪除警告寫寵物的名字）
  const deletingSpecies = useLiveQuery(async () => (deleting ? speciesOf(await profiles.deps.openDb(deleting.dbName).pets.get('pet')) : DEFAULT_SPECIES), [deleting?.dbName])

  const [name, setName] = useState('')
  const [age, setAge] = useState<AgeBand | undefined>(undefined)
  const [species, setSpecies] = useState<Species>(DEFAULT_SPECIES)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  const openAdd = () => {
    setName('')
    setAge(undefined)
    setSpecies(DEFAULT_SPECIES)
    setErr('')
    setAdding(true)
  }
  const openEdit = (c: ChildProfile) => {
    setName(c.name)
    setAge(c.ageBand)
    setErr('')
    setEditing(c)
  }

  const submitAdd = async () => {
    setBusy(true)
    const r = await profiles.addChild({ name, ageBand: age, species })
    setBusy(false)
    if (!r.ok) return setErr(r.error)
    setAdding(false)
    toast(`已新增 ${r.child.name}`, 'ok')
  }

  const submitEdit = async () => {
    if (!editing) return
    setBusy(true)
    const r1 = await profiles.renameChild(editing.id, name)
    const r2 = age && age !== editing.ageBand ? await profiles.setChildAge(editing.id, age) : r1
    setBusy(false)
    if (!r1.ok) return setErr(r1.error)
    if (!r2.ok) return setErr(r2.error)
    setEditing(null)
    toast('已儲存', 'ok')
  }

  if (!list) return null
  const onlyOne = list.length <= 1
  const deletingPet = speciesName(deletingSpecies)

  return (
    <div className="card" data-testid="children-card">
      <h2>孩子們</h2>
      <p className="lt-text">每個孩子有自己的寵物、房間、星星和學習進度；家長 PIN 全家共用。</p>
      <ul className="kid-list">
        {list.map((c) => (
          <li key={c.id} className="kid-row" data-testid="kid-row" data-child-id={c.id}>
            <span className="kid-avatar" aria-hidden>{c.avatar}</span>
            <span className="kid-info">
              <b>{c.name}</b>
              <small>
                {c.ageBand ? AGE_LABEL[c.ageBand] : '年齡未設定'}
                {ctx?.activeId === c.id && ' · 目前這台正在玩'}
              </small>
            </span>
            <button className="btn" data-testid="kid-edit" onClick={() => openEdit(c)}>
              改名/年齡
            </button>
            <button className="btn danger" data-testid="kid-delete" disabled={onlyOne} title={onlyOne ? '至少要留一個孩子' : undefined} onClick={() => setDeleting(c)}>
              刪除
            </button>
          </li>
        ))}
      </ul>
      {onlyOne && <p className="lt-note">目前只有一個孩子，不能刪除。</p>}
      <p className="lt-note" data-testid="age-hint">年齡決定學習從哪裡開始（3 歲是幼幼模式）；已經玩過的技能不會被改動。要改年齡，按該孩子的「改名/年齡」。</p>
      <button className="btn primary" data-testid="kid-add" onClick={openAdd}>
        新增孩子
      </button>

      {adding && (
        <Modal title="新增孩子" onClose={() => setAdding(false)}>
          <form
            className="form"
            onSubmit={(e) => {
              e.preventDefault()
              void submitAdd()
            }}
          >
            <label className="field">
              孩子的名字
              <input className="input" data-testid="kid-name" autoFocus value={name} maxLength={10} onChange={(e) => setName(e.target.value)} />
            </label>
            <div className="field">
              年齡
              <AgeChoices value={age} onChange={setAge} />
            </div>
            {/* v7.5：新孩子選寵物（阿悟、兔兔、虎虎，名字固定）；建立之後不能換，所以「改名/年齡」裡沒有這一項 */}
            <div className="field">
              寵物（建立後不能換）
              <SpeciesPicker value={species} onChange={setSpecies} compact />
            </div>
            {err && <p className="form-msg warn" role="alert">{err}</p>}
            <button className="btn primary" type="submit" data-testid="kid-add-submit" disabled={busy || !name.trim()}>
              新增
            </button>
            <button className="btn" type="button" onClick={() => setAdding(false)}>
              取消
            </button>
          </form>
        </Modal>
      )}

      {editing && (
        <Modal title={`修改 ${editing.name}`} onClose={() => setEditing(null)}>
          <form
            className="form"
            onSubmit={(e) => {
              e.preventDefault()
              void submitEdit()
            }}
          >
            <label className="field">
              孩子的名字
              <input className="input" data-testid="kid-name" autoFocus value={name} maxLength={10} onChange={(e) => setName(e.target.value)} />
            </label>
            <div className="field">
              年齡
              <AgeChoices value={age} onChange={setAge} />
            </div>
            {err && <p className="form-msg warn" role="alert">{err}</p>}
            <button className="btn primary" type="submit" data-testid="kid-edit-submit" disabled={busy || !name.trim()}>
              儲存
            </button>
            <button className="btn" type="button" onClick={() => setEditing(null)}>
              取消
            </button>
          </form>
        </Modal>
      )}

      {deleting && (
        <Modal title={`刪除 ${deleting.name}？`} onClose={() => setDeleting(null)}>
          <p className="kid-warn" data-testid="kid-delete-warning">
            這個孩子的{deletingPet}和進度都會刪掉，無法復原。
          </p>
          <PinPad
            label="輸入家長 PIN 確認刪除"
            onComplete={async (pin) => {
              const target = deleting
              const r = await profiles.removeChild(target.id, pin, {
                // 刪除「目前正在玩的孩子」：先讓畫面離開他的資料庫，再刪
                beforeDelete: ctx?.activeId === target.id ? ctx.leave : undefined,
              })
              if (!r.ok) return r.error
              setDeleting(null)
              toast(`已刪除 ${target.name}`, 'ok')
            }}
          />
          <button className="btn" onClick={() => setDeleting(null)}>
            取消
          </button>
        </Modal>
      )}
    </div>
  )
}
