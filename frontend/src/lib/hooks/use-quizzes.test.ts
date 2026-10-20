import { describe, it, expect } from 'vitest'

import { hasGeneratingQuizzes } from './use-quizzes'
import type { Quiz } from '@/lib/types/quiz'

function quiz(status: Quiz['status']): Quiz {
  return {
    id: `quiz:${status}`,
    name: status,
    notebook_id: null,
    status,
    error: null,
    settings: null,
    created: null,
    updated: null,
    stats: {
      question_count: 0,
      attempt_count: 0,
      last_score_pct: null,
      best_score_pct: null,
      answered_count: 0,
      mastered_count: 0,
      wrong_count: 0,
    },
  }
}

describe('hasGeneratingQuizzes', () => {
  it('is true while any quiz is still being generated', () => {
    expect(hasGeneratingQuizzes([quiz('ready'), quiz('generating')])).toBe(true)
  })

  it('is false once every quiz is ready or failed', () => {
    expect(hasGeneratingQuizzes([quiz('ready'), quiz('failed')])).toBe(false)
  })

  it('is false before data has loaded', () => {
    expect(hasGeneratingQuizzes(undefined)).toBe(false)
    expect(hasGeneratingQuizzes([])).toBe(false)
  })
})
