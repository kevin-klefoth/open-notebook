import { describe, it, expect, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'

import { QuizQuestionView, optionState } from './QuizQuestionView'
import type { QuizAnswerResult, QuizQuestion } from '@/lib/types/quiz'

// useTranslation is mocked globally in setup.ts (t returns the key string)

// Radix inputs observe their size; jsdom has no ResizeObserver.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal('ResizeObserver', ResizeObserverStub)

function makeQuestion(overrides: Partial<QuizQuestion> = {}): QuizQuestion {
  return {
    id: 'quiz_question:1',
    position: 0,
    type: 'single',
    question: 'Which organelle produces ATP?',
    options: [
      { id: 'a', text: 'Mitochondria' },
      { id: 'b', text: 'Nucleus' },
      { id: 'c', text: 'Ribosome' },
    ],
    ...overrides,
  }
}

function makeResult(overrides: Partial<QuizAnswerResult> = {}): QuizAnswerResult {
  return {
    question_id: 'quiz_question:1',
    is_correct: true,
    correct_option_ids: ['a'],
    explanation: 'They make ATP.',
    ...overrides,
  }
}

describe('optionState', () => {
  it('has no state before the answer was checked', () => {
    expect(optionState('a', ['a'], null)).toBe('neutral')
  })

  it('tells right picks, wrong picks, missed solutions and bystanders apart', () => {
    const result = makeResult({ correct_option_ids: ['a', 'c'] })
    expect(optionState('a', ['a', 'b'], result)).toBe('correct')
    expect(optionState('b', ['a', 'b'], result)).toBe('wrong')
    expect(optionState('c', ['a', 'b'], result)).toBe('missed')
    expect(optionState('d', ['a', 'b'], result)).toBe('neutral')
  })
})

describe('QuizQuestionView (single choice)', () => {
  it('shows the question, a hint and every option as a radio button', () => {
    render(
      <QuizQuestionView question={makeQuestion()} selected={[]} onChange={vi.fn()} result={null} />
    )

    expect(screen.getByText('Which organelle produces ATP?')).toBeInTheDocument()
    expect(screen.getByText('quiz.singleChoiceHint')).toBeInTheDocument()
    expect(screen.getAllByRole('radio')).toHaveLength(3)
  })

  it('reports the chosen option', () => {
    const onChange = vi.fn()
    render(
      <QuizQuestionView question={makeQuestion()} selected={[]} onChange={onChange} result={null} />
    )

    fireEvent.click(screen.getByLabelText('Nucleus'))

    expect(onChange).toHaveBeenCalledWith(['b'])
  })
})

describe('QuizQuestionView (multiple choice)', () => {
  const multiple = makeQuestion({ type: 'multiple' })

  it('shows checkboxes and the multiple-choice hint', () => {
    render(<QuizQuestionView question={multiple} selected={[]} onChange={vi.fn()} result={null} />)

    expect(screen.getByText('quiz.multipleChoiceHint')).toBeInTheDocument()
    expect(screen.getAllByRole('checkbox')).toHaveLength(3)
  })

  it('adds and removes options from the selection', () => {
    const onChange = vi.fn()
    const { rerender } = render(
      <QuizQuestionView question={multiple} selected={['a']} onChange={onChange} result={null} />
    )

    fireEvent.click(screen.getByLabelText('Ribosome'))
    expect(onChange).toHaveBeenLastCalledWith(['a', 'c'])

    rerender(
      <QuizQuestionView question={multiple} selected={['a', 'c']} onChange={onChange} result={null} />
    )
    fireEvent.click(screen.getByLabelText('Mitochondria'))
    expect(onChange).toHaveBeenLastCalledWith(['c'])
  })
})

describe('QuizQuestionView (after checking)', () => {
  it('marks a correct answer and shows the explanation', () => {
    render(
      <QuizQuestionView
        question={makeQuestion()}
        selected={['a']}
        onChange={vi.fn()}
        result={makeResult()}
      />
    )

    expect(screen.getByText('quiz.correct')).toBeInTheDocument()
    expect(screen.getByText('quiz.optionCorrect')).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('They make ATP.')
  })

  it('marks the wrong pick and reveals the correct option', () => {
    render(
      <QuizQuestionView
        question={makeQuestion()}
        selected={['b']}
        onChange={vi.fn()}
        result={makeResult({ is_correct: false })}
      />
    )

    expect(screen.getByText('quiz.incorrect')).toBeInTheDocument()
    expect(screen.getByText('quiz.optionWrong')).toBeInTheDocument()
    expect(screen.getByText('quiz.optionMissed')).toBeInTheDocument()
  })

  it('locks the inputs', () => {
    render(
      <QuizQuestionView
        question={makeQuestion()}
        selected={['a']}
        onChange={vi.fn()}
        result={makeResult()}
      />
    )

    screen.getAllByRole('radio').forEach((radio) => expect(radio).toBeDisabled())
  })

  it('omits the explanation block text when there is none', () => {
    render(
      <QuizQuestionView
        question={makeQuestion()}
        selected={['a']}
        onChange={vi.fn()}
        result={makeResult({ explanation: null })}
      />
    )

    expect(screen.queryByText(/quiz.explanation/)).not.toBeInTheDocument()
  })
})
