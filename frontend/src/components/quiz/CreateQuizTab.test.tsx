import type { ReactNode } from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'

import { CreateQuizTab } from './CreateQuizTab'

// useTranslation is mocked globally in setup.ts (t returns the key string)

// Radix checkboxes and scroll areas observe their size; jsdom has no ResizeObserver.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal('ResizeObserver', ResizeObserverStub)

// Radix Select needs pointer APIs jsdom lacks; a native <select> keeps the
// tests about the form, not the widget.
vi.mock('@/components/ui/select', () => ({
  Select: ({
    value,
    onValueChange,
    children,
  }: {
    value: string
    onValueChange: (v: string) => void
    children: ReactNode
  }) => (
    <select
      value={value}
      onChange={(event) => onValueChange(event.target.value)}
    >
      {children}
    </select>
  ),
  SelectTrigger: () => null,
  SelectValue: () => null,
  SelectContent: ({ children }: { children: ReactNode }) => <>{children}</>,
  SelectItem: ({ value, children }: { value: string; children: ReactNode }) => (
    <option value={value}>{children}</option>
  ),
}))

const mutate = vi.fn()
vi.mock('@/lib/hooks/use-quizzes', () => ({
  useGenerateQuiz: () => ({ mutate, isPending: false }),
}))

vi.mock('@/lib/hooks/use-notebooks', () => ({
  useNotebooks: () => ({
    data: [
      { id: 'notebook:1', name: 'Biology' },
      { id: 'notebook:2', name: 'History' },
    ],
  }),
}))

vi.mock('@/lib/hooks/use-models', () => ({
  useModels: () => ({
    data: [
      { id: 'model:lang', name: 'gpt-test', provider: 'openai', type: 'language' },
      { id: 'model:emb', name: 'embed-test', provider: 'openai', type: 'embedding' },
    ],
  }),
}))

vi.mock('@/lib/hooks/use-podcasts', () => ({
  useLanguages: () => ({ data: [{ code: 'de-DE', name: 'German' }] }),
}))

const content = {
  sources: [
    { id: 'source:a', title: 'Cells' },
    { id: 'source:b', title: null },
  ],
  notes: [{ id: 'note:x', title: 'My note' }],
  isLoading: false,
  isError: false,
  sourcesTruncated: false,
}
vi.mock('@/lib/hooks/use-quiz-content', () => ({
  useQuizContentItems: (notebookId: string) =>
    notebookId
      ? content
      : { sources: [], notes: [], isLoading: false, isError: false, sourcesTruncated: false },
  useQuizContentSize: () => ({ data: { token_count: 1234, char_count: 5000 } }),
}))

function chooseNotebook(id: string) {
  const select = screen.getAllByRole('combobox')[0]
  fireEvent.change(select, { target: { value: id } })
}

describe('CreateQuizTab', () => {
  beforeEach(() => {
    mutate.mockReset()
  })

  it('shows the content picker only after a notebook is chosen', () => {
    render(<CreateQuizTab onCreated={vi.fn()} />)
    expect(screen.queryByText('Cells')).not.toBeInTheDocument()

    chooseNotebook('notebook:1')

    expect(screen.getByText('Cells')).toBeInTheDocument()
    expect(screen.getByText('quiz.untitledSource')).toBeInTheDocument()
    expect(screen.getByText('My note')).toBeInTheDocument()
    expect(screen.getByText('quiz.itemsSelected')).toBeInTheDocument()
    expect(screen.getByText('quiz.tokens')).toBeInTheDocument()
  })

  it('offers only language models', () => {
    render(<CreateQuizTab onCreated={vi.fn()} />)
    expect(screen.getByText('gpt-test')).toBeInTheDocument()
    expect(screen.queryByText('embed-test')).not.toBeInTheDocument()
  })

  it('does not submit an incomplete form and explains what is missing', () => {
    render(<CreateQuizTab onCreated={vi.fn()} />)

    fireEvent.click(screen.getByText('quiz.generate'))

    expect(mutate).not.toHaveBeenCalled()
    expect(screen.getByText('quiz.notebookRequired')).toBeInTheDocument()
    expect(screen.getByText('quiz.nameRequired')).toBeInTheDocument()
  })

  it('rejects an invalid number of questions', () => {
    render(<CreateQuizTab onCreated={vi.fn()} />)
    chooseNotebook('notebook:1')

    fireEvent.change(screen.getByLabelText('quiz.numQuestions'), { target: { value: '99' } })
    fireEvent.click(screen.getByText('quiz.generate'))

    expect(mutate).not.toHaveBeenCalled()
    expect(screen.getByText('quiz.numQuestionsInvalid')).toBeInTheDocument()
  })

  it('prefills the quiz name from the notebook until the user types one', () => {
    render(<CreateQuizTab onCreated={vi.fn()} />)

    chooseNotebook('notebook:1')
    expect(screen.getByLabelText('quiz.quizName')).toHaveValue('quiz.defaultName')

    fireEvent.change(screen.getByLabelText('quiz.quizName'), { target: { value: 'Mine' } })
    chooseNotebook('notebook:2')
    expect(screen.getByLabelText('quiz.quizName')).toHaveValue('Mine')
  })

  it('submits the whole notebook when nothing was deselected', () => {
    render(<CreateQuizTab onCreated={vi.fn()} />)
    chooseNotebook('notebook:1')
    fireEvent.change(screen.getByLabelText('quiz.quizName'), { target: { value: 'Bio quiz' } })

    fireEvent.click(screen.getByText('quiz.generate'))

    expect(mutate).toHaveBeenCalledTimes(1)
    expect(mutate.mock.calls[0][0]).toEqual({
      name: 'Bio quiz',
      notebook_id: 'notebook:1',
      num_questions: 10,
      max_options: 4,
    })
  })

  it('submits only the sources and notes that stay checked', () => {
    render(<CreateQuizTab onCreated={vi.fn()} />)
    chooseNotebook('notebook:1')
    fireEvent.change(screen.getByLabelText('quiz.quizName'), { target: { value: 'Bio quiz' } })

    fireEvent.click(screen.getByLabelText('quiz.untitledSource')) // uncheck source:b
    fireEvent.click(screen.getByLabelText('My note')) // uncheck the note
    fireEvent.click(screen.getByText('quiz.generate'))

    expect(mutate.mock.calls[0][0].context_config).toEqual({
      sources: { a: 'full content' },
      notes: {},
    })
  })

  it('refuses to submit once everything is deselected', () => {
    render(<CreateQuizTab onCreated={vi.fn()} />)
    chooseNotebook('notebook:1')
    fireEvent.change(screen.getByLabelText('quiz.quizName'), { target: { value: 'Bio quiz' } })

    fireEvent.click(screen.getByText('quiz.selectNone'))
    fireEvent.click(screen.getByText('quiz.generate'))

    expect(mutate).not.toHaveBeenCalled()
    expect(screen.getByText('quiz.contentRequired')).toBeInTheDocument()
  })

  it('switches back to the list and resets the form after the job started', () => {
    const onCreated = vi.fn()
    mutate.mockImplementation((_payload, options) => options?.onSuccess?.())
    render(<CreateQuizTab onCreated={onCreated} />)
    chooseNotebook('notebook:1')
    fireEvent.change(screen.getByLabelText('quiz.quizName'), { target: { value: 'Bio quiz' } })

    fireEvent.click(screen.getByText('quiz.generate'))

    expect(onCreated).toHaveBeenCalledTimes(1)
    expect(screen.getByLabelText('quiz.quizName')).toHaveValue('')
  })
})
