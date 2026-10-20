import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'

import { QuizzesTab } from './QuizzesTab'
import type { Quiz } from '@/lib/types/quiz'

// useTranslation is mocked globally in setup.ts (t returns the key string)

const useQuizzesMock = vi.fn()
vi.mock('@/lib/hooks/use-quizzes', () => ({
  useQuizzes: () => useQuizzesMock(),
}))

function makeQuiz(overrides: Partial<Quiz> = {}): Quiz {
  return {
    id: 'quiz:1',
    name: 'Cell biology',
    notebook_id: 'notebook:1',
    status: 'ready',
    error: null,
    settings: null,
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
    },
    ...overrides,
  }
}

function mockQuizzes(state: Record<string, unknown>) {
  useQuizzesMock.mockReturnValue({
    quizzes: [],
    isLoading: false,
    isError: false,
    ...state,
  })
}

describe('QuizzesTab', () => {
  beforeEach(() => {
    useQuizzesMock.mockReset()
  })

  it('shows a loading state', () => {
    mockQuizzes({ isLoading: true })
    render(<QuizzesTab onCreate={vi.fn()} />)
    expect(screen.getByText('common.loading')).toBeInTheDocument()
  })

  it('shows an error when the quizzes cannot be loaded', () => {
    mockQuizzes({ isError: true })
    render(<QuizzesTab onCreate={vi.fn()} />)
    expect(screen.getByText('quiz.loadFailed')).toBeInTheDocument()
  })

  it('offers to create the first quiz when there are none', () => {
    const onCreate = vi.fn()
    mockQuizzes({})
    render(<QuizzesTab onCreate={onCreate} />)

    expect(screen.getByText('quiz.noQuizzes')).toBeInTheDocument()
    fireEvent.click(screen.getByText('quiz.createFirst'))
    expect(onCreate).toHaveBeenCalledTimes(1)
  })

  it('lists quizzes with their state', () => {
    mockQuizzes({
      quizzes: [
        makeQuiz(),
        makeQuiz({ id: 'quiz:2', name: 'Busy', status: 'generating' }),
        makeQuiz({ id: 'quiz:3', name: 'Broken', status: 'failed' }),
      ],
    })
    render(<QuizzesTab onCreate={vi.fn()} />)

    expect(screen.getByText('Cell biology')).toBeInTheDocument()
    expect(screen.getByText('quiz.questionsCount')).toBeInTheDocument()
    expect(screen.getByText('quiz.statusGenerating')).toBeInTheDocument()
    expect(screen.getByText('quiz.statusFailed')).toBeInTheDocument()
  })
})
