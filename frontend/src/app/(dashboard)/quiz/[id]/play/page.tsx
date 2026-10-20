'use client'

import { useState } from 'react'
import { useParams, useRouter, useSearchParams } from 'next/navigation'

import { AppShell } from '@/components/layout/AppShell'
import { QuizPlayer } from '@/components/quiz/QuizPlayer'
import { QuizAttemptMode } from '@/lib/types/quiz'

function parseMode(value: string | null): QuizAttemptMode {
  return value === 'retry_wrong' ? 'retry_wrong' : 'full'
}

export default function QuizPlayPage() {
  const params = useParams()
  const router = useRouter()
  const searchParams = useSearchParams()

  const quizId = params?.id ? decodeURIComponent(params.id as string) : ''
  const [mode, setMode] = useState<QuizAttemptMode>(parseMode(searchParams.get('mode')))
  // Bumped on every restart so the player remounts and starts a new attempt,
  // also when the mode doesn't change ("start over").
  const [run, setRun] = useState(0)

  const handleRestart = (nextMode: QuizAttemptMode) => {
    setMode(nextMode)
    setRun((current) => current + 1)
    router.replace(`/quiz/${encodeURIComponent(quizId)}/play?mode=${nextMode}`)
  }

  return (
    <AppShell>
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-2xl px-6 py-6">
          <QuizPlayer
            key={`${quizId}-${mode}-${run}`}
            quizId={quizId}
            mode={mode}
            onRestart={handleRestart}
          />
        </div>
      </div>
    </AppShell>
  )
}
