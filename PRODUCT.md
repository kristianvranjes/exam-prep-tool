# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

University students at FER (University of Zagreb, Faculty of Electrical Engineering and
Computing) preparing for midterms (međuispit), finals (završni ispit) and exam terms
(ispitni rok) in specific courses. They study laptop first, in long sessions at a desk or
in the library, and use a phone for short reviews between lectures or on the tram.

Secondary users are course owners and faculty moderators who curate units, exam scopes,
past papers and the shared question bank, and review student contributions.

## Product Purpose

ExamPrep lets students practise the questions of one course the way that course is
examined: by unit, by exam scope, and on past papers with the real scoring rules. It
shows what to study next, checks answers with explanations, and tracks what was
reviewed. Success means a student walks into an exam having practised the right units,
knowing where they are weak.

## Positioning

A shared, student-reviewed question bank per FER course, organised like the real exam:
ordered units, midterm/final/exam-term scopes with dates, past papers with ordered
pointed items and negative marking, and spaced review. AI only suggests; people approve
what enters the bank.

## Operating Context

- The academic calendar drives use: winter midterms 23 Nov – 1 Dec 2026, finals
  1–12 Feb 2027, exam terms 15–26 Feb 2027, summer midterms around 19–30 Apr 2027.
  Traffic peaks in the one or two weeks before each exam period.
- The interface is Croatian. Course questions and explanations may contain Croatian prose,
  mathematical notation, technical symbols, code, or source-language text.
- Questions come from course materials, past exams and student contributions; many
  courses (for example PPJ, compilers) include grammar notation, symbols (→, ε, ∪) and
  code fragments in question text.
- Practice modes: guided practice with an immediate answer check and optional
  confidence (sure / unsure / guessed), end-of-session grading, scope practice and
  past-paper sessions with points and negative marking. Short answers are self-reviewed.

## Capabilities and Constraints

- Hierarchy: Faculty → Course → units, exam scopes, materials and a shared question
  bank. Question types today: multiple choice, true/false, short answer, numeric,
  multiple-select and matching, with formulas and code highlighting in question text.
- Student project, local-first and cloud-optional; infrastructure cost must stay near
  zero.
- Interface language: Croatian only. English UI localization and a language switch are out
  of scope unless the product owner revisits this decision.

## Brand Commitments

- Name: ExamPrep. No logo beyond the current graduation-cap mark; no other brand
  assets exist.
- ExamPrep is a student project, not an official FER product; it must not use FER's
  visual identity.

## Evidence on Hand

- Real question material: 469 PPJ quiz questions (outside this repository) used for
  imports during development.
- No testimonials, usage statistics or pilot results exist yet; the pilot evaluation is
  planned after the winter midterms (roadmap R6). Do not invent any.

## Product Principles

1. The exam is the organising principle: units, scopes and papers mirror how a course is
   actually examined.
2. Honest feedback over encouragement: show what was wrong, why, and what to practise
   next, without gamification.
3. People approve content; AI assists and never publishes on its own.
4. Study time is scarce before an exam: every screen should shorten the path to the next
   useful question.

## Accessibility & Inclusion

WCAG 2.2 AA: visible keyboard focus, labelled controls, 4.5:1 text contrast, 44 px touch
targets, and reduced-motion support. Croatian diacritics (č ć đ š ž) and technical
symbols must render in every face the interface uses.
