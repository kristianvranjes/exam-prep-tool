import type { OwnerQuestion, QuestionStatus, QuestionType } from "../lib/api";
import { sourceLabels, statusLabels, statusTones, typeLabels } from "../lib/question-types";
import { Badge } from "./ui";

export function QuestionStatusBadge({ status }: { status: QuestionStatus }) {
  return <Badge tone={statusTones[status]}>{statusLabels[status]}</Badge>;
}

/** The type, review status and origin of a question, always in words, never as raw enum values. */
export function QuestionBadges({ type, status, source }: { type: QuestionType; status?: QuestionStatus; source?: OwnerQuestion["source"] }) {
  return <>
    <Badge>{typeLabels[type]}</Badge>
    {status && <QuestionStatusBadge status={status} />}
    {source && <Badge>{sourceLabels[source]}</Badge>}
  </>;
}
