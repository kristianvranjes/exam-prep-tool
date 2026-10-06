import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { DraftForm, UnsavedChangesProvider } from "../src/components/unsaved-changes";

it("clears a reverted edit and a successful form reset, but keeps failed or disabled drafts dirty", async () => {
  const changed = vi.fn();
  render(<UnsavedChangesProvider onDirtyChange={changed}>
    <DraftForm aria-label="Draft"><fieldset><input aria-label="Text" defaultValue="Original" /></fieldset></DraftForm>
  </UnsavedChangesProvider>);
  await act(async () => fireEvent.change(screen.getByLabelText("Text"), { target: { value: "Edited" } }));
  expect(changed).toHaveBeenLastCalledWith(true);
  screen.getByLabelText("Text").closest("fieldset")!.disabled = true;
  await act(async () => fireEvent.click(screen.getByRole("form")));
  expect(changed).toHaveBeenLastCalledWith(true);
  await act(async () => fireEvent.change(screen.getByLabelText("Text"), { target: { value: "Original" } }));
  expect(changed).toHaveBeenLastCalledWith(false);
  await act(async () => fireEvent.change(screen.getByLabelText("Text"), { target: { value: "Another edit" } }));
  expect(changed).toHaveBeenLastCalledWith(true);
  await act(async () => screen.getByRole("form").closest("form")!.reset());
  expect(changed).toHaveBeenLastCalledWith(false);
});

it("does not clear another form's unsaved content when one draft is closed", async () => {
  const changed = vi.fn();
  function Forms({ first = true }: { first?: boolean }) {
    return <UnsavedChangesProvider onDirtyChange={changed}>
      {first && <DraftForm><input aria-label="First" defaultValue="" /></DraftForm>}
      <DraftForm><input aria-label="Second" defaultValue="" /></DraftForm>
    </UnsavedChangesProvider>;
  }
  const view = render(<Forms />);
  await act(async () => {
    fireEvent.change(screen.getByLabelText("First"), { target: { value: "First draft" } });
    fireEvent.change(screen.getByLabelText("Second"), { target: { value: "Second draft" } });
  });
  view.rerender(<Forms first={false} />);
  await waitFor(() => expect(changed).toHaveBeenLastCalledWith(true));
  await act(async () => fireEvent.change(screen.getByLabelText("Second"), { target: { value: "" } }));
  expect(changed).toHaveBeenLastCalledWith(false);
});
