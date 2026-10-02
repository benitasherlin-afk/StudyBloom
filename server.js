const express = require("express");

const app = express();
app.use(express.json({limit: "4mb"}));
app.use(express.static(__dirname));

async function askOllama(messages, options = {}) {
  const response = await fetch("http://localhost:11434/api/chat", {
    method: "POST",
    headers: {"Content-Type": "application/json"},
    body: JSON.stringify({
      model: "llama3.2",
      messages,
      stream: false,
      ...options
    })
  });

  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Ollama request failed.");
  if (!data.message?.content) throw new Error("The local AI returned an empty response.");
  return data.message.content;
}

function cleanJson(raw) {
  return raw
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

app.post("/api/ask", async (req, res) => {
  try {
    const question = String(req.body.question || "").trim();
    if (!question) return res.status(400).json({error: "Question is required."});

    const answer = await askOllama([
      {role: "system", content: "You are StudyBloom, a friendly AI tutor. Explain clearly for a college student. Keep answers simple and useful."},
      {role: "user", content: question}
    ]);

    res.json({answer});
  } catch (err) {
    res.status(500).json({error: err.message});
  }
});

app.post("/api/plan", async (req, res) => {
  try {
    const notes = String(req.body.notes || "").trim();
    const examDate = String(req.body.examDate || "").trim();
    const studyMinutes = Number(req.body.studyMinutes || 60);

    if (!notes) return res.status(400).json({error: "Notes are required."});
    if (!examDate) return res.status(400).json({error: "Exam date is required."});

    const prompt = `Create a realistic study plan from ONLY the supplied notes.

Exam date: ${examDate}
Study time per day: ${studyMinutes} minutes

Return ONLY valid JSON:
{
  "title": "...",
  "goal": "...",
  "schedule": [
    {
      "focus": "...",
      "duration": "...",
      "reason": "...",
      "tasks": ["...", "..."]
    }
  ]
}

Rules:
- Identify topics only from the notes.
- Do not invent topics.
- Break topics across available study days.
- Include active recall, practice, revision, and final review when appropriate.
- Keep each day's work within the daily study time.
- Keep the language simple.

NOTES:
${notes}`;

    const raw = await askOllama([
      {role: "system", content: "You create structured study plans. Return JSON only."},
      {role: "user", content: prompt}
    ]);

    const plan = JSON.parse(cleanJson(raw));
    res.json(plan);
  } catch (err) {
    res.status(500).json({error: err.message || "Could not create study plan."});
  }
});

app.post("/api/quiz", async (req, res) => {
  try {
    const notes = String(req.body.notes || "").trim();
    const count = Math.min(Math.max(Number(req.body.count || 10), 5), 15);
    const difficulty = String(req.body.difficulty || "medium");

    if (!notes) return res.status(400).json({error: "Notes are required."});

    const makePrompt = (retry = false) => `Create a multiple-choice quiz using ONLY the information in these notes.

Number of questions: ${count}
Difficulty: ${difficulty}
${retry ? `IMPORTANT: Your previous response did not contain exactly ${count} questions. This time you MUST return exactly ${count} questions. Count them carefully before responding.` : ""}

Return ONLY valid JSON in exactly this structure:
{
  "title": "StudyBloom Quiz",
  "instructions": "Choose the best answer.",
  "questions": [
    {
      "question": "...",
      "options": ["...", "...", "...", "..."],
      "answerIndex": 0,
      "topic": "..."
    }
  ]
}

Rules:
- The questions array MUST contain exactly ${count} questions — no more and no fewer.
- Exactly 4 options for every question.
- Exactly one correct answer for every question.
- answerIndex must be 0, 1, 2, or 3.
- Use only information supported by the notes.
- Cover different topics when possible.
- Keep questions clear and college-friendly.
- The topic field should name the topic being tested.
- Do not add explanations, markdown, or text outside the JSON.

NOTES:
${notes}`;

    async function generateQuizOnce(retry = false) {
      const raw = await askOllama([
        {role: "system", content: "You generate MCQ quizzes. Output ONLY valid JSON. Follow the requested question count exactly."},
        {role: "user", content: makePrompt(retry)}
      ], {
        format: "json",
        options: {temperature: 0.1, num_predict: 5000}
      });

      const quiz = JSON.parse(cleanJson(raw));
      return quiz;
    }

    let quiz = await generateQuizOnce(false);

    // Llama can occasionally stop early. Give it one automatic correction attempt.
    if (!Array.isArray(quiz.questions) || quiz.questions.length !== count) {
      quiz = await generateQuizOnce(true);
    }

    if (!Array.isArray(quiz.questions) || quiz.questions.length !== count) {
      throw new Error(`The AI returned ${Array.isArray(quiz.questions) ? quiz.questions.length : 0} questions instead of ${count}. Please click Generate Quiz again.`);
    }

    quiz.questions.forEach((q, index) => {
      if (!q.question || !Array.isArray(q.options) || q.options.length !== 4) {
        throw new Error(`Question ${index + 1} is incomplete. Please generate the quiz again.`);
      }
      if (![0,1,2,3].includes(q.answerIndex)) {
        throw new Error(`Question ${index + 1} has an invalid answer. Please generate the quiz again.`);
      }
    });

    res.json(quiz);
  } catch (err) {
    res.status(500).json({error: err.message || "Could not create quiz."});
  }
});

app.listen(3000, () => {
  console.log("StudyBloom is running at http://localhost:3000");
});
