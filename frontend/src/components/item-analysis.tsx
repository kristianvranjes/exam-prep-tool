"use client";

import { useEffect, useState } from "react";
import { CircleCheck } from "lucide-react";
import { api, type ItemAnalysis, type ItemAnalysisFlag, type ItemAnalysisList, type OptionAnalysis } from "../lib/api";
import { Alert, Badge, Button, EmptyState, LoadingState } from "./ui";

const PAGE = 20;
const percent = (share: number) => `${Math.round(share * 100)}%`;
const signed = (value: number) => `${value > 0 ? "+" : value < 0 ? "−" : ""}${Math.abs(value).toFixed(2)}`;
const students = (count: number) => `${count} ${count === 1 ? "student" : "students"}`;
const typeLabel = (item: ItemAnalysis) => item.type.toLowerCase().replaceAll("_", " ");
// A likely wrong key needs a decision; the other flags suggest an improvement.
const FLAGS: Record<ItemAnalysisFlag, { label: string; tone: "danger" | "pending" }> = {
  NEGATIVE_DISCRIMINATION: { label: "Check the key", tone: "danger" },
  STRONG_DISTRACTOR: { label: "Strong distractor", tone: "danger" },
  TOO_HARD: { label: "Very hard", tone: "pending" },
  TOO_EASY: { label: "Very easy", tone: "pending" },
  UNUSED_DISTRACTOR: { label: "Unused option", tone: "pending" },
};

/** Multiple-choice options are lettered by bank position; True and False name themselves. */
function letter(item: ItemAnalysis, option: OptionAnalysis) {
  return item.type === "TRUE_FALSE" ? null : String.fromCharCode(65 + option.position);
}
function optionName(item: ItemAnalysis, option: OptionAnalysis) {
  const mark = letter(item, option);
  return mark ? `option ${mark} (“${option.text}”)` : option.text;
}

/** One plain-language sentence per flag, in the server's priority order. */
export function explanations(item: ItemAnalysis): string[] {
  const flagged = (flag: OptionAnalysis["flag"]) => item.options.filter(option => option.flag === flag);
  return item.flags.flatMap(flag => {
    if (flag === "NEGATIVE_DISCRIMINATION") return [`Students who do well on other questions get this one wrong more often than weaker students (${percent(item.upper_correct ?? 0)} of the top group answer correctly, ${percent(item.lower_correct ?? 0)} of the bottom group). The key may be wrong.`];
    if (flag === "STRONG_DISTRACTOR") return flagged(flag).map(option => `Strong students often choose ${optionName(item, option)} — check the key.`);
    if (flag === "TOO_HARD") return [`Only ${percent(item.difficulty ?? 0)} of students answer correctly. Check the key and the wording, and whether the course covers it.`];
    if (flag === "TOO_EASY") return [`${percent(item.difficulty ?? 0)} of students answer correctly. The question may give its answer away.`];
    return flagged(flag).map(option => `Almost nobody chooses ${optionName(item, option)}. A more plausible wrong answer would make the question more informative.`);
  });
}

export function ItemAnalysisView({ courseId, onOpenQuestion }: { courseId: string; onOpenQuestion?: (questionId: string) => void }) {
  const [offset, setOffset] = useState(0);
  const [revision, setRevision] = useState(0);
  const [data, setData] = useState<ItemAnalysisList | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    api.itemAnalysis(courseId, offset)
      .then(result => { if (active) { setData(result); setError(""); } })
      .catch(e => { if (active) setError(e instanceof Error ? e.message : "Could not load item analysis. Try again."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [courseId, offset, revision]);

  function page(next: number) { setLoading(true); setOffset(next); }
  const pages = data ? Math.max(1, Math.ceil(data.total / PAGE)) : 1;

  return <section className="mt-8 min-w-0 border-t border-line pt-6" aria-labelledby="item-analysis-heading">
    <div className="max-w-prose">
      <h3 id="item-analysis-heading" className="text-xl font-semibold">Item analysis</h3>
      <p className="mt-2 text-sm text-muted">How students answer each approved question, to help you find a wrong key or an option nobody believes. Each student&apos;s first graded answer to the current version counts, and only totals are shown, never an individual student. Answer keys are visible here.</p>
    </div>
    {loading && <LoadingState>Loading item analysis…</LoadingState>}
    {!loading && error && <div className="mt-4 space-y-3"><Alert>{error}</Alert><Button variant="secondary" onClick={() => { setLoading(true); setError(""); setRevision(value => value + 1); }}>Try again</Button></div>}
    {!loading && !error && data && data.total === 0 && <div className="mt-4"><EmptyState title="No graded answers yet.">Statistics appear once students answer approved multiple-choice or true/false questions. Each question needs {data.min_sample_size} students.</EmptyState></div>}
    {!loading && !error && data && data.total > 0 && <>
      <p className="mt-4 text-sm">{data.total} {data.total === 1 ? "question" : "questions"} answered · {data.analysed} with at least {data.min_sample_size} students · <span className="font-semibold">{data.flagged} to check</span></p>
      <ol aria-label="Questions, those to check first" className="mt-4 border-t border-line">
        {data.items.map(item => <ItemRow key={item.question_id} item={item} minimum={data.min_sample_size} onOpenQuestion={onOpenQuestion} />)}
      </ol>
      {pages > 1 && <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button variant="secondary" disabled={offset === 0} onClick={() => page(offset - PAGE)}>Previous</Button>
        <span className="text-sm text-muted">Page {offset / PAGE + 1} of {pages}</span>
        <Button variant="secondary" disabled={offset + PAGE >= data.total} onClick={() => page(offset + PAGE)}>Next</Button>
      </div>}
    </>}
  </section>;
}

function ItemRow({ item, minimum, onOpenQuestion }: { item: ItemAnalysis; minimum: number; onOpenQuestion?: (questionId: string) => void }) {
  const heading = `item-${item.question_id}`;
  const notes = explanations(item);
  return <li aria-labelledby={heading} className="min-w-0 border-b border-line py-5">
    <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
      <h4 id={heading} className="min-w-0 max-w-prose break-words font-display text-lg font-medium [overflow-wrap:anywhere]">{item.stem}</h4>
      <span className="flex flex-wrap gap-2"><Badge>{typeLabel(item)}</Badge>{item.flags.map(flag => <Badge key={flag} tone={FLAGS[flag].tone}>{FLAGS[flag].label}</Badge>)}</span>
    </div>
    {!item.enough_data && <p className="mt-2 text-sm text-muted">Not enough answers yet: {item.sample_size} of {minimum} students.</p>}
    {item.enough_data && <>
      {notes.length > 0 && <ul aria-label="What to check" className="mt-3 max-w-prose list-disc space-y-1 pl-5">{notes.map(note => <li key={note}>{note}</li>)}</ul>}
      <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-4">
        <div><dt className="text-muted">Answered correctly</dt><dd className="font-medium">{percent(item.difficulty ?? 0)}</dd></div>
        <div><dt className="text-muted">Students</dt><dd className="font-medium">{item.sample_size}</dd></div>
        <div><dt className="text-muted">Top vs bottom group</dt><dd className="font-medium">{item.upper_correct === null || item.lower_correct === null ? "Too few ranked" : `${percent(item.upper_correct)} vs ${percent(item.lower_correct)}`}</dd></div>
        <div><dt className="text-muted">Discrimination</dt><dd className="font-medium">{item.discrimination === null ? "—" : signed(item.discrimination)}</dd></div>
      </dl>
      {item.group_size === null && <p className="mt-2 text-sm text-muted">Groups need more students who also answered other questions ({item.ranked_size} so far).</p>}
      {item.options.length > 0 && <OptionTable item={item} />}
    </>}
    {item.earlier_version_sample > 0 && <p className="mt-2 text-sm text-muted">{students(item.earlier_version_sample)} answered an earlier version; those answers are not counted.</p>}
    {onOpenQuestion && <Button variant="ghost" className="mt-2" aria-label={`Open in question bank: ${item.stem}`} onClick={() => onOpenQuestion(item.question_id)}>Open in question bank</Button>}
  </li>;
}

function OptionTable({ item }: { item: ItemAnalysis }) {
  const groups = item.group_size !== null;
  return <div className="mt-4 max-w-2xl overflow-x-auto">
    <table className="w-full text-left text-sm tabular-nums">
      <caption className="sr-only">Answer choices: share of all students{groups ? ` and of the top and bottom ${item.group_size} students` : ""}</caption>
      <thead className="text-muted">
        <tr><th scope="col" className="py-2 pr-3 font-medium">Option</th><th scope="col" className="py-2 pr-3 font-medium">All</th>{groups && <><th scope="col" className="py-2 pr-3 font-medium">Top</th><th scope="col" className="py-2 font-medium">Bottom</th></>}</tr>
      </thead>
      <tbody>
        {item.options.map(option => <tr key={option.position} className="border-t border-line align-top">
          <th scope="row" className="min-w-0 py-2 pr-3 font-normal">
            <span className="break-words [overflow-wrap:anywhere]">{letter(item, option) && <span className="mr-1 font-semibold">{letter(item, option)}</span>}{option.text}</span>
            {option.is_key && <span className="ml-2 inline-flex items-center gap-1 font-medium text-success"><CircleCheck aria-hidden="true" className="size-4" />Key</span>}
            {option.flag && <Badge tone={FLAGS[option.flag].tone} className="ml-2 whitespace-nowrap">{FLAGS[option.flag].label}</Badge>}
          </th>
          <td className="whitespace-nowrap py-2 pr-3">{percent(option.share)} <span className="text-muted">({option.count})</span></td>
          {groups && <><td className="py-2 pr-3">{option.upper_share === null ? "—" : percent(option.upper_share)}</td><td className="py-2">{option.lower_share === null ? "—" : percent(option.lower_share)}</td></>}
        </tr>)}
      </tbody>
    </table>
  </div>;
}
