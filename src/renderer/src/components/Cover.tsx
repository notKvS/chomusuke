import { useState } from 'react'
import { Icon } from './Icon'

/** Album art with a music-note placeholder while missing or broken. */
export function Cover({ src, size, className = '' }: { src?: string; size?: number; className?: string }) {
  const [failed, setFailed] = useState<string | null>(null)
  const style = size ? { width: size, height: size } : undefined
  const showImage = src && failed !== src

  return (
    <div className={`cover ${className}`} style={style}>
      {showImage ? (
        <img src={src} alt="" draggable={false} onError={() => setFailed(src)} />
      ) : (
        <Icon name="music" size={size ? Math.max(16, size * 0.4) : 64} />
      )}
    </div>
  )
}
