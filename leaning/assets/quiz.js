for (const quiz of document.querySelectorAll("[data-quiz]")) {
  const feedback = quiz.querySelector("[data-feedback]");

  for (const button of quiz.querySelectorAll("button[data-correct]")) {
    button.addEventListener("click", () => {
      for (const option of quiz.querySelectorAll("button[data-correct]")) {
        option.setAttribute("aria-pressed", String(option === button));
      }

      const correct = button.dataset.correct === "true";
      feedback.textContent = correct
        ? button.dataset.success
        : button.dataset.retry;
    });
  }
}
