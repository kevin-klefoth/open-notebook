import apiClient from './client'
import {
  Quiz,
  QuizAnswerRequest,
  QuizAnswerResult,
  QuizAttempt,
  QuizAttemptMode,
  QuizDetail,
  QuizFinishResult,
  QuizGenerateRequest,
  QuizGenerateResponse,
} from '@/lib/types/quiz'

export const quizzesApi = {
  list: async (notebookId?: string) => {
    const response = await apiClient.get<Quiz[]>('/quizzes', {
      params: notebookId ? { notebook_id: notebookId } : undefined,
    })
    return response.data
  },

  get: async (quizId: string) => {
    const response = await apiClient.get<QuizDetail>(`/quizzes/${quizId}`)
    return response.data
  },

  generate: async (payload: QuizGenerateRequest) => {
    const response = await apiClient.post<QuizGenerateResponse>(
      '/quizzes/generate',
      payload
    )
    return response.data
  },

  delete: async (quizId: string) => {
    await apiClient.delete(`/quizzes/${quizId}`)
  },

  startAttempt: async (quizId: string, mode: QuizAttemptMode) => {
    const response = await apiClient.post<QuizAttempt>(
      `/quizzes/${quizId}/attempts`,
      { mode }
    )
    return response.data
  },

  answer: async (attemptId: string, payload: QuizAnswerRequest) => {
    const response = await apiClient.post<QuizAnswerResult>(
      `/quizzes/attempts/${attemptId}/answers`,
      payload
    )
    return response.data
  },

  finishAttempt: async (attemptId: string) => {
    const response = await apiClient.post<QuizFinishResult>(
      `/quizzes/attempts/${attemptId}/finish`
    )
    return response.data
  },
}
