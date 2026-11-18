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

/**
 * The course tabs (handoff 21a-21d). Custom practice is reached from Učenje; a manager's materials are the Materijali part
 * of "Pitanja i materijali".
 */
async function openScreen(page: Page, name: "Učenje" | "Vježba" | "Ispit" | "Napredak" | "Pitanja" | "Materijali", settled = true) {
  const tabs = page.getByRole("navigation", { name: "Navigacija kolegija" });
  await tabs.waitFor();
  const tab = (label: string) => tabs.getByRole("button", { name: new RegExp(`^${label}`) }).click({ timeout: 10_000 });
  if (name === "Vježba") { await tab("Učenje"); await page.getByRole("button", { name: "Otvori: Vježba po mjeri", exact: true }).click(); }
  else if (name === "Pitanja") await tab("Pitanja i materijali");
  else if (name === "Materijali") {
    await tab("Pitanja i materijali");
    await page.getByRole("group", { name: "Pitanja i materijali" }).getByRole("button", { name: /^Materijali/ }).click();
  } else await tab(name);
  // The screen is open once the address says so; the previous one is still visible until then.
  const suffix = { "Učenje": "", "Vježba": "/practice", "Ispit": "/exam", "Napredak": "/progress", "Pitanja": "/questions", "Materijali": "/materials" }[name];
  // Practice shows the finished review again when one is still open, so that address is left to the caller.
  if (settled) await expect(page).toHaveURL(new RegExp(`/courses/[^/]+${suffix}$`));
}

async function login(page: Page, email: string) {
  await page.goto("/");
  const form = page.getByRole("form", { name: "Prijava" });
  await form.getByLabel("E-pošta").fill(email);
  await form.getByLabel("Lozinka").fill(password);
  await form.getByRole("button", { name: "Prijavi se" }).click();
  // Danas, or its welcome for a student without courses.
  await expect(page.getByRole("heading", { level: 1, name: /^(Danas|Prvo upišite kolegij koji polažete)$/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Račun:/ })).toBeVisible();
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
    await moderator.getByRole("link", { name: "Alati fakulteta", exact: true }).click();
    const createCourse = moderator.getByRole("form", { name: "Izradi kolegij" });
    await expect(createCourse).toBeVisible();
    await createCourse.getByLabel("Fakultet").selectOption({ label: facultyName });
    await createCourse.getByLabel("Naziv kolegija").fill(courseName);
    await createCourse.getByLabel("Šifra (neobavezno)").fill("E2E-101");
    await createCourse.getByRole("button", { name: "Izradi kolegij" }).click();
    const moderatorCourses = moderator.getByRole("region", { name: "Danas", exact: true });
    await expect(moderator.getByRole("heading", { name: courseName, exact: true })).toBeVisible();
    await expect(moderatorCourses).toBeHidden();
    // Materials belong to the people who run the course: the owner uploads, students never see the tab.
    await openScreen(moderator, "Materijali");
    const uploadForm = moderator.getByRole("form", { name: "Učitavanje materijala za učenje" });
    await uploadForm.getByLabel("PDF datoteka").setInputFiles({
      name: "e2e-notes.pdf", mimeType: "application/pdf", buffer: makePdf(),
    });
    await uploadForm.getByRole("button", { name: "Učitaj PDF" }).click();
    const materials = moderator.getByRole("list", { name: "Popis materijala" });
    await expect(materials.getByText("e2e-notes.pdf")).toBeVisible();
    await expect(materials.getByText("Spremno", { exact: true })).toBeVisible({ timeout: 30_000 });
    await materials.getByRole("button", { name: "Prikaži detalje: e2e-notes.pdf" }).click();
    const materialDetail = moderator.getByRole("article", { name: "Detalji materijala: e2e-notes.pdf" });
    await expect(materialDetail).toBeVisible();
    await materialDetail.getByText("Izdvojeni tekst", { exact: true }).click();
    await expect(materialDetail.getByRole("region", { name: "Izdvojeni tekst materijala" }))
      .toContainText("ExamPrep E2E material");
    await expect(materialDetail.getByRole("region", { name: "Izdvojeni tekst materijala" }))
      .toContainText("Deterministic study notes.");
    await expect(moderator.getByRole("group", { name: "Pitanja i materijali" })).toContainText("Materijali · 1");
    await openScreen(moderator, "Učenje");
    await moderator.getByRole("button", { name: "Danas", exact: true }).click();
    await expect(moderatorCourses.getByRole("link", { name: courseName, exact: true })).toHaveCount(1);
    await moderator.getByRole("link", { name: "Alati fakulteta", exact: true }).click();

    await login(student, "student-e2e@example.com");
    const studentCourses = student.getByRole("region", { name: "Danas", exact: true });
    await expect(student.getByRole("heading", { level: 1, name: "Prvo upišite kolegij koji polažete" })).toBeVisible();
    await expect(student.getByLabel("Pretraži po fakultetu")).toHaveCount(0);
    await student.getByRole("button", { name: "Upiši kolegij" }).first().click();
    await expect(student).toHaveURL(/\/enrol$/);
    await student.getByLabel("Pretraži po fakultetu").selectOption({ label: "E2E Faculty, Example Test University" });
    await expect(student.getByRole("button", { name: `Upiši kolegij: ${courseName}` })).toBeVisible();
    await student.getByRole("button", { name: `Upiši kolegij: ${courseName}` }).click();
    await expect(student.getByRole("button", { name: `Upisano, otvori kolegij: ${courseName}` })).toBeVisible();
    await student.getByRole("button", { name: "Danas", exact: true }).click();
    await expect(studentCourses.getByRole("link", { name: courseName, exact: true })).toHaveCount(1);
    await studentCourses.getByRole("link", { name: courseName, exact: true }).click();
    await expect(student.getByRole("heading", { name: courseName, exact: true })).toBeVisible();
    await expect(student.getByText("Ovaj kolegij još nema pitanja za vježbu.")).toBeVisible();
    await expect(student.getByRole("region", { name: "Materijali", exact: true })).toHaveCount(0);
    await expect(student.getByRole("button", { name: "Nastavi vježbu" })).toHaveCount(0);
    await test.info().attach("overview-empty", { body: await student.screenshot({ fullPage: true }), contentType: "image/png" });
    await expect(studentCourses).toBeHidden();
    await expect(student.getByLabel("Pretraži po fakultetu")).toBeHidden();
    for (const name of ["Materijali kolegija", "Vježba", "Napredak", "Baza pitanja"]) await expect(student.getByRole("region", { name, exact: true })).toBeHidden();
    await expect(student.getByRole("button", { name: "Postavke kolegija", exact: true })).toHaveCount(0);
    await expect(student.getByRole("heading", { name: "Postavke kolegija" })).toHaveCount(0);
    const studentNavigation = student.getByRole("navigation", { name: "Navigacija kolegija" });
    await openScreen(student, "Napredak");
    const emptyProgress = student.getByRole("region", { name: "Napredak", exact: true });
    await expect(emptyProgress.getByText("Napredak će se pojaviti kad završite vježbu s automatski ocijenjenim pitanjima.")).toBeVisible();
    await expect(emptyProgress.getByRole("region", { name: "Vaše vježbanje" })).toHaveCount(0);
    await expect(emptyProgress.getByText("Detalji rasporeda")).toHaveCount(0);
    await emptyProgress.getByRole("button", { name: "Započni vježbu", exact: true }).click();
    await expect(student.locator("#practice")).toBeFocused();
    await expect(student.locator("#course-practice").getByText("Ovaj kolegij još nema pitanja za vježbu.")).toBeVisible();
    await expect(student.getByRole("button", { name: "Započni vježbu", exact: true })).toHaveCount(0);
    // An empty course points students to contributions only; materials are not offered to them.
    await expect(student.getByRole("button", { name: "Otvori materijale", exact: true })).toHaveCount(0);
    await expect(studentNavigation.getByRole("button", { name: "Materijali", exact: true })).toHaveCount(0);

    // A student's "Pitanja i materijali" is the question bank, open at once; there is no Materijali part for them.
    await openScreen(student, "Pitanja");
    await expect(student.getByRole("group", { name: "Pitanja i materijali" })).toHaveCount(0);
    await student.getByRole("button", { name: "Stvori pitanje", exact: true }).click();
    const questionForm = student.getByRole("form", { name: "Obrazac za stvaranje pitanja" });
    await questionForm.getByLabel("Vrsta pitanja").selectOption("MULTIPLE_CHOICE");
    await questionForm.getByLabel("Tekst pitanja").fill(questionStem);
    await questionForm.getByLabel("Objašnjenje").fill("Paris is the French capital.");
    await expect(questionForm.getByLabel("Točna opcija 1")).toBeChecked();
    await questionForm.getByLabel("Opcija 1", { exact: true }).fill(correctOption);
    await questionForm.getByLabel("Opcija 2", { exact: true }).fill("Lyon");
    await expect(questionForm.getByLabel(/^Opcija \d$/)).toHaveCount(2);
    await questionForm.getByRole("button", { name: "Spremi nacrt" }).click();
    // The editor stays open after saving; return to the bank to see the saved draft.
    await expect(student.getByText("Pitanje je spremljeno kao privatni nacrt.")).toBeVisible();
    await student.getByRole("button", { name: "Natrag na bazu pitanja" }).click();
    const selectedQuestion = student.getByRole("article", { name: "Odabrano pitanje" });
    await expect(selectedQuestion).toContainText(questionStem);
    await expect(selectedQuestion).toContainText("Skica");
    await expect(selectedQuestion).toContainText("Izvor: Napisano ili uvezeno");
    await selectedQuestion.getByRole("button", { name: "Pošalji na pregled" }).click();
    await expect(selectedQuestion).toContainText("Na pregledu");

    await moderator.getByRole("button", { name: "Osvježi red" }).click();
    const reviewCard = moderator.getByRole("article", { name: questionStem });
    await expect(reviewCard).toBeVisible();
    await expect(reviewCard).toContainText(`Točan odgovor: ${correctOption}`);
    await expect(reviewCard).toContainText("Paris is the French capital.");
    await reviewCard.getByRole("button", { name: "Odobri" }).click();
    await expect(reviewCard).toHaveCount(0);
    await expect(moderator.getByText("Pitanje je odobreno.")).toBeVisible();

    // The bank in its tab has no close button; reading the page again shows the moderator's decision.
    await student.reload();
    await student.getByRole("list", { name: "Popis pitanja" })
      .getByRole("button", { name: new RegExp(questionStem.replace("?", "\\?")) }).click();
    await expect(student.getByRole("article", { name: "Odabrano pitanje" })).toContainText("Objavljeno");

    await student.getByRole("button", { name: "Prijavi problem" }).click();
    const reportForm = student.getByRole("form", { name: "Prijava problema s pitanjem" });
    await reportForm.getByRole("radio", { name: "Nejasno" }).check();
    await reportForm.getByLabel("Opis (neobavezno)").fill("E2E report: wording should be reviewed.");
    await reportForm.getByRole("button", { name: "Pošalji prijavu" }).click();
    await expect(student.getByText("Prijava je poslana na pregled fakulteta.")).toBeVisible();

    await moderator.getByRole("button", { name: "Prijave grešaka", exact: true }).click();
    const reportCard = moderator.getByRole("article", { name: `Prijava: ${questionStem}` });
    await expect(reportCard).toContainText(questionStem);
    await expect(reportCard).toContainText("Razlog: Nejasno");
    await expect(reportCard).toContainText("E2E report: wording should be reviewed.");
    await reportCard.getByRole("button", { name: "Odbaci prijavu" }).click();
    await expect(reportCard).toHaveCount(0);
    await expect(moderator.getByText("Prijava je odbačena.")).toBeVisible();

    await selectedQuestion.getByRole("button", { name: "Predloži izmjenu" }).click();
    const suggestionForm = student.getByRole("form", { name: "Prijedlog izmjene pitanja" });
    await suggestionForm.getByLabel("Predložena težina").fill("3");
    await suggestionForm.getByLabel("Napomena uz prijedlog (neobavezno)").fill("E2E suggestion: set difficulty to 3.");
    await suggestionForm.getByRole("button", { name: "Pošalji prijedlog" }).click();
    await expect(student.getByText("Prijedlog je poslan na pregled fakulteta.")).toBeVisible();
    await expect(selectedQuestion).not.toContainText("Težina 3/5");

    await moderator.getByRole("button", { name: "Prijedlozi pitanja", exact: true }).click();
    const suggestionCard = moderator.getByRole("article", { name: `Prijedlog: ${questionStem}` });
    await expect(suggestionCard).toContainText("Osnovna verzija 3");
    await expect(suggestionCard).toContainText("E2E suggestion: set difficulty to 3.");
    const difficultyComparison = suggestionCard.getByRole("group", { name: "Usporedba: Težina" });
    await expect(difficultyComparison).toContainText("Nije postavljeno");
    await expect(difficultyComparison).toContainText("Predloženo3");
    await suggestionCard.getByRole("button", { name: "Odobri i primijeni" }).click();
    await expect(suggestionCard).toHaveCount(0);
    await expect(moderator.getByText("Prijedlog je primijenjen. Ostali otvoreni prijedlozi za ovo pitanje zamijenjeni su.")).toBeVisible();

    await student.reload();
    await student.getByRole("list", { name: "Popis pitanja" })
      .getByRole("button", { name: new RegExp(questionStem.replace("?", "\\?")) }).click();
    await expect(selectedQuestion).toContainText("Težina 3/5");
    await expect(selectedQuestion).toContainText("Objavljeno");

    await openScreen(student, "Učenje");
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
    // There is no course navigation while answering; Save and leave returns to the course page.
    await student.getByRole("button", { name: "Spremi i izađi" }).click();
    await openScreen(student, "Učenje");
    await expect(student.getByRole("heading", { name: "Nastavite učiti" })).toBeVisible();
    await expect(student.getByRole("button", { name: "Nastavi vježbu" })).toHaveClass(primaryFill);
    await expect(student.locator("#course-overview").locator("button.bg-accent")).toHaveCount(1);
    await test.info().attach("overview-resume", { body: await student.screenshot({ fullPage: true }), contentType: "image/png" });
    await student.getByRole("button", { name: "Nastavi vježbu" }).click();
    await expect(student.getByRole("radio", { name: correctOption })).toBeChecked();
    await student.getByRole("button", { name: "Spremi i izađi" }).click();
    await student.getByRole("button", { name: "Danas", exact: true }).click();
    await expect(student.getByRole("heading", { name: "Danas", exact: true })).toBeVisible();
    // Danas puts the open session on the course's card.
    const todayCard = studentCourses.getByRole("article", { name: courseName });
    await expect(todayCard.getByRole("button", { name: "Nastavi vježbu", exact: true })).toBeVisible();
    await todayCard.getByRole("button", { name: "Nastavi vježbu", exact: true }).click();
    await expect(student.getByRole("radio", { name: correctOption })).toBeChecked();
    // Guided practice checks the answer immediately and reveals only its key.
    await student.getByRole("radio", { name: "Siguran sam", exact: true }).check();
    await student.getByRole("button", { name: "Provjeri odgovor" }).click();
    const feedback = student.getByRole("region", { name: "Povratna informacija" });
    await expect(feedback.getByRole("heading", { name: "Točno" })).toBeFocused();
    await expect(feedback.getByText("Paris is the French capital.", { exact: true })).toBeVisible();
    await expect(student.getByRole("radio", { name: new RegExp(correctOption) })).toBeDisabled();
    // Every answer is checked and final, so the last question ends the session in one click.
    await student.getByRole("button", { name: "Završi vježbu", exact: true }).click();
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
      await openScreen(student, "Učenje");
      const overview = student.locator("#course-overview");
      await expect(overview.getByRole("button", { name: "Nastavi vježbu" })).toHaveCount(0);
      await expect(overview.getByRole("button", { name: "Započni preporučenu vježbu" })).toBeVisible();
      await expect(overview.getByRole("region", { name: "Drugi načini vježbe" })).toBeVisible();
      // The tab row scrolls on its own on a phone; the page never scrolls sideways.
      await expect.poll(() => student.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await test.info().attach(`overview-${viewport.width}`, { body: await student.screenshot({ fullPage: true }), contentType: "image/png" });
      await openScreen(student, "Napredak");
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
      await openScreen(student, "Učenje");
      await overview.getByRole("button", { name: "Započni preporučenu vježbu" }).click();
      await expect(student.getByRole("radio", { name: "Preporučena vježba" })).toBeChecked();
      await expect(student.getByRole("button", { name: "Započni vježbu", exact: true })).toBeVisible();
      await expect(student.getByRole("heading", { name: "Pitanje 1 od 1" })).toHaveCount(0);
    }

    // A second real session combines an objective mistake with an ungraded short answer.
    await openScreen(student, "Pitanja");
    await student.getByRole("button", { name: "Stvori pitanje", exact: true }).click();
    await questionForm.getByLabel("Vrsta pitanja").selectOption("SHORT_ANSWER");
    await questionForm.getByLabel("Tekst pitanja").fill("Explain why regular practice helps learning.");
    await questionForm.getByLabel("Referentni odgovor").fill("Regular practice helps recall and identifies gaps in understanding.");
    await questionForm.getByRole("button", { name: "Spremi nacrt" }).click();
    await expect(student.getByText("Pitanje je spremljeno kao privatni nacrt.")).toBeVisible();
    await student.getByRole("button", { name: "Natrag na bazu pitanja" }).click();
    await expect(selectedQuestion).toContainText("Explain why regular practice helps learning.");
    await openScreen(student, "Vježba");
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
    await expect(student.getByRole("heading", { name: "Pregled vježbe" })).toBeFocused();
    await student.getByRole("button", { name: "Završi vježbu", exact: true }).click();
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
      // One result is shown at a time; the index lists both.
      await expect(results.getByRole("navigation", { name: "Popis pitanja u pregledu" }).getByRole("button")).toHaveCount(2);
    }
    // Self-assessment is saved apart from the grade: the item stays ungraded and the counts say so.
    await results.getByRole("button", { name: "Skoči na pitanje 2", exact: true }).click();
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
    await openScreen(student, "Vježba", false);
    await results.getByRole("button", { name: "Otvori napredak" }).click();
    await expect(progress).toBeVisible();
    await expect(progress.getByText("Točno: 1 od 2 automatski ocijenjenih odgovora")).toBeVisible();
    expect(pageErrors).toEqual([]);
  } finally {
    await studentContext.close();
    await moderatorContext.close();
  }
});
