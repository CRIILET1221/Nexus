/** Знак NexAtom: атом с блоком в центре (тот же рисунок, что и иконка приложения) */
export function AtomMark({ size = 16, color = '#04140d' }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="-256 -256 512 512" aria-hidden="true">
      <g fill="none" stroke={color} strokeWidth={30} strokeLinecap="round">
        <ellipse rx="190" ry="72" transform="rotate(-32)" />
        <ellipse rx="190" ry="72" transform="rotate(32)" />
      </g>
      <polygon points="0,-74 64,-37 0,0 -64,-37" fill={color} />
      <polygon points="-64,-37 0,0 0,74 -64,37" fill={color} opacity={0.78} />
      <polygon points="64,-37 0,0 0,74 64,37" fill={color} opacity={0.9} />
      <rect x="-24" y="-24" width="48" height="48" rx="8" fill={color} transform="rotate(-32) translate(109 -59) rotate(32)" />
      <rect x="-24" y="-24" width="48" height="48" rx="8" fill={color} transform="rotate(32) translate(-109 59) rotate(-32)" />
    </svg>
  )
}
