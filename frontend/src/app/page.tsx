import { BackendHealth } from "@/components/backend-health";
export default function Home() {
  return <main className="mx-auto max-w-xl px-6 py-24">
    <p className="text-sm font-medium text-neutral-500">Phase 1 · Local development</p>
    <h1 className="mt-3 text-4xl font-semibold tracking-tight">ExamPrep</h1>
    <p className="mt-4 text-neutral-600">University exam preparation. The development foundation is ready for the next phase.</p>
    <BackendHealth />
  </main>;
}
