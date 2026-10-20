'use client'

import Link from 'next/link'
import { formatDistanceToNow } from 'date-fns'
import { AlertCircle, Loader2, Play, RotateCcw, Trash2 } from 'lucide-react'
import { useState } from 'react'

import { ConfirmDialog } from '@/components/common/ConfirmDialog'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { useTranslation } from '@/lib/hooks/use-translation'
import { Quiz } from '@/lib/types/quiz'
import { getDateLocale } from '@/lib/utils/date-locale'

interface QuizCardProps {
  quiz: Quiz
  /** Name of the notebook the quiz was made from, when it still exists */
  notebookName?: string
  onDelete: (quizId: string) => void
  deleting?: boolean
}

export function quizPlayHref(quizId: string, mode: 'full' | 'retry_wrong') {
  return `/quiz/${encodeURIComponent(quizId)}/play?mode=${mode}`
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-0.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="font-mono text-sm text-foreground">{value}</dd>
    </div>
  )
}

export function QuizCard({ quiz, notebookName, onDelete, deleting }: QuizCardProps) {
  const { t, language } = useTranslation()
  const [confirmOpen, setConfirmOpen] = useState(false)
  const { stats } = quiz

  const created = quiz.created
    ? formatDistanceToNow(new Date(quiz.created), {
        addSuffix: true,
        locale: getDateLocale(language),
      })
    : null

  const requested = quiz.settings?.num_questions
  const generated = quiz.settings?.generated_questions
  const fewerThanRequested =
    quiz.status === 'ready' &&
    requested !== undefined &&
    generated !== undefined &&
    generated < requested

  const masteredPct = stats.question_count
    ? Math.round((100 * stats.mastered_count) / stats.question_count)
    : 0
  const practiced = stats.attempt_count > 0
  const percent = (value: number | null) => (value === null ? '–' : `${value}%`)

  return (
    <Card className="gap-0 py-0">
      <CardContent className="flex h-full flex-col gap-4 p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 space-y-0.5">
            <h3 className="truncate font-display text-lg font-semibold tracking-tight">
              {quiz.name}
            </h3>
            <p className="truncate text-xs text-muted-foreground">
              {[
                quiz.status === 'ready'
                  ? t('quiz.questionsCount', { count: stats.question_count })
                  : null,
                notebookName,
                created,
              ]
                .filter(Boolean)
                .join(' · ')}
            </p>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="shrink-0 text-muted-foreground hover:text-destructive"
            aria-label={t('quiz.deleteQuiz')}
            onClick={() => setConfirmOpen(true)}
            disabled={deleting}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>

        {quiz.status === 'generating' ? (
          <Badge variant="outline" className="gap-1.5 self-start">
            <Loader2 className="h-3 w-3 animate-spin" />
            {t('quiz.statusGenerating')}
          </Badge>
        ) : null}

        {quiz.status === 'failed' ? (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              <span className="font-medium">{t('quiz.statusFailed')}</span>
              {quiz.error ? <span className="block">{quiz.error}</span> : null}
            </AlertDescription>
          </Alert>
        ) : null}

        {quiz.status === 'ready' ? (
          <>
            <div className="space-y-2">
              <Progress
                value={masteredPct}
                aria-label={t('quiz.progressLabel', {
                  mastered: stats.mastered_count,
                  total: stats.question_count,
                })}
              />
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                <span>
                  {t('quiz.progressLabel', {
                    mastered: stats.mastered_count,
                    total: stats.question_count,
                  })}
                </span>
                {stats.wrong_count > 0 ? (
                  <Badge variant="destructive">
                    {t('quiz.wrongToRepeat', { count: stats.wrong_count })}
                  </Badge>
                ) : null}
              </div>
            </div>

            {practiced ? (
              <dl className="grid grid-cols-3 gap-3">
                <Stat label={t('quiz.attempts')} value={String(stats.attempt_count)} />
                <Stat label={t('quiz.lastScore')} value={percent(stats.last_score_pct)} />
                <Stat label={t('quiz.bestScore')} value={percent(stats.best_score_pct)} />
              </dl>
            ) : (
              <p className="text-sm text-muted-foreground">{t('quiz.notPracticed')}</p>
            )}

            {fewerThanRequested ? (
              <p className="text-xs text-muted-foreground">
                {t('quiz.fewerQuestions', { generated, requested })}
              </p>
            ) : null}

            <div className="mt-auto flex flex-wrap gap-2 pt-1">
              <Button asChild>
                <Link href={quizPlayHref(quiz.id, 'full')}>
                  <Play className="mr-2 h-4 w-4" />
                  {t('quiz.startQuiz')}
                </Link>
              </Button>
              {stats.wrong_count > 0 ? (
                <Button asChild variant="outline">
                  <Link href={quizPlayHref(quiz.id, 'retry_wrong')}>
                    <RotateCcw className="mr-2 h-4 w-4" />
                    {t('quiz.repeatWrong')}
                  </Link>
                </Button>
              ) : (
                <Button variant="outline" disabled>
                  <RotateCcw className="mr-2 h-4 w-4" />
                  {t('quiz.repeatWrong')}
                </Button>
              )}
            </div>
          </>
        ) : null}
      </CardContent>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={t('quiz.deleteTitle')}
        description={t('quiz.deleteDesc', { name: quiz.name })}
        confirmText={t('common.delete')}
        confirmVariant="destructive"
        isLoading={deleting}
        onConfirm={() => {
          onDelete(quiz.id)
          setConfirmOpen(false)
        }}
      />
    </Card>
  )
}
