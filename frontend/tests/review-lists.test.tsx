import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { ProgressPanel } from "../src/components/progress-panel";
import type { ReviewProgressSummary } from "../src/lib/api";
import type { FavoriteQuestion, MistakeQuestion } from "../src/lib/practice-api";

const mock = vi.hoisted(() => ({
  reviewProgress: vi.fn(), reviewProgressSummary: vi.fn(), unitProgress: vi.fn(), reviewDue: vi.fn(),
  mistakes: vi.fn(), favorites: vi.fn(), favorite: vi.fn(), unfavorite: vi.fn(),
}));
vi.mock("../src/lib/api", () => ({ api: mock }));
vi.mock("../src/lib/practice-api", () => ({ practiceApi: mock }));

const asOf = "2030-01-02T12:00:00Z";
const summary = (changes: Partial<ReviewProgressSummary> = {}): ReviewProgressSummary => ({
  as_of: asOf, reviewed_questions: 2, due_now: 0, upcoming: 2,
  resolved_review_count: 3, correct_review_count: 1, incorrect_review_count: 2,
  last_reviewed_at: "2030-01-01T10:00:00Z", next_due_at: "2030-01-03T10:00:00Z",
  stage_counts: [0, 1, 2, 3, 4, 5].map(review_stage => ({ review_stage, question_count: 0 })), ...changes,
});
const mistake = (index: number, changes: Partial<MistakeQuestion> = {}): MistakeQuestion => ({
  question_id: `m${index}`, type: "MULTIPLE_CHOICE", stem: `Mistake ${index}?`, difficulty: null, units: [],
  last_reviewed_at: "2030-01-01T10:00:00Z", incorrect_review_count: 1, available: true, ...changes,
});
const favorite = (index: number, changes: Partial<FavoriteQuestion> = {}): FavoriteQuestion => ({
  question_id: `f${index}`, favorited_at: "2030-01-01T09:00:00Z", type: "TRUE_FALSE", stem: `Favorite ${index}?`,
  difficulty: null, available: true, ...changes,
});
const page = <T,>(make: (index: number) => T, from: number, count: number) => Array.from({ length: count }, (_, index) => make(from + index));

function section(name: string) {
  return screen.findByRole("region", { name });
}

beforeEach(() => {
  vi.resetAllMocks();
  mock.reviewProgressSummary.mockResolvedValue(summary());
  mock.reviewProgress.mockResolvedValue([]);
  mock.unitProgress.mockResolvedValue({ as_of: asOf, units: [] });
  mock.mistakes.mockResolvedValue([]);
  mock.favorites.mockResolvedValue([]);
});

it("lists mistakes with stems, type, units and dates, marks unavailable ones and opens Mistakes practice", async () => {
  mock.mistakes.mockResolvedValue([
    mistake(1, { stem: "Je li $x^2$ paran?", type: "TRUE_FALSE", units: [{ id: "u1", title: "Logic" }, { id: "u2", title: "Sets" }], incorrect_review_count: 3 }),
    mistake(2, { available: false }),
  ]);
  const practice = vi.fn();
  render(<ProgressPanel courseId="course" onPracticeMistakes={practice} />);
  const mistakes = await section("Mistakes");
  const rows = await within(mistakes).findAllByRole("listitem");
  expect(mock.mistakes).toHaveBeenCalledWith("course", 0, 20);
  expect(rows).toHaveLength(2);
  expect(rows[0]).toHaveTextContent("Je li");
  // Stems render through RichText, so formulas are typeset.
  await waitFor(() => expect(rows[0].querySelector(".katex")).not.toBeNull());
  expect(rows[0]).toHaveTextContent(/True \/ false · Logic, Sets · Last missed .+ · Missed 3 times/);
  expect(rows[0].querySelector("time")).toHaveAttribute("datetime", "2030-01-01T10:00:00Z");
  expect(within(rows[0]).queryByText("Unavailable for practice")).not.toBeInTheDocument();
  expect(rows[1]).toHaveTextContent(/Multiple choice · Last missed .+ · Missed 1 time$/);
  expect(within(rows[1]).getByText("Unavailable for practice")).toBeVisible();
  // A full page is the only sign of more; this one is short.
  expect(within(mistakes).queryByRole("button", { name: "Load more mistakes" })).not.toBeInTheDocument();
  fireEvent.click(within(mistakes).getByRole("button", { name: "Practice these mistakes" }));
  expect(practice).toHaveBeenCalledOnce();
});

it("loads more mistakes a page at a time and retries a failed page", async () => {
  mock.mistakes
    .mockResolvedValueOnce(page(index => mistake(index), 0, 20))
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValueOnce([mistake(19), mistake(20)]);
  render(<ProgressPanel courseId="course" />);
  const mistakes = await section("Mistakes");
  expect(await within(mistakes).findAllByRole("listitem")).toHaveLength(20);
  fireEvent.click(within(mistakes).getByRole("button", { name: "Load more mistakes" }));
  expect(await within(mistakes).findByRole("alert")).toHaveTextContent("Could not load more mistakes. Try again.");
  expect(within(mistakes).getAllByRole("listitem")).toHaveLength(20);
  fireEvent.click(within(mistakes).getByRole("button", { name: "Retry mistakes" }));
  await waitFor(() => expect(within(mistakes).getAllByRole("listitem")).toHaveLength(21));
  expect(mock.mistakes).toHaveBeenNthCalledWith(2, "course", 20, 20);
  expect(mock.mistakes).toHaveBeenNthCalledWith(3, "course", 20, 20);
  // A row that shifted pages is listed once, and a short page ends the list.
  expect(within(mistakes).queryByRole("button", { name: "Load more mistakes" })).not.toBeInTheDocument();
  expect(within(mistakes).queryByRole("alert")).not.toBeInTheDocument();
});

it("says plainly when there is nothing to list and offers no practice", async () => {
  render(<ProgressPanel courseId="course" onPracticeMistakes={vi.fn()} onPracticeFavorites={vi.fn()} />);
  const mistakes = await section("Mistakes");
  expect(await within(mistakes).findByText(/No mistakes to review/)).toBeVisible();
  const favorites = await section("Favorites");
  expect(await within(favorites).findByText(/No favorites yet/)).toBeVisible();
  expect(screen.queryByRole("button", { name: "Practice these mistakes" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Practice favorites" })).not.toBeInTheDocument();
});

it("offers no Mistakes section before any graded practice, but still lists favorites", async () => {
  mock.reviewProgressSummary.mockResolvedValue(summary({ reviewed_questions: 0, resolved_review_count: 0, correct_review_count: 0, incorrect_review_count: 0 }));
  mock.favorites.mockResolvedValue([favorite(1)]);
  render(<ProgressPanel courseId="course" />);
  const favorites = await section("Favorites");
  expect(await within(favorites).findByText("Favorite 1?")).toBeVisible();
  expect(screen.queryByRole("region", { name: "Mistakes" })).not.toBeInTheDocument();
  expect(mock.mistakes).not.toHaveBeenCalled();
});

it("lists favorites, unstars one in place and opens Favorites practice while one is still available", async () => {
  mock.favorites.mockResolvedValue([favorite(1), favorite(2, { available: false, type: "NUMERIC" })]);
  mock.unfavorite.mockResolvedValue({ question_id: "f1", favorite: false, favorited_at: null });
  const practice = vi.fn();
  render(<ProgressPanel courseId="course" onPracticeFavorites={practice} />);
  const favorites = await section("Favorites");
  const rows = await within(favorites).findAllByRole("listitem");
  expect(mock.favorites).toHaveBeenCalledWith("course", 0, 20);
  expect(rows[0]).toHaveTextContent(/True \/ false · Saved .+/);
  expect(rows[1]).toHaveTextContent(/Numeric · Saved/);
  expect(within(rows[1]).getByText("Unavailable for practice")).toBeVisible();
  const star = within(rows[0]).getByRole("button", { name: "Favorite: Favorite 1?" });
  expect(star).toHaveAttribute("aria-pressed", "true");
  fireEvent.click(within(favorites).getByRole("button", { name: "Practice favorites" }));
  expect(practice).toHaveBeenCalledOnce();
  await act(async () => { fireEvent.click(star); });
  expect(mock.unfavorite).toHaveBeenCalledWith("course", "f1");
  // The row stays so the star can be pressed again; nothing left to practice hides the action.
  expect(star).toHaveAttribute("aria-pressed", "false");
  expect(within(favorites).getAllByRole("listitem")).toHaveLength(2);
  expect(within(favorites).queryByRole("button", { name: "Practice favorites" })).not.toBeInTheDocument();
});

it("reloads both lists with Refresh progress", async () => {
  render(<ProgressPanel courseId="course" />);
  await section("Mistakes");
  await waitFor(() => expect(mock.mistakes).toHaveBeenCalledTimes(1));
  expect(mock.favorites).toHaveBeenCalledTimes(1);
  mock.mistakes.mockResolvedValue([mistake(1)]);
  fireEvent.click(screen.getByRole("button", { name: "Refresh progress" }));
  const mistakes = await section("Mistakes");
  expect(await within(mistakes).findByText("Mistake 1?")).toBeVisible();
  expect(mock.favorites).toHaveBeenCalledTimes(2);
});

it("pages favorites past rows unstarred here without skipping the next favorite", async () => {
  mock.favorites.mockResolvedValueOnce(page(index => favorite(index), 0, 20)).mockResolvedValueOnce([favorite(20)]);
  mock.unfavorite.mockResolvedValue({ question_id: "f3", favorite: false, favorited_at: null });
  render(<ProgressPanel courseId="course" />);
  const favorites = await section("Favorites");
  const rows = await within(favorites).findAllByRole("listitem");
  const star = within(rows[3]).getByRole("button", { name: "Favorite: Favorite 3?" });
  await act(async () => { fireEvent.click(star); });
  expect(star).toHaveAttribute("aria-pressed", "false");
  fireEvent.click(within(favorites).getByRole("button", { name: "Load more favorites" }));
  // The server no longer counts f3, so the next page starts one row earlier.
  await waitFor(() => expect(within(favorites).getAllByRole("listitem")).toHaveLength(21));
  expect(mock.favorites).toHaveBeenNthCalledWith(2, "course", 19, 20);
  expect(within(favorites).getByText("Favorite 20?")).toBeVisible();
});

it("drops stars changed here once Refresh progress reloads the favorites", async () => {
  mock.favorites.mockResolvedValue([favorite(1)]);
  mock.unfavorite.mockResolvedValue({ question_id: "f1", favorite: false, favorited_at: null });
  render(<ProgressPanel courseId="course" />);
  const favorites = await section("Favorites");
  await act(async () => { fireEvent.click(await within(favorites).findByRole("button", { name: "Favorite: Favorite 1?" })); });
  expect(within(favorites).getByRole("button", { name: "Favorite: Favorite 1?" })).toHaveAttribute("aria-pressed", "false");
  // Starred again elsewhere: the reloaded list is the truth.
  fireEvent.click(screen.getByRole("button", { name: "Refresh progress" }));
  await waitFor(() => expect(mock.favorites).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(within(favorites).getByRole("button", { name: "Favorite: Favorite 1?" })).toHaveAttribute("aria-pressed", "true"));
});

it("says a failed refresh could not refresh the list and never calls it loading more", async () => {
  let fail: (cause: Error) => void = () => {};
  mock.favorites
    .mockResolvedValueOnce(page(index => favorite(index), 0, 20))
    .mockImplementationOnce(() => new Promise((_, reject) => { fail = reject; }));
  render(<ProgressPanel courseId="course" />);
  const favorites = await section("Favorites");
  expect(await within(favorites).findAllByRole("listitem")).toHaveLength(20);
  fireEvent.click(screen.getByRole("button", { name: "Refresh progress" }));
  await waitFor(() => expect(mock.favorites).toHaveBeenCalledTimes(2));
  const more = within(favorites).getByRole("button", { name: "Load more favorites" });
  expect(more).toBeDisabled();
  await act(async () => { fail(new Error("offline")); });
  expect(await within(favorites).findByRole("alert")).toHaveTextContent("Could not refresh your favorites.");
  expect(within(favorites).getAllByRole("listitem")).toHaveLength(20);
  expect(within(favorites).getByRole("button", { name: "Retry favorites" })).toBeEnabled();
});

it("explains that questions in an unfinished session are left out of Mistakes practice", async () => {
  mock.mistakes.mockResolvedValue([mistake(1)]);
  render(<ProgressPanel courseId="course" />);
  const mistakes = await section("Mistakes");
  expect(within(mistakes).getByText(/Questions in an unfinished session are left out of practice until you finish or abandon it\./)).toBeVisible();
});
