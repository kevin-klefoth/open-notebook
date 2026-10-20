'use client'

import { Check, X } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { useTranslation } from '@/lib/hooks/use-translation'
import { cn } from '@/lib/utils'
import { QuizAnswerResult, QuizQuestion } from '@/lib/types/quiz'

interface QuizQuestionViewProps {
  question: QuizQuestion
  selected: string[]
  onChange: (selected: string[]) => void
  /** Set once the answer was checked; the question is then read-only */
  result: QuizAnswerResult | null
}

type OptionState = 'correct' | 'wrong' | 'missed' | 'neutral'

/** What an option shows after checking: right, wrongly picked, or missed. */
export function optionState(
  optionId: string,
  selected: string[],
  result: QuizAnswerResult | null
): OptionState {
  if (!result) return 'neutral'
  const isCorrect = result.correct_option_ids.includes(optionId)
  const isSelected = selected.includes(optionId)
  if (isCorrect && isSelected) return 'correct'
  if (isSelected) return 'wrong'
  if (isCorrect) return 'missed'
  return 'neutral'
}

const STATE_CLASSES: Record<OptionState, string> = {
  neutral: 'border-border',
  correct: 'border-fern bg-fern-tint',
  wrong: 'border-destructive bg-destructive-tint',
  missed: 'border-dashed border-fern',
}

export function QuizQuestionView({
  question,
  selected,
  onChange,
  result,
}: QuizQuestionViewProps) {
  const { t } = useTranslation()
  const locked = result !== null
  const multiple = question.type === 'multiple'

  const stateLabel: Record<OptionState, string | null> = {
    neutral: null,
    correct: t('quiz.optionCorrect'),
    wrong: t('quiz.optionWrong'),
    missed: t('quiz.optionMissed'),
  }

  const renderOption = (option: QuizQuestion['options'][number]) => {
    const state = optionState(option.id, selected, result)
    const inputId = `${question.id}-${option.id}`
    const label = stateLabel[state]

    return (
      <li key={option.id}>
        <label
          htmlFor={inputId}
          className={cn(
            'flex items-start gap-3 rounded-md border p-3 transition-colors',
            STATE_CLASSES[state],
            locked ? 'cursor-default' : 'cursor-pointer hover:bg-accent'
          )}
        >
          {multiple ? (
            <Checkbox
              id={inputId}
              className="mt-0.5"
              checked={selected.includes(option.id)}
              disabled={locked}
              onCheckedChange={(checked) =>
                onChange(
                  checked === true
                    ? [...selected, option.id]
                    : selected.filter((id) => id !== option.id)
                )
              }
            />
          ) : (
            <RadioGroupItem id={inputId} value={option.id} className="mt-0.5" disabled={locked} />
          )}
          <span className="flex-1 text-sm">{option.text}</span>
          {label ? (
            <Badge
              variant={state === 'wrong' ? 'destructive' : 'default'}
              className="gap-1"
            >
              {state === 'wrong' ? <X /> : <Check />}
              {label}
            </Badge>
          ) : null}
        </label>
      </li>
    )
  }

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <h2 className="text-lg font-medium leading-snug">{question.question}</h2>
        <p className="text-sm text-muted-foreground">
          {multiple ? t('quiz.multipleChoiceHint') : t('quiz.singleChoiceHint')}
        </p>
      </div>

      {multiple ? (
        <ul className="space-y-2">{question.options.map(renderOption)}</ul>
      ) : (
        <RadioGroup
          value={selected[0] ?? ''}
          onValueChange={(value) => onChange([value])}
          disabled={locked}
          asChild
        >
          <ul className="space-y-2">{question.options.map(renderOption)}</ul>
        </RadioGroup>
      )}

      {result ? (
        <div
          role="status"
          className={cn(
            'space-y-1 rounded-md border p-3 text-sm',
            result.is_correct ? 'border-fern bg-fern-tint' : 'border-destructive bg-destructive-tint'
          )}
        >
          <p className="font-medium">
            {result.is_correct ? t('quiz.correct') : t('quiz.incorrect')}
          </p>
          {result.explanation ? (
            <p>
              <span className="font-medium">{t('quiz.explanation')}: </span>
              {result.explanation}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
