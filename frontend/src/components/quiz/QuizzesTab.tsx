'use client'

import { AlertCircle, GraduationCap, Loader2 } from 'lucide-react'

import { EmptyState } from '@/components/common/EmptyState'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { useQuizzes } from '@/lib/hooks/use-quizzes'
import { useTranslation } from '@/lib/hooks/use-translation'

interface QuizzesTabProps {
  /** Switches to the "New quiz" tab (used by the empty state). */
  onCreate: () => void
}

export function QuizzesTab({ onCreate }: QuizzesTabProps) {
  const { t } = useTranslation()
  const { quizzes, isLoading, isError } = useQuizzes()

  if (isLoading) {
    return (
      <div className="flex items-center gap-3 rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        {t('common.loading')}
      </div>
    )
  }

  if (isError) {
    return (
      <Alert variant="destructive">
        <AlertCircle className="h-4 w-4" />
        <AlertTitle>{t('quiz.loadFailed')}</AlertTitle>
        <AlertDescription>{t('common.error')}</AlertDescription>
      </Alert>
    )
  }

  if (quizzes.length === 0) {
    return (
      <EmptyState
        icon={GraduationCap}
        title={t('quiz.noQuizzes')}
        description={t('quiz.noQuizzesDesc')}
        action={<Button onClick={onCreate}>{t('quiz.createFirst')}</Button>}
      />
    )
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {quizzes.map((quiz) => (
        <Card key={quiz.id}>
          <CardContent className="space-y-2 p-4">
            <h3 className="font-display text-lg font-semibold tracking-tight">
              {quiz.name}
            </h3>
            {quiz.status === 'generating' ? (
              <Badge variant="outline" className="gap-1.5">
                <Loader2 className="h-3 w-3 animate-spin" />
                {t('quiz.statusGenerating')}
              </Badge>
            ) : quiz.status === 'failed' ? (
              <Badge variant="destructive">{t('quiz.statusFailed')}</Badge>
            ) : (
              <p className="text-sm text-muted-foreground">
                {t('quiz.questionsCount', { count: quiz.stats.question_count })}
              </p>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
