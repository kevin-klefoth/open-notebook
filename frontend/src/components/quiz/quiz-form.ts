import { QUIZ_LIMITS, QuizGenerateRequest } from '@/lib/types/quiz'

/** Sentinel for "no explicit choice" in the model and language selects. */
export const AUTO = '__auto__'

export interface QuizFormValues {
  name: string
  notebookId: string
  /** Text field, so the user can clear it while typing */
  numQuestions: string
  maxOptions: number
  /** Model record ID, or AUTO for the default model */
  modelId: string
  /** Language name, or AUTO to follow the content's language */
  language: string
  /** Items the user switched off; everything else counts as selected */
  deselectedSourceIds: ReadonlySet<string>
  deselectedNoteIds: ReadonlySet<string>
}

export type QuizFormError =
  | 'nameRequired'
  | 'notebookRequired'
  | 'contentRequired'
  | 'numQuestionsInvalid'

export interface ContentItems {
  sourceIds: string[]
  noteIds: string[]
}

export function parseNumQuestions(raw: string): number | null {
  const trimmed = raw.trim()
  if (!/^\d+$/.test(trimmed)) {
    return null
  }
  const value = Number(trimmed)
  return value >= QUIZ_LIMITS.minQuestions && value <= QUIZ_LIMITS.maxQuestions
    ? value
    : null
}

export function selectedItems(
  items: ContentItems,
  values: Pick<QuizFormValues, 'deselectedSourceIds' | 'deselectedNoteIds'>
): ContentItems {
  return {
    sourceIds: items.sourceIds.filter((id) => !values.deselectedSourceIds.has(id)),
    noteIds: items.noteIds.filter((id) => !values.deselectedNoteIds.has(id)),
  }
}

export function validateQuizForm(
  values: QuizFormValues,
  items: ContentItems
): QuizFormError[] {
  const errors: QuizFormError[] = []
  if (!values.name.trim()) errors.push('nameRequired')
  if (!values.notebookId) {
    errors.push('notebookRequired')
  } else {
    const selected = selectedItems(items, values)
    if (selected.sourceIds.length + selected.noteIds.length === 0) {
      errors.push('contentRequired')
    }
  }
  if (parseNumQuestions(values.numQuestions) === null) {
    errors.push('numQuestionsInvalid')
  }
  return errors
}

/** Context selection for POST /chat/context and /quizzes/generate. */
export function buildContextConfig(
  items: ContentItems,
  values: Pick<QuizFormValues, 'deselectedSourceIds' | 'deselectedNoteIds'>
): NonNullable<QuizGenerateRequest['context_config']> {
  const selected = selectedItems(items, values)
  const strip = (prefix: string) => (id: string) => id.replace(new RegExp(`^${prefix}:`), '')
  return {
    sources: Object.fromEntries(
      selected.sourceIds.map((id) => [strip('source')(id), 'full content'])
    ),
    notes: Object.fromEntries(
      selected.noteIds.map((id) => [strip('note')(id), 'full content'])
    ),
  }
}

/**
 * Build the API request. The selection is only sent when the user narrowed it:
 * left alone, the API uses the whole notebook, which stays correct even when
 * the lists shown here were truncated by paging.
 */
export function buildGenerateRequest(
  values: QuizFormValues,
  items: ContentItems
): QuizGenerateRequest {
  const numQuestions = parseNumQuestions(values.numQuestions)
  if (numQuestions === null) {
    throw new Error('Invalid number of questions')
  }
  const narrowed =
    values.deselectedSourceIds.size > 0 || values.deselectedNoteIds.size > 0

  return {
    name: values.name.trim(),
    notebook_id: values.notebookId,
    ...(narrowed ? { context_config: buildContextConfig(items, values) } : {}),
    num_questions: numQuestions,
    max_options: values.maxOptions,
    ...(values.modelId !== AUTO ? { model_id: values.modelId } : {}),
    ...(values.language !== AUTO ? { language: values.language } : {}),
  }
}
