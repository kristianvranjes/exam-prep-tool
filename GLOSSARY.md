# ExamPrep

A shared, student-reviewed question bank per university course, organised the way the course is examined, with practice on top of it.

## Language

### Courses and people

**Faculty**:
A university faculty (for example FER) that groups courses and has its own Faculty moderators.
_Avoid_: School, department

**Course**:
A subject taught at a Faculty. It has Units, Exam scopes, Exam papers, a Question bank and Members.
_Avoid_: Subject, class

**Member**:
A person who practises in a Course. Every Course manager is also a Member and keeps access to the ordinary Member screens, with extra screens for their privileges.
_Avoid_: Student (as a role), user, learner

**Course owner**:
A Member who runs one Course: manages its Units, Exam scopes and Exam papers, and gives Approval to the questions submitted to it.
_Avoid_: Admin, creator

**Faculty moderator**:
A person assigned to a Faculty who oversees shared content across its Courses, giving Approval to questions, and can manage Exam papers. Can practise in any of those Courses like a Member.
_Avoid_: Admin, reviewer

**Course manager**:
A Course owner or a Faculty moderator: anyone who can manage a Course's content and approve its questions.
_Avoid_: Manager, admin

### Practice

**Quiz**:
A Member's frozen set of questions for one Course, started from a chosen focus (Units, an Exam scope, an Exam paper, their mistakes). A Quiz can be attempted more than once.
_Avoid_: Test, session, practice session

**Attempt**:
One run through a Quiz, from start to submission or abandonment. A Quiz has many Attempts.
_Avoid_: Run, try

**Course quiz**:
A short in-class quiz (*blic*) that a Course examines, one of the kinds an Exam scope or Exam paper can have alongside Midterm, Final, Full exam and lab. Not a Member's Quiz.
_Avoid_: Quiz (on its own), blic (in English text)

**Review**:
A Member going back over a question they have answered before, scheduled to come due sooner after a wrong answer and later after a right one. A question is "due for review" when its time has come.
_Avoid_: Revision, repetition

**Self-grading**:
A Member marking their own short answer as right or wrong, because it cannot be checked automatically.
_Avoid_: Self-review

### Exam structure

**Unit**:
An ordered topic block of a Course (*cjelina*) that questions belong to and Exam scopes cover.
_Avoid_: Chapter, topic, lesson (a Lesson is the teaching text written for a Unit)

**Exam scope**:
The Units one exam covers in one academic year, with a kind (Midterm, Final, Full exam, lab or Course quiz) and optional dates.
_Avoid_: Exam cycle, ispitni ciklus

**Midterm**:
An exam (*međuispit*, MI) that covers about the first half of a course's units. It has one sitting per year.
_Avoid_: MI (in English text)

**Final**:
An exam (*završni ispit*, ZI) that usually covers the second half of a course's units. It has one sitting per year.
_Avoid_: ZI (in English text)

**Full exam**:
An exam that covers all of a course's units, with the same units at every Exam term. It is the only exam that is offered more than once a year.
_Avoid_: FULL_EXAM, exam term (for the exam itself)

**Exam term**:
One scheduled sitting of a Full exam in an academic year (*ispitni rok*): winter, summer, autumn 1, autumn 2, or a Dean's term.
_Avoid_: Exam period, exam date

**Dean's term**:
An extra Exam term (*dekanski rok*) that is offered only in some years.
_Avoid_: Dekan term

**Exam paper**:
A real exam recorded as it was set: its questions in order, the points for each, and its scoring rules (wrong-answer penalty, pass threshold, time limit). Members take it as a Quiz once a Course manager has published it.
_Avoid_: Past paper, past exam

### Content

**Question bank**:
The shared collection of Approved questions for one Course.
_Avoid_: Question pool, question database

**Question set**:
A batch of prepared questions from outside the app (for example from the Content Studio or an external AI), imported as Drafts that a Course manager approves before they enter the Question bank.
_Avoid_: Quiz import, quiz JSON, imported quiz

**Material**:
A PDF a Course manager uploads for a Course, which questions and Concepts can cite as their source.
_Avoid_: Source file, document

**Concept**:
A named topic extracted from a Course's Materials and approved before it is used to ground generated questions. Not a Unit.
_Avoid_: Keyword, tag

**Lesson**:
The short teaching text written for one Unit: key ideas, definitions, a worked example and common traps. It is not another word for a Unit.
_Avoid_: Chapter, summary

**Member question**:
A question a Member writes or imports and submits for Approval. It joins the Question bank only once a Course manager approves it.
_Avoid_: Student suggested question, user question, contribution

**Approval**:
A Course manager's decision on a Member question: approve it into the Question bank, or reject it with a reason.
_Avoid_: Review, moderation

**Approved question**:
A question a Course manager has approved, so it belongs to the Question bank and is visible to every Member.
_Avoid_: Published question, live question

**Edit suggestion**:
A Member's proposed change to an Approved question, which takes effect only once a Course manager accepts it. Not a Member question.
_Avoid_: Suggested question

**Draft**:
Anything its author has not yet submitted: a Member question, an item of an imported Question set, or an Exam paper that has not been published.
_Avoid_: Unapproved, work in progress
