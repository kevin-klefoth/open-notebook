'use client'

import { useMemo, useState } from 'react'
import { Loader2 } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { formatNumber } from '@/components/podcasts/generate-podcast-selection'
import { useModels } from '@/lib/hooks/use-models'
import { useNotebooks } from '@/lib/hooks/use-notebooks'
import { useLanguages } from '@/lib/hooks/use-podcasts'
import { useQuizContentItems, useQuizContentSize } from '@/lib/hooks/use-quiz-content'
import { useGenerateQuiz } from '@/lib/hooks/use-quizzes'
import { useTranslation } from '@/lib/hooks/use-translation'
import { QUIZ_LIMITS } from '@/lib/types/quiz'

import {
  AUTO,
  QuizFormError,
  QuizFormValues,
  buildContextConfig,
  buildGenerateRequest,
  selectedItems,
  validateQuizForm,
} from './quiz-form'

interface CreateQuizTabProps {
  /** Called after the generation job was started (switches back to the list). */
  onCreated: () => void
}

const OPTION_CHOICES = Array.from(
  { length: QUIZ_LIMITS.maxOptions - QUIZ_LIMITS.minOptions + 1 },
  (_, i) => QUIZ_LIMITS.minOptions + i
)

function FieldError({ message }: { message?: string }) {
  return message ? <p className="text-sm text-destructive">{message}</p> : null
}

function toggled(set: ReadonlySet<string>, id: string, selected: boolean) {
  const next = new Set(set)
  if (selected) {
    next.delete(id)
  } else {
    next.add(id)
  }
  return next
}

export function CreateQuizTab({ onCreated }: CreateQuizTabProps) {
  const { t } = useTranslation()
  const generateQuiz = useGenerateQuiz()

  const [name, setName] = useState('')
  const [nameTouched, setNameTouched] = useState(false)
  const [notebookId, setNotebookId] = useState('')
  const [numQuestions, setNumQuestions] = useState(String(QUIZ_LIMITS.defaultQuestions))
  const [maxOptions, setMaxOptions] = useState<number>(QUIZ_LIMITS.defaultOptions)
  const [modelId, setModelId] = useState(AUTO)
  const [language, setLanguage] = useState(AUTO)
  const [deselectedSourceIds, setDeselectedSourceIds] = useState<ReadonlySet<string>>(new Set())
  const [deselectedNoteIds, setDeselectedNoteIds] = useState<ReadonlySet<string>>(new Set())
  const [showErrors, setShowErrors] = useState(false)

  const notebooksQuery = useNotebooks()
  const modelsQuery = useModels()
  const { data: languages = [] } = useLanguages()
  const content = useQuizContentItems(notebookId)

  const notebooks = useMemo(() => notebooksQuery.data ?? [], [notebooksQuery.data])
  const languageModels = useMemo(
    () => (modelsQuery.data ?? []).filter((model) => model.type === 'language'),
    [modelsQuery.data]
  )

  const items = useMemo(
    () => ({
      sourceIds: content.sources.map((source) => source.id),
      noteIds: content.notes.map((note) => note.id),
    }),
    [content.sources, content.notes]
  )

  const values: QuizFormValues = {
    name,
    notebookId,
    numQuestions,
    maxOptions,
    modelId,
    language,
    deselectedSourceIds,
    deselectedNoteIds,
  }
  const errors = validateQuizForm(values, items)
  const selected = selectedItems(items, values)
  const selectedCount = selected.sourceIds.length + selected.noteIds.length

  const sizeQuery = useQuizContentSize(
    notebookId,
    useMemo(
      () => buildContextConfig(items, { deselectedSourceIds, deselectedNoteIds }),
      [items, deselectedSourceIds, deselectedNoteIds]
    )
  )

  const errorMessages: Record<QuizFormError, string> = {
    nameRequired: t('quiz.nameRequired'),
    notebookRequired: t('quiz.notebookRequired'),
    contentRequired: t('quiz.contentRequired'),
    numQuestionsInvalid: t('quiz.numQuestionsInvalid', {
      min: QUIZ_LIMITS.minQuestions,
      max: QUIZ_LIMITS.maxQuestions,
    }),
  }
  const errorFor = (error: QuizFormError) =>
    showErrors && errors.includes(error) ? errorMessages[error] : undefined

  const handleNotebookChange = (id: string) => {
    setNotebookId(id)
    setDeselectedSourceIds(new Set())
    setDeselectedNoteIds(new Set())
    if (!nameTouched) {
      const notebook = notebooks.find((nb) => nb.id === id)
      setName(notebook ? t('quiz.defaultName', { name: notebook.name }) : '')
    }
  }

  const selectAll = (select: boolean) => {
    setDeselectedSourceIds(select ? new Set() : new Set(items.sourceIds))
    setDeselectedNoteIds(select ? new Set() : new Set(items.noteIds))
  }

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault()
    if (errors.length > 0) {
      setShowErrors(true)
      return
    }
    generateQuiz.mutate(buildGenerateRequest(values, items), {
      onSuccess: () => {
        setName('')
        setNameTouched(false)
        setNotebookId('')
        setDeselectedSourceIds(new Set())
        setDeselectedNoteIds(new Set())
        setShowErrors(false)
        onCreated()
      },
    })
  }

  const hasContent = content.sources.length + content.notes.length > 0

  return (
    <form onSubmit={handleSubmit} className="max-w-3xl space-y-8" noValidate>
      <section className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="quiz-notebook">{t('quiz.notebook')}</Label>
          <Select value={notebookId} onValueChange={handleNotebookChange}>
            <SelectTrigger id="quiz-notebook" className="w-full">
              <SelectValue placeholder={t('quiz.selectNotebook')} />
            </SelectTrigger>
            <SelectContent>
              {notebooks.length === 0 ? (
                <div className="px-2 py-2 text-sm text-muted-foreground">
                  {t('quiz.noNotebooks')}
                </div>
              ) : (
                notebooks.map((notebook) => (
                  <SelectItem key={notebook.id} value={notebook.id}>
                    {notebook.name}
                  </SelectItem>
                ))
              )}
            </SelectContent>
          </Select>
          <FieldError message={errorFor('notebookRequired')} />
        </div>

        <div className="space-y-2">
          <Label htmlFor="quiz-name">{t('quiz.quizName')}</Label>
          <Input
            id="quiz-name"
            value={name}
            maxLength={200}
            placeholder={t('quiz.quizNamePlaceholder')}
            onChange={(event) => {
              setName(event.target.value)
              setNameTouched(true)
            }}
          />
          <FieldError message={errorFor('nameRequired')} />
        </div>
      </section>

      {notebookId ? (
        <section className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                {t('quiz.content')}
              </h3>
              <p className="text-xs text-muted-foreground">{t('quiz.contentDesc')}</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline">
                {t('quiz.itemsSelected', { count: selectedCount })}
              </Badge>
              {sizeQuery.data ? (
                <Badge variant="outline">
                  {t('quiz.tokens', { value: formatNumber(sizeQuery.data.token_count) })}
                </Badge>
              ) : null}
              <Button type="button" variant="ghost" size="sm" onClick={() => selectAll(true)}>
                {t('quiz.selectAll')}
              </Button>
              <Button type="button" variant="ghost" size="sm" onClick={() => selectAll(false)}>
                {t('quiz.selectNone')}
              </Button>
            </div>
          </div>

          {content.isLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              {t('common.loading')}
            </div>
          ) : content.isError ? (
            <p className="text-sm text-destructive">{t('quiz.contentLoadFailed')}</p>
          ) : !hasContent ? (
            <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
              {t('quiz.noContent')}
            </p>
          ) : (
            <ScrollArea className="max-h-72 rounded-md border">
              <ul className="divide-y">
                {content.sources.map((source) => (
                  <li key={source.id} className="flex items-center gap-3 px-3 py-2">
                    <Checkbox
                      id={`quiz-source-${source.id}`}
                      checked={!deselectedSourceIds.has(source.id)}
                      onCheckedChange={(checked) =>
                        setDeselectedSourceIds((prev) =>
                          toggled(prev, source.id, checked === true)
                        )
                      }
                    />
                    <Label
                      htmlFor={`quiz-source-${source.id}`}
                      className="flex-1 cursor-pointer font-normal"
                    >
                      {source.title || t('quiz.untitledSource')}
                    </Label>
                    <Badge variant="outline">{t('quiz.sourceLabel')}</Badge>
                  </li>
                ))}
                {content.notes.map((note) => (
                  <li key={note.id} className="flex items-center gap-3 px-3 py-2">
                    <Checkbox
                      id={`quiz-note-${note.id}`}
                      checked={!deselectedNoteIds.has(note.id)}
                      onCheckedChange={(checked) =>
                        setDeselectedNoteIds((prev) =>
                          toggled(prev, note.id, checked === true)
                        )
                      }
                    />
                    <Label
                      htmlFor={`quiz-note-${note.id}`}
                      className="flex-1 cursor-pointer font-normal"
                    >
                      {note.title || t('quiz.untitledNote')}
                    </Label>
                    <Badge variant="outline">{t('quiz.noteLabel')}</Badge>
                  </li>
                ))}
              </ul>
            </ScrollArea>
          )}
          {content.sourcesTruncated ? (
            <p className="text-xs text-muted-foreground">{t('quiz.sourcesTruncated')}</p>
          ) : null}
          <FieldError message={errorFor('contentRequired')} />
        </section>
      ) : null}

      <section className="space-y-4">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          {t('quiz.settings')}
        </h3>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="quiz-num-questions">{t('quiz.numQuestions')}</Label>
            <Input
              id="quiz-num-questions"
              inputMode="numeric"
              value={numQuestions}
              onChange={(event) => setNumQuestions(event.target.value)}
            />
            <FieldError message={errorFor('numQuestionsInvalid')} />
          </div>

          <div className="space-y-2">
            <Label htmlFor="quiz-max-options">{t('quiz.maxOptions')}</Label>
            <Select
              value={String(maxOptions)}
              onValueChange={(value) => setMaxOptions(Number(value))}
            >
              <SelectTrigger id="quiz-max-options" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {OPTION_CHOICES.map((count) => (
                  <SelectItem key={count} value={String(count)}>
                    {count}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">{t('quiz.maxOptionsDesc')}</p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="quiz-model">{t('quiz.model')}</Label>
            <Select value={modelId} onValueChange={setModelId}>
              <SelectTrigger id="quiz-model" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={AUTO}>{t('quiz.modelDefault')}</SelectItem>
                {languageModels.map((model) => (
                  <SelectItem key={model.id} value={model.id}>
                    {model.name}
                    <span className="ml-2 text-xs text-muted-foreground">{model.provider}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="quiz-language">{t('quiz.language')}</Label>
            <Select value={language} onValueChange={setLanguage}>
              <SelectTrigger id="quiz-language" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={AUTO}>{t('quiz.languageAuto')}</SelectItem>
                {languages.map((lang) => (
                  <SelectItem key={lang.code} value={lang.name}>
                    {lang.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </section>

      <Button type="submit" disabled={generateQuiz.isPending}>
        {generateQuiz.isPending ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            {t('quiz.starting')}
          </>
        ) : (
          t('quiz.generate')
        )}
      </Button>
    </form>
  )
}
