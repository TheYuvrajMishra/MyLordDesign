import { useState, type FormEvent } from 'react'

type ChatInputProps = {
  disabled?: boolean
  onSend: (text: string) => Promise<void> | void
}

function ChatInput({ disabled = false, onSend }: ChatInputProps) {
  const [text, setText] = useState('')

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const trimmed = text.trim()
    if (!trimmed || disabled) {
      return
    }

    setText('')
    await onSend(trimmed)
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex items-end gap-2 rounded-2xl border border-zinc-200 bg-white/95 p-2 shadow-sm dark:border-zinc-700 dark:bg-zinc-900/90"
    >
      <textarea
        value={text}
        onChange={(event) => setText(event.target.value)}
        rows={1}
        placeholder="Enter a website URL (example.com) for a full design audit..."
        className="max-h-28 min-h-10 flex-1 resize-y border-0 bg-transparent px-2 py-2 text-sm text-zinc-700 outline-none placeholder:text-zinc-400 dark:text-zinc-200"
      />
      <button
        type="submit"
        disabled={disabled || text.trim().length === 0}
        className="rounded-xl bg-zinc-900 px-4 py-2 text-sm font-semibold text-zinc-50 transition hover:bg-black disabled:cursor-not-allowed disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
      >
        Send
      </button>
    </form>
  )
}

export default ChatInput
