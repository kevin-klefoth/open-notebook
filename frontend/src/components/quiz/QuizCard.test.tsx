import { describe, it, expect, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'

import { QuizCard, quizPlayHref } from './QuizCard'
import type { Quiz } from '@/lib/types/quiz'

// useTranslation is mocked globally in setup.ts (t returns the key string)

function makeQuiz(overrides: Partial<Quiz> = {}, stats: Partial<Quiz['stats']> = {}): Quiz {
  return {
    id: 'quiz:abc',
    name: 'Cell biology',
    notebook_id: 'notebook:1',
    status: 'ready',
    error: null,
    settings: { num_questions: 10, generated_questions: 10 },
    created: null,
    updated: null,
    stats: {
      question_count: 10,
      attempt_count: 0,
      last_score_pct: null,
      best_score_pct: null,
      answered_count: 0,
      mastered_count: 0,
      wrong_count: 0,
      ...stats,
    },
    ...overrides,
  }
}

function renderCard(quiz: Quiz, props: Partial<Parameters<typeof QuizCard>[0]> = {}) {
  const onDelete = vi.fn()
  render(<QuizCard quiz={quiz} onDelete={onDelete} {...props} />)
  return { onDelete }
}

describe('quizPlayHref', () => {
  it('links to the player with the chosen mode', () => {
    expect(quizPlayHref('quiz:abc', 'full')).toBe('/quiz/quiz%3Aabc/play?mode=full')
    expect(quizPlayHref('quiz:abc', 'retry_wrong')).toBe('/quiz/quiz%3Aabc/play?mode=retry_wrong')
  })
})

describe('QuizCard (ready)', () => {
  it('invites to practice when nothing was answered yet', () => {
    renderCard(makeQuiz())

    expect(screen.getByText('quiz.notPracticed')).toBeInTheDocument()
    expect(screen.queryByText('quiz.attempts')).not.toBeInTheDocument()
  })

  it('shows the learning statistics after the first attempt', () => {
    renderCard(
      makeQuiz(
        {},
        {
          attempt_count: 3,
          last_score_pct: 70,
          best_score_pct: 90,
          answered_count: 10,
          mastered_count: 7,
          wrong_count: 3,
        }
      )
    )

    expect(screen.getByText('quiz.attempts').nextSibling).toHaveTextContent('3')
    expect(screen.getByText('quiz.lastScore').nextSibling).toHaveTextContent('70%')
    expect(screen.getByText('quiz.bestScore').nextSibling).toHaveTextContent('90%')
    expect(screen.getByText('quiz.wrongToRepeat')).toBeInTheDocument()
    // the shared Progress primitive doesn't forward `value`, so check the bar itself
    expect(
      document.querySelector('[data-slot="progress-indicator"]')
    ).toHaveStyle({ transform: 'translateX(-30%)' })
    expect(screen.queryByText('quiz.notPracticed')).not.toBeInTheDocument()
  })

  it('starts the quiz and the repetition through the player route', () => {
    renderCard(makeQuiz({}, { attempt_count: 1, wrong_count: 2, answered_count: 10 }))

    expect(screen.getByText('quiz.startQuiz').closest('a')).toHaveAttribute(
      'href',
      '/quiz/quiz%3Aabc/play?mode=full'
    )
    expect(screen.getByText('quiz.repeatWrong').closest('a')).toHaveAttribute(
      'href',
      '/quiz/quiz%3Aabc/play?mode=retry_wrong'
    )
  })

  it('disables repeating when no question was answered wrong', () => {
    renderCard(makeQuiz({}, { attempt_count: 1, answered_count: 10, mastered_count: 10 }))

    const repeat = screen.getByText('quiz.repeatWrong').closest('button')
    expect(repeat).toBeDisabled()
    expect(screen.getByText('quiz.repeatWrong').closest('a')).toBeNull()
    expect(screen.queryByText('quiz.wrongToRepeat')).not.toBeInTheDocument()
  })

  it('says so when fewer questions than requested were generated', () => {
    renderCard(
      makeQuiz({ settings: { num_questions: 10, generated_questions: 6 } }, { question_count: 6 })
    )
    expect(screen.getByText('quiz.fewerQuestions')).toBeInTheDocument()
  })

  it('shows the notebook name when it is known', () => {
    renderCard(makeQuiz(), { notebookName: 'Biologie' })
    expect(screen.getByText(/Biologie/)).toBeInTheDocument()
  })
})

describe('QuizCard (other states)', () => {
  it('shows progress while generating, without statistics or actions', () => {
    renderCard(makeQuiz({ status: 'generating' }))

    expect(screen.getByText('quiz.statusGenerating')).toBeInTheDocument()
    expect(screen.queryByText('quiz.startQuiz')).not.toBeInTheDocument()
    expect(document.querySelector('[data-slot="progress-indicator"]')).toBeNull()
  })

  it('shows why generation failed', () => {
    renderCard(makeQuiz({ status: 'failed', error: 'No model configured' }))

    expect(screen.getByText('quiz.statusFailed')).toBeInTheDocument()
    expect(screen.getByText('No model configured')).toBeInTheDocument()
    expect(screen.queryByText('quiz.startQuiz')).not.toBeInTheDocument()
  })
})

describe('QuizCard deletion', () => {
  it('asks for confirmation before deleting', () => {
    const { onDelete } = renderCard(makeQuiz())

    fireEvent.click(screen.getByLabelText('quiz.deleteQuiz'))
    expect(onDelete).not.toHaveBeenCalled()
    expect(screen.getByText('quiz.deleteTitle')).toBeInTheDocument()

    fireEvent.click(screen.getByText('common.delete'))
    expect(onDelete).toHaveBeenCalledWith('quiz:abc')
  })

  it('does nothing when the confirmation is cancelled', () => {
    const { onDelete } = renderCard(makeQuiz())

    fireEvent.click(screen.getByLabelText('quiz.deleteQuiz'))
    fireEvent.click(screen.getByText('common.cancel'))

    expect(onDelete).not.toHaveBeenCalled()
  })

  it('can delete a failed quiz', () => {
    const { onDelete } = renderCard(makeQuiz({ status: 'failed', error: 'x' }))

    fireEvent.click(screen.getByLabelText('quiz.deleteQuiz'))
    fireEvent.click(screen.getByText('common.delete'))

    expect(onDelete).toHaveBeenCalledWith('quiz:abc')
  })
})
