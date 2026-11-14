import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { PracticeQuiz } from "../src/components/practice-quiz";
import type { Attempt } from "../src/lib/practice-api";

const mock = vi.hoisted(() => ({ history: vi.fn(), start: vi.fn(), read: vi.fn(), save: vi.fn(), submit: vi.fn(), abandon: vi.fn(), availability: vi.fn() }));
vi.mock("../src/lib/practice-api", () => ({ practiceApi: mock }));
vi.mock("../src/lib/api", () => ({ api: mock }));
let current: Extract<Attempt, { status: "ACTIVE" }>;
const abandoned = (): Extract<Attempt, { status: "ABANDONED" }> => ({
  ...structuredClone(current), status: "ABANDONED", abandoned_at: "2030-01-01T12:00:00Z",
});
beforeEach(() => {
  vi.resetAllMocks();
  current = {
    id: "attempt", course_id: "course", status: "ACTIVE", started_at: "2030-01-01T10:00:00Z", submitted_at: null,
    questions: [
      { id: "mcq", position: 0, type: "MULTIPLE_CHOICE", stem: "Choose a number", difficulty: null, options: [{ position: 0, text: "One" }, { position: 1, text: "Two" }], answer: { type: "MULTIPLE_CHOICE", option_position: 0 } },
      { id: "tf", position: 1, type: "TRUE_FALSE", stem: "The sky is green", difficulty: null, options: [], answer: null },
      { id: "sa", position: 2, type: "SHORT_ANSWER", stem: "Explain gravity", difficulty: null, options: [], answer: null },
    ],
  };
  mock.availability.mockResolvedValue({ course_total: 30, total: 30, by_type: [{ type: "TRUE_FALSE", count: 30 }], by_unit: [] });
  mock.history.mockResolvedValue([]);
  mock.start.mockImplementation(async () => structuredClone(current));
  mock.abandon.mockImplementation(async () => abandoned());
  mock.read.mockImplementation(async () => abandoned());
});
async function start(mode = "Vođena vježba") {
  render(<PracticeQuiz courseId="course" />);
  await waitFor(() => expect(screen.getByRole("button", { name: "Započni vježbu" })).toBeEnabled());
  fireEvent.click(screen.getByText("Više mogućnosti"));
  fireEvent.click(screen.getByLabelText(mode));
  fireEvent.click(screen.getByRole("button", { name: "Započni vježbu" }));
  await screen.findByRole("heading", { name: "Pitanje 2 od 3" });
  fireEvent.click(screen.getByRole("button", { name: "Prethodno" }));
  await screen.findByLabelText("One");
  expect(screen.getByRole("button", { name: "Odustani od pokušaja" })).not.toBeVisible();
  fireEvent.click(screen.getByText("Više", { selector: "summary" }));
}

it.each(["Vođena vježba", "Ispitna vježba"])("requires confirmation, warns about unsaved edits, and cancels without mutation in %s", async mode => {
  await start(mode);
  fireEvent.click(screen.getByLabelText("Two"));
  fireEvent.click(screen.getByRole("button", { name: "Odustani od pokušaja" }));
  const confirmation = screen.getByRole("region", { name: "Potvrda odustajanja" });
  expect(within(confirmation).getByText("Odustati od ovog pokušaja?")).toHaveFocus();
  expect(confirmation).toHaveTextContent("neće moći nastaviti");
  expect(confirmation).toHaveTextContent("Spremljeni odgovori ostaju u povijesti");
  expect(confirmation).toHaveTextContent("Ocjene i napredak ponavljanja neće biti zabilježeni");
  expect(confirmation).toHaveTextContent("Nespremljene promjene odgovora bit će odbačene");
  expect(mock.abandon).not.toHaveBeenCalled();
  expect(mock.save).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Nastavi vježbati" }));
  expect(screen.getByLabelText("Two")).toBeChecked();
  expect(screen.getByText("Nespremljene promjene")).toBeInTheDocument();
  expect(screen.queryByRole("region", { name: "Potvrda odustajanja" })).not.toBeInTheDocument();
});

it("abandons without saving local edits and retains only saved answers in a read-only history view", async () => {
  await start();
  fireEvent.click(screen.getByLabelText("Two"));
  fireEvent.click(screen.getByRole("button", { name: "Odustani od pokušaja" }));
  fireEvent.click(screen.getByRole("button", { name: "Potvrdi odustajanje" }));
  const view = await screen.findByRole("region", { name: "Napušteni pokušaj" });
  await waitFor(() => expect(within(view).getByText("Pokušaj je napušten")).toHaveFocus());
  expect(mock.abandon).toHaveBeenCalledWith("course", "attempt");
  expect(mock.save).not.toHaveBeenCalled();
  expect(mock.submit).not.toHaveBeenCalled();
  expect(within(view).getByText("Vaš spremljeni odgovor: One")).toBeInTheDocument();
  expect(within(view).queryByText("Vaš spremljeni odgovor: Two")).not.toBeInTheDocument();
  expect(within(view).getAllByText("Vaš spremljeni odgovor: Nema spremljenog odgovora")).toHaveLength(2);
  expect(view.querySelector("time")).toHaveAttribute("datetime", "2030-01-01T12:00:00Z");
  expect(within(view).queryByRole("button")).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Save answer" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Submit quiz — final" })).not.toBeInTheDocument();
  expect(screen.queryByText(/Correct answer|Reference answer|Practice complete/)).not.toBeInTheDocument();
  expect(screen.queryByRole("region", { name: "Rezultati vježbe" })).not.toBeInTheDocument();
  mock.history.mockResolvedValue([abandoned()]);
  fireEvent.click(screen.getByRole("button", { name: "Natrag na povijest vježbi" }));
  fireEvent.click(await screen.findByRole("button", { name: /Pogledaj napuštenu vježbu/ }));
  await screen.findByRole("region", { name: "Napušteni pokušaj" });
  expect(mock.read).toHaveBeenCalledWith("course", "attempt");
  expect(screen.queryByRole("button", { name: /Nastavi vježbu/ })).not.toBeInTheDocument();
});

it("prevents duplicate abandon requests and disables cancellation while pending", async () => {
  let finish!: (value: Attempt) => void;
  mock.abandon.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
  await start();
  fireEvent.click(screen.getByRole("button", { name: "Odustani od pokušaja" }));
  expect(screen.queryByText("Nespremljene promjene odgovora bit će odbačene.")).not.toBeInTheDocument();
  const confirm = screen.getByRole("button", { name: "Potvrdi odustajanje" });
  fireEvent.click(confirm);
  fireEvent.click(confirm);
  expect(mock.abandon).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("button", { name: "Odustajem…" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Nastavi vježbati" })).toBeDisabled();
  await act(async () => finish(abandoned()));
  await screen.findByText("Pokušaj je napušten");
});

it("retains the attempt and unsaved edit on failure, then allows an explicit retry", async () => {
  mock.abandon.mockRejectedValueOnce(new Error("Connection failed"));
  await start();
  fireEvent.click(screen.getByLabelText("Two"));
  fireEvent.click(screen.getByRole("button", { name: "Odustani od pokušaja" }));
  fireEvent.click(screen.getByRole("button", { name: "Potvrdi odustajanje" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Connection failed");
  expect(screen.getByRole("button", { name: "Potvrdi odustajanje" })).toBeEnabled();
  fireEvent.click(screen.getByRole("button", { name: "Nastavi vježbati" }));
  expect(screen.getByLabelText("Two")).toBeChecked();
  fireEvent.click(screen.getByRole("button", { name: "Odustani od pokušaja" }));
  fireEvent.click(screen.getByRole("button", { name: "Potvrdi odustajanje" }));
  await screen.findByText("Pokušaj je napušten");
  expect(mock.abandon).toHaveBeenCalledTimes(2);
  expect(mock.save).not.toHaveBeenCalled();
});

it("reopens abandoned history with exact saved short answers and no grading controls", async () => {
  current.questions[1].answer = { type: "TRUE_FALSE", value: false };
  current.questions[2].answer = { type: "SHORT_ANSWER", text: "  My answer\n stays here  " };
  mock.history.mockResolvedValue([abandoned()]);
  render(<PracticeQuiz courseId="course" />);
  fireEvent.click(await screen.findByText("Povijest vježbi"));
  fireEvent.click(await screen.findByRole("button", { name: /Pogledaj napuštenu vježbu/ }));
  const view = await screen.findByRole("region", { name: "Napušteni pokušaj" });
  expect(within(view).getByText("Vaš spremljeni odgovor: Netočno")).toBeInTheDocument();
  const answer = within(screen.getByRole("article", { name: "Spremljeni odgovor na pitanje 3" })).getByText(/^Vaš spremljeni odgovor:/);
  expect(answer.textContent).toBe("Vaš spremljeni odgovor:   My answer\n stays here  ");
  expect(answer).toHaveClass("whitespace-pre-wrap");
  expect(within(view).queryByText(/Correct answer:|Reference answer:|Ungraded|%/)).not.toBeInTheDocument();
  expect(mock.submit).not.toHaveBeenCalled();
});

it("handles a saved-attempt reload after abandonment in another tab", async () => {
  await start();
  fireEvent.click(screen.getByRole("button", { name: "Ponovno učitaj spremljene odgovore" }));
  await waitFor(() => expect(screen.getByText("Pokušaj je napušten")).toBeInTheDocument());
  expect(screen.queryByRole("button", { name: "Odustani od pokušaja" })).not.toBeInTheDocument();
  expect(mock.abandon).not.toHaveBeenCalled();
});
