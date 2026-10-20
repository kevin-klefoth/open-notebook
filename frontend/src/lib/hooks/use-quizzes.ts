import { useMemo } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { quizzesApi } from '@/lib/api/quizzes'
import { QUERY_KEYS } from '@/lib/api/query-client'
import { useToast } from '@/lib/hooks/use-toast'
import { useTranslation } from '@/lib/hooks/use-translation'
import { getApiErrorKey } from '@/lib/utils/error-handler'
import { Quiz, QuizGenerateRequest } from '@/lib/types/quiz'

/** How often the list refreshes while a quiz is still being generated. */
export const QUIZ_POLL_INTERVAL_MS = 4_000

export function hasGeneratingQuizzes(quizzes: Quiz[] | undefined): boolean {
  return !!quizzes?.some((quiz) => quiz.status === 'generating')
}

export function useQuizzes() {
  const query = useQuery({
    queryKey: QUERY_KEYS.quizzes,
    queryFn: () => quizzesApi.list(),
    refetchInterval: (current) =>
      hasGeneratingQuizzes(current.state.data) ? QUIZ_POLL_INTERVAL_MS : false,
  })

  const quizzes = useMemo(() => query.data ?? [], [query.data])

  return { ...query, quizzes }
}

export function useQuiz(quizId: string | undefined) {
  return useQuery({
    queryKey: QUERY_KEYS.quiz(quizId ?? ''),
    queryFn: () => quizzesApi.get(quizId as string),
    enabled: !!quizId,
  })
}

export function useGenerateQuiz() {
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const { t } = useTranslation()

  return useMutation({
    mutationFn: (payload: QuizGenerateRequest) => quizzesApi.generate(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.quizzes })
      toast({
        title: t('quiz.generationStarted'),
        description: t('quiz.generationStartedDesc'),
      })
    },
    onError: (error: unknown) => {
      toast({
        title: t('quiz.failedToGenerate'),
        description: getApiErrorKey(error, t('common.error')),
        variant: 'destructive',
      })
    },
  })
}

export function useDeleteQuiz() {
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const { t } = useTranslation()

  return useMutation({
    mutationFn: (quizId: string) => quizzesApi.delete(quizId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.quizzes })
      toast({
        title: t('quiz.quizDeleted'),
        description: t('quiz.quizDeletedDesc'),
      })
    },
    onError: (error: unknown) => {
      toast({
        title: t('quiz.failedToDelete'),
        description: getApiErrorKey(error, t('common.error')),
        variant: 'destructive',
      })
    },
  })
}
