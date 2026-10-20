'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { AlertCircle, ArrowLeft, Loader2 } from 'lucide-react'

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import {
  useAnswerQuizQuestion,
  useFinishQuizAttempt,
  useStartQuizAttempt,
} from '@/lib/hooks/use-quizzes'
import { useTranslation } from '@/lib/hooks/use-translation'
import { QuizAnswerResult, QuizAttemptMode, QuizFinishResult } from '@/lib/types/quiz'
import { getApiErrorMessage } from '@/lib/utils/error-handler'

import { QuizQuestionView } from './QuizQuestionView'
import { QuizResultView } from './QuizResultView'

interface QuizPlayerProps {
  quizId: string
  mode: QuizAttemptMode
  /** Start over, in the same or the other mode (the parent remounts the player). */
  onRestart: (mode: QuizAttemptMode) => void
}

function BackLink() {
  const { t } = useTranslation()
  return (
    <Button asChild variant="ghost" size="sm" className="-ml-3">
      <Link href="/quiz">
        <ArrowLeft className="mr-2 h-4 w-4" />
        {t('quiz.backToQuizzes')}
      </Link>
    </Button>
  )
}

export function QuizPlayer({ quizId, mode, onRestart }: QuizPlayerProps) {
  const { t } = useTranslation()
  const startAttempt = useStartQuizAttempt()
  const answerQuestion = useAnswerQuizQuestion()
  const finishAttempt = useFinishQuizAttempt()

  const [index, setIndex] = useState(0)
  const [selected, setSelected] = useState<string[]>([])
  const [result, setResult] = useState<QuizAnswerResult | null>(null)
  const [finished, setFinished] = useState<QuizFinishResult | null>(null)

  // One attempt per mounted player, even when React runs the effect twice in
  // development. Restarting remounts the player (see the page's `key`).
  const startedRef = useRef(false)
  useEffect(() => {
    if (startedRef.current) return
    startedRef.current = true
    startAttempt.mutate({ quizId, mode })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const attempt = startAttempt.data

  if (startAttempt.isError) {
    return (
      <div className="space-y-4">
        <BackLink />
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>{t('quiz.attemptFailed')}</AlertTitle>
          <AlertDescription>
            {getApiErrorMessage(startAttempt.error, (key) => t(key), 'common.error')}
          </AlertDescription>
        </Alert>
      </div>
    )
  }

  if (!attempt) {
    return (
      <div className="flex items-center gap-3 p-6 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        {t('quiz.preparing')}
      </div>
    )
  }

  if (finished) {
    return <QuizResultView result={finished} onRestart={onRestart} />
  }

  const question = attempt.questions[index]
  const isLast = index === attempt.questions.length - 1
  const busy = answerQuestion.isPending || finishAttempt.isPending

  const handleCheck = () => {
    answerQuestion.mutate(
      {
        attemptId: attempt.id,
        payload: { question_id: question.id, selected_option_ids: selected },
      },
      { onSuccess: setResult }
    )
  }

  const handleNext = () => {
    if (isLast) {
      finishAttempt.mutate(attempt.id, { onSuccess: setFinished })
      return
    }
    setIndex(index + 1)
    setSelected([])
    setResult(null)
  }

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <BackLink />
          {attempt.mode === 'retry_wrong' ? (
            <Badge variant="outline">{t('quiz.retryMode')}</Badge>
          ) : null}
        </div>
        <div className="space-y-1.5">
          <p className="text-sm text-muted-foreground">
            {t('quiz.questionOf', { current: index + 1, total: attempt.total })}
          </p>
          <Progress value={Math.round((100 * (index + (result ? 1 : 0))) / attempt.total)} />
        </div>
      </div>

      {/* keyed so every question starts with fresh inputs */}
      <QuizQuestionView
        key={question.id}
        question={question}
        selected={selected}
        onChange={setSelected}
        result={result}
      />

      <div className="flex justify-end">
        {result ? (
          <Button onClick={handleNext} disabled={busy}>
            {finishAttempt.isPending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                {t('quiz.finishing')}
              </>
            ) : isLast ? (
              t('quiz.finishQuiz')
            ) : (
              t('quiz.nextQuestion')
            )}
          </Button>
        ) : (
          <Button onClick={handleCheck} disabled={selected.length === 0 || busy}>
            {answerQuestion.isPending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                {t('quiz.checking')}
              </>
            ) : (
              t('quiz.checkAnswer')
            )}
          </Button>
        )}
      </div>
    </div>
  )
}
