import { useEffect, useRef } from "react";
import { answerText } from "../lib/question-types";
import type { Attempt } from "../lib/practice-api";
import { QuestionUnits } from "./question-units";
import { RichText } from "./rich-text";
import { Badge, Surface } from "./ui";

export function AbandonedQuiz({ attempt }: { attempt: Extract<Attempt, { status: "ABANDONED" }> }) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus(); }, []);
  return <section aria-label="Napušteni pokušaj" className="flex flex-col gap-5">
    <div>
      <h2 ref={heading} tabIndex={-1} className="text-xl font-semibold">Pokušaj je napušten</h2>
      <p className="mt-2 text-muted">Ovaj pokušaj se ne može nastaviti. Spremljeni odgovori ostaju u povijesti. Ocjene i napredak ponavljanja nisu zabilježeni.</p>
      <p className="mt-2 text-sm text-muted">Napušteno <time dateTime={attempt.abandoned_at}>{new Date(attempt.abandoned_at).toLocaleString("hr-HR")}</time>.</p>
    </div>
    {attempt.questions.map((question, index) => {
      const answer = question.answer;
      const savedAnswer = answerText(answer, question.options, question.unit, question.choices, question.spec);
      return <article key={question.id} aria-label={`Spremljeni odgovor na pitanje ${index + 1}`}><Surface className="flex flex-col gap-3">
        <h3 className="text-lg font-semibold">{index + 1}. <RichText text={question.stem} /></h3>
        <QuestionUnits units={question.units} />
        <div><Badge>{answer ? "Odgovor je spremljen" : "Nema spremljenog odgovora"}</Badge></div>
        <p className="whitespace-pre-wrap">Vaš spremljeni odgovor: <RichText text={savedAnswer ?? "Nema spremljenog odgovora"} /></p>
      </Surface></article>;
    })}
  </section>;
}
