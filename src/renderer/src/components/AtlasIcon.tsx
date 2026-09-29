import type { CSSProperties } from 'react'

interface AtlasIconProps {
  iconId: number
  size?: number
  className?: string
  title?: string
}

export function AtlasIcon({
  iconId,
  size = 32,
  className = '',
  title
}: AtlasIconProps): React.JSX.Element {
  const tileSize = 32
  const scale = size / tileSize
  const x = (iconId % 256) * tileSize
  const y = Math.floor(iconId / 256) * tileSize
  const style: CSSProperties = {
    width: size,
    height: size,
    backgroundImage: 'url("gtnh-data://current/atlas.webp")',
    backgroundPosition: `${-x * scale}px ${-y * scale}px`,
    backgroundSize: `${256 * tileSize * scale}px auto`,
    imageRendering: 'pixelated'
  }

  return (
    <span
      className={`atlas-icon ${className}`}
      style={style}
      title={title}
      aria-hidden={title ? undefined : true}
    />
  )
}
