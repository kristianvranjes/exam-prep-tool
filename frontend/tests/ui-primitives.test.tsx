import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { expect, it, vi } from "vitest";
import { Sheet } from "../src/components/sheet";
import { OptionRow, PageHeader, ProgressBar, SegmentedControl, StatCell, optionMarker } from "../src/components/ui";

it("SegmentedControl exposes a labelled group, marks the selection and reports clicks", () => {
  const onChange = vi.fn();
  render(
    <SegmentedControl
      label="Način"
      value="b"
      onChange={onChange}
      options={[{ value: "a", label: "Prvi" }, { value: "b", label: "Drugi" }]}
    />,
  );
  expect(screen.getByRole("group", { name: "Način" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Drugi" })).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByRole("button", { name: "Prvi" })).toHaveAttribute("aria-pressed", "false");
  fireEvent.click(screen.getByRole("button", { name: "Prvi" }));
  expect(onChange).toHaveBeenLastCalledWith("a");
  fireEvent.click(screen.getByRole("button", { name: "Drugi" }));
  expect(onChange).toHaveBeenLastCalledWith("b");
});

it("ProgressBar exposes progressbar values and clamps them", () => {
  const { rerender } = render(<ProgressBar label="Napredak" value={30} max={60} />);
  const bar = screen.getByRole("progressbar", { name: "Napredak" });
  expect(bar).toHaveAttribute("aria-valuemin", "0");
  expect(bar).toHaveAttribute("aria-valuemax", "60");
  expect(bar).toHaveAttribute("aria-valuenow", "30");
  expect(bar.firstElementChild).toHaveStyle({ width: "50%" });
  rerender(<ProgressBar label="Napredak" value={500} />);
  expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "100");
  rerender(<ProgressBar label="Napredak" value={-5} />);
  expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "0");
});

it("OptionRow keeps the native input reachable by its label text and shows the note", () => {
  render(
    <OptionRow control={<input type="radio" name="q" className="peer sr-only" />} marker="A" state="correct" note="Vaš odgovor">
      Zagreb
    </OptionRow>,
  );
  expect(screen.getByLabelText(/Zagreb/)).toHaveAttribute("type", "radio");
  expect(screen.getByText("Vaš odgovor")).toBeInTheDocument();
});

it("optionMarker returns letters and cycling shapes", () => {
  expect([0, 1, 2].map((i) => optionMarker(i, "letters"))).toEqual(["A", "B", "C"]);
  expect([0, 1, 2, 3, 4, 5, 6].map((i) => optionMarker(i, "shapes"))).toEqual(["●", "■", "▲", "◆", "★", "⬟", "●"]);
});

it("StatCell renders label, value and unit", () => {
  render(<StatCell label="Točnost" value="82" unit="%" note="Zadnjih 7 dana" />);
  expect(screen.getByText("Točnost")).toBeInTheDocument();
  expect(screen.getByText("82")).toBeInTheDocument();
  expect(screen.getByText("%")).toBeInTheDocument();
  expect(screen.getByText("Zadnjih 7 dana")).toBeInTheDocument();
});

it("PageHeader renders the heading with its id and fires the back action", () => {
  const onClick = vi.fn();
  render(<PageHeader title="Kolegiji" headingId="page-title" back={{ label: "Natrag", onClick }} />);
  const heading = screen.getByRole("heading", { level: 1, name: "Kolegiji" });
  expect(heading).toHaveAttribute("id", "page-title");
  fireEvent.click(screen.getByRole("button", { name: "Natrag" }));
  expect(onClick).toHaveBeenCalledTimes(1);
});

function SheetHarness() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>Otvori</button>
      <Sheet open={open} onClose={() => setOpen(false)} title="Pitanja"><p>Sadržaj</p></Sheet>
    </>
  );
}

it("Sheet renders nothing when closed and a dialog when open", () => {
  const { rerender } = render(<Sheet open={false} onClose={() => {}} title="Pitanja"><p>Sadržaj</p></Sheet>);
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  rerender(<Sheet open onClose={() => {}} title="Pitanja"><p>Sadržaj</p></Sheet>);
  expect(screen.getByRole("dialog", { name: "Pitanja" })).toBeInTheDocument();
  expect(screen.getByText("Sadržaj")).toBeInTheDocument();
});

it("Sheet closes on Escape and the close button, and restores focus", () => {
  render(<SheetHarness />);
  const opener = screen.getByRole("button", { name: "Otvori" });
  opener.focus();
  fireEvent.click(opener);
  expect(screen.getByRole("dialog")).toHaveFocus();
  fireEvent.keyDown(document, { key: "Escape" });
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(opener).toHaveFocus();
  fireEvent.click(opener);
  fireEvent.click(screen.getByRole("button", { name: "Zatvori" }));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});
