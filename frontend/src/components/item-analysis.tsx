"use client";

import { useEffect, useState } from "react";
import { CircleCheck } from "lucide-react";
import { api, type ItemAnalysis, type ItemAnalysisFlag, type ItemAnalysisList, type OptionAnalysis } from "../lib/api";
import { typeLabels } from "../lib/question-types";
import { pluralForm, QUESTIONS } from "../lib/plural";
import { RichText } from "./rich-text";
import { Alert, Badge, Button, EmptyState, LoadingState } from "./ui";

const PAGE = 20;
const percent = (share: number) => `${Math.round(share * 100)}%`;
const signed = (value: number) => `${value > 0 ? "+" : value < 0 ? "−" : ""}${Math.abs(value).toFixed(2)}`;
const students = (count: number) => `${count} ${studentForm(count)}`;
const studentForm = (count: number) => pluralForm(count, ["student", "studenta", "studenata"]);
// A likely wrong key needs a decision; the other flags suggest an improvement.
const FLAGS: Record<ItemAnalysisFlag, { label: string; tone: "danger" | "pending" }> = {
  NEGATIVE_DISCRIMINATION: { label: "Provjerite ključ", tone: "danger" },
  STRONG_DISTRACTOR: { label: "Jak distraktor", tone: "danger" },
  TOO_HARD: { label: "Vrlo teško", tone: "pending" },
  TOO_EASY: { label: "Vrlo lako", tone: "pending" },
  UNUSED_DISTRACTOR: { label: "Neiskorištena opcija", tone: "pending" },
};

/** Multiple-choice options are lettered by bank position; True and False name themselves. */
function letter(item: ItemAnalysis, option: OptionAnalysis) {
  return item.type === "TRUE_FALSE" ? null : String.fromCharCode(65 + option.position);
}
function optionName(item: ItemAnalysis, option: OptionAnalysis) {
  const mark = letter(item, option);
  return mark ? `opciju ${mark} („${option.text}“)` : option.text;
}

/** One plain-language sentence per flag, in the server's priority order. */
export function explanations(item: ItemAnalysis): string[] {
  const flagged = (flag: OptionAnalysis["flag"]) => item.options.filter(option => option.flag === flag);
  return item.flags.flatMap(flag => {
    if (flag === "NEGATIVE_DISCRIMINATION") return [`Studenti koji dobro rješavaju ostala pitanja ovo pitanje griješe češće od slabijih studenata (u najboljoj skupini točno odgovara ${percent(item.upper_correct ?? 0)}, u najslabijoj ${percent(item.lower_correct ?? 0)}). Ključ je možda pogrešan.`];
    if (flag === "STRONG_DISTRACTOR") return flagged(flag).map(option => `Jaki studenti često biraju ${optionName(item, option)} — provjerite ključ.`);
    if (flag === "TOO_HARD") return [`Samo ${percent(item.difficulty ?? 0)} studenata odgovara točno. Provjerite ključ i formulaciju te pokriva li kolegij to gradivo.`];
    if (flag === "TOO_EASY") return [`${percent(item.difficulty ?? 0)} studenata odgovara točno. Pitanje možda otkriva svoj odgovor.`];
    return flagged(flag).map(option => `Gotovo nitko ne bira ${optionName(item, option)}. Uvjerljiviji netočan odgovor učinio bi pitanje informativnijim.`);
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
      .catch(e => { if (active) setError(e instanceof Error ? e.message : "Analizu pitanja nije moguće učitati. Pokušajte ponovno."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [courseId, offset, revision]);

  function page(next: number) { setLoading(true); setOffset(next); }
  const pages = data ? Math.max(1, Math.ceil(data.total / PAGE)) : 1;

  return <section className="mt-8 min-w-0 border-t border-line pt-6" aria-labelledby="item-analysis-heading">
    <div className="max-w-prose">
      <h3 id="item-analysis-heading" className="text-xl font-semibold">Analiza pitanja</h3>
      <p className="mt-2 text-sm text-muted">Kako studenti odgovaraju na pojedino odobreno pitanje, kako biste pronašli pogrešan ključ ili opciju u koju nitko ne vjeruje. Računa se prvi ocijenjeni odgovor svakog studenta na trenutnu verziju, a prikazuju se samo zbrojevi, nikada pojedini student. Ključevi odgovora ovdje su vidljivi.</p>
    </div>
    {loading && <LoadingState>Učitavanje analize pitanja…</LoadingState>}
    {!loading && error && <div className="mt-4 space-y-3"><Alert>{error}</Alert><Button variant="secondary" onClick={() => { setLoading(true); setError(""); setRevision(value => value + 1); }}>Pokušaj ponovno</Button></div>}
    {!loading && !error && data && data.total === 0 && <div className="mt-4"><EmptyState title="Još nema ocijenjenih odgovora.">Statistika se pojavljuje kad studenti odgovore na odobrena, automatski ocjenjivana pitanja. Svako pitanje treba najmanje {data.min_sample_size} {studentForm(data.min_sample_size)}.</EmptyState></div>}
    {!loading && !error && data && data.total > 0 && <>
      <p className="mt-4 text-sm">{data.total} {pluralForm(data.total, QUESTIONS)} s odgovorima · {data.analysed} s barem {data.min_sample_size} {studentForm(data.min_sample_size)} · <span className="font-semibold">{data.flagged} za provjeru</span></p>
      <ol aria-label="Pitanja, prvo ona za provjeru" className="mt-4 border-t border-line">
        {data.items.map(item => <ItemRow key={item.question_id} item={item} minimum={data.min_sample_size} onOpenQuestion={onOpenQuestion} />)}
      </ol>
      {pages > 1 && <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button variant="secondary" disabled={offset === 0} onClick={() => page(offset - PAGE)}>Prethodna</Button>
        <span className="text-sm text-muted">Stranica {offset / PAGE + 1} od {pages}</span>
        <Button variant="secondary" disabled={offset + PAGE >= data.total} onClick={() => page(offset + PAGE)}>Sljedeća</Button>
      </div>}
    </>}
  </section>;
}

function ItemRow({ item, minimum, onOpenQuestion }: { item: ItemAnalysis; minimum: number; onOpenQuestion?: (questionId: string) => void }) {
  const heading = `item-${item.question_id}`;
  const notes = explanations(item);
  return <li aria-labelledby={heading} className="min-w-0 border-b border-line py-5">
    <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
      <h4 id={heading} className="min-w-0 max-w-prose break-words font-display text-lg font-medium [overflow-wrap:anywhere]"><RichText text={item.stem} /></h4>
      <span className="flex flex-wrap gap-2"><Badge>{typeLabels[item.type]}</Badge>{item.flags.map(flag => <Badge key={flag} tone={FLAGS[flag].tone}>{FLAGS[flag].label}</Badge>)}</span>
    </div>
    {!item.enough_data && <p className="mt-2 text-sm text-muted">Još nema dovoljno odgovora: {item.sample_size} od {minimum} studenata.</p>}
    {item.enough_data && <>
      {notes.length > 0 && <ul aria-label="Što provjeriti" className="mt-3 max-w-prose list-disc space-y-1 pl-5">{notes.map(note => <li key={note}>{note}</li>)}</ul>}
      <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-4">
        <div><dt className="text-muted">Točno odgovorilo</dt><dd className="font-medium">{percent(item.difficulty ?? 0)}</dd></div>
        <div><dt className="text-muted">Studenti</dt><dd className="font-medium">{item.sample_size}</dd></div>
        <div><dt className="text-muted">Najbolja i najslabija skupina</dt><dd className="font-medium">{item.upper_correct === null || item.lower_correct === null ? "Premalo rangiranih" : `${percent(item.upper_correct)} naspram ${percent(item.lower_correct)}`}</dd></div>
        <div><dt className="text-muted">Diskriminacija</dt><dd className="font-medium">{item.discrimination === null ? "—" : signed(item.discrimination)}</dd></div>
      </dl>
      {item.group_size === null && <p className="mt-2 text-sm text-muted">Za skupine treba više studenata koji su odgovorili i na druga pitanja (zasad {item.ranked_size}).</p>}
      {item.options.length > 0 && <OptionTable item={item} />}
    </>}
    {item.earlier_version_sample > 0 && <p className="mt-2 text-sm text-muted">Raniju verziju rješavalo je: {students(item.earlier_version_sample)}; ti odgovori se ne broje.</p>}
    {onOpenQuestion && <Button variant="ghost" className="mt-2" aria-label={`Otvori u bazi pitanja: ${item.stem}`} onClick={() => onOpenQuestion(item.question_id)}>Otvori u bazi pitanja</Button>}
  </li>;
}

function OptionTable({ item }: { item: ItemAnalysis }) {
  const groups = item.group_size !== null;
  return <div className="mt-4 max-w-2xl overflow-x-auto">
    <table className="w-full text-left text-sm tabular-nums">
      <caption className="sr-only">Opcije odgovora: udio svih studenata{groups ? ` te najboljih i najslabijih ${item.group_size} studenata` : ""}</caption>
      <thead className="text-muted">
        <tr><th scope="col" className="py-2 pr-3 font-medium">Opcija</th><th scope="col" className="py-2 pr-3 font-medium">Svi</th>{groups && <><th scope="col" className="py-2 pr-3 font-medium">Najbolji</th><th scope="col" className="py-2 font-medium">Najslabiji</th></>}</tr>
      </thead>
      <tbody>
        {item.options.map(option => <tr key={option.position} className="border-t border-line align-top">
          <th scope="row" className="min-w-0 py-2 pr-3 font-normal">
            <span className="break-words [overflow-wrap:anywhere]">{letter(item, option) && <span className="mr-1 font-semibold">{letter(item, option)}</span>}<RichText text={option.text} /></span>
            {option.is_key && <span className="ml-2 inline-flex items-center gap-1 font-medium text-success"><CircleCheck aria-hidden="true" className="size-4" />Ključ</span>}
            {option.flag && <Badge tone={FLAGS[option.flag].tone} className="ml-2 whitespace-nowrap">{FLAGS[option.flag].label}</Badge>}
          </th>
          <td className="whitespace-nowrap py-2 pr-3">{percent(option.share)} <span className="text-muted">({option.count})</span></td>
          {groups && <><td className="py-2 pr-3">{option.upper_share === null ? "—" : percent(option.upper_share)}</td><td className="py-2">{option.lower_share === null ? "—" : percent(option.lower_share)}</td></>}
        </tr>)}
      </tbody>
    </table>
  </div>;
}
