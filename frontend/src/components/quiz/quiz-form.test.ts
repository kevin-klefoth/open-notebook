import { describe, it, expect } from 'vitest'

import {
  AUTO,
  QuizFormValues,
  buildContextConfig,
  buildGenerateRequest,
  parseNumQuestions,
  validateQuizForm,
} from './quiz-form'

const ITEMS = {
  sourceIds: ['source:a', 'source:b'],
  noteIds: ['note:x'],
}

function values(overrides: Partial<QuizFormValues> = {}): QuizFormValues {
  return {
    name: 'My quiz',
    notebookId: 'notebook:1',
    numQuestions: '10',
    maxOptions: 4,
    modelId: AUTO,
    language: AUTO,
    deselectedSourceIds: new Set(),
    deselectedNoteIds: new Set(),
    ...overrides,
  }
}

describe('parseNumQuestions', () => {
  it.each([
    ['1', 1],
    ['10', 10],
    [' 50 ', 50],
  ])('accepts %j', (raw, expected) => {
    expect(parseNumQuestions(raw)).toBe(expected)
  })

  it.each(['', '0', '51', '-3', '2.5', 'abc', '1e1'])('rejects %j', (raw) => {
    expect(parseNumQuestions(raw)).toBeNull()
  })
})

describe('validateQuizForm', () => {
  it('accepts a complete form', () => {
    expect(validateQuizForm(values(), ITEMS)).toEqual([])
  })

  it('requires a name, a notebook and a valid number of questions', () => {
    expect(
      validateQuizForm(values({ name: '  ', notebookId: '', numQuestions: '0' }), ITEMS)
    ).toEqual(['nameRequired', 'notebookRequired', 'numQuestionsInvalid'])
  })

  it('requires at least one selected source or note', () => {
    const none = values({
      deselectedSourceIds: new Set(ITEMS.sourceIds),
      deselectedNoteIds: new Set(ITEMS.noteIds),
    })
    expect(validateQuizForm(none, ITEMS)).toEqual(['contentRequired'])
  })

  it('is satisfied by a single note', () => {
    const onlyNote = values({ deselectedSourceIds: new Set(ITEMS.sourceIds) })
    expect(validateQuizForm(onlyNote, ITEMS)).toEqual([])
  })

  it('does not report missing content before a notebook is chosen', () => {
    expect(validateQuizForm(values({ notebookId: '' }), { sourceIds: [], noteIds: [] })).toEqual([
      'notebookRequired',
    ])
  })
})

describe('buildContextConfig', () => {
  it('lists the selected items without table prefixes, as full content', () => {
    const config = buildContextConfig(ITEMS, {
      deselectedSourceIds: new Set(['source:b']),
      deselectedNoteIds: new Set(),
    })
    expect(config).toEqual({
      sources: { a: 'full content' },
      notes: { x: 'full content' },
    })
  })
})

describe('buildGenerateRequest', () => {
  it('omits the selection, model and language when left on their defaults', () => {
    expect(buildGenerateRequest(values({ name: '  Biology ' }), ITEMS)).toEqual({
      name: 'Biology',
      notebook_id: 'notebook:1',
      num_questions: 10,
      max_options: 4,
    })
  })

  it('sends the selection once the user narrowed it', () => {
    const request = buildGenerateRequest(
      values({ deselectedNoteIds: new Set(['note:x']) }),
      ITEMS
    )
    expect(request.context_config).toEqual({
      sources: { a: 'full content', b: 'full content' },
      notes: {},
    })
  })

  it('sends an explicit model and language', () => {
    const request = buildGenerateRequest(
      values({ modelId: 'model:abc', language: 'German', numQuestions: '7', maxOptions: 5 }),
      ITEMS
    )
    expect(request).toMatchObject({
      model_id: 'model:abc',
      language: 'German',
      num_questions: 7,
      max_options: 5,
    })
  })

  it('refuses an invalid number of questions', () => {
    expect(() => buildGenerateRequest(values({ numQuestions: 'x' }), ITEMS)).toThrow()
  })
})
