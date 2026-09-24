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
  const metric = page.getByRole("region", { name: "Learning progress" })
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
    const createCourse = moderator.getByRole("form", { name: "Create a course" });
    await expect(createCourse).toBeVisible();
    await createCourse.getByLabel("Faculty").selectOption({ label: facultyName });
    await createCourse.getByLabel("Course name").fill(courseName);
    await createCourse.getByLabel("Code (optional)").fill("E2E-101");
    await createCourse.getByRole("button", { name: "Create course" }).click();
    const moderatorCourses = moderator.getByRole("region", { name: "Your courses" });
    await expect(moderatorCourses.getByRole("button", { name: new RegExp(courseName) })).toHaveCount(1);
    await expect(moderator.getByRole("heading", { name: courseName })).toBeVisible();

    await login(student, "student-e2e@example.com");
    const studentCourses = student.getByRole("region", { name: "Your courses" });
    await expect(studentCourses.getByRole("heading", { name: "No courses yet" })).toBeVisible();
    await student.getByLabel("Browse by faculty").selectOption({ label: "E2E Faculty — Example Test University" });
    await expect(student.getByRole("button", { name: `Join course: ${courseName}` })).toBeVisible();
    await student.getByRole("button", { name: `Join course: ${courseName}` }).click();
    await expect(studentCourses.getByRole("button", { name: new RegExp(courseName) })).toHaveCount(1);
    await studentCourses.getByRole("button", { name: new RegExp(courseName) }).click();
    await expect(student.getByRole("region", { name: "Course materials" })).toBeVisible();
    await expect(student.getByRole("region", { name: "Practice quiz" })).toBeVisible();
    await expect(student.getByRole("region", { name: "Learning progress" })).toBeVisible();
    await expect(student.getByRole("region", { name: "Question bank" })).toBeVisible();
    await expect(student.getByRole("link", { name: "Course settings" })).toHaveCount(0);
    await expect(student.getByRole("heading", { name: "Course settings" })).toHaveCount(0);

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

    await student.getByRole("button", { name: "Open question bank" }).click();
    await student.getByRole("button", { name: "Create question", exact: true }).click();
    const questionForm = student.getByRole("form", { name: "Create question form" });
    await questionForm.getByLabel("Question type").selectOption("MULTIPLE_CHOICE");
    await questionForm.getByLabel("Question stem").fill(questionStem);
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
    await expect(selectedQuestion).toContainText("pending review");

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

    await student.getByRole("button", { name: "Open practice quizzes" }).click();
    await student.getByRole("radio", { name: "Standard practice" }).check();
    await student.getByRole("radio", { name: "Study" }).check();
    await student.getByRole("spinbutton", { name: "Practice question count" }).fill("1");
    await student.getByRole("checkbox", { name: "True / false" }).uncheck();
    await student.getByRole("checkbox", { name: "Short answer" }).uncheck();
    await student.getByRole("button", { name: "Start practice quiz" }).click();
    await expect(student.getByRole("heading", { name: "Question 1 of 1" })).toBeVisible();
    await student.getByRole("radio", { name: correctOption }).check();
    await student.getByRole("button", { name: "Save answer" }).click();
    await expect(student.getByText("1 / 1 answered and saved")).toBeVisible();
    await student.getByRole("button", { name: "Submit quiz — final" }).click();
    await student.getByRole("button", { name: "Confirm final submission" }).click();
    const result = student.getByRole("article", { name: "Question 1 result" });
    await expect(result.getByText("Correct", { exact: true })).toBeVisible();
    await expect(student.getByRole("region", { name: "Quiz results" })).toContainText("Pending0");

    await student.getByRole("button", { name: "Open learning progress" }).click();
    await expectMetricAtLeast(student, "Reviewed questions", 1);
    await expectMetricAtLeast(student, "Resolved reviews", 1);
    await expectMetricAtLeast(student, "Correct reviews", 1);
    await student.getByRole("button", { name: "Open adaptive review" }).click();
    await expect(student.locator("#practice")).toBeFocused();
    await expect(student.getByRole("region", { name: "Quiz results" })).toBeVisible();
    await student.getByRole("button", { name: "Back to saved attempts" }).click();
    await expect(student.getByRole("radio", { name: "Adaptive review" })).toBeChecked();
    await expect(student.getByRole("button", { name: "Start practice quiz" })).toBeVisible();
    await expect(student.getByRole("heading", { name: "Question 1 of 1" })).toHaveCount(0);
  } finally {
    await studentContext.close();
    await moderatorContext.close();
  }
});
