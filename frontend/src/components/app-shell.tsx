"use client";

import { FormEvent, useEffect, useState } from "react";
import { api, Course, User } from "../lib/api";

import { QuestionBank } from "./question-bank";
import { CourseMaterials } from "./course-materials";
type Mode = "login" | "register";

export function AppShell() {
  const [user, setUser] = useState<User | null>(null);
  const [courses, setCourses] = useState<Course[]>([]);
  const [selected, setSelected] = useState<Course | null>(null);
  const [mode, setMode] = useState<Mode>("login");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => { api.me().then(setUser).catch(() => undefined); }, []);
  useEffect(() => { if (user) api.courses().then(setCourses).catch(() => setError("Could not load courses")); }, [user]);

  async function submitAuth(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError("");
    const values = Object.fromEntries(new FormData(event.currentTarget));
    try {
      const nextUser = mode === "login" ? await api.login({ email: String(values.email), password: String(values.password) }) : await api.register({ email: String(values.email), password: String(values.password), display_name: String(values.display_name) });
      setUser(nextUser);
    } catch (e) { setError(e instanceof Error ? e.message : "Authentication failed"); } finally { setBusy(false); }
  }

  async function createCourse(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError("");
    const form = event.currentTarget;
    const values = Object.fromEntries(new FormData(event.currentTarget));
    try { const course = await api.createCourse({ name: String(values.name), code: String(values.code || "") || undefined, description: String(values.description || "") || undefined }); setCourses((current) => [...current, course]); setSelected(course); form.reset(); }
    catch (e) { setError(e instanceof Error ? e.message : "Could not create course"); } finally { setBusy(false); }
  }

  if (!user) return <main className="mx-auto max-w-md px-6 py-16"><p className="text-sm text-neutral-500">Phase 2 · Account access</p><h1 className="mt-3 text-4xl font-semibold">ExamPrep</h1><p className="mt-3 text-neutral-600">{mode === "login" ? "Sign in to manage your courses." : "Create your student account."}</p><form onSubmit={submitAuth} className="mt-8 space-y-4 rounded-xl border border-neutral-200 bg-white p-6"><label className="block text-sm">Email<input name="email" type="email" required className="mt-1 w-full rounded border p-2" /></label>{mode === "register" && <label className="block text-sm">Display name<input name="display_name" required minLength={1} maxLength={100} className="mt-1 w-full rounded border p-2" /></label>}<label className="block text-sm">Password<input name="password" type="password" required minLength={mode === "register" ? 8 : 1} className="mt-1 w-full rounded border p-2" /></label><button disabled={busy} className="w-full rounded bg-black px-4 py-2 text-white disabled:opacity-50">{busy ? "Working…" : mode === "login" ? "Log in" : "Register"}</button>{error && <p role="alert" className="text-sm text-red-700">{error}</p>}</form><button className="mt-4 text-sm underline" onClick={() => { setMode(mode === "login" ? "register" : "login"); setError(""); }}>{mode === "login" ? "Create an account" : "Already have an account? Log in"}</button></main>;

  return <main className="mx-auto max-w-3xl px-6 py-12"><header className="flex items-center justify-between"><div><p className="text-sm text-neutral-500">Signed in as</p><h1 className="text-2xl font-semibold">{user.display_name}</h1><p className="text-sm text-neutral-600">{user.email}</p></div><button className="rounded border px-3 py-2 text-sm" onClick={async () => { await api.logout(); setUser(null); setCourses([]); setSelected(null); }}>Log out</button></header><section className="mt-10"><h2 className="text-xl font-semibold">Your courses</h2>{courses.length === 0 ? <p className="mt-3 text-neutral-600">You do not belong to any courses yet.</p> : <ul className="mt-3 grid gap-3 sm:grid-cols-2">{courses.map((course) => <li key={course.id}><button className="w-full rounded border p-4 text-left hover:bg-neutral-50" onClick={() => setSelected(course)}><span className="font-medium">{course.name}</span>{course.code && <span className="ml-2 text-sm text-neutral-500">{course.code}</span>}<span className="mt-1 block text-sm text-neutral-600">{course.description || "No description"}</span></button></li>)}</ul>}</section><form onSubmit={createCourse} className="mt-10 space-y-4 rounded-xl border border-neutral-200 bg-white p-6"><h2 className="font-semibold">Create a course</h2><input name="name" required maxLength={150} placeholder="Course name" className="w-full rounded border p-2" /><input name="code" maxLength={50} placeholder="Code (optional)" className="w-full rounded border p-2" /><textarea name="description" maxLength={2000} placeholder="Description (optional)" className="w-full rounded border p-2" /><button disabled={busy} className="rounded bg-black px-4 py-2 text-white disabled:opacity-50">Create course</button></form>{selected && <section className="mt-6 rounded-xl border bg-neutral-50 p-6"><h2 className="text-xl font-semibold">{selected.name}</h2>{selected.code && <p className="text-sm text-neutral-600">{selected.code}</p>}<p className="mt-3 text-neutral-700">{selected.description || "No description"}</p><CourseMaterials key={selected.id} courseId={selected.id} /><QuestionBank key={`questions-${selected.id}`} courseId={selected.id} /></section>}{error && <p role="alert" className="mt-4 text-sm text-red-700">{error}</p>}</main>;
}
