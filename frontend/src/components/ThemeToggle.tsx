type ThemeToggleProps = {
  isDark: boolean
  onToggle: () => void
}

function ThemeToggle({ isDark, onToggle }: ThemeToggleProps) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="rounded-xl border border-zinc-300/70 bg-white/80 px-3 py-2 text-xs font-semibold tracking-wide text-zinc-700 shadow-sm backdrop-blur transition hover:bg-white dark:border-zinc-700 dark:bg-zinc-900/80 dark:text-zinc-200"
      aria-label="Toggle color theme"
    >
      {isDark ? 'Light' : 'Dark'} mode
    </button>
  )
}

export default ThemeToggle
