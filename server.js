require("dotenv").config();
const express = require("express");
const { GoogleGenAI } = require("@google/genai");

const app = express();

app.use(express.json({ limit: "4mb" }));
app.use(express.static(__dirname));

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY
});

const MODEL = "gemini-3.8-flash";

async function askGemini(messages, options = {}) {
  const systemMessage =
    messages.find(m => m.role === "system")?.content || "";

  const userMessages = messages
    .filter(m => m.role !== "system")
    .map(m => m.content)
    .join("\n\n");

  const response = await ai.models.generateContent({
    model: MODEL,
    contents: userMessages,
    config: {
      systemInstruction: systemMessage,
      temperature: options.temperature ?? 0.7,
      maxOutputTokens: options.maxOutputTokens ?? 5000,
      ...(options.json
        ? {
            responseMimeType: "application/json"
          }
        : {})
    }
  });

  if (!response.text) {
    throw new Error("Gemini returned an empty response.");
  }

  return response.text;
}

function cleanJson(raw) {
  return raw
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}


// =========================
// AI TUTOR
// =========================

app.post("/api/ask", async (req, res) => {
  try {
    const question = String(req.body.question || "").trim();

    if (!question) {
      return res.status(400).json({
        error: "Question is required."
      });
    }

    const answer = await askGemini([
      {
        role: "system",
        content:
          "You are StudyBloom, a friendly AI tutor. Explain clearly for a college student. Keep answers simple and useful."
      },
      {
        role: "user",
        content: question
      }
    ]);

    res.json({ answer });

  } catch (err) {
    console.error(err);

    res.status(500).json({
      error: err.message || "AI tutor failed."
    });
  }
});


// =========================
// AI STUDY PLANNER
// =========================

app.post("/api/plan", async (req, res) => {
  try {
    const notes = String(req.body.notes || "").trim();
    const examDate = String(req.body.examDate || "").trim();
    const studyMinutes = Number(req.body.studyMinutes || 60);

    if (!notes) {
      return res.status(400).json({
        error: "Notes are required."
      });
    }

    if (!examDate) {
      return res.status(400).json({
        error: "Exam date is required."
      });
    }

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

    const raw = await askGemini([
      {
        role: "system",
        content:
          "You create structured study plans. Return JSON only."
      },
      {
        role: "user",
        content: prompt
      }
    ], {
      json: true,
      temperature: 0.3,
      maxOutputTokens: 4000
    });

    const plan = JSON.parse(cleanJson(raw));

    res.json(plan);

  } catch (err) {
    console.error(err);

    res.status(500).json({
      error: err.message || "Could not create study plan."
    });
  }
});


// =========================
// QUIZ GENERATOR
// =========================

app.post("/api/quiz", async (req, res) => {
  try {
    const notes = String(req.body.notes || "").trim();

    const count = Math.min(
      Math.max(Number(req.body.count || 10), 5),
      15
    );

    const difficulty = String(
      req.body.difficulty || "medium"
    );

    if (!notes) {
      return res.status(400).json({
        error: "Notes are required."
      });
    }

    const makePrompt = (retry = false) => `Create a multiple-choice quiz using ONLY the information in these notes.

Number of questions: ${count}
Difficulty: ${difficulty}

${retry
  ? `IMPORTANT: Your previous response did not contain exactly ${count} questions. This time you MUST return exactly ${count} questions. Count them carefully before responding.`
  : ""}

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
- The questions array MUST contain exactly ${count} questions.
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

      const raw = await askGemini([
        {
          role: "system",
          content:
            "You generate MCQ quizzes. Output ONLY valid JSON. Follow the requested question count exactly."
        },
        {
          role: "user",
          content: makePrompt(retry)
        }
      ], {
        json: true,
        temperature: 0.1,
        maxOutputTokens: 6000
      });

      return JSON.parse(cleanJson(raw));
    }

    let quiz = await generateQuizOnce(false);

    // Automatic correction attempt
    if (
      !Array.isArray(quiz.questions) ||
      quiz.questions.length !== count
    ) {
      quiz = await generateQuizOnce(true);
    }

    if (
      !Array.isArray(quiz.questions) ||
      quiz.questions.length !== count
    ) {
      throw new Error(
        `The AI returned ${
          Array.isArray(quiz.questions)
            ? quiz.questions.length
            : 0
        } questions instead of ${count}. Please click Generate Quiz again.`
      );
    }

    quiz.questions.forEach((q, index) => {

      if (
        !q.question ||
        !Array.isArray(q.options) ||
        q.options.length !== 4
      ) {
        throw new Error(
          `Question ${index + 1} is incomplete. Please generate the quiz again.`
        );
      }

      if (![0, 1, 2, 3].includes(q.answerIndex)) {
        throw new Error(
          `Question ${index + 1} has an invalid answer. Please generate the quiz again.`
        );
      }
    });

    res.json(quiz);

  } catch (err) {
    console.error(err);

    res.status(500).json({
      error: err.message || "Could not create quiz."
    });
  }
});


// =========================
// START SERVER
// =========================

const PORT = process.env.PORT || 3000;

app.listen(PORT, "0.0.0.0", () => {
  console.log(`StudyBloom is running on port ${PORT}`);
});require("dotenv").config();