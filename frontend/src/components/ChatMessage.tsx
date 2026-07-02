import AuditReportCard from './AuditReportCard'
import { type DesignAuditReport } from '../services/reportTypes'

type ProgressEvent = {
  message: string
  progress: number
  at: string
}

export type ChatMessageItem = {
  id: string
  role: 'user' | 'assistant'
  text: string
  report?: DesignAuditReport
  isLoading?: boolean
  progress?: {
    percent: number
    currentStep: string
    logs: ProgressEvent[]
  }
}

type ChatMessageProps = {
  message: ChatMessageItem
}

function ChatMessage({ message }: ChatMessageProps) {
  const isUser = message.role === 'user'

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-relaxed shadow-sm md:max-w-[72%] ${
          isUser
            ? 'bg-zinc-900 text-zinc-100 dark:bg-zinc-100 dark:text-zinc-900'
            : 'border border-zinc-200 bg-white text-zinc-700 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200'
        }`}
      >
        <p>{message.text}</p>
        {message.progress && (
          <div className="mt-3 space-y-2 rounded-xl border border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-700 dark:bg-zinc-900">
            <div className="flex items-center justify-between text-xs font-semibold text-zinc-600 dark:text-zinc-300">
              <span>{message.progress.currentStep}</span>
              <span>{message.progress.percent}%</span>
            </div>
            <div className="h-2 rounded-full bg-zinc-200 dark:bg-zinc-700">
              <div
                className="h-2 rounded-full bg-zinc-900 transition-all dark:bg-zinc-100"
                style={{ width: `${message.progress.percent}%` }}
              />
            </div>
            <ul className="max-h-36 space-y-1 overflow-y-auto pr-1 text-xs text-zinc-500 dark:text-zinc-400">
              {message.progress.logs.slice(-6).map((item) => (
                <li key={`${item.at}-${item.message}`}>• {item.message}</li>
              ))}
            </ul>
            {message.isLoading && (
              <p className="text-xs font-medium text-zinc-500 dark:text-zinc-400">Audit in progress...</p>
            )}
          </div>
        )}
        {message.report && (
          <div className="mt-3 max-w-[min(980px,88vw)]">
            <AuditReportCard report={message.report} />
          </div>
        )}
      </div>
    </div>
  )
}

export default ChatMessage
