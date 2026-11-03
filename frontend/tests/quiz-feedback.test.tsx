import { useState } from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { CheckedFeedback } from "../src/components/quiz-feedback";
import type { ActiveQuestion, QuestionFeedback, SelfReview } from "../src/lib/practice-api";

const question: ActiveQuestion = {
  id: "sa", position: 0, type: "SHORT_ANSWER", stem: "Explain gravity", difficulty: null, options: [],
  answer: { type: "SHORT_ANSWER", text: "Mass attracts mass" },
};
const pending: QuestionFeedback = {
  options: [], explanation: "Every mass attracts every other mass.", correct_boolean: null,
  reference_answer: "Masses attract each other", grading_status: "PENDING", self_review: null,
};

function Guided({ save }: { save: (verdict: SelfReview | null) => Promise<void> }) {
  const [feedback, setFeedback] = useState(pending);
  return <CheckedFeedback question={question} feedback={feedback} onSelfReview={async verdict => {
    await save(verdict); setFeedback(current => ({ ...current, self_review: verdict }));
  }} />;
}

it("lets a checked short answer be self-assessed, labelled as the student's own check", async () => {
  const save = vi.fn().mockResolvedValue(undefined);
  render(<Guided save={save} />);
  const block = screen.getByRole("region", { name: "Answer feedback" });
  expect(within(block).getByRole("heading", { name: "Compare with the reference answer" })).toBeVisible();
  const hadIt = within(block).getByRole("button", { name: "I had it" });
  expect(hadIt).toHaveAttribute("type", "button");
  fireEvent.click(hadIt);
  await waitFor(() => expect(hadIt).toHaveAttribute("aria-pressed", "true"));
  expect(save).toHaveBeenCalledWith("CORRECT");
  expect(within(block).getByRole("status")).toHaveTextContent("Saved as self-assessed correct.");
  expect(within(block).getByText(/Your own check, not a grade/)).toBeVisible();
  // The grade itself stays pending: no Correct verdict appears.
  expect(within(block).queryByRole("heading", { name: "Correct" })).not.toBeInTheDocument();
  fireEvent.click(within(block).getByRole("button", { name: "I missed it" }));
  await waitFor(() => expect(within(block).getByRole("button", { name: "I missed it" })).toHaveAttribute("aria-pressed", "true"));
  expect(save).toHaveBeenLastCalledWith("INCORRECT");
});

it("ignores repeat presses while saving", async () => {
  let finish!: () => void;
  const save = vi.fn(() => new Promise<void>(done => { finish = done; }));
  render(<Guided save={save} />);
  const hadIt = screen.getByRole("button", { name: "I had it" });
  fireEvent.click(hadIt);
  expect(hadIt).toHaveAttribute("aria-disabled", "true");
  fireEvent.click(screen.getByRole("button", { name: "I missed it" }));
  expect(save).toHaveBeenCalledOnce();
  finish();
  await waitFor(() => expect(hadIt).toHaveAttribute("aria-pressed", "true"));
});

it("offers no self-assessment for graded answers or without a save handler", () => {
  const { rerender } = render(<CheckedFeedback question={question} feedback={pending} />);
  expect(screen.queryByRole("button")).not.toBeInTheDocument();
  const numeric: ActiveQuestion = { ...question, type: "NUMERIC", answer: { type: "NUMERIC", value: "9.81" } };
  rerender(<CheckedFeedback question={numeric} feedback={{ ...pending, grading_status: "CORRECT", correct_value: "9.81" }} onSelfReview={vi.fn()} />);
  expect(screen.queryByRole("button")).not.toBeInTheDocument();
});
