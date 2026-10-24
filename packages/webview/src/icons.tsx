/** Small line icons shared by the webviews, 16×16, using the current text colour. */
const PATHS = {
  search: 'M7 2.5a4.5 4.5 0 1 0 0 9 4.5 4.5 0 0 0 0-9ZM10.3 10.3 14 14',
  back: 'M13.5 8h-11M6.5 4 2.5 8l4 4',
  eye: 'M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8ZM8 10a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z',
  eyeOff:
    'M2 2l12 12M6.6 3.7A6.8 6.8 0 0 1 8 3.5c4 0 6.5 4.5 6.5 4.5a11 11 0 0 1-1.9 2.4M4.2 4.9A11 11 0 0 0 1.5 8S4 12.5 8 12.5a6.4 6.4 0 0 0 3-.8M6.6 6.6a2 2 0 0 0 2.8 2.8',
  refresh:
    'M13.5 3v3.5H10M2.5 13V9.5H6M3.3 6a5 5 0 0 1 9-1.2l1.2 1.7M12.7 10a5 5 0 0 1-9 1.2L2.5 9.5',
  plug: 'M5.5 1.5v3M10.5 1.5v3M3.5 4.5h9v2.5a4.5 4.5 0 0 1-9 0V4.5ZM8 11.5v3',
  link: 'M6.5 9.5l3-3M7 4.5l1-1a2.8 2.8 0 0 1 4 4l-1 1M9 11.5l-1 1a2.8 2.8 0 0 1-4-4l1-1',
  lock: 'M4 7.5h8v6.5H4zM5.5 7.5V5a2.5 2.5 0 0 1 5 0v2.5',
  check: 'M3 8.5l3 3 7-7',
  error: 'M8 1.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13ZM8 4.5v4.5M8 11v.5',
  chevron: 'M6 3.5 10.5 8 6 12.5',
  shield: 'M8 1.5l5.5 2v4c0 3.5-2.5 6-5.5 7-3-1-5.5-3.5-5.5-7v-4l5.5-2Z',
  gear: 'M8 5.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5ZM8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M3.4 12.6l1.4-1.4M11.2 4.8l1.4-1.4',
  plus: 'M8 3v10M3 8h10',
  newFile:
    'M9 1.5H4a1 1 0 0 0-1 1v11a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V5.5l-4-4ZM9 1.5v4h4M8 8v4M6 10h4',
  folder: 'M1.5 4a1 1 0 0 1 1-1h3.5l1.5 1.5h6a1 1 0 0 1 1 1V12a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1V4Z',
  sparkle: 'M8 1.5 9.4 6.6 14.5 8 9.4 9.4 8 14.5 6.6 9.4 1.5 8 6.6 6.6 8 1.5Z',
  book: 'M2 3h4a2 2 0 0 1 2 2v8.5A1.5 1.5 0 0 0 6.5 12H2V3ZM14 3h-4a2 2 0 0 0-2 2v8.5A1.5 1.5 0 0 1 9.5 12H14V3Z',
  bug: 'M5.5 5.5a2.5 2.5 0 0 1 5 0M4.5 6.5h7v3a3.5 3.5 0 0 1-7 0v-3ZM8 6.5v6.5M4.5 9H2M11.5 9H14M3 5l1.5 1.5M13 5l-1.5 1.5M3 13l1.7-1.5M13 13l-1.7-1.5',
  star: 'M8 1.8l1.9 3.9 4.3.6-3.1 3 .7 4.3L8 11.6l-3.8 2 .7-4.3-3.1-3 4.3-.6L8 1.8Z',
} as const

export type IconName = keyof typeof PATHS

export function Icon({
  name,
  size = 16,
  className,
}: {
  name: IconName
  size?: number
  className?: string
}) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d={PATHS[name]} />
    </svg>
  )
}
