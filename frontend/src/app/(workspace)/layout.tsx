import { AppShell } from "../../components/app-shell";

// Shared layout keeps the current course's answers and forms mounted across destinations.
export default function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  return <><AppShell />{children}</>;
}
