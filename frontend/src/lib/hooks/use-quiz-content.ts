import { useEffect, useMemo, useState } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'

import { chatApi } from '@/lib/api/chat'
import { notesApi } from '@/lib/api/notes'
import { QUERY_KEYS } from '@/lib/api/query-client'
import { sourcesApi } from '@/lib/api/sources'
import type { QuizGenerateRequest } from '@/lib/types/quiz'

/** The sources endpoint pages at 100 at most. */
export const SOURCE_PAGE_LIMIT = 100
const SIZE_DEBOUNCE_MS = 400

/** Sources and notes of one notebook, for the quiz content picker. */
export function useQuizContentItems(notebookId: string) {
  const sourcesQuery = useQuery({
    queryKey: [...QUERY_KEYS.sources(notebookId), 'quiz-picker'],
    queryFn: () =>
      sourcesApi.list({ notebook_id: notebookId, limit: SOURCE_PAGE_LIMIT }),
    enabled: !!notebookId,
  })
  const notesQuery = useQuery({
    queryKey: QUERY_KEYS.notes(notebookId),
    queryFn: () => notesApi.list({ notebook_id: notebookId }),
    enabled: !!notebookId,
  })

  const sources = useMemo(() => sourcesQuery.data ?? [], [sourcesQuery.data])
  const notes = useMemo(() => notesQuery.data ?? [], [notesQuery.data])

  return {
    sources,
    notes,
    isLoading: sourcesQuery.isLoading || notesQuery.isLoading,
    isError: sourcesQuery.isError || notesQuery.isError,
    /** More sources may exist than were listed. */
    sourcesTruncated: sources.length >= SOURCE_PAGE_LIMIT,
  }
}

type ContextConfig = NonNullable<QuizGenerateRequest['context_config']>

/**
 * Token and character count of the selected content, debounced so ticking
 * through checkboxes doesn't fire a request per click.
 */
export function useQuizContentSize(
  notebookId: string,
  contextConfig: ContextConfig
) {
  const key = JSON.stringify(contextConfig)
  const [debouncedKey, setDebouncedKey] = useState(key)

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedKey(key), SIZE_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [key])

  const config = useMemo(() => JSON.parse(debouncedKey) as ContextConfig, [debouncedKey])
  const hasItems =
    Object.keys(config.sources).length + Object.keys(config.notes).length > 0

  return useQuery({
    queryKey: ['quiz-content-size', notebookId, debouncedKey],
    queryFn: () =>
      chatApi.buildContext({ notebook_id: notebookId, context_config: config }),
    enabled: !!notebookId && hasItems,
    staleTime: 30_000,
    placeholderData: keepPreviousData,
  })
}
