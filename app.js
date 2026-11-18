const MEDIA_BUCKET = "class-media";
const IMAGE_LIMIT = 15 * 1024 * 1024;
const RESOURCE_LIMIT = 50 * 1024 * 1024;
const VIDEO_LIMIT = 100 * 1024 * 1024;
const pages = {
  home: document.getElementById("home-page"),
  units: document.getElementById("units-page"),
  questions: document.getElementById("questions-page"),
  challenge: document.getElementById("challenge-page"),
};
let client = null;
let currentUser = null;
let isTeacher = false;
let authRevision = 0;
let questionLoadRevision = 0;
let resources = [];
let questions = [];
let editingQuestion = null;
let challenge = null;

function setConnectionMessage(message, visible = true) {
  const banner = document.getElementById("connection-banner");
  banner.textContent = message;
  banner.hidden = !visible;
}

function showStatus(id, message, isError = false) {
  const status = document.getElementById(id);
  status.textContent = message;
  status.classList.toggle("status-error", isError);
}

function showPage(name) {
  Object.entries(pages).forEach(([pageName, page]) => {
    const active = pageName === name;
    page.hidden = !active;
    page.classList.toggle("active", active);
  });
  document.querySelectorAll(".nav-link").forEach((button) => {
    const active = button.dataset.page === name;
    button.classList.toggle("active", active);
    if (active) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  });
  window.scrollTo({ top: 0, behavior: "smooth" });
  if (name === "units") renderResources();
  if (name === "questions") renderQuestions();
}

document.querySelectorAll("[data-page]").forEach((button) => {
  button.addEventListener("click", (event) => {
    event.preventDefault();
    showPage(button.dataset.page);
  });
});

function newId() {
  return window.crypto && typeof window.crypto.randomUUID === "function"
    ? window.crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function textElement(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  element.textContent = text;
  return element;
}

function formatDate(value) {
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" })
    .format(new Date(value));
}

function formatSize(bytes) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function publicMediaUrl(path) {
  return client.storage.from(MEDIA_BUCKET).getPublicUrl(path).data.publicUrl;
}

function safeFileName(name) {
  return name.normalize("NFKD").replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 100) || "attachment";
}

function fileFromForm(data, name) {
  const file = data.get(name);
  return file && file.size > 0 ? file : null;
}

function setTeacherControls() {
  document.getElementById("login-open").hidden = Boolean(currentUser);
  document.getElementById("user-panel").hidden = !currentUser;
  document.getElementById("resource-form").hidden = !isTeacher;
  document.getElementById("new-question-button").hidden = !isTeacher;
  if (!isTeacher) document.getElementById("question-form").hidden = true;
  document.getElementById("units-page").classList.toggle("teacher-view", isTeacher);
  document.querySelector("#user-panel small").textContent = isTeacher ? "TEACHER ACCESS" : "NO TEACHER ACCESS";
  if (currentUser) {
    document.getElementById("user-email").textContent = currentUser.email || "Teacher account";
  }
}

function setEmpty(list, count, title, detail) {
  const empty = document.createElement("div");
  empty.className = "empty-state";
  empty.append(
    textElement("span", "", "✧"),
    textElement("strong", "", title),
    textElement("p", "", detail),
  );
  list.replaceChildren(empty);
  if (count) count.textContent = "0";
}

async function loadResources() {
  if (!client) return;
  const list = document.getElementById("resource-list");
  const count = document.getElementById("resource-count");
  showStatus("resource-status", "");
  try {
    const { data, error } = await client
      .from("unit_resources")
      .select("id, title, file_path, file_name, file_type, created_at")
      .order("created_at", { ascending: false });
    if (error) throw error;
    resources = data || [];
    renderResources();
  } catch (error) {
    showStatus("resource-status", `Could not load unit materials: ${error.message}`, true);
    setEmpty(list, count, "Materials unavailable", "Check the connection or ask your teacher for help.");
  }
}

function createResourceCard(resource) {
  const card = document.createElement("article");
  card.className = "resource-card";
  const icon = textElement("span", "resource-icon", resource.file_name.toLowerCase().endsWith(".pdf") ? "PDF" : "PPT");
  icon.setAttribute("aria-hidden", "true");
  const details = document.createElement("div");
  details.className = "resource-details";
  details.append(textElement("h3", "resource-title", resource.title));
  details.append(textElement("p", "resource-meta", `${resource.file_name} · ${formatDate(resource.created_at)}`));
  const actions = document.createElement("div");
  actions.className = "resource-actions";
  const link = document.createElement("a");
  link.className = "button button-secondary button-small";
  link.href = publicMediaUrl(resource.file_path);
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.textContent = "Open file ↗";
  actions.append(link);
  if (isTeacher) {
    const remove = document.createElement("button");
    remove.className = "entry-action delete-action";
    remove.type = "button";
    remove.textContent = "Remove";
    remove.addEventListener("click", () => deleteResource(resource, remove));
    actions.append(remove);
  }
  card.append(icon, details, actions);
  return card;
}

function renderResources() {
  const list = document.getElementById("resource-list");
  const count = document.getElementById("resource-count");
  count.textContent = String(resources.length);
  if (!resources.length) {
    setEmpty(list, null, "No unit files yet", "Your teacher's slides and handouts will appear here.");
    count.textContent = "0";
    return;
  }
  list.replaceChildren(...resources.map(createResourceCard));
}

async function uploadMedia(path, file) {
  const { data, error } = await client.storage.from(MEDIA_BUCKET).upload(path, file, {
    cacheControl: "3600",
    contentType: file.type || undefined,
    upsert: false,
  });
  if (error) throw new Error(error.message);
  return data.path;
}

async function removeMedia(paths) {
  const existing = paths.filter(Boolean);
  if (!existing.length) return null;
  const { error } = await client.storage.from(MEDIA_BUCKET).remove(existing);
  return error;
}

function validResourceFile(file) {
  const extension = file.name.split(".").pop().toLowerCase();
  return ["ppt", "pptx", "pdf"].includes(extension);
}

document.getElementById("resource-file").addEventListener("change", (event) => {
  const file = event.currentTarget.files[0];
  document.getElementById("resource-file-name").textContent = file ? file.name : "No file selected";
  showStatus("resource-message", "");
});

document.getElementById("resource-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!client || !isTeacher || !currentUser) {
    showStatus("resource-message", "Only the teacher can upload unit files.", true);
    return;
  }
  const form = event.currentTarget;
  const data = new FormData(form);
  const file = fileFromForm(data, "file");
  if (!file || !validResourceFile(file)) {
    showStatus("resource-message", "Choose a PowerPoint (.ppt or .pptx) or PDF file.", true);
    return;
  }
  if (file.size > RESOURCE_LIMIT) {
    showStatus("resource-message", "This file is larger than 50 MB. Choose a smaller file.", true);
    return;
  }
  const id = newId();
  const path = `${currentUser.id}/units/${id}/${safeFileName(file.name)}`;
  const button = form.querySelector('button[type="submit"]');
  button.disabled = true;
  showStatus("resource-message", "");
  try {
    const storedPath = await uploadMedia(path, file);
    const { error } = await client.from("unit_resources").insert({
      id,
      created_by: currentUser.id,
      title: data.get("title").trim() || file.name,
      file_path: storedPath,
      file_name: file.name,
      file_type: file.type || "application/octet-stream",
    });
    if (error) {
      try {
        const cleanupError = await removeMedia([storedPath]);
        if (cleanupError) throw cleanupError;
      } catch (cleanupError) {
        throw new Error(`Could not save the file record: ${error.message}. Uploaded file cleanup failed: ${cleanupError.message}`);
      }
      throw new Error(`Could not save the file record: ${error.message}`);
    }
    form.reset();
    document.getElementById("resource-file-name").textContent = "No file selected";
    resources.unshift({
      id,
      title: data.get("title").trim() || file.name,
      file_path: storedPath,
      file_name: file.name,
      file_type: file.type || "application/octet-stream",
      created_at: new Date().toISOString(),
    });
    renderResources();
  } catch (error) {
    showStatus("resource-message", `Could not upload this file: ${error.message}`, true);
  } finally {
    button.disabled = false;
  }
});

async function deleteResource(resource, button) {
  if (!isTeacher) return;
  if (!window.confirm(`Remove "${resource.title}" from unit review?`)) return;
  button.disabled = true;
  try {
    const { error } = await client.from("unit_resources").delete().eq("id", resource.id).select("id").single();
    if (error) throw error;
    resources = resources.filter((item) => item.id !== resource.id);
    renderResources();
    try {
      const cleanupError = await removeMedia([resource.file_path]);
      if (cleanupError) showStatus("resource-status", `File removed from the library, but storage cleanup failed: ${cleanupError.message}`, true);
    } catch (cleanupError) {
      showStatus("resource-status", `File removed from the library, but storage cleanup failed: ${cleanupError.message}`, true);
    }
  } catch (error) {
    button.disabled = false;
    showStatus("resource-status", `Could not remove this file: ${error.message}`, true);
  }
}

async function loadQuestions() {
  if (!client) return;
  const revision = ++questionLoadRevision;
  const list = document.getElementById("questions-list");
  const count = document.getElementById("question-count");
  showStatus("questions-status", "");
  setEmpty(list, count, "Loading questions", "Getting the class question set...");
  try {
    const { data, error } = await client
      .from("questions")
      .select("id, topic, prompt, image_path, choice_a, choice_b, choice_c, choice_d, created_at")
      .order("created_at", { ascending: false });
    if (error) throw error;
    if (revision !== questionLoadRevision) return;
    questions = data || [];
    renderQuestions();
  } catch (error) {
    if (revision !== questionLoadRevision) return;
    showStatus("questions-status", `Could not load Regents questions: ${error.message}`, true);
    setEmpty(list, count, "Questions unavailable", "Check your connection or ask your teacher for help.");
  }
}

function renderQuestions() {
  const list = document.getElementById("questions-list");
  const count = document.getElementById("question-count");
  const visibleQuestions = isTeacher ? questions : questions.filter(isValidMcq);
  count.textContent = String(visibleQuestions.length);
  if (!visibleQuestions.length) {
    setEmpty(list, null, "No practice questions yet", "Your teacher's Regents questions will appear here.");
    count.textContent = "0";
    return;
  }
  const legacyCount = visibleQuestions.filter((question) => !isValidMcq(question)).length;
  showStatus("questions-status", legacyCount ? `${legacyCount} old question(s) need to be recreated as multiple choice before students can use them.` : "");
  list.replaceChildren(...visibleQuestions.map((question) => createQuestionCard(question, "review")));
}

function isValidMcq(question) {
  return Boolean(question.prompt && question.prompt.trim()
    && ["a", "b", "c", "d"].every((letter) => question[`choice_${letter}`] && question[`choice_${letter}`].trim()));
}

function createChoice(question, letter, groupName) {
  const label = document.createElement("label");
  label.className = "mcq-choice";
  const input = document.createElement("input");
  input.type = "radio";
  input.name = groupName;
  input.value = letter;
  input.required = true;
  const letterBadge = textElement("span", "choice-letter", letter);
  const choiceText = textElement("span", "choice-text", question[`choice_${letter.toLowerCase()}`]);
  label.append(input, letterBadge, choiceText);
  return label;
}

function createQuestionCard(question, mode, onChallengeAnswer, onChallengeSkip) {
  const card = document.createElement("article");
  card.className = "entry-card question-card";
  const header = document.createElement("div");
  header.className = "entry-card-top";
  const titleGroup = document.createElement("div");
  titleGroup.style.flex = "1";
  titleGroup.append(textElement("h3", "entry-title", question.topic || "Regents practice"));
  titleGroup.append(textElement("p", "entry-meta", formatDate(question.created_at)));
  header.append(titleGroup);
  const validQuestion = isValidMcq(question);
  if (isTeacher && mode === "review") {
    const actions = document.createElement("div");
    actions.className = "entry-actions";
    if (validQuestion) {
      const edit = document.createElement("button");
      edit.className = "entry-action";
      edit.type = "button";
      edit.textContent = "Edit";
      edit.addEventListener("click", () => openQuestionEditor(question));
      actions.append(edit);
    }
    const remove = document.createElement("button");
    remove.className = "entry-action delete-action";
    remove.type = "button";
    remove.textContent = "Delete";
    remove.addEventListener("click", () => deleteQuestion(question, remove));
    actions.append(remove);
    header.append(actions);
  }
  card.append(header);
  if (!validQuestion) {
    card.append(textElement("p", "legacy-warning", "This older question is not a complete multiple-choice item. Remove it and add it again with choices and an answer key."));
    return card;
  }
  card.append(textElement("p", "question-prompt", question.prompt));
  if (question.image_path) {
    const image = document.createElement("img");
    image.className = "question-image";
    image.src = publicMediaUrl(question.image_path);
    image.alt = question.topic ? `Image for ${question.topic}` : "Regents question image";
    card.append(image);
  }
  const answerForm = document.createElement("form");
  answerForm.className = "mcq-form";
  const choices = document.createElement("div");
  choices.className = "choice-grid";
  const radioGroup = `${mode}-${question.id}-${newId()}`;
  ["A", "B", "C", "D"].forEach((letter) => choices.append(createChoice(question, letter, radioGroup)));
  const controls = document.createElement("div");
  controls.className = "mcq-controls";
  const skip = document.createElement("button");
  skip.className = "text-button skip-button";
  skip.type = "button";
  skip.textContent = "Skip question";
  const submit = document.createElement("button");
  submit.className = "button button-primary";
  submit.type = "submit";
  submit.textContent = "Check answer";
  controls.append(skip, submit);
  answerForm.append(choices, controls);

  const skipped = document.createElement("div");
  skipped.className = "skipped-message";
  skipped.hidden = true;
  skipped.append(textElement("span", "", "Skipped for now."));
  const tryAgain = document.createElement("button");
  tryAgain.className = "text-button";
  tryAgain.type = "button";
  tryAgain.textContent = "Try this question";
  skipped.append(tryAgain);

  const feedback = document.createElement("div");
  feedback.className = "answer-feedback";
  feedback.hidden = true;
  card.append(answerForm, skipped, feedback);

  skip.addEventListener("click", () => {
    if (mode === "challenge") {
      onChallengeSkip();
      return;
    }
    answerForm.hidden = true;
    skipped.hidden = false;
    card.classList.add("is-skipped");
  });
  tryAgain.addEventListener("click", () => {
    answerForm.hidden = false;
    skipped.hidden = true;
    card.classList.remove("is-skipped");
  });
  answerForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const selected = answerForm.querySelector('input[type="radio"]:checked');
    if (!selected) {
      showStatus("questions-status", "Choose A, B, C, or D before checking your answer.", true);
      return;
    }
    checkAnswer(question, selected.value, card, answerForm, feedback, submit, mode, onChallengeAnswer);
  });
  return card;
}

async function checkAnswer(question, selectedOption, card, form, feedback, submit, mode, onChallengeAnswer) {
  if (!client) return;
  submit.disabled = true;
  showStatus("questions-status", "");
  try {
    const { data, error } = await client.rpc("check_mcq_answer", {
      p_question_id: question.id,
      p_choice: selectedOption,
    });
    if (error) throw error;
    const result = Array.isArray(data) ? data[0] : data;
    if (!result) throw new Error("The answer check did not return a result.");
    form.hidden = true;
    renderAnswerFeedback(question, selectedOption, result, feedback);
    feedback.hidden = false;
    card.classList.add(result.is_correct ? "answer-correct" : "answer-incorrect");
    if (mode === "challenge") onChallengeAnswer(result.is_correct);
  } catch (error) {
    showStatus("questions-status", `Could not check this answer: ${error.message}`, true);
    submit.disabled = false;
  }
}

function renderAnswerFeedback(question, selectedOption, result, container) {
  const correct = Boolean(result.is_correct);
  container.replaceChildren();
  const heading = textElement("strong", correct ? "feedback-title feedback-good" : "feedback-title feedback-review",
    correct ? "Correct — nice work." : "Not quite. Review this one.");
  container.append(heading);
  if (!correct) {
    const correctChoice = question[`choice_${String(result.correct_option).toLowerCase()}`];
    container.append(textElement("p", "correct-answer", `Correct answer: ${result.correct_option}. ${correctChoice}`));
  }
  if (result.explanation) {
    const explanation = document.createElement("p");
    explanation.className = "explanation-copy";
    explanation.textContent = result.explanation;
    container.append(explanation);
  }
  if (result.explanation_video_path) {
    const video = document.createElement("video");
    video.className = "explanation-video";
    video.controls = true;
    video.preload = "metadata";
    video.src = publicMediaUrl(result.explanation_video_path);
    video.setAttribute("aria-label", "Teacher's video explanation");
    container.append(video);
  }
  if (result.explanation_video_url) {
    const link = document.createElement("a");
    link.className = "video-link";
    link.href = result.explanation_video_url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = "Watch the video explanation ↗";
    container.append(link);
  }
  if (challenge && challenge.active && container.closest("#challenge-question")) {
    const next = document.createElement("button");
    next.className = "button button-primary next-challenge";
    next.type = "button";
    next.textContent = challenge.index + 1 === challenge.items.length ? "See results" : "Next question";
    next.addEventListener("click", () => advanceChallenge(false));
    container.append(next);
  }
  if (selectedOption === result.correct_option && !correct) {
    container.append(textElement("p", "explanation-copy", "Your answer was recorded as incorrect."));
  }
}

async function openQuestionEditor(question) {
  if (!isTeacher) return;
  const form = document.getElementById("question-form");
  editingQuestion = question || null;
  form.reset();
  showStatus("question-message", "");
  document.getElementById("question-form-title").textContent = question ? "Edit question" : "Add a Regents question";
  document.getElementById("question-submit-label").textContent = question ? "Save changes" : "Save question";
  document.getElementById("question-image-name").textContent = "No file selected";
  document.getElementById("explanation-video-name").textContent = "No file selected";
  document.getElementById("question-image-hint").textContent = question && question.image_path ? "An image is attached. Choose a new image to replace it." : "";
  document.getElementById("explanation-video-hint").textContent = "";
  if (question) {
    const { data: solution, error } = await client
      .from("question_solutions")
      .select("correct_option, explanation, explanation_video_url, explanation_video_path")
      .eq("question_id", question.id)
      .single();
    if (error) {
      showStatus("question-message", `Could not load this question's answer key: ${error.message}`, true);
      return;
    }
    question.solution = solution;
    form.elements.topic.value = question.topic || "";
    form.elements.prompt.value = question.prompt;
    form.elements.choice_a.value = question.choice_a;
    form.elements.choice_b.value = question.choice_b;
    form.elements.choice_c.value = question.choice_c;
    form.elements.choice_d.value = question.choice_d;
    form.elements.correct_option.value = solution.correct_option;
    form.elements.explanation.value = solution.explanation || "";
    form.elements.explanation_url.value = solution.explanation_video_url || "";
    if (solution.explanation_video_path) {
      document.getElementById("explanation-video-hint").textContent = "A video is attached. Choose a new video to replace it.";
    }
  }
  form.hidden = false;
  form.scrollIntoView({ behavior: "smooth", block: "start" });
  document.getElementById("question-prompt").focus({ preventScroll: true });
}

function closeQuestionEditor() {
  editingQuestion = null;
  const form = document.getElementById("question-form");
  form.reset();
  form.hidden = true;
  document.getElementById("question-image-name").textContent = "No file selected";
  document.getElementById("explanation-video-name").textContent = "No file selected";
  document.getElementById("question-image-hint").textContent = "";
  document.getElementById("explanation-video-hint").textContent = "";
  showStatus("question-message", "");
}

document.getElementById("new-question-button").addEventListener("click", () => openQuestionEditor(null));
document.getElementById("cancel-question").addEventListener("click", closeQuestionEditor);
document.getElementById("question-image").addEventListener("change", (event) => {
  const file = event.currentTarget.files[0];
  document.getElementById("question-image-name").textContent = file ? file.name : "No file selected";
  document.getElementById("question-image-hint").textContent = file
    ? `${formatSize(file.size)} selected`
    : editingQuestion && editingQuestion.image_path ? "An image is attached. Choose a new image to replace it." : "";
});
document.getElementById("explanation-video").addEventListener("change", (event) => {
  const file = event.currentTarget.files[0];
  document.getElementById("explanation-video-name").textContent = file ? file.name : "No file selected";
  document.getElementById("explanation-video-hint").textContent = file
    ? `${formatSize(file.size)} selected`
    : editingQuestion && editingQuestion.solution && editingQuestion.solution.explanation_video_path
      ? "A video is attached. Choose a new video to replace it."
      : "";
});

async function uploadQuestion(questionId, imageFile, videoFile, videoUrl, oldSolution) {
  const uploaded = [];
  let imagePath = editingQuestion ? editingQuestion.image_path : null;
  let videoPath = oldSolution ? oldSolution.explanation_video_path : null;
  try {
    if (imageFile) {
      imagePath = await uploadMedia(`${currentUser.id}/questions/${questionId}/${newId()}-${safeFileName(imageFile.name)}`, imageFile);
      uploaded.push(imagePath);
    }
    if (videoFile) {
      videoPath = await uploadMedia(`${currentUser.id}/explanations/${questionId}/${newId()}-${safeFileName(videoFile.name)}`, videoFile);
      uploaded.push(videoPath);
    } else if (videoUrl) {
      videoPath = null;
    }
    return { imagePath, videoPath, uploaded };
  } catch (error) {
    try {
      const cleanupError = await removeMedia(uploaded);
      if (cleanupError) throw cleanupError;
    } catch (cleanupError) {
      throw new Error(`${error.message} Uploaded file cleanup failed: ${cleanupError.message}`);
    }
    throw error;
  }
}

document.getElementById("question-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!client || !isTeacher || !currentUser) {
    showStatus("question-message", "Only the teacher can manage Regents questions.", true);
    return;
  }
  const form = event.currentTarget;
  const data = new FormData(form);
  const imageFile = fileFromForm(data, "image");
  const videoFile = fileFromForm(data, "video");
  const videoUrl = data.get("explanation_url").trim();
  if (imageFile && (!imageFile.type.startsWith("image/") || imageFile.size > IMAGE_LIMIT)) {
    showStatus("question-message", "Choose an image file smaller than 15 MB.", true);
    return;
  }
  if (videoFile && (!["video/mp4", "video/webm"].includes(videoFile.type) || videoFile.size > VIDEO_LIMIT)) {
    showStatus("question-message", "Choose an MP4 or WebM video smaller than 100 MB.", true);
    return;
  }
  if (videoUrl) {
    try {
      if (new URL(videoUrl).protocol !== "https:") throw new Error("Video links must use HTTPS.");
    } catch (error) {
      showStatus("question-message", error.message || "Enter a valid HTTPS video link.", true);
      return;
    }
  }
  if (!data.get("explanation").trim() && !videoUrl && !videoFile
    && !(editingQuestion && editingQuestion.solution && editingQuestion.solution.explanation_video_path)) {
    showStatus("question-message", "Add a written or video explanation for students.", true);
    return;
  }

  const questionId = editingQuestion ? editingQuestion.id : newId();
  const oldImagePath = editingQuestion ? editingQuestion.image_path : null;
  const oldVideoPath = editingQuestion && editingQuestion.solution ? editingQuestion.solution.explanation_video_path : null;
  const button = form.querySelector('button[type="submit"]');
  button.disabled = true;
  showStatus("question-message", "");
  let uploadedPaths = [];
  let saved = false;
  try {
    const media = await uploadQuestion(questionId, imageFile, videoFile, videoUrl, editingQuestion && editingQuestion.solution);
    uploadedPaths = media.uploaded;
    const { error } = await client.rpc("save_mcq_question", {
      p_question_id: questionId,
      p_topic: data.get("topic").trim(),
      p_prompt: data.get("prompt").trim(),
      p_image_path: media.imagePath,
      p_choice_a: data.get("choice_a").trim(),
      p_choice_b: data.get("choice_b").trim(),
      p_choice_c: data.get("choice_c").trim(),
      p_choice_d: data.get("choice_d").trim(),
      p_correct_option: data.get("correct_option"),
      p_explanation: data.get("explanation").trim(),
      p_explanation_video_url: videoUrl,
      p_explanation_video_path: media.videoPath,
    });
    if (error) throw new Error(error.message);
    saved = true;
    closeQuestionEditor();
    const replacedPaths = [
      imageFile && oldImagePath && oldImagePath !== media.imagePath ? oldImagePath : null,
      (videoFile || videoUrl) && oldVideoPath && oldVideoPath !== media.videoPath ? oldVideoPath : null,
    ];
    try {
      const cleanupError = await removeMedia(replacedPaths);
      if (cleanupError) showStatus("questions-status", `Question saved, but old media cleanup failed: ${cleanupError.message}`, true);
    } catch (cleanupError) {
      showStatus("questions-status", `Question saved, but old media cleanup failed: ${cleanupError.message}`, true);
    }
    await loadQuestions();
  } catch (error) {
    if (saved) {
      showStatus("questions-status", `Question saved, but the list could not refresh: ${error.message}`, true);
      closeQuestionEditor();
      return;
    }
    try {
      const cleanupError = await removeMedia(uploadedPaths);
      if (cleanupError) throw cleanupError;
    } catch (cleanupError) {
      showStatus("question-message", `${error.message} Uploaded file cleanup failed: ${cleanupError.message}`, true);
      return;
    }
    showStatus("question-message", `Could not save this question: ${error.message}`, true);
  } finally {
    button.disabled = false;
  }
});

async function deleteQuestion(question, button) {
  if (!isTeacher || !window.confirm(`Delete "${question.topic || "this question"}"?`)) return;
  button.disabled = true;
  try {
    const { data: solution, error: solutionError } = await client
      .from("question_solutions")
      .select("explanation_video_path")
      .eq("question_id", question.id)
      .maybeSingle();
    if (solutionError) throw solutionError;
    const { error } = await client.from("questions").delete().eq("id", question.id).select("id").single();
    if (error) throw error;
    questions = questions.filter((item) => item.id !== question.id);
    renderQuestions();
    try {
      const cleanupError = await removeMedia([question.image_path, solution && solution.explanation_video_path]);
      if (cleanupError) showStatus("questions-status", `Question deleted, but its media could not be removed: ${cleanupError.message}`, true);
    } catch (cleanupError) {
      showStatus("questions-status", `Question deleted, but its media could not be removed: ${cleanupError.message}`, true);
    }
  } catch (error) {
    button.disabled = false;
    showStatus("questions-status", `Could not delete the question: ${error.message}`, true);
  }
}

function shuffle(items) {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(Math.random() * (index + 1));
    [result[index], result[swap]] = [result[swap], result[index]];
  }
  return result;
}

function startChallenge() {
  const challengeItems = questions.filter(isValidMcq);
  if (!challengeItems.length) {
    showStatus("challenge-empty-message", "There are no questions yet. Check back after your teacher adds some.");
    return;
  }
  challenge = { active: true, items: shuffle(challengeItems), index: 0, correct: 0, answered: 0, skipped: 0 };
  document.getElementById("challenge-intro").hidden = true;
  document.getElementById("challenge-results").hidden = true;
  document.getElementById("challenge-session").hidden = false;
  renderChallengeQuestion();
}

function renderChallengeQuestion() {
  if (!challenge || challenge.index >= challenge.items.length) {
    finishChallenge();
    return;
  }
  const total = challenge.items.length;
  document.getElementById("challenge-progress-label").textContent = `Question ${challenge.index + 1} of ${total}`;
  document.getElementById("challenge-score-label").textContent = `${challenge.correct} correct · ${challenge.answered} answered`;
  document.getElementById("challenge-progress-bar").style.width = `${(challenge.index / total) * 100}%`;
  const question = challenge.items[challenge.index];
  const card = createQuestionCard(
    question,
    "challenge",
    (isCorrect) => {
      challenge.answered += 1;
      if (isCorrect) challenge.correct += 1;
      document.getElementById("challenge-score-label").textContent = `${challenge.correct} correct · ${challenge.answered} answered`;
    },
    () => advanceChallenge(true),
  );
  document.getElementById("challenge-question").replaceChildren(card);
}

function advanceChallenge(skipped) {
  if (!challenge) return;
  if (skipped) challenge.skipped += 1;
  challenge.index += 1;
  renderChallengeQuestion();
}

function finishChallenge() {
  if (!challenge) return;
  challenge.active = false;
  document.getElementById("challenge-session").hidden = true;
  document.getElementById("challenge-results").hidden = false;
  document.getElementById("challenge-progress-bar").style.width = "100%";
  document.getElementById("challenge-result-title").textContent = challenge.correct > 0 ? "Nice work." : "Good practice.";
  document.getElementById("challenge-result-summary").textContent =
    `${challenge.correct} correct · ${challenge.answered} answered · ${challenge.skipped} skipped`;
}

document.getElementById("start-challenge").addEventListener("click", startChallenge);
document.getElementById("play-again").addEventListener("click", startChallenge);

function setAuthDialog(open) {
  const dialog = document.getElementById("auth-dialog");
  if (open && client) dialog.showModal();
  else if (open) setConnectionMessage("Teacher sign-in is unavailable because this site is not connected yet.");
  else dialog.close();
}

document.getElementById("login-open").addEventListener("click", () => setAuthDialog(true));
document.getElementById("auth-close").addEventListener("click", () => setAuthDialog(false));
document.getElementById("auth-dialog").addEventListener("click", (event) => {
  if (event.target === event.currentTarget) setAuthDialog(false);
});

document.getElementById("login-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!client) return;
  const form = event.currentTarget;
  const data = new FormData(form);
  const button = form.querySelector('button[type="submit"]');
  button.disabled = true;
  showStatus("auth-message", "");
  try {
    const { error } = await client.auth.signInWithPassword({
      email: data.get("email").trim(),
      password: data.get("password"),
    });
    if (error) {
      showStatus("auth-message", error.message, true);
      return;
    }
    form.reset();
    setAuthDialog(false);
  } catch (error) {
    showStatus("auth-message", `Could not sign in: ${error.message}`, true);
  } finally {
    button.disabled = false;
  }
});

document.getElementById("logout-button").addEventListener("click", async () => {
  if (!client) return;
  try {
    const { error } = await client.auth.signOut();
    if (error) setConnectionMessage(`Could not sign out: ${error.message}`);
  } catch (error) {
    setConnectionMessage(`Could not sign out: ${error.message}`);
  }
});

async function syncAuth(session) {
  const revision = ++authRevision;
  currentUser = session ? session.user : null;
  isTeacher = false;
  setTeacherControls();
  if (!currentUser) {
    setConnectionMessage("", false);
    return;
  }
  try {
    const { data, error } = await client
      .from("profiles")
      .select("role")
      .eq("id", currentUser.id)
      .maybeSingle();
    if (revision !== authRevision) return;
    if (error) throw error;
    isTeacher = Boolean(data && data.role === "teacher");
    setTeacherControls();
    if (!isTeacher) setConnectionMessage("This account is not the teacher account. Students can use the site without signing in.");
    else setConnectionMessage("", false);
    renderResources();
    renderQuestions();
  } catch (error) {
    if (revision !== authRevision) return;
    setTeacherControls();
    setConnectionMessage(`Could not verify teacher access: ${error.message}`);
  }
}

function connectSupabase() {
  const config = window.APP_CONFIG;
  if (!config || !config.supabaseUrl || !config.supabaseAnonKey
    || config.supabaseUrl.includes("YOUR_") || config.supabaseAnonKey.includes("YOUR_")) {
    setConnectionMessage("Class content and teacher sign-in are unavailable until this site is connected.");
    setEmpty(document.getElementById("resource-list"), document.getElementById("resource-count"), "Materials unavailable", "Connect Supabase to load class files.");
    setEmpty(document.getElementById("questions-list"), document.getElementById("question-count"), "Questions unavailable", "Connect Supabase to load practice questions.");
    return;
  }
  if (!window.supabase || typeof window.supabase.createClient !== "function") {
    setConnectionMessage("The Supabase client could not load. Check your internet connection and reload the page.");
    return;
  }
  try {
    client = window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey);
  } catch (error) {
    setConnectionMessage(`Could not connect to Supabase: ${error.message}`);
    return;
  }
  loadResources();
  loadQuestions();
  client.auth.onAuthStateChange((_event, session) => {
    window.setTimeout(() => syncAuth(session), 0);
  });
  client.auth.getSession().then(({ data, error }) => {
    if (error) {
      setConnectionMessage(`Could not check the teacher session: ${error.message}`);
      return;
    }
    syncAuth(data.session);
  }).catch((error) => {
    setConnectionMessage(`Could not check the teacher session: ${error.message}`);
  });
}

document.getElementById("resource-form").hidden = true;
document.getElementById("question-form").hidden = true;
document.getElementById("new-question-button").hidden = true;
document.getElementById("user-panel").hidden = true;
document.getElementById("challenge-session").hidden = true;
document.getElementById("challenge-results").hidden = true;
connectSupabase();
