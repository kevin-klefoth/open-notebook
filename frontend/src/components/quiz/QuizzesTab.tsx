'use client'

import { useMemo } from 'react'
import { AlertCircle, GraduationCap, Loader2 } from 'lucide-react'

import { EmptyState } from '@/components/common/EmptyState'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { QuizCard } from '@/components/quiz/QuizCard'
import { useNotebooks } from '@/lib/hooks/use-notebooks'
import { useDeleteQuiz, useQuizzes } from '@/lib/hooks/use-quizzes'
import { useTranslation } from '@/lib/hooks/use-translation'

interface QuizzesTabProps {
  /** Switches to the "New quiz" tab (used by the empty state). */
  onCreate: () => void
}

export function QuizzesTab({ onCreate }: QuizzesTabProps) {
  const { t } = useTranslation()
  const { quizzes, isLoading, isError } = useQuizzes()
  const { data: notebooks } = useNotebooks()
  const deleteQuiz = useDeleteQuiz()

  const notebookNames = useMemo(
    () => new Map((notebooks ?? []).map((notebook) => [notebook.id, notebook.name])),
    [notebooks]
  )

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
        <QuizCard
          key={quiz.id}
          quiz={quiz}
          notebookName={quiz.notebook_id ? notebookNames.get(quiz.notebook_id) : undefined}
          onDelete={(quizId) => deleteQuiz.mutate(quizId)}
          deleting={deleteQuiz.isPending && deleteQuiz.variables === quiz.id}
        />
      ))}
    </div>
  )
}
