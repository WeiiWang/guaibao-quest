import type { ReactNode } from 'react'

interface Props {
  title: string
  children: ReactNode
  onClose?: () => void
}

export function Modal({ title, children, onClose }: Props) {
  return (
    <div className="modal-back" onClick={onClose} role="presentation">
      <div className="modal" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <h2>{title}</h2>
        {children}
      </div>
    </div>
  )
}
