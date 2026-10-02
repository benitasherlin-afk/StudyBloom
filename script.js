async function postJSON(url, body) {
  const res = await fetch(url, {
    method: "POST",
    headers: {"Content-Type": "application/json"},
    body: JSON.stringify(body)
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Something went wrong.");
  return data;
}

async function askTutor() {
  const input = document.getElementById("tutorInput").value.trim();
  const out = document.getElementById("tutorOutput");
  if (!input) return out.innerHTML = "Please enter a question.";

  out.innerHTML = "Thinking...";
  try {
    const data = await postJSON("/api/ask", {question: input});
    out.innerHTML = `<strong>AI Tutor:</strong><br>${escapeHtml(data.answer).replace(/\n/g,"<br>")}`;
  } catch (e) {
    out.innerHTML = "Error: " + escapeHtml(e.message);
  }
}

async function generatePlan() {
  const notes = document.getElementById("notesInput").value.trim();
  const examDate = document.getElementById("examDate").value;
  const studyMinutes = Number(document.getElementById("studyMinutes").value);
  const out = document.getElementById("planOutput");

  if (!notes) return out.innerHTML = "Please paste your notes first.";
  if (!examDate) return out.innerHTML = "Please select your exam date.";

  out.innerHTML = "Creating your study plan...";
  try {
    const data = await postJSON("/api/plan", {notes, examDate, studyMinutes});
    let html = `<h3>${escapeHtml(data.title || "Study Plan")}</h3>`;
    html += `<p>${escapeHtml(data.goal || "")}</p>`;
    (data.schedule || []).forEach((s, i) => {
      html += `<div class="question"><strong>Day ${i+1}: ${escapeHtml(s.focus)}</strong>
      <p>${escapeHtml(s.duration || "")}</p>
      <p>${escapeHtml(s.reason || "")}</p>
      <ul>${(s.tasks || []).map(t => `<li>${escapeHtml(t)}</li>`).join("")}</ul></div>`;
    });
    out.innerHTML = html;
  } catch (e) {
    out.innerHTML = "Error: " + escapeHtml(e.message);
  }
}

async function generateQuiz() {
  const notes = document.getElementById("quizNotes").value.trim();
  const count = Number(document.getElementById("quizCount").value);
  const difficulty = document.getElementById("quizDifficulty").value;
  const out = document.getElementById("quizOutput");

  if (!notes) return out.innerHTML = "Please paste your notes first.";

  out.innerHTML = "Generating your quiz...";
  try {
    const quiz = await postJSON("/api/quiz", {notes, count, difficulty});
    renderQuiz(quiz);
  } catch (e) {
    out.innerHTML = "Error: " + escapeHtml(e.message);
  }
}

let currentQuiz = null;

function renderQuiz(quiz) {
  currentQuiz = quiz;
  const out = document.getElementById("quizOutput");
  let html = `<h3>${escapeHtml(quiz.title || "Quiz")}</h3>
              <p>${escapeHtml(quiz.instructions || "Choose the best answer.")}</p>`;

  quiz.questions.forEach((q, i) => {
    html += `<div class="question" id="question-${i}">
      <strong>${i+1}. ${escapeHtml(q.question)}</strong>
      <div class="small">Topic: ${escapeHtml(q.topic || "General")}</div>`;
    q.options.forEach((opt, j) => {
      html += `<label class="option">
        <input type="radio" name="q${i}" value="${j}">
        ${String.fromCharCode(65+j)}. ${escapeHtml(opt)}
      </label>`;
    });
    html += `</div>`;
  });

  html += `<button onclick="submitQuiz()">Submit Quiz</button>
           <div id="quizResult"></div>`;
  out.innerHTML = html;
}

function submitQuiz() {
  if (!currentQuiz) return;

  let score = 0;
  let answered = 0;
  const weak = [];

  currentQuiz.questions.forEach((q, i) => {
    const selected = document.querySelector(`input[name="q${i}"]:checked`);
    const box = document.getElementById(`question-${i}`);
    const labels = box.querySelectorAll(".option");

    labels.forEach((label, j) => {
      label.classList.remove("correct", "wrong");
      if (j === q.answerIndex) label.classList.add("correct");
    });

    if (selected) {
      answered++;
      const chosen = Number(selected.value);
      if (chosen === q.answerIndex) {
        score++;
      } else {
        labels[chosen].classList.add("wrong");
        weak.push(q.topic || "General");
      }
    } else {
      weak.push(q.topic || "General");
    }
  });

  const total = currentQuiz.questions.length;
  const percent = Math.round((score / total) * 100);
  const uniqueWeak = [...new Set(weak)];

  document.getElementById("quizResult").innerHTML = `
    <div class="card">
      <h3>Score: ${score}/${total} (${percent}%)</h3>
      <p>Answered: ${answered}/${total}</p>
      <p><strong>Topics to review:</strong> ${
        uniqueWeak.length ? uniqueWeak.map(escapeHtml).join(", ") : "None — great job!"
      }</p>
    </div>`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
