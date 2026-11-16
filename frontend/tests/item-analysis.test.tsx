import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { explanations, ItemAnalysisView } from "../src/components/item-analysis";
import type { ItemAnalysis, ItemAnalysisList, OptionAnalysis } from "../src/lib/api";

const mock = vi.hoisted(() => ({ itemAnalysis: vi.fn() }));
vi.mock("../src/lib/api", () => ({ api: mock }));

const option = (position: number, text: string, changes: Partial<OptionAnalysis> = {}): OptionAnalysis => ({
  position, text, is_key: false, count: 10, share: 0.25, upper_share: 0.25, lower_share: 0.25, flag: null, ...changes,
});
const item = (changes: Partial<ItemAnalysis> = {}): ItemAnalysis => ({
  question_id: "q1", type: "MULTIPLE_CHOICE", stem: "Koja gramatika je dvoznačna?", sample_size: 40, earlier_version_sample: 0,
  enough_data: true, difficulty: 0.45, upper_correct: 0.3, lower_correct: 0.5, discrimination: -0.2, ranked_size: 38, group_size: 10,
  flags: ["NEGATIVE_DISCRIMINATION", "STRONG_DISTRACTOR", "UNUSED_DISTRACTOR"],
  options: [
    option(0, "S → aSb | ε", { is_key: true, count: 18, share: 0.45, upper_share: 0.3, lower_share: 0.5 }),
    option(1, "S → aS | b", { count: 12, share: 0.3 }),
    option(2, "S → SS | a", { count: 9, share: 0.225, upper_share: 0.6, lower_share: 0.1, flag: "STRONG_DISTRACTOR" }),
    option(3, "S → a", { count: 1, share: 0.025, upper_share: 0, lower_share: 0.05, flag: "UNUSED_DISTRACTOR" }),
  ],
  ...changes,
});
const list = (items: ItemAnalysis[], changes: Partial<ItemAnalysisList> = {}): ItemAnalysisList => ({
  analysis_version: "item-analysis-v1", min_sample_size: 30, total: items.length,
  analysed: items.filter(row => row.enough_data).length, flagged: items.filter(row => row.flags.length).length, items, ...changes,
});
const pending = item({
  question_id: "q2", type: "TRUE_FALSE", stem: "Every regular language is context-free.", sample_size: 12, earlier_version_sample: 5,
  enough_data: false, difficulty: null, upper_correct: null, lower_correct: null, discrimination: null, ranked_size: 0, group_size: null, flags: [], options: [],
});

beforeEach(() => { vi.resetAllMocks(); });

it("lists flagged questions first with plain-language explanations and the answer table", async () => {
  mock.itemAnalysis.mockResolvedValue(list([item(), pending]));
  const onOpenQuestion = vi.fn();
  render(<ItemAnalysisView courseId="course" onOpenQuestion={onOpenQuestion} />);
  const rows = within(await screen.findByRole("list", { name: "Pitanja, prvo ona za provjeru" })).getAllByRole("listitem", { name: /./ });
  expect(rows.map(row => within(row).getByRole("heading").textContent)).toEqual(["Koja gramatika je dvoznačna?", "Every regular language is context-free."]);
  expect(screen.getByText(/2 pitanja s odgovorima · 1 s barem 30 studenata/)).toHaveTextContent("1 za provjeru");

  const flagged = rows[0];
  const notes = within(flagged).getByRole("list", { name: "Što provjeriti" });
  expect(within(notes).getAllByRole("listitem").map(note => note.textContent)).toEqual([
    "Studenti koji dobro rješavaju ostala pitanja ovo pitanje griješe češće od slabijih studenata (u najboljoj skupini točno odgovara 30%, u najslabijoj 50%). Ključ je možda pogrešan.",
    "Jaki studenti često biraju opciju C („S → SS | a“). Provjerite ključ.",
    "Gotovo nitko ne bira opciju D („S → a“). Uvjerljiviji netočan odgovor učinio bi pitanje informativnijim.",
  ]);
  expect(within(flagged).getByText("Provjerite ključ")).toBeVisible();
  expect(within(flagged).getByText("−0.20")).toBeVisible();
  expect(within(flagged).getByText("30% naspram 50%")).toBeVisible();
  const table = within(flagged).getByRole("table");
  const key = within(table).getByRole("row", { name: /S → aSb \| ε/ });
  expect(key).toHaveTextContent("Ključ");
  expect(within(key).getAllByRole("cell").map(cell => cell.textContent)).toEqual(["45% (18)", "30%", "50%"]);
  expect(within(table).getByRole("row", { name: /S → SS \| a/ })).toHaveTextContent("Jak distraktor");

  fireEvent.click(within(flagged).getByRole("button", { name: "Otvori u bazi pitanja: Koja gramatika je dvoznačna?" }));
  expect(onOpenQuestion).toHaveBeenCalledWith("q1");
});

it("shows only the count below the threshold and says when earlier versions are excluded", async () => {
  mock.itemAnalysis.mockResolvedValue(list([pending]));
  render(<ItemAnalysisView courseId="course" />);
  const row = await screen.findByRole("listitem", { name: "Every regular language is context-free." });
  expect(row).toHaveTextContent("Još nema dovoljno odgovora: 12 od 30 studenata.");
  expect(row).toHaveTextContent("Raniju verziju rješavalo je: 5 studenata; ti odgovori se ne broje.");
  expect(within(row).queryByRole("table")).not.toBeInTheDocument();
  expect(within(row).queryByRole("button")).not.toBeInTheDocument();
});

it("explains true/false distractors by name and reports small groups honestly", async () => {
  const trueFalse = item({
    type: "TRUE_FALSE", flags: ["STRONG_DISTRACTOR"], discrimination: 0.1, upper_correct: 0.4, lower_correct: 0.3,
    options: [option(0, "True", { is_key: true, upper_share: 0.4 }), option(1, "False", { upper_share: 0.6, flag: "STRONG_DISTRACTOR" })],
  });
  expect(explanations(trueFalse)).toEqual(["Jaki studenti često biraju False. Provjerite ključ."]);
  const small = item({ flags: ["TOO_HARD"], difficulty: 0.15, discrimination: null, upper_correct: null, lower_correct: null, group_size: null, ranked_size: 12,
    options: [option(0, "A", { is_key: true, upper_share: null, lower_share: null }), option(1, "B", { upper_share: null, lower_share: null })] });
  expect(explanations(small)).toEqual(["Samo 15% studenata odgovara točno. Provjerite ključ i formulaciju te pokriva li kolegij to gradivo."]);
  expect(explanations(item({ flags: ["TOO_EASY"], difficulty: 0.97 }))).toEqual(["97% studenata odgovara točno. Pitanje možda otkriva svoj odgovor."]);
  mock.itemAnalysis.mockResolvedValue(list([small]));
  render(<ItemAnalysisView courseId="course" />);
  const row = await screen.findByRole("listitem", { name: small.stem });
  expect(row).toHaveTextContent("Premalo rangiranih");
  expect(row).toHaveTextContent("Za skupine treba više studenata koji su odgovorili i na druga pitanja (zasad 12).");
  expect(within(within(row).getByRole("table")).getAllByRole("columnheader").map(cell => cell.textContent)).toEqual(["Opcija", "Svi"]);
});

it("pages through the list and retries a failed load", async () => {
  const rows = Array.from({ length: 20 }, (_, index) => item({ question_id: `q${index}`, stem: `Question ${index}`, flags: [] }));
  mock.itemAnalysis.mockResolvedValueOnce(list(rows, { total: 25 })).mockRejectedValueOnce(new Error("Course owner or faculty moderator access required"))
    .mockResolvedValue(list([item({ question_id: "last", stem: "The last question", flags: [] })], { total: 25 }));
  render(<ItemAnalysisView courseId="course" />);
  expect(await screen.findByText("Stranica 1 od 2")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Sljedeća" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Course owner or faculty moderator access required");
  expect(mock.itemAnalysis).toHaveBeenLastCalledWith("course", 20);
  fireEvent.click(screen.getByRole("button", { name: "Pokušaj ponovno" }));
  expect(await screen.findByRole("heading", { name: "The last question" })).toBeVisible();
  expect(mock.itemAnalysis).toHaveBeenLastCalledWith("course", 20);
  expect(screen.getByRole("button", { name: "Sljedeća" })).toBeDisabled();
  await waitFor(() => expect(screen.getByText("Stranica 2 od 2")).toBeVisible());
});

it("explains the empty state", async () => {
  mock.itemAnalysis.mockResolvedValue(list([]));
  render(<ItemAnalysisView courseId="course" />);
  expect(await screen.findByRole("heading", { name: "Još nema ocijenjenih odgovora." })).toBeVisible();
  expect(screen.getByText(/Svako pitanje treba najmanje 30 studenata/)).toBeVisible();
});
