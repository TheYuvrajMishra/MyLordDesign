import { useEffect, useMemo, useState } from 'react'
import ChatInput from '../components/ChatInput'
import ChatMessage, { type ChatMessageItem } from '../components/ChatMessage'
import ThemeToggle from '../components/ThemeToggle'
import { getDesignAuditJob, sendChatMessage, startDesignAudit } from '../services/chatApi'

const THEME_KEY = 'ui-theme'

const initialMessages: ChatMessageItem[] = [
  {
    id: 'welcome-1',
    role: 'assistant',
    text: 'Paste a website URL to generate a screenshot-rich UI/UX design audit report.',
  },
]

function ChatPage() {
  const [messages, setMessages] = useState<ChatMessageItem[]>(initialMessages)
  const [isLoading, setIsLoading] = useState(false)
  const [isDark, setIsDark] = useState<boolean>(() => {
    const savedTheme = localStorage.getItem(THEME_KEY)
    if (savedTheme) {
      return savedTheme === 'dark'
    }
    return window.matchMedia('(prefers-color-scheme: dark)').matches
  })

  useEffect(() => {
    document.documentElement.classList.toggle('dark', isDark)
    localStorage.setItem(THEME_KEY, isDark ? 'dark' : 'light')
  }, [isDark])

  const headerLabel = useMemo(() => {
    return isLoading ? 'Thinking...' : 'Online'
  }, [isLoading])

  const handleSend = async (text: string) => {
    const userMessage: ChatMessageItem = {
      id: crypto.randomUUID(),
      role: 'user',
      text,
    }

    setMessages((prev) => [...prev, userMessage])
    setIsLoading(true)

    try {
      if (looksLikeAuditUrl(text)) {
        const starting = await startDesignAudit(text)
        const progressMessageId = crypto.randomUUID()

        setMessages((prev) => [
          ...prev,
          {
            id: progressMessageId,
            role: 'assistant',
            text: starting.reply,
            isLoading: true,
            progress: {
              percent: 0,
              currentStep: 'Queued',
              logs: [],
            },
          },
        ])

        await waitForAuditCompletion(starting.jobId, (state) => {
          setMessages((prev) =>
            prev.map((item) => {
              if (item.id !== progressMessageId) {
                return item
              }

              return {
                ...item,
                text: state.status === 'completed'
                  ? 'Design audit completed. Here is your full report.'
                  : state.status === 'failed'
                    ? `Audit failed: ${state.error || 'Unknown error'}`
                    : 'Website audit running. Live backend progress below.',
                isLoading: state.status === 'queued' || state.status === 'running',
                report: state.status === 'completed' ? state.report ?? undefined : undefined,
                progress: {
                  percent: state.progress,
                  currentStep: state.currentStep,
                  logs: state.logs,
                },
              }
            }),
          )
        })

        return
      }

      const data = await sendChatMessage(text)

      if (data.mode === 'audit-started' && data.jobId) {
        const progressMessageId = crypto.randomUUID()

        setMessages((prev) => [
          ...prev,
          {
            id: progressMessageId,
            role: 'assistant',
            text: data.reply,
            isLoading: true,
            progress: {
              percent: 0,
              currentStep: 'Queued',
              logs: [],
            },
          },
        ])

        await waitForAuditCompletion(data.jobId, (state) => {
          setMessages((prev) =>
            prev.map((item) => {
              if (item.id !== progressMessageId) {
                return item
              }

              return {
                ...item,
                text: state.status === 'completed'
                  ? 'Design audit completed. Here is your full report.'
                  : state.status === 'failed'
                    ? `Audit failed: ${state.error || 'Unknown error'}`
                    : 'Website audit running. Live backend progress below.',
                isLoading: state.status === 'queued' || state.status === 'running',
                report: state.status === 'completed' ? state.report ?? undefined : undefined,
                progress: {
                  percent: state.progress,
                  currentStep: state.currentStep,
                  logs: state.logs,
                },
              }
            }),
          )
        })

        return
      }

      setMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: 'assistant',
          text: data.reply,
          report: data.report,
        },
      ])
    } catch {
      setMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: 'assistant',
          text: 'Unable to reach backend. Start backend server and retry.',
        },
      ])
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-linear-to-b from-zinc-100 via-zinc-100 to-zinc-200 px-3 py-4 text-zinc-800 transition-colors dark:from-zinc-950 dark:via-zinc-900 dark:to-zinc-950 dark:text-zinc-100 md:px-6 md:py-8">
      <div className="mx-auto flex h-[calc(100vh-2rem)] w-full max-w-5xl flex-col rounded-3xl border border-zinc-300/70 bg-white/75 shadow-2xl shadow-zinc-400/15 backdrop-blur-xl dark:border-zinc-700/80 dark:bg-zinc-900/70 dark:shadow-black/30 md:h-[calc(100vh-4rem)]">
        <header className="flex items-center justify-between border-b border-zinc-200 px-4 py-3 dark:border-zinc-700 md:px-6">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500 dark:text-zinc-400">Chat Layout</p>
            <h1 className="text-lg font-bold tracking-tight md:text-xl">MyLord Console</h1>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">{headerLabel}</p>
          </div>
          <ThemeToggle isDark={isDark} onToggle={() => setIsDark((prev) => !prev)} />
        </header>

        <main className="flex-1 space-y-3 overflow-y-auto px-4 py-4 md:px-6 md:py-5">
          {messages.map((message) => (
            <ChatMessage key={message.id} message={message} />
          ))}
        </main>

        <div className="border-t border-zinc-200 p-3 dark:border-zinc-700 md:p-4">
          <ChatInput disabled={isLoading} onSend={handleSend} />
        </div>
      </div>
    </div>
  )
}

export default ChatPage

function looksLikeAuditUrl(value: string) {
  const input = value.trim()
  if (!input) {
    return false
  }

  return /^https?:\/\//i.test(input) || /^[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}(\/.*)?$/i.test(input)
}

async function waitForAuditCompletion(
  jobId: string,
  onUpdate: (state: {
    status: 'queued' | 'running' | 'completed' | 'failed'
    progress: number
    currentStep: string
    logs: Array<{ message: string; progress: number; at: string }>
    report: ChatMessageItem['report'] | null
    error: string | null
  }) => void,
) {
  const maxAttempts = 300

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const state = await getDesignAuditJob(jobId)
    onUpdate(state)

    if (state.status === 'completed' || state.status === 'failed') {
      return
    }

    await new Promise((resolve) => setTimeout(resolve, 900))
  }

  onUpdate({
    status: 'failed',
    progress: 100,
    currentStep: 'Timeout',
    logs: [],
    report: null,
    error: 'Audit polling timed out. Please retry.',
  })
}
