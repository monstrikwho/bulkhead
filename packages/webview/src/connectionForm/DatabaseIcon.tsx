import { BRAND_ICONS } from '../brandIcons'

/**
 * Brand mark of a catalog entry in its brand colour. Very dark marks (e.g. Render's black) take
 * the theme's foreground instead, so they stay visible on dark themes. Entries without a mark
 * get a monogram tile.
 */
export function DatabaseIcon({
  id,
  label,
  size = 28,
}: {
  id: string
  label: string
  size?: number
}) {
  const icon = BRAND_ICONS[id]
  if (!icon) {
    return (
      <span
        className="db-monogram"
        style={{ width: size, height: size, fontSize: size * 0.42 }}
        aria-hidden
      >
        {monogram(label)}
      </span>
    )
  }
  return (
    <svg
      className="db-icon"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      role="img"
      aria-label={icon.title}
      fill={isDark(icon.hex) ? 'currentColor' : `#${icon.hex}`}
    >
      <path d={icon.path} />
    </svg>
  )
}

function monogram(label: string): string {
  const words = label.split(/\s+/).filter((word) => /^[A-Z]/.test(word))
  return (words.length > 1 ? words[0]![0]! + words[1]![0]! : label.slice(0, 2)).toUpperCase()
}

/** Relative luminance below ~0.08: unreadable on a dark editor background. */
function isDark(hex: string): boolean {
  const [r, g, b] = [0, 2, 4].map((offset) => {
    const channel = parseInt(hex.slice(offset, offset + 2), 16) / 255
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b! < 0.08
}
