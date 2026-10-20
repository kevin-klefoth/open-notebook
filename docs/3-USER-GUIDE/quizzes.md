# Quizzes - Test What You Learned

Turn a notebook into a quiz with single-choice and multiple-choice questions, answer it, and repeat the questions you got wrong. Quizzes live on the **Quiz** page (sidebar, under **Create**), which has two tabs: **My quizzes** and **New quiz**.

A quiz needs a language model: the **Transformation Model**, or the **Chat Model** if none is set (see [Before You Start](index.md#before-you-start)). You can also pick another language model per quiz. The **worker** must be running, because questions are generated as a background job.

---

## Create a Quiz

Open **Quiz → New quiz** and fill in:

| Field | Notes |
|-------|-------|
| **Notebook** | The notebook the questions are based on |
| **Quiz name** | Filled in from the notebook name until you type your own |
| **Content** | Every source and note of the notebook is selected. Untick what the quiz should leave out, or use **Select none** and tick only what you want. The badges show how many items are selected and how many tokens they add up to |
| **Number of questions** | 1 to 50 |
| **Maximum answer options** | 2 to 8. Each question gets up to this many options. Multiple-choice questions need at least 3, so with 2 you only get single-choice questions |
| **Model** | **Default model**, or any language model you have added in **Manage → Models** |
| **Language** | **Same as the content**, or a fixed language for questions, options and explanations |

Click **Generate quiz**. The quiz appears in **My quizzes** right away with **Generating questions...** and becomes playable when it is ready, usually within a minute. If generation fails, the card says why (no model configured, the model's answer could not be used, ...) and you can delete it and try again, often with another model.

Notes:

- The questions are based on the full text and insights of the selected sources and on your notes. The quiz is a snapshot: editing or deleting a source later doesn't change an existing quiz.
- Some models return fewer usable questions than you asked for. The quiz keeps what worked, and its card says, for example, "Only 8 of 10 questions could be generated."
- Large selections are sent to your **Large Context Model** when they exceed about 105,000 tokens (the same rule as chat).

---

## My Quizzes

Each quiz is a card with:

- **Mastered**: the bar and "7 of 10 mastered". A question counts as mastered when your latest answer to it was correct.
- **To repeat**: how many questions your latest answer got wrong. Skipped questions count as wrong.
- **Attempts**, **Last result** and **Best result**: for finished attempts. A repetition of only the wrong questions is an attempt too, so its result is a percentage of the repeated questions.
- **Start quiz**: all questions, in order.
- **Repeat wrong questions**: only the questions you last got wrong. Disabled while there are none.
- The trash icon deletes the quiz with all its results, after a confirmation.

---

## Answering

One question per step:

- **Single choice**: pick one answer. **Multiple choice**: tick every answer that applies. The question tells you which kind it is.
- **Check answer** marks each option as **Correct**, **Wrong** (you ticked it, but it is wrong) or **Missed** (correct, but you didn't tick it), and shows the explanation. For multiple choice you need exactly the right set; a partly right answer counts as wrong.
- **Next question**, and on the last one **Finish quiz**. Questions you leave by closing the page are not recorded until you answer them; finishing records the unanswered ones as wrong.

The result page shows your score, how many questions are mastered, and offers **Repeat wrong questions**, **Start over** and **Back to quizzes**. Answers are recorded as you go, so the cards are up to date even if you leave in the middle.

---

## Troubleshooting

| Problem | What to do |
|---------|------------|
| A quiz stays on **Generating questions...** | The worker isn't running (`make worker-start`, or the worker process of your Docker setup). If it crashed during generation, delete the quiz and create it again |
| **No model configured for ... transformation** | Set a Chat or Transformation model in **Manage → Models → Default Model Assignments**, or choose a model in the quiz form |
| **The model did not return any usable quiz questions** | The model's answer wasn't valid. Try another model or select less content |
| The notebook list in **New quiz** is empty | Create a notebook and add sources or notes first |
