import { expect, test } from "@playwright/test";

const api = "http://localhost:8000";
const password = "ExamPrepE2E!2026";

for (const width of [1280, 390]) {
  test(`deep links, refresh and protected Back/Forward at ${width}px`, async ({ browser }) => {
    const owner = await browser.newContext({ extraHTTPHeaders: { Origin: "http://localhost:3000" } });
    const student = await browser.newContext({ viewport: { width, height: 900 }, extraHTTPHeaders: { Origin: "http://localhost:3000" } });
    const courseIds: string[] = [];
    let failed = false;
    try {
      // Public APIs prepare isolated fixtures; all routing and study actions use the UI.
      expect((await owner.request.post(`${api}/auth/login`, { data: { email: "owner-e2e@example.com", password } })).ok()).toBe(true);
      expect((await student.request.post(`${api}/auth/login`, { data: { email: "student-e2e@example.com", password } })).ok()).toBe(true);
      const faculties = await (await owner.request.get(`${api}/faculties`)).json();
      for (const name of [`Routing ${width}`, `Other course ${width}`]) {
        const response = await owner.request.post(`${api}/courses`, { data: { faculty_id: faculties[0].id, name } });
        expect(response.ok()).toBe(true);
        const course = await response.json(); courseIds.push(course.id);
        expect((await student.request.post(`${api}/courses/${course.id}/join`)).ok()).toBe(true);
      }
      const [courseId, otherId] = courseIds;
      expect((await student.request.post(`${api}/courses/${courseId}/questions`, { data: {
        type: "SHORT_ANSWER", stem: "Explain spaced practice", reference_answer: "Review knowledge over time.",
        explanation: null, difficulty: null, concept_ids: [],
      } })).ok()).toBe(true);
      const page = await student.newPage();
      const errors: string[] = [];
      page.on("pageerror", error => errors.push(error.message));
      const base = `/courses/${courseId}`;
      await page.goto(`http://localhost:3000${base}/progress`);
      await expect(page.getByRole("region", { name: "Napredak", exact: true })).toBeVisible();
      await page.reload();
      await expect(page.getByRole("region", { name: "Napredak", exact: true })).toBeVisible();
      // The course page links to its other screens; a breadcrumb leads back to it.
      const openScreen = async (name: "Prošli ispiti" | "Napredak" | "Vježba") => {
        const nav = page.getByRole("navigation", { name: "Navigacija kolegija", exact: true });
        await nav.waitFor();
        // Only a screen other than the course page has the course in its breadcrumb.
        if (!/\/courses\/[^/]+$/.test(page.url())) await nav.getByRole("button").nth(1).click({ timeout: 10_000 });
        const control = { "Prošli ispiti": "Otvori: Prošli ispiti", "Napredak": "Otvori napredak", "Vježba": "Otvori: Vježba po mjeri" }[name];
        await page.getByRole("button", { name: control, exact: true }).first().click();
      };
      // Materials are for course managers, so a student's course page does not offer them.
      await openScreen("Prošli ispiti");
      await expect(page).toHaveURL(new RegExp(`${base}/papers$`));
      // Progress to papers goes through the course page, so Back lands there first.
      await page.goBack();
      await expect(page).toHaveURL(new RegExp(`${base}$`));
      await page.goForward();
      await expect(page).toHaveURL(new RegExp(`${base}/papers$`));
      await openScreen("Vježba");
      await expect(page).toHaveURL(new RegExp(`${base}/practice$`));
      await page.getByRole("radio", { name: "Prilagođeno", exact: true }).check();
      await page.getByRole("spinbutton", { name: "Vlastiti broj pitanja" }).fill("1");
      await page.getByText("Više mogućnosti", { exact: true }).click();
      await page.getByRole("radio", { name: "Ispitna vježba", exact: true }).check();
      await page.getByRole("button", { name: "Započni vježbu", exact: true }).click();
      await expect(page).toHaveURL(new RegExp(`${base}/attempts/[^/]+$`));
      const attemptUrl = page.url();
      const answer = page.getByRole("textbox", { name: "Vaš kratki odgovor" });
      await answer.fill("My unsaved explanation");
      // Cancelling Back must restore the same history entry, answer and Next router state.
      const backWarning = page.waitForEvent("dialog");
      await page.evaluate(() => history.back());
      const backDialog = await backWarning;
      expect(backDialog.message()).toContain("Nespremljeni odgovor");
      await backDialog.dismiss();
      await expect(page).toHaveURL(attemptUrl);
      await expect(answer).toHaveValue("My unsaved explanation");
      await page.getByRole("button", { name: "Spremi i izađi" }).click();
      await expect(page).toHaveURL(new RegExp(`${base}/practice$`));
      await page.getByRole("button", { name: "Nastavi vježbu", exact: true }).click();
      await expect(page).toHaveURL(attemptUrl);
      await expect(answer).toHaveValue("My unsaved explanation");
      await page.reload();
      await expect(answer).toHaveValue("My unsaved explanation");
      await answer.fill("Changed answer after refresh");
      // There is no course navigation while answering: Save and leave keeps the answer.
      await page.getByRole("button", { name: "Spremi i izađi" }).click();
      await openScreen("Napredak");
      await expect(page).toHaveURL(new RegExp(`${base}/progress$`));
      await expect(page.getByRole("region", { name: "Napredak", exact: true })).toBeVisible();
      await openScreen("Vježba");
      await expect(page).toHaveURL(new RegExp(`${base}/practice$`));
      await page.getByRole("button", { name: "Nastavi vježbu", exact: true }).click();
      await expect(page).toHaveURL(attemptUrl);
      await expect(answer).toHaveValue("Changed answer after refresh");
      // Cancelling Forward is covered by returning to a dirty session from setup.
      await page.getByRole("button", { name: "Spremi i izađi" }).click();
      await expect(page).toHaveURL(new RegExp(`${base}/practice$`));
      await page.goBack();
      await expect(answer).toHaveValue("Changed answer after refresh");
      await answer.fill("Unsaved before forward");
      const forwardWarning = page.waitForEvent("dialog");
      await page.evaluate(() => history.forward());
      const forwardDialog = await forwardWarning;
      expect(forwardDialog.message()).toContain("Nespremljeni odgovor");
      await forwardDialog.dismiss();
      await expect(page).toHaveURL(attemptUrl);
      await expect(answer).toHaveValue("Unsaved before forward");
      await page.getByRole("button", { name: "Spremi i pregledaj" }).click();
      await page.getByRole("button", { name: "Završi vježbu", exact: true }).click();
      await expect(page).toHaveURL(`${attemptUrl}/results`);
      await page.reload();
      await expect(page.getByRole("region", { name: "Rezultati vježbe" })).toBeVisible();
      // A submitted attempt's old active URL resolves to its frozen results.
      await page.goto(attemptUrl);
      await expect(page).toHaveURL(`${attemptUrl}/results`);
      await expect(page.getByRole("button", { name: "Spremi i dalje" })).toHaveCount(0);
      const signedOut = await browser.newContext();
      try {
        const login = await signedOut.newPage();
        await login.goto(`${attemptUrl}/results`);
        await login.getByLabel("E-pošta").fill("student-e2e@example.com");
        await login.getByLabel("Lozinka").fill(password);
        await login.getByRole("button", { name: "Prijavi se", exact: true }).click();
        await expect(login.getByRole("region", { name: "Rezultati vježbe" })).toBeVisible();
        await expect(login).toHaveURL(`${attemptUrl}/results`);
      } finally { await signedOut.close(); }
      const ownerPage = await owner.newPage();
      await ownerPage.goto(`${attemptUrl}/results`);
      await expect(ownerPage.getByText("Vježba se ne može otvoriti.", { exact: false })).toBeVisible();
      await page.goto(`http://localhost:3000/courses/${otherId}/attempts/${attemptUrl.split("/").pop()}/results`);
      await expect(page.getByRole("button", { name: "Natrag na vježbu", exact: true })).toBeVisible();
      await page.getByRole("button", { name: "Natrag na vježbu", exact: true }).click();
      await expect(page).toHaveURL(new RegExp(`/courses/${otherId}/practice$`));
      // An old link to materials gives a student a way back instead of an empty page.
      await page.goto(`http://localhost:3000${base}/materials`);
      await expect(page.getByText("Materijale kolegija vide samo vlasnik kolegija i moderatori fakulteta.")).toBeVisible();
      await page.getByRole("button", { name: "Natrag na pregled", exact: true }).click();
      await expect(page).toHaveURL(new RegExp(`${base}$`));
      await page.goto("http://localhost:3000/courses/00000000-0000-0000-0000-000000000000");
      await expect(page.getByRole("heading", { name: "Kolegij nije dostupan" })).toBeVisible();
      await page.getByRole("button", { name: "Natrag na početnu", exact: true }).click();
      await expect(page).toHaveURL("http://localhost:3000/");
      expect(errors).toEqual([]);
    } catch (error) { failed = true; throw error; }
    finally {
      for (const id of courseIds) {
        try { await owner.request.delete(`${api}/courses/${id}`); }
        catch (error) { if (!failed) throw error; } // Keep the original failure when Playwright closes a timed-out context.
      }
      await owner.close(); await student.close();
    }
  });
}
