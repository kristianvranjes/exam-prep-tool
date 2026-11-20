import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AuthScreen } from "../src/components/auth-screen";

const mock = vi.hoisted(() => ({ authConfig: vi.fn() }));
vi.mock("../src/lib/api", () => ({ api: mock }));
vi.mock("../src/components/theme", () => ({ ThemeSelect: () => null }));

const initialize = vi.fn();
const renderButton = vi.fn((element: HTMLElement) => { element.textContent = "Nastavi s Googleom"; });
const props = () => ({ mode: "login" as const, busy: false, error: "", submit: vi.fn(), changeMode: vi.fn(), onGoogle: vi.fn() });

beforeEach(() => {
  vi.clearAllMocks();
  (window as unknown as { google: unknown }).google = { accounts: { id: { initialize, renderButton } } };
  // The script is already on the page and loaded, as after a first visit.
  const script = document.createElement("script");
  script.src = "https://accounts.google.com/gsi/client"; script.dataset.loaded = "1";
  document.head.appendChild(script);
});
afterEach(() => { document.head.querySelectorAll("script").forEach(node => node.remove()); });

it("offers Google above the e-mail form when both are on, and passes the credential on", async () => {
  mock.authConfig.mockResolvedValue({ google_client_id: "id.apps.googleusercontent.com", password_login: true });
  const p = props();
  render(<AuthScreen {...p} />);
  expect(await screen.findByText("Nastavi s Googleom")).toBeInTheDocument();
  expect(screen.getByText("ili e-poštom")).toBeInTheDocument();
  expect(screen.getByRole("form", { name: "Prijava" })).toBeInTheDocument();
  expect(initialize).toHaveBeenCalledWith(expect.objectContaining({ client_id: "id.apps.googleusercontent.com", ux_mode: "popup" }));
  initialize.mock.calls[0][0].callback({ credential: "token" });
  expect(p.onGoogle).toHaveBeenCalledWith("token");
});

it("shows only Google when password sign-in is off, with errors still in words", async () => {
  mock.authConfig.mockResolvedValue({ google_client_id: "id.apps.googleusercontent.com", password_login: false });
  render(<AuthScreen {...props()} error="Prijava Googleom nije uspjela. Pokušajte ponovno." />);
  expect(await screen.findByText("Nastavi s Googleom")).toBeInTheDocument();
  expect(screen.queryByRole("form", { name: "Prijava" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Izradi račun" })).not.toBeInTheDocument();
  expect(screen.queryByText("ili e-poštom")).not.toBeInTheDocument();
  expect(screen.getByRole("alert")).toHaveTextContent("Prijava Googleom nije uspjela.");
});

it("stays the password form without a Google client, or when the config cannot be read", async () => {
  mock.authConfig.mockResolvedValue({ google_client_id: null, password_login: true });
  const view = render(<AuthScreen {...props()} />);
  await waitFor(() => expect(mock.authConfig).toHaveBeenCalled());
  expect(screen.getByRole("form", { name: "Prijava" })).toBeInTheDocument();
  expect(screen.queryByText("ili e-poštom")).not.toBeInTheDocument();
  expect(renderButton).not.toHaveBeenCalled();
  view.unmount();
  mock.authConfig.mockRejectedValue(new Error("offline"));
  render(<AuthScreen {...props()} />);
  expect(await screen.findByRole("form", { name: "Prijava" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Izradi račun" })).toBeInTheDocument();
});
