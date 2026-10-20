'use client'

import Link from 'next/link'
import { PartyPopper, RotateCcw, Trophy } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { useTranslation } from '@/lib/hooks/use-translation'
import { QuizAttemptMode, QuizFinishResult } from '@/lib/types/quiz'

interface QuizResultViewProps {
  result: QuizFinishResult
  onRestart: (mode: QuizAttemptMode) => void
}

export function QuizResultView({ result, onRestart }: QuizResultViewProps) {
  const { t } = useTranslation()
  const { stats } = result
  const perfect = result.score === result.total
  const Icon = perfect ? PartyPopper : Trophy

  return (
    <div className="space-y-6 text-center">
      <div className="space-y-3">
        <Icon className="mx-auto h-12 w-12 text-gold" aria-hidden="true" />
        <h2 className="font-display text-2xl font-bold tracking-tight">
          {t('quiz.resultTitle')}
        </h2>
        <p className="font-mono text-4xl font-semibold">{result.score_pct}%</p>
        <p className="text-muted-foreground">
          {t('quiz.resultScore', { score: result.score, total: result.total })}
        </p>
        <p className="text-sm">
          {perfect
            ? t('quiz.resultPerfect')
            : t('quiz.wrongToRepeat', { count: result.wrong_question_ids.length })}
        </p>
      </div>

      <div className="mx-auto max-w-sm space-y-2">
        <Progress
          value={
            stats.question_count
              ? Math.round((100 * stats.mastered_count) / stats.question_count)
              : 0
          }
        />
        <p className="text-xs text-muted-foreground">
          {t('quiz.progressLabel', {
            mastered: stats.mastered_count,
            total: stats.question_count,
          })}
        </p>
      </div>

      <div className="flex flex-wrap justify-center gap-2">
        {stats.wrong_count > 0 ? (
          <Button onClick={() => onRestart('retry_wrong')}>
            <RotateCcw className="mr-2 h-4 w-4" />
            {t('quiz.repeatWrong')}
          </Button>
        ) : null}
        <Button
          variant={stats.wrong_count > 0 ? 'outline' : 'default'}
          onClick={() => onRestart('full')}
        >
          {t('quiz.playAgain')}
        </Button>
        <Button asChild variant="outline">
          <Link href="/quiz">{t('quiz.backToQuizzes')}</Link>
        </Button>
      </div>
    </div>
  )
}
