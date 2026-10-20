export type QuizStatus = 'generating' | 'ready' | 'failed'
export type QuizQuestionType = 'single' | 'multiple'
export type QuizAttemptMode = 'full' | 'retry_wrong'

export interface QuizStats {
  question_count: number
  attempt_count: number
  /** Percent of the most recent finished attempt, null before the first one */
  last_score_pct: number | null
  best_score_pct: number | null
  /** Questions answered at least once */
  answered_count: number
  /** Questions whose latest answer was correct */
  mastered_count: number
  /** Questions whose latest answer was wrong (what "repeat wrong" asks) */
  wrong_count: number
}

export interface QuizSettings {
  num_questions?: number
  max_options?: number
  model_id?: string | null
  language?: string | null
  /** Set when generation finished; can be below num_questions */
  generated_questions?: number
}

export interface Quiz {
  id: string
  name: string
  notebook_id: string | null
  status: QuizStatus
  error: string | null
  settings: QuizSettings | null
  created: string | null
  updated: string | null
  stats: QuizStats
}

export interface QuizOption {
  id: string
  text: string
}

/** A question as shown while answering: the solution only arrives with the answer. */
export interface QuizQuestion {
  id: string
  position: number
  type: QuizQuestionType
  question: string
  options: QuizOption[]
}

export interface QuizDetail extends Quiz {
  questions: QuizQuestion[]
}

export interface QuizGenerateRequest {
  name: string
  notebook_id: string
  /** Same format as POST /chat/context; omit to use the whole notebook */
  context_config?: {
    sources: Record<string, string>
    notes: Record<string, string>
  }
  num_questions: number
  max_options: number
  model_id?: string
  language?: string
}

export interface QuizGenerateResponse {
  quiz_id: string
  job_id: string
  status: string
}

export interface QuizAttempt {
  id: string
  quiz_id: string
  mode: QuizAttemptMode
  total: number
  finished: boolean
  questions: QuizQuestion[]
}

export interface QuizAnswerRequest {
  question_id: string
  selected_option_ids: string[]
}

export interface QuizAnswerResult {
  question_id: string
  is_correct: boolean
  correct_option_ids: string[]
  explanation: string | null
}

export interface QuizFinishResult {
  attempt_id: string
  score: number
  total: number
  score_pct: number
  wrong_question_ids: string[]
  stats: QuizStats
}

/** Bounds enforced by the API; keep in sync with api/models.py QuizGenerateRequest. */
export const QUIZ_LIMITS = {
  minQuestions: 1,
  maxQuestions: 50,
  minOptions: 2,
  maxOptions: 8,
  defaultQuestions: 10,
  defaultOptions: 4,
} as const
