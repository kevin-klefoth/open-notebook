import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'

import { QuizPlayer } from './QuizPlayer'
import type {
  QuizAnswerResult,
  QuizAttempt,
  QuizFinishResult,
  QuizQuestion,
} from '@/lib/types/quiz'

// useTranslation is mocked globally in setup.ts (t returns the key string)

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal('ResizeObserver', ResizeObserverStub)

const start = vi.fn()
const answer = vi.fn()
const finish = vi.fn()
const hookState = {
  start: { data: undefined as QuizAttempt | undefined, isError: false, error: null as unknown },
  answerPending: false,
  finishPending: false,
}

vi.mock('@/lib/hooks/use-quizzes', () => ({
  useStartQuizAttempt: () => ({ mutate: start, ...hookState.start }),
  useAnswerQuizQuestion: () => ({ mutate: answer, isPending: hookState.answerPending }),
  useFinishQuizAttempt: () => ({ mutate: finish, isPending: hookState.finishPending }),
}))

function question(id: string, type: QuizQuestion['type'] = 'single'): QuizQuestion {
  return {
    id,
    position: 0,
    type,
    question: `Question ${id}`,
    options: [
      { id: 'a', text: `${id} option A` },
      { id: 'b', text: `${id} option B` },
    ],
  }
}

const ATTEMPT: QuizAttempt = {
  id: 'quiz_attempt:1',
  quiz_id: 'quiz:1',
  mode: 'full',
  total: 2,
  finished: false,
  questions: [question('q1'), question('q2')],
}

const FINISHED: QuizFinishResult = {
  attempt_id: 'quiz_attempt:1',
  score: 1,
  total: 2,
  score_pct: 50,
  wrong_question_ids: ['q2'],
  stats: {
    question_count: 2,
    attempt_count: 1,
    last_score_pct: 50,
    best_score_pct: 50,
    answered_count: 2,
    mastered_count: 1,
    wrong_count: 1,
  },
}

function renderPlayer(onRestart = vi.fn()) {
  render(<QuizPlayer quizId="quiz:1" mode="full" onRestart={onRestart} />)
  return { onRestart }
}

describe('QuizPlayer', () => {
  beforeEach(() => {
    start.mockReset()
    answer.mockReset()
    finish.mockReset()
    hookState.start = { data: undefined, isError: false, error: null }
    hookState.answerPending = false
    hookState.finishPending = false
  })

  it('starts exactly one attempt in the requested mode', () => {
    renderPlayer()

    expect(start).toHaveBeenCalledTimes(1)
    expect(start).toHaveBeenCalledWith({ quizId: 'quiz:1', mode: 'full' })
    expect(screen.getByText('quiz.preparing')).toBeInTheDocument()
  })

  it('explains why an attempt could not be started', () => {
    hookState.start = {
      data: undefined,
      isError: true,
      error: { response: { data: { detail: 'There are no wrongly answered questions to repeat' } } },
    }
    renderPlayer()

    expect(screen.getByText('quiz.attemptFailed')).toBeInTheDocument()
    expect(
      screen.getByText('There are no wrongly answered questions to repeat')
    ).toBeInTheDocument()
  })

  it('shows the first question with its position and needs a selection to check', () => {
    hookState.start.data = ATTEMPT
    renderPlayer()

    expect(screen.getByText('Question q1')).toBeInTheDocument()
    expect(screen.getByText('quiz.questionOf')).toBeInTheDocument()
    expect(screen.getByText('quiz.checkAnswer').closest('button')).toBeDisabled()
  })

  it('announces the retry mode', () => {
    hookState.start.data = { ...ATTEMPT, mode: 'retry_wrong' }
    renderPlayer()
    expect(screen.getByText('quiz.retryMode')).toBeInTheDocument()
  })

  it('sends the selection, shows the verdict and then offers the next question', () => {
    hookState.start.data = ATTEMPT
    answer.mockImplementation((_vars, options) =>
      options.onSuccess({
        question_id: 'q1',
        is_correct: true,
        correct_option_ids: ['a'],
        explanation: 'Because.',
      } satisfies QuizAnswerResult)
    )
    renderPlayer()

    fireEvent.click(screen.getByLabelText('q1 option A'))
    fireEvent.click(screen.getByText('quiz.checkAnswer'))

    expect(answer.mock.calls[0][0]).toEqual({
      attemptId: 'quiz_attempt:1',
      payload: { question_id: 'q1', selected_option_ids: ['a'] },
    })
    expect(screen.getByText('quiz.correct')).toBeInTheDocument()
    expect(screen.queryByText('quiz.checkAnswer')).not.toBeInTheDocument()

    fireEvent.click(screen.getByText('quiz.nextQuestion'))

    expect(screen.getByText('Question q2')).toBeInTheDocument()
    expect(screen.queryByText('quiz.correct')).not.toBeInTheDocument()
    // the new question starts without a selection
    expect(screen.getByText('quiz.checkAnswer').closest('button')).toBeDisabled()
  })

  it('finishes after the last question and shows the result', () => {
    hookState.start.data = { ...ATTEMPT, total: 1, questions: [question('q1')] }
    answer.mockImplementation((_vars, options) =>
      options.onSuccess({
        question_id: 'q1',
        is_correct: false,
        correct_option_ids: ['b'],
        explanation: null,
      } satisfies QuizAnswerResult)
    )
    finish.mockImplementation((_id, options) => options.onSuccess(FINISHED))
    renderPlayer()

    fireEvent.click(screen.getByLabelText('q1 option A'))
    fireEvent.click(screen.getByText('quiz.checkAnswer'))
    fireEvent.click(screen.getByText('quiz.finishQuiz'))

    expect(finish.mock.calls[0][0]).toBe('quiz_attempt:1')
    expect(screen.getByText('quiz.resultTitle')).toBeInTheDocument()
    expect(screen.getByText('50%')).toBeInTheDocument()
  })

  it('lets the result screen restart in either mode', () => {
    hookState.start.data = { ...ATTEMPT, total: 1, questions: [question('q1')] }
    answer.mockImplementation((_vars, options) =>
      options.onSuccess({
        question_id: 'q1',
        is_correct: false,
        correct_option_ids: ['b'],
        explanation: null,
      })
    )
    finish.mockImplementation((_id, options) => options.onSuccess(FINISHED))
    const { onRestart } = renderPlayer()

    fireEvent.click(screen.getByLabelText('q1 option A'))
    fireEvent.click(screen.getByText('quiz.checkAnswer'))
    fireEvent.click(screen.getByText('quiz.finishQuiz'))

    fireEvent.click(screen.getByText('quiz.repeatWrong'))
    expect(onRestart).toHaveBeenLastCalledWith('retry_wrong')

    fireEvent.click(screen.getByText('quiz.playAgain'))
    expect(onRestart).toHaveBeenLastCalledWith('full')
  })

  it('does not offer to repeat when nothing is wrong', () => {
    hookState.start.data = { ...ATTEMPT, total: 1, questions: [question('q1')] }
    answer.mockImplementation((_vars, options) =>
      options.onSuccess({
        question_id: 'q1',
        is_correct: true,
        correct_option_ids: ['a'],
        explanation: null,
      })
    )
    finish.mockImplementation((_id, options) =>
      options.onSuccess({
        ...FINISHED,
        score: 2,
        score_pct: 100,
        wrong_question_ids: [],
        stats: { ...FINISHED.stats, mastered_count: 2, wrong_count: 0 },
      })
    )
    renderPlayer()

    fireEvent.click(screen.getByLabelText('q1 option A'))
    fireEvent.click(screen.getByText('quiz.checkAnswer'))
    fireEvent.click(screen.getByText('quiz.finishQuiz'))

    expect(screen.getByText('quiz.resultPerfect')).toBeInTheDocument()
    expect(screen.queryByText('quiz.repeatWrong')).not.toBeInTheDocument()
  })
})
