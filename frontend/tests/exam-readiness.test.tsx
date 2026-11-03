import { fireEvent, render, screen, within } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { ReadinessFigure, ReadinessUnits } from "../src/components/exam-readiness";
import type { ExamScopeReadiness, UnitReadiness } from "../src/lib/api";

const unit = (unit_id: string, title: string, fields: Partial<UnitReadiness> = {}): UnitReadiness => ({
  unit_id, title, position: 0, is_archived: false, question_count: 10, answered_count: 0, retained_count: 0,
  answer_count: 0, correct_answer_count: 0, coverage: 0, accuracy: null, retention: null, readiness: { low: 0, high: 1 }, ...fields,
});
const logic = unit("u1", "Logika", { answered_count: 8, retained_count: 6, answer_count: 12, correct_answer_count: 9, coverage: 0.8, accuracy: 0.75, retention: 0.75, readiness: { low: 0.66, high: 0.79 } });
const sets = unit("u2", "Skupovi", { answered_count: 4, retained_count: 1, answer_count: 5, correct_answer_count: 2, coverage: 0.4, accuracy: 0.4, retention: 0.25, readiness: { low: 0.1, high: 0.5 } });
const relations = unit("u3", "Relacije");
const readiness = (fields: Partial<ExamScopeReadiness> = {}): ExamScopeReadiness => ({
  scope_id: "mi", rule: "readiness-v1", as_of: "2026-11-16T12:00:00Z", question_count: 30, answered_count: 12,
  retained_count: 7, answer_count: 17, correct_answer_count: 11, min_answered: 10, readiness: { low: 0.552, high: 0.704 },
  units: [logic, sets, relations], weakest_unit_ids: ["u3", "u2", "u1"], ...fields,
});

it("sets the range as one figure in Literata tabular figures, says it in words and carries coverage as its subtitle", () => {
  render(<ReadinessFigure readiness={readiness()} subtitle="You have practiced 12 of 30 approved questions" />);
  expect(screen.getByText("Estimated readiness: 55 to 70 percent")).toBeInTheDocument();
  const figure = screen.getByText("55–70%");
  expect(figure).toHaveAttribute("aria-hidden", "true");
  expect(figure.parentElement).toHaveClass("font-display", "tabular-nums");
  expect(screen.getByText("You have practiced 12 of 30 approved questions")).toBeVisible();
  expect(screen.queryByText(/The range is wide/)).not.toBeInTheDocument();
});

it("lists the weakest units with counts and practice shortcuts, keeping evidence one click away", () => {
  const onPracticeUnit = vi.fn();
  render(<ReadinessUnits readiness={readiness()} onPracticeUnit={onPracticeUnit} />);
  const weakest = screen.getByRole("list", { name: "Weakest units" });
  const items = within(weakest).getAllByRole("listitem");
  expect(items.map(item => item.querySelector("p")?.textContent)).toEqual(["Relacije", "Skupovi", "Logika"]);
  expect(within(items[0]).getByText("Not practiced yet · 0 of 10 questions answered")).toBeVisible();
  // Counts, not percentages: the readiness figure is the overview's only percentage.
  expect(within(items[1]).getByText("4 of 10 questions answered · 1 retained · 2 of 5 answers correct")).toBeVisible();
  const practice = within(items[1]).getByRole("button", { name: "Practice this unit: Skupovi" });
  expect(practice).toHaveClass("min-h-11");
  fireEvent.click(practice);
  expect(onPracticeUnit).toHaveBeenCalledExactlyOnceWith("u2");
  fireEvent.click(screen.getByText("Readiness by unit"));
  expect(within(screen.getByRole("list", { name: "Readiness by unit" })).getAllByRole("listitem")).toHaveLength(3);
  expect(screen.getByText(/How it works \(readiness-v1\).*from 17 graded answers to 12 of 30 questions/)).toBeVisible();
});

it("says plainly when there are not enough answers yet, without a range", () => {
  const early = readiness({ answered_count: 3, readiness: null });
  render(<><ReadinessFigure readiness={early} /><ReadinessUnits readiness={early} onPracticeUnit={vi.fn()} /></>);
  expect(screen.getByText("Not enough answers yet")).toBeVisible();
  expect(screen.getByText(/Answer 7 more questions from this cycle to see a readiness range\. You have answered 3 of 30/)).toBeVisible();
  expect(screen.queryByText(/Estimated readiness/)).not.toBeInTheDocument();
  expect(screen.getByRole("list", { name: "Start with" })).toBeVisible();
});

it("flags a wide range and shows a single number once the range has closed", () => {
  const view = render(<><ReadinessFigure readiness={readiness({ readiness: { low: 0.2, high: 0.9 } })} /><ReadinessUnits readiness={readiness()} /></>);
  expect(screen.getByText("Estimated readiness: 20 to 90 percent")).toBeInTheDocument();
  expect(screen.getByText("The range is wide because some units have few or no answers yet.")).toBeVisible();
  // Without a handler, for example during an open session, there are no practice actions.
  expect(screen.queryByRole("button", { name: /Practice this/ })).not.toBeInTheDocument();
  view.unmount();
  render(<ReadinessFigure readiness={readiness({ readiness: { low: 0.75, high: 0.75 } })} />);
  expect(screen.getByText("Estimated readiness: 75 percent")).toBeInTheDocument();
  expect(screen.getByText("75%")).toBeInTheDocument();
});

it("explains a cycle without automatically graded questions instead of showing zeros", () => {
  const empty = readiness({ question_count: 0, answered_count: 0, min_answered: 0, readiness: null, units: [unit("u1", "Logika", { question_count: 0, coverage: null, readiness: null })], weakest_unit_ids: [] });
  render(<><ReadinessFigure readiness={empty} /><ReadinessUnits readiness={empty} /></>);
  expect(screen.getByText(/No automatically graded questions are linked to this cycle's units yet/)).toBeVisible();
  expect(screen.queryByText("Not enough answers yet")).not.toBeInTheDocument();
  expect(screen.queryByText("Readiness by unit")).not.toBeInTheDocument();
  expect(screen.queryByText("0%")).not.toBeInTheDocument();
});
