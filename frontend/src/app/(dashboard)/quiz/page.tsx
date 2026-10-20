'use client'

import { useState } from 'react'
import { ListChecks, Plus } from 'lucide-react'

import { AppShell } from '@/components/layout/AppShell'
import { QuizzesTab } from '@/components/quiz/QuizzesTab'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useTranslation } from '@/lib/hooks/use-translation'

type QuizTab = 'quizzes' | 'create'

export default function QuizPage() {
  const { t } = useTranslation()
  const [activeTab, setActiveTab] = useState<QuizTab>('quizzes')

  return (
    <AppShell>
      <div className="flex-1 overflow-y-auto">
        <div className="px-6 py-6 space-y-6">
          <header className="space-y-1">
            <h1 className="font-display text-2xl font-bold tracking-tight">{t('quiz.title')}</h1>
            <p className="text-muted-foreground">{t('quiz.description')}</p>
          </header>

          <Tabs
            value={activeTab}
            onValueChange={(value) => setActiveTab(value as QuizTab)}
            className="space-y-6"
          >
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {t('quiz.chooseAView')}
              </p>
              <TabsList aria-label={t('common.accessibility.quizViews')} className="w-full max-w-md">
                <TabsTrigger value="quizzes">
                  <ListChecks className="h-4 w-4" />
                  {t('quiz.myQuizzesTab')}
                </TabsTrigger>
                <TabsTrigger value="create">
                  <Plus className="h-4 w-4" />
                  {t('quiz.createTab')}
                </TabsTrigger>
              </TabsList>
            </div>

            <TabsContent value="quizzes">
              <QuizzesTab onCreate={() => setActiveTab('create')} />
            </TabsContent>

            <TabsContent value="create">{/* quiz creation form: next step */}</TabsContent>
          </Tabs>
        </div>
      </div>
    </AppShell>
  )
}
