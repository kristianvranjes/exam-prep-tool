import { expect, test, type Page } from "@playwright/test";
import { makePdf } from "./pdf-fixture";

const facultyName = "E2E Faculty";
const courseName = "E2E Exam Preparation";
const questionStem = "Which city is the capital of France?";
const correctOption = "Paris";
const password = "ExamPrepE2E!2026";
// The primary button fill as a whole class; secondary and ghost variants carry
// prefixed accent classes such as `aria-pressed:bg-accent-surface`.
const primaryFill = /(?:^|\s)bg-accent(?:\s|$)/;

async function login(page: Page, email: string) {
  await page.goto("/");
  const form = page.getByRole("form", { name: "Prijava" });
  await form.getByLabel("E-pošta").fill(email);
  await form.getByLabel("Lozinka").fill(password);
  await form.getByRole("button", { name: "Prijavi se" }).click();
  await expect(page.getByRole("heading", { name: "Vaši kolegiji" })).toBeVisible();
  await expect(page.getByText(email, { exact: true })).toBeVisible();
}

async function expectMetricAtLeast(page: Page, label: string, minimum: number) {
  const metric = page.getByRole("region", { name: "Napredak" })
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
    const pageErrors: string[] = [];
    student.on("pageerror", error => pageErrors.push(error.message));

    await login(moderator, "owner-e2e@example.com");
    await moderator.getByRole("button", { name: "Alati fakulteta", exact: true }).click();
    const createCourse = moderator.getByRole("form", { name: "Create a course" });
    await expect(createCourse).toBeVisible();
    await createCourse.getByLabel("Faculty").selectOption({ label: facultyName });
    await createCourse.getByLabel("Course name").fill(courseName);
    await createCourse.getByLabel("Code (optional)").fill("E2E-101");
    await createCourse.getByRole("button", { name: "Create course" }).click();
    const moderatorCourses = moderator.getByRole("region", { name: "Vaši kolegiji" });
    await expect(moderator.getByRole("heading", { name: courseName, exact: true })).toBeVisible();
    await expect(moderatorCourses).toBeHidden();
    await moderator.getByRole("button", { name: "Natrag na početnu" }).click();
    await expect(moderatorCourses.getByRole("button", { name: new RegExp(courseName) })).toHaveCount(1);
    await moderator.getByRole("button", { name: "Alati fakulteta", exact: true }).click();

    await login(student, "student-e2e@example.com");
    const studentCourses = student.getByRole("region", { name: "Vaši kolegiji" });
    await expect(studentCourses.getByRole("heading", { name: "Još nema kolegija" })).toBeVisible();
    await expect(student.getByLabel("Pretraži po fakultetu")).toHaveCount(0);
    await student.getByRole("button", { name: "Upiši kolegij", exact: true }).click();
    await student.getByLabel("Pretraži po fakultetu").selectOption({ label: "E2E Faculty — Example Test University" });
    await expect(student.getByRole("button", { name: `Upiši kolegij: ${courseName}` })).toBeVisible();
    await student.getByRole("button", { name: `Upiši kolegij: ${courseName}` }).click();
    await expect(studentCourses.getByRole("button", { name: new RegExp(courseName) })).toHaveCount(1);
    await studentCourses.getByRole("button", { name: new RegExp(courseName) }).click();
    await expect(student.getByRole("heading", { name: courseName, exact: true })).toBeVisible();
    await expect(student.getByRole("heading", { name: "Pregled", exact: true })).toBeVisible();
    await expect(student.getByText("Ovaj kolegij još nema pitanja za vježbu.")).toBeVisible();
    await expect(student.getByText("Još nema dodanih materijala.")).toBeVisible();
    await expect(student.getByText(/Napredak se pojavljuje nakon vježbe s automatski ocijenjenim pitanjima/)).toBeVisible();
    await expect(student.getByRole("button", { name: "Nastavi vježbu" })).toHaveCount(0);
    await test.info().attach("overview-empty", { body: await student.screenshot({ fullPage: true }), contentType: "image/png" });
    await expect(studentCourses).toBeHidden();
    await expect(student.getByLabel("Pretraži po fakultetu")).toBeHidden();
    for (const name of ["Course materials", "Vježba", "Napredak", "Question bank"]) await expect(student.getByRole("region", { name, exact: true })).toBeHidden();
    await expect(student.getByRole("button", { name: "Postavke kolegija", exact: true })).toHaveCount(0);
    await expect(student.getByRole("heading", { name: "Course settings" })).toHaveCount(0);
    const studentNavigation = student.getByRole("navigation", { name: "Navigacija kolegija" });
    await studentNavigation.getByRole("button", { name: "Napredak", exact: true }).click();
    const emptyProgress = student.getByRole("region", { name: "Napredak", exact: true });
    await expect(emptyProgress.getByText("Napredak će se pojaviti kad završite vježbu s automatski ocijenjenim pitanjima.")).toBeVisible();
    await expect(emptyProgress.getByRole("region", { name: "Vaše vježbanje" })).toHaveCount(0);
    await expect(emptyProgress.getByText("Detalji rasporeda")).toHaveCount(0);
    await emptyProgress.getByRole("button", { name: "Započni vježbu", exact: true }).click();
    await expect(student.locator("#practice")).toBeFocused();
    await expect(student.locator("#course-practice").getByText("Ovaj kolegij još nema pitanja za vježbu.")).toBeVisible();
    await expect(student.getByRole("button", { name: "Započni vježbu", exact: true })).toHaveCount(0);
    await student.getByRole("button", { name: "Otvori materijale", exact: true }).click();
    await expect(studentNavigation.getByRole("button", { name: "Materijali" })).toHaveAttribute("aria-current", "page");

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

    await studentNavigation.getByRole("button", { name: "Više", exact: true }).click();
    await student.getByRole("button", { name: "Baza pitanja", exact: true }).click();
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
    await expect(selectedQuestion).toContainText("Nacrt");
    await expect(selectedQuestion).toContainText("Source: Napisano ili uvezeno");
    await selectedQuestion.getByRole("button", { name: "Submit for review" }).click();
    await expect(selectedQuestion).toContainText("Čeka pregled fakulteta");

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
    await expect(student.getByRole("article", { name: "Selected question" })).toContainText("Odobreno");

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
    await expect(selectedQuestion).toContainText("Odobreno");

    await studentNavigation.getByRole("button", { name: "Pregled", exact: true }).click();
    await expect(student.getByRole("region", { name: "Materijali", exact: true })).toContainText("1 materijal");
    await student.getByRole("button", { name: "Započni preporučenu vježbu" }).click();
    await expect(student.getByRole("radio", { name: "Preporučena vježba" })).toBeChecked();
    await expect(student.getByRole("heading", { name: "Pitanje 1 od 1" })).toHaveCount(0);
    // Plain course questions are a setup choice under More options, not an Overview shortcut.
    await expect(student.getByLabel("Vođena vježba", { exact: true })).toBeHidden();
    await expect(student.getByRole("radio", { name: "Pitanja kolegija", exact: true })).toBeHidden();
    const moreOptions = student.getByText("Više mogućnosti", { exact: true });
    await moreOptions.focus(); await moreOptions.press("Enter");
    await student.getByRole("radio", { name: "Pitanja kolegija", exact: true }).check();
    await expect(student.getByRole("radio", { name: "5 pitanja", exact: true })).toBeChecked();
    await expect(student.getByRole("button", { name: "Započni vježbu", exact: true })).toBeDisabled();
    await student.getByRole("radio", { name: "Prilagođeno", exact: true }).check();
    await student.getByRole("spinbutton", { name: "Vlastiti broj pitanja" }).fill("1");
    await expect(student.getByRole("radio", { name: "Vođena vježba", exact: true })).toBeVisible();
    await student.getByRole("radio", { name: "Vođena vježba" }).check();
    await student.getByRole("checkbox", { name: "Točno / netočno" }).uncheck();
    await student.getByRole("checkbox", { name: "Kratki odgovor" }).uncheck();
    await student.getByRole("button", { name: "Započni vježbu", exact: true }).click();
    await expect(student.getByRole("heading", { name: "Pitanje 1 od 1" })).toBeVisible();
    await student.getByRole("radio", { name: correctOption }).check();
    await expect(studentNavigation).toBeHidden();
    await expect(student.getByRole("navigation", { name: "Glavna navigacija" })).toBeHidden();
    await student.getByText("Navigacija kolegija", { exact: true }).click();
    await studentNavigation.getByRole("button", { name: "Pregled", exact: true }).click();
    await expect(student.getByRole("heading", { name: "Nastavite učiti" })).toBeVisible();
    await expect(student.getByRole("button", { name: "Nastavi vježbu" })).toHaveClass(primaryFill);
    await expect(student.locator("#course-overview").getByRole("button", { name: "Započni preporučenu vježbu" })).toHaveCount(0);
    await expect(student.locator("#course-overview").locator("button.bg-accent")).toHaveCount(1);
    await test.info().attach("overview-resume", { body: await student.screenshot({ fullPage: true }), contentType: "image/png" });
    await student.getByRole("button", { name: "Nastavi vježbu" }).click();
    await expect(student.getByRole("radio", { name: correctOption })).toBeChecked();
    await student.getByText("Navigacija kolegija", { exact: true }).click();
    await student.getByRole("button", { name: "Natrag na početnu" }).click();
    await expect(student.getByRole("heading", { name: "Početna", exact: true })).toBeVisible();
    await expect(student.getByRole("heading", { name: "Nastavite učiti" })).toBeVisible();
    await student.getByRole("button", { name: "Nastavi vježbu" }).click();
    await expect(student.getByRole("radio", { name: correctOption })).toBeChecked();
    // Guided practice checks the answer immediately and reveals only its key.
    await student.getByRole("radio", { name: "Siguran sam", exact: true }).check();
    await student.getByRole("button", { name: "Provjeri odgovor" }).click();
    const feedback = student.getByRole("region", { name: "Povratna informacija" });
    await expect(feedback.getByRole("heading", { name: "Točno" })).toBeFocused();
    await expect(feedback.getByText("Paris is the French capital.", { exact: true })).toBeVisible();
    await expect(student.getByRole("radio", { name: new RegExp(correctOption) })).toBeDisabled();
    await student.getByRole("button", { name: "Nastavi na pregled", exact: true }).click();
    await expect(student.getByRole("heading", { name: "Pregled vježbe" })).toBeFocused();
    await expect(student.getByText("Odgovoreno i spremljeno 1 od 1", { exact: true })).toBeVisible();
    await student.getByRole("button", { name: "Završi vježbu", exact: true }).click();
    await student.getByRole("button", { name: "Potvrdi konačnu predaju" }).click();
    const result = student.getByRole("article", { name: "Rezultat pitanja 1" });
    await expect(result.getByText("Točno · označeno: siguran sam", { exact: true })).toBeVisible();
    const results = student.getByRole("region", { name: "Rezultati vježbe" });
    await expect(results.getByRole("heading", { name: "Vježba je završena" })).toBeFocused();
    await expect(results.getByLabel("Sažetak rezultata")).toContainText("Točno1Netočno0Kratki odgovori0");
    await expect(results.getByRole("button", { name: "Vježbaj ponovno" })).toHaveClass(primaryFill);
    await expect(results.getByRole("button", { name: "Svi odgovori" })).toHaveAttribute("aria-pressed", "true");
    await expect(results.getByRole("button", { name: "Pogreške", exact: true })).toBeDisabled();
    for (const viewport of [{ width: 1280, height: 900 }, { width: 390, height: 844 }]) {
      await student.setViewportSize(viewport);
      await student.screenshot({ path: test.info().outputPath(`results-correct-${viewport.width}.png`), fullPage: true });
      const answerDetails = result.getByText("Pogledaj odgovor i objašnjenje", { exact: true });
      await answerDetails.focus(); await answerDetails.press("Enter");
      await expect(result.getByText("Paris is the French capital.", { exact: true })).toBeVisible();
      await expect.poll(() => student.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await answerDetails.press("Enter");
    }

    await results.getByRole("button", { name: "Otvori napredak" }).click();
    await expectMetricAtLeast(student, "Ponovljena pitanja", 1);
    const progress = student.getByRole("region", { name: "Napredak", exact: true });
    await expect(progress.getByText("Točnost automatski ocijenjenih odgovora", { exact: true }).locator("..")).toContainText("100.0%");
    await expect(progress.getByText("Točno: 1 od 1 automatski ocijenjenih odgovora")).toBeVisible();
    await progress.getByRole("button", { name: "Započni preporučenu vježbu" }).click();
    await expect(student.locator("#practice")).toBeFocused();
    await expect(student.getByRole("region", { name: "Rezultati vježbe" })).toHaveCount(0);
    await expect(student.getByRole("radio", { name: "Preporučena vježba" })).toBeChecked();
    await expect(student.getByRole("button", { name: "Započni vježbu", exact: true })).toBeVisible();
    await expect(student.getByRole("heading", { name: "Pitanje 1 od 1" })).toHaveCount(0);
    for (const viewport of [{ width: 1280, height: 900 }, { width: 390, height: 844 }]) {
      await student.setViewportSize(viewport);
      await studentNavigation.getByRole("button", { name: "Pregled", exact: true }).click();
      const overview = student.locator("#course-overview");
      await expect(overview.getByRole("heading", { name: "Što dalje učiti" })).toBeVisible();
      await expect(overview.getByRole("button", { name: "Nastavi vježbu" })).toHaveCount(0);
      await expect(overview.getByRole("button", { name: "Započni preporučenu vježbu" })).toHaveClass(primaryFill);
      // Graded accuracy is shown in Progress; the overview summary keeps a count only.
      await expect(overview.getByRole("region", { name: "Sažetak napretka" })).toContainText(/Ponovljeno: \d+ pitanj/);
      await expect(overview.getByRole("region", { name: "Sažetak napretka" })).not.toContainText("%");
      await expect(overview.getByRole("list", { name: "Nedavni materijali" })).toContainText("e2e-notes.pdf");
      await expect.poll(() => student.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await test.info().attach(`overview-${viewport.width}`, { body: await student.screenshot({ fullPage: true }), contentType: "image/png" });
      await overview.getByRole("button", { name: "Otvori napredak" }).click();
      await expect(student.getByRole("region", { name: "Napredak", exact: true })).toBeVisible();
      await expect(progress.getByRole("heading", { name: "Što treba pažnju" })).toBeVisible();
      await expect(progress.getByText("Trenutno ništa ne treba ponoviti")).toBeVisible();
      const scheduling = progress.getByText("Detalji rasporeda", { exact: true });
      await expect(progress.getByText("Faza 1: 1", { exact: true })).toBeHidden();
      await expect.poll(() => student.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await student.screenshot({ path: test.info().outputPath(`progress-${viewport.width}.png`), fullPage: true });
      await scheduling.focus(); await scheduling.press("Enter");
      await expect(progress.getByRole("heading", { name: "Ponovljeno pitanje 1" })).toBeVisible();
      await expect(progress.getByText("Faza 1: 1", { exact: true })).toBeVisible();
      await expect(progress.getByText(/ID pitanja:/)).toBeHidden();
      await expect.poll(() => student.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await student.screenshot({ path: test.info().outputPath(`progress-details-${viewport.width}.png`), fullPage: true });
      await scheduling.focus(); await scheduling.press("Enter");
      await studentNavigation.getByRole("button", { name: "Pregled", exact: true }).click();
      await overview.getByRole("button", { name: "Otvori materijale" }).click();
      await expect(student.getByRole("region", { name: "Course materials" })).toBeVisible();
      await studentNavigation.getByRole("button", { name: "Pregled", exact: true }).click();
      await overview.getByRole("button", { name: "Započni preporučenu vježbu" }).click();
      await expect(student.getByRole("radio", { name: "Preporučena vježba" })).toBeChecked();
      await expect(student.getByRole("button", { name: "Započni vježbu", exact: true })).toBeVisible();
      await expect(student.getByRole("heading", { name: "Pitanje 1 od 1" })).toHaveCount(0);
    }

    // A second real session combines an objective mistake with an ungraded short answer.
    await studentNavigation.getByRole("button", { name: "Više", exact: true }).click();
    await student.getByRole("button", { name: "Baza pitanja", exact: true }).click();
    const openBank = student.getByRole("button", { name: "Open question bank" });
    if (await openBank.isVisible()) await openBank.click();
    await student.getByRole("button", { name: "Create question", exact: true }).click();
    await questionForm.getByLabel("Question type").selectOption("SHORT_ANSWER");
    await questionForm.getByLabel("Question text").fill("Explain why regular practice helps learning.");
    await questionForm.getByLabel("Reference answer").fill("Regular practice helps recall and identifies gaps in understanding.");
    await questionForm.getByRole("button", { name: "Save draft" }).click();
    await expect(selectedQuestion).toContainText("Explain why regular practice helps learning.");
    await studentNavigation.getByRole("button", { name: "Vježba", exact: true }).click();
    await moreOptions.click();
    await student.getByRole("radio", { name: "Pitanja kolegija", exact: true }).check();
    await student.getByRole("spinbutton", { name: "Vlastiti broj pitanja" }).fill("2");
    await student.getByRole("checkbox", { name: "Kratki odgovor" }).check();
    await student.getByRole("radio", { name: "Ispitna vježba", exact: true }).check();
    await student.getByRole("button", { name: "Započni vježbu", exact: true }).click();
    const rawShortAnswer = "  Practice helps me recall.\n" + "A long explanation with an unbroken word: " + "learning".repeat(40) + "  ";
    for (let index = 0; index < 2; index++) {
      await expect(student.getByRole("heading", { name: `Pitanje ${index + 1} od 2` })).toBeVisible();
      const shortAnswer = student.getByRole("textbox", { name: "Vaš kratki odgovor" });
      if (await shortAnswer.isVisible()) await shortAnswer.fill(rawShortAnswer);
      else await student.getByRole("radio", { name: "Lyon", exact: true }).check();
      await student.getByRole("button", { name: index === 0 ? "Spremi i dalje" : "Spremi i pregledaj", exact: true }).click();
    }
    await student.getByRole("button", { name: "Završi vježbu", exact: true }).click();
    await student.getByRole("button", { name: "Potvrdi konačnu predaju" }).click();
    await expect(results.getByLabel("Sažetak rezultata")).toContainText("Točno0Netočno1Kratki odgovori1čeka samoprocjenu: 1");
    for (const viewport of [{ width: 1280, height: 900 }, { width: 390, height: 844 }]) {
      await student.setViewportSize(viewport);
      const reviewMistakes = results.getByRole("button", { name: "Pregledaj pogreške", exact: true });
      await reviewMistakes.focus(); await reviewMistakes.press("Enter");
      await expect(results.getByRole("heading", { name: "Pogreške", exact: true })).toBeFocused();
      await expect(results.getByRole("article")).toHaveCount(1);
      await expect(results.getByRole("article")).toContainText("Lyon");
      await expect(results.getByRole("article")).toContainText("Paris is the French capital.");
      await student.screenshot({ path: test.info().outputPath(`results-mistakes-${viewport.width}.png`), fullPage: true });
      const selfReview = results.getByRole("button", { name: "Samoprocjena", exact: true });
      await selfReview.focus(); await selfReview.press("Enter");
      await expect(selfReview).toBeFocused();
      await expect(selfReview).toHaveAttribute("aria-pressed", "true");
      const shortResult = results.getByRole("article");
      await expect(shortResult).toHaveCount(1);
      await expect(shortResult.getByText("Potrebna samoprocjena", { exact: true })).toBeVisible();
      await expect.poll(() => shortResult.locator("dd").first().textContent()).toBe(rawShortAnswer);
      await expect(shortResult.getByText("Referentni odgovor", { exact: true })).toBeVisible();
      await expect.poll(() => student.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await student.screenshot({ path: test.info().outputPath(`results-self-review-${viewport.width}.png`), fullPage: true });
      await results.getByRole("button", { name: "Svi odgovori", exact: true }).click();
      await expect(results.getByRole("article")).toHaveCount(2);
    }
    // Self-assessment is saved apart from the grade: the item stays ungraded and the counts say so.
    const hadIt = results.getByRole("article").filter({ hasText: "Referentni odgovor" }).getByRole("button", { name: "Znao sam", exact: true });
    await hadIt.click();
    await expect(hadIt).toHaveAttribute("aria-pressed", "true");
    await expect(results.getByLabel("Sažetak rezultata")).toContainText("Točno0Netočno1Kratki odgovori1po samoprocjeni točno: 1");
    await results.getByRole("button", { name: "Vježbaj ponovno", exact: true }).click();
    await expect(results).toHaveCount(0);
    await expect(student.getByRole("form", { name: "Postavke vježbe" })).toBeVisible();
    await expect(student.getByRole("spinbutton", { name: "Vlastiti broj pitanja" })).toHaveValue("2");
    await expect(student.getByRole("radio", { name: "Pitanja kolegija", exact: true })).toBeChecked();
    await expect(student.getByRole("heading", { name: "Pitanje 1 od 2" })).toHaveCount(0);
    await student.getByText("Povijest vježbi", { exact: true }).click();
    const historyResults = student.getByRole("button", { name: /Pregled vježbe/ });
    await expect(historyResults).toHaveCount(2);
    await historyResults.first().click();
    await expect(results.getByRole("button", { name: "Pogreške", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(results.getByLabel("Sažetak rezultata")).toContainText("po samoprocjeni točno: 1");
    await results.getByRole("button", { name: "Natrag na kolegij" }).click();
    await expect(student.getByRole("heading", { name: "Pregled", exact: true })).toBeVisible();
    await studentNavigation.getByRole("button", { name: "Vježba", exact: true }).click();
    await results.getByRole("button", { name: "Otvori napredak" }).click();
    await expect(progress).toBeVisible();
    await expect(progress.getByText("Točno: 1 od 2 automatski ocijenjenih odgovora")).toBeVisible();
    expect(pageErrors).toEqual([]);
  } finally {
    await studentContext.close();
    await moderatorContext.close();
  }
});
