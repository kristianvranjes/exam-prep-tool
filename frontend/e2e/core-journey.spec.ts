import { expect, test, type Page } from "@playwright/test";
import { makePdf } from "./pdf-fixture";

const facultyName = "E2E Faculty";
const courseName = "E2E Exam Preparation";
const questionStem = "Which city is the capital of France?";
const correctOption = "Paris";
const password = "ExamPrepE2E!2026";

async function login(page: Page, email: string) {
  await page.goto("/");
  const form = page.getByRole("form", { name: "Login" });
  await form.getByLabel("Email").fill(email);
  await form.getByLabel("Password").fill(password);
  await form.getByRole("button", { name: "Log in" }).click();
  await expect(page.getByRole("heading", { name: "Your courses" })).toBeVisible();
  await expect(page.getByText(email, { exact: true })).toBeVisible();
}

async function expectMetricAtLeast(page: Page, label: string, minimum: number) {
  const metric = page.getByRole("region", { name: "Progress" })
    .getByText(label, { exact: true }).locator("..");
  await expect.poll(async () => {
    const text = await metric.textContent();
    return Number(text?.replace(label, "").trim());
  }).toBeGreaterThanOrEqual(minimum);
}

test("moderator and student complete the core exam-preparation journey", async ({ browser }) => {
  const baseURL = test.info().project.use.baseURL as string;
  const moderatorContext = await browser.newContext({ baseURL });
  const studentContext = await browser.newContext({ baseURL });
  try {
    const moderator = await moderatorContext.newPage();
    const student = await studentContext.newPage();

    await login(moderator, "owner-e2e@example.com");
    await moderator.getByRole("button", { name: "Faculty tools", exact: true }).click();
    const createCourse = moderator.getByRole("form", { name: "Create a course" });
    await expect(createCourse).toBeVisible();
    await createCourse.getByLabel("Faculty").selectOption({ label: facultyName });
    await createCourse.getByLabel("Course name").fill(courseName);
    await createCourse.getByLabel("Code (optional)").fill("E2E-101");
    await createCourse.getByRole("button", { name: "Create course" }).click();
    const moderatorCourses = moderator.getByRole("region", { name: "Your courses" });
    await expect(moderator.getByRole("heading", { name: courseName, exact: true })).toBeVisible();
    await expect(moderatorCourses).toBeHidden();
    await moderator.getByRole("button", { name: "Back to Home" }).click();
    await expect(moderatorCourses.getByRole("button", { name: new RegExp(courseName) })).toHaveCount(1);
    await moderator.getByRole("button", { name: "Faculty tools", exact: true }).click();

    await login(student, "student-e2e@example.com");
    const studentCourses = student.getByRole("region", { name: "Your courses" });
    await expect(studentCourses.getByRole("heading", { name: "No courses yet" })).toBeVisible();
    await expect(student.getByLabel("Browse by faculty")).toHaveCount(0);
    await student.getByRole("button", { name: "Join a course", exact: true }).click();
    await student.getByLabel("Browse by faculty").selectOption({ label: "E2E Faculty — Example Test University" });
    await expect(student.getByRole("button", { name: `Join course: ${courseName}` })).toBeVisible();
    await student.getByRole("button", { name: `Join course: ${courseName}` }).click();
    await expect(studentCourses.getByRole("button", { name: new RegExp(courseName) })).toHaveCount(1);
    await studentCourses.getByRole("button", { name: new RegExp(courseName) }).click();
    await expect(student.getByRole("heading", { name: courseName, exact: true })).toBeVisible();
    await expect(student.getByRole("heading", { name: "Overview", exact: true })).toBeVisible();
    await expect(student.getByText("No practice questions are available for this course yet.")).toBeVisible();
    await expect(student.getByText("No study materials have been added yet.")).toBeVisible();
    await expect(student.getByText(/Progress appears after completing automatically graded practice/)).toBeVisible();
    await expect(student.getByRole("button", { name: "Resume session" })).toHaveCount(0);
    await test.info().attach("overview-empty", { body: await student.screenshot({ fullPage: true }), contentType: "image/png" });
    await expect(studentCourses).toBeHidden();
    await expect(student.getByLabel("Browse by faculty")).toBeHidden();
    for (const name of ["Course materials", "Practice quiz", "Progress", "Question bank"]) await expect(student.getByRole("region", { name, exact: true })).toBeHidden();
    await expect(student.getByRole("button", { name: "Course settings", exact: true })).toHaveCount(0);
    await expect(student.getByRole("heading", { name: "Course settings" })).toHaveCount(0);
    const studentNavigation = student.getByRole("navigation", { name: "Course navigation" });
    await studentNavigation.getByRole("button", { name: "Progress", exact: true }).click();
    const emptyProgress = student.getByRole("region", { name: "Progress", exact: true });
    await expect(emptyProgress.getByText("Your progress will appear after you complete automatically graded practice.")).toBeVisible();
    await expect(emptyProgress.getByRole("region", { name: "Your practice" })).toHaveCount(0);
    await expect(emptyProgress.getByText("Scheduling details")).toHaveCount(0);
    await emptyProgress.getByRole("button", { name: "Start practice", exact: true }).click();
    await expect(student.locator("#practice")).toBeFocused();
    await expect(student.locator("#course-practice").getByText("No practice questions are available for this course yet.")).toBeVisible();
    await expect(student.getByRole("button", { name: "Start practice", exact: true })).toHaveCount(0);
    await student.getByRole("button", { name: "View materials", exact: true }).click();
    await expect(studentNavigation.getByRole("button", { name: "Materials" })).toHaveAttribute("aria-current", "page");

    const uploadForm = student.getByRole("form", { name: "Upload study material" });
    await uploadForm.getByLabel("PDF file").setInputFiles({
      name: "e2e-notes.pdf", mimeType: "application/pdf", buffer: makePdf(),
    });
    await uploadForm.getByRole("button", { name: "Upload PDF" }).click();
    const materials = student.getByRole("list", { name: "Materials list" });
    await expect(materials.getByText("e2e-notes.pdf")).toBeVisible();
    await expect(materials.getByText("Ready", { exact: true })).toBeVisible({ timeout: 30_000 });
    await materials.getByRole("button", { name: "View details: e2e-notes.pdf" }).click();
    const materialDetail = student.getByRole("article", { name: "Material details: e2e-notes.pdf" });
    await expect(materialDetail).toBeVisible();
    await materialDetail.getByText("Extracted text", { exact: true }).click();
    await expect(materialDetail.getByRole("region", { name: "Extracted material text" }))
      .toContainText("ExamPrep E2E material");
    await expect(materialDetail.getByRole("region", { name: "Extracted material text" }))
      .toContainText("Deterministic study notes.");

    await studentNavigation.getByRole("button", { name: "More", exact: true }).click();
    await student.getByRole("button", { name: "Question bank", exact: true }).click();
    await student.getByRole("button", { name: "Open question bank" }).click();
    await student.getByRole("button", { name: "Create question", exact: true }).click();
    const questionForm = student.getByRole("form", { name: "Create question form" });
    await questionForm.getByLabel("Question type").selectOption("MULTIPLE_CHOICE");
    await questionForm.getByLabel("Question text").fill(questionStem);
    await questionForm.getByLabel("Explanation").fill("Paris is the French capital.");
    await expect(questionForm.getByLabel("Correct option 1")).toBeChecked();
    await questionForm.getByLabel("Option 1", { exact: true }).fill(correctOption);
    await questionForm.getByLabel("Option 2", { exact: true }).fill("Lyon");
    await expect(questionForm.getByLabel(/^Option \d$/)).toHaveCount(2);
    await questionForm.getByRole("button", { name: "Save draft" }).click();
    const selectedQuestion = student.getByRole("article", { name: "Selected question" });
    await expect(selectedQuestion).toContainText(questionStem);
    await expect(selectedQuestion).toContainText("draft");
    await expect(selectedQuestion).toContainText("Source: USER");
    await selectedQuestion.getByRole("button", { name: "Submit for review" }).click();
    await expect(selectedQuestion).toContainText("Awaiting faculty review");

    await moderator.getByRole("button", { name: "Refresh queue" }).click();
    const reviewCard = moderator.getByRole("article", { name: questionStem });
    await expect(reviewCard).toBeVisible();
    await expect(reviewCard).toContainText(`Correct answer: ${correctOption}`);
    await expect(reviewCard).toContainText("Paris is the French capital.");
    await reviewCard.getByRole("button", { name: "Approve" }).click();
    await expect(reviewCard).toHaveCount(0);
    await expect(moderator.getByText("Question approved.")).toBeVisible();

    await student.getByRole("button", { name: "Close question bank" }).click();
    await student.getByRole("button", { name: "Open question bank" }).click();
    await student.getByRole("list", { name: "Questions list" })
      .getByRole("button", { name: new RegExp(questionStem.replace("?", "\\?")) }).click();
    await expect(student.getByRole("article", { name: "Selected question" })).toContainText("approved");

    await student.getByRole("button", { name: "Report issue" }).click();
    const reportForm = student.getByRole("form", { name: "Report question issue" });
    await reportForm.getByLabel("Reason").selectOption("UNCLEAR");
    await reportForm.getByLabel("Details").fill("E2E report: wording should be reviewed.");
    await reportForm.getByRole("button", { name: "Submit report" }).click();
    await expect(student.getByText("Report submitted for faculty review.")).toBeVisible();

    await moderator.getByRole("button", { name: "Reports", exact: true }).click();
    const reportCard = moderator.getByRole("article", { name: `Report: ${questionStem}` });
    await expect(reportCard).toContainText(questionStem);
    await expect(reportCard).toContainText("Reason: UNCLEAR");
    await expect(reportCard).toContainText("E2E report: wording should be reviewed.");
    await reportCard.getByRole("button", { name: "Dismiss report" }).click();
    await expect(reportCard).toHaveCount(0);
    await expect(moderator.getByText("Report dismissed.")).toBeVisible();

    await selectedQuestion.getByRole("button", { name: "Suggest edit" }).click();
    const suggestionForm = student.getByRole("form", { name: "Suggest question edit" });
    await suggestionForm.getByLabel("Proposed difficulty").fill("3");
    await suggestionForm.getByLabel("Suggestion note (optional)").fill("E2E suggestion: set difficulty to 3.");
    await suggestionForm.getByRole("button", { name: "Submit suggestion" }).click();
    await expect(student.getByText("Suggestion submitted for faculty review.")).toBeVisible();
    await expect(selectedQuestion).not.toContainText("Difficulty 3/5");

    await moderator.getByRole("button", { name: "Suggestions", exact: true }).click();
    const suggestionCard = moderator.getByRole("article", { name: `Suggestion: ${questionStem}` });
    await expect(suggestionCard).toContainText("Base version 3");
    await expect(suggestionCard).toContainText("E2E suggestion: set difficulty to 3.");
    const difficultyComparison = suggestionCard.getByRole("group", { name: "Difficulty comparison" });
    await expect(difficultyComparison).toContainText("Not set");
    await expect(difficultyComparison).toContainText("Proposed3");
    await suggestionCard.getByRole("button", { name: "Approve & apply" }).click();
    await expect(suggestionCard).toHaveCount(0);
    await expect(moderator.getByText("Suggestion applied. Other open suggestions for this question were superseded.")).toBeVisible();

    await student.getByRole("button", { name: "Close question bank" }).click();
    await student.getByRole("button", { name: "Open question bank" }).click();
    await student.getByRole("list", { name: "Questions list" })
      .getByRole("button", { name: new RegExp(questionStem.replace("?", "\\?")) }).click();
    await expect(selectedQuestion).toContainText("Difficulty 3/5");
    await expect(selectedQuestion).toContainText("approved");

    await studentNavigation.getByRole("button", { name: "Overview", exact: true }).click();
    await expect(student.getByRole("region", { name: "Materials", exact: true })).toContainText("1 study material");
    await student.getByRole("button", { name: "Start recommended practice" }).click();
    await expect(student.getByRole("radio", { name: "Recommended practice" })).toBeChecked();
    await expect(student.getByRole("heading", { name: "Question 1 of 1" })).toHaveCount(0);
    await studentNavigation.getByRole("button", { name: "Overview", exact: true }).click();
    await student.getByRole("button", { name: "Practice course questions", exact: true }).click();
    await expect(student.getByRole("radio", { name: "Course questions", exact: true })).toBeChecked();
    await expect(student.getByLabel("Guided practice", { exact: true })).toBeHidden();
    await expect(student.getByRole("radio", { name: "5 questions", exact: true })).toBeChecked();
    await expect(student.getByRole("button", { name: "Start practice", exact: true })).toBeDisabled();
    await student.getByRole("radio", { name: "Custom", exact: true }).check();
    await student.getByRole("spinbutton", { name: "Custom question count" }).fill("1");
    const moreOptions = student.getByText("More options", { exact: true });
    await moreOptions.focus(); await moreOptions.press("Enter");
    await expect(student.getByRole("radio", { name: "Guided practice", exact: true })).toBeVisible();
    await student.getByRole("radio", { name: "Guided practice" }).check();
    await student.getByRole("checkbox", { name: "True / false" }).uncheck();
    await student.getByRole("checkbox", { name: "Short answer" }).uncheck();
    await student.getByRole("button", { name: "Start practice", exact: true }).click();
    await expect(student.getByRole("heading", { name: "Question 1 of 1" })).toBeVisible();
    await student.getByRole("radio", { name: correctOption }).check();
    await expect(studentNavigation).toBeHidden();
    await expect(student.getByRole("navigation", { name: "Main navigation" })).toBeHidden();
    await student.getByText("Course navigation", { exact: true }).click();
    await studentNavigation.getByRole("button", { name: "Overview", exact: true }).click();
    await expect(student.getByRole("heading", { name: "Continue studying" })).toBeVisible();
    await expect(student.getByRole("button", { name: "Resume session" })).toHaveClass(/bg-accent/);
    await expect(student.getByRole("button", { name: "Start recommended practice" })).not.toHaveClass(/bg-accent/);
    await test.info().attach("overview-resume", { body: await student.screenshot({ fullPage: true }), contentType: "image/png" });
    await student.getByRole("button", { name: "Resume session" }).click();
    await expect(student.getByRole("radio", { name: correctOption })).toBeChecked();
    await student.getByText("Course navigation", { exact: true }).click();
    await student.getByRole("button", { name: "Back to Home" }).click();
    await expect(student.getByRole("heading", { name: "Home", exact: true })).toBeVisible();
    await expect(student.getByRole("heading", { name: "Continue studying" })).toBeVisible();
    await student.getByRole("button", { name: "Resume session" }).click();
    await expect(student.getByRole("radio", { name: correctOption })).toBeChecked();
    await student.getByRole("button", { name: "Save and review" }).click();
    await expect(student.getByRole("heading", { name: "Review practice" })).toBeFocused();
    await expect(student.getByText("1 of 1 answered and saved", { exact: true })).toBeVisible();
    await student.getByRole("button", { name: "Finish practice", exact: true }).click();
    await student.getByRole("button", { name: "Confirm final submission" }).click();
    const result = student.getByRole("article", { name: "Question 1 result" });
    await expect(result.getByText("Correct", { exact: true })).toBeVisible();
    await expect(student.getByRole("region", { name: "Quiz results" })).toContainText("Self-review required0");

    await studentNavigation.getByRole("button", { name: "Progress", exact: true }).click();
    await expectMetricAtLeast(student, "Questions reviewed", 1);
    const progress = student.getByRole("region", { name: "Progress", exact: true });
    await expect(progress.getByText("Automatically graded accuracy", { exact: true }).locator("..")).toContainText("100.0%");
    await expect(progress.getByText("1 correct out of 1 automatically graded answers")).toBeVisible();
    await progress.getByRole("button", { name: "Start recommended practice" }).click();
    await expect(student.locator("#practice")).toBeFocused();
    await expect(student.getByRole("region", { name: "Quiz results" })).toHaveCount(0);
    await expect(student.getByRole("radio", { name: "Recommended practice" })).toBeChecked();
    await expect(student.getByRole("button", { name: "Start practice", exact: true })).toBeVisible();
    await expect(student.getByRole("heading", { name: "Question 1 of 1" })).toHaveCount(0);
    for (const viewport of [{ width: 1280, height: 900 }, { width: 390, height: 844 }]) {
      await student.setViewportSize(viewport);
      await studentNavigation.getByRole("button", { name: "Overview", exact: true }).click();
      const overview = student.locator("#course-overview");
      await expect(overview.getByRole("heading", { name: "What to study next" })).toBeVisible();
      await expect(overview.getByRole("button", { name: "Resume session" })).toHaveCount(0);
      await expect(overview.getByRole("button", { name: "Start recommended practice" })).toHaveClass(/bg-accent/);
      await expect(overview.getByRole("region", { name: "Progress summary" })).toContainText("100.0%");
      await expect(overview.getByRole("list", { name: "Recent materials" })).toContainText("e2e-notes.pdf");
      await expect.poll(() => student.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await test.info().attach(`overview-${viewport.width}`, { body: await student.screenshot({ fullPage: true }), contentType: "image/png" });
      await overview.getByRole("button", { name: "View progress" }).click();
      await expect(student.getByRole("region", { name: "Progress", exact: true })).toBeVisible();
      await expect(progress.getByRole("heading", { name: "What needs attention" })).toBeVisible();
      await expect(progress.getByText("Nothing is due right now")).toBeVisible();
      const scheduling = progress.getByText("Scheduling details", { exact: true });
      await expect(progress.getByText("Stage 1: 1", { exact: true })).toBeHidden();
      await expect.poll(() => student.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await student.screenshot({ path: test.info().outputPath(`progress-${viewport.width}.png`), fullPage: true });
      await scheduling.focus(); await scheduling.press("Enter");
      await expect(progress.getByRole("heading", { name: "Reviewed question 1" })).toBeVisible();
      await expect(progress.getByText("Stage 1: 1", { exact: true })).toBeVisible();
      await expect(progress.getByText(/Question ID:/)).toBeHidden();
      await expect.poll(() => student.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await student.screenshot({ path: test.info().outputPath(`progress-details-${viewport.width}.png`), fullPage: true });
      await scheduling.focus(); await scheduling.press("Enter");
      await studentNavigation.getByRole("button", { name: "Overview", exact: true }).click();
      await overview.getByRole("button", { name: "View materials" }).click();
      await expect(student.getByRole("region", { name: "Course materials" })).toBeVisible();
      await studentNavigation.getByRole("button", { name: "Overview", exact: true }).click();
      await overview.getByRole("button", { name: "Start recommended practice" }).click();
      await expect(student.getByRole("radio", { name: "Recommended practice" })).toBeChecked();
      await expect(student.getByRole("button", { name: "Start practice", exact: true })).toBeVisible();
      await expect(student.getByRole("heading", { name: "Question 1 of 1" })).toHaveCount(0);
    }
  } finally {
    await studentContext.close();
    await moderatorContext.close();
  }
});
