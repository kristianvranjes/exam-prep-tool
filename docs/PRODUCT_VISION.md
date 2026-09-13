# 🎓 ExamPrep

**ExamPrep** je studentski projekt čiji je cilj razviti platformu za vježbanje i ponavljanje ispitnih pitanja za fakultetske kolegije.

Ideja je omogućiti studentima da na jednom mjestu vježbaju pitanja iz različitih predmeta, prate vlastiti napredak, ponavljaju pitanja koja im predstavljaju problem te zajedno doprinose kvaliteti baze pitanja.

U budućnosti se platforma može proširiti na više fakulteta, ali početna verzija neće sadržavati filtriranje po fakultetima. Organizacija sadržaja u početku će se temeljiti prvenstveno na **predmetima i temama**.

---

## ✨ Glavne funkcionalnosti

### 📚 Baza pitanja

* organizacija pitanja prema predmetima
* organizacija pitanja prema temama i podtemama
* različite vrste pitanja
* označavanje težine pitanja
* objašnjenja odgovora
* izvori pitanja
* verzioniranje pitanja
* označavanje pitanja kao omiljenih
* pregled pitanja koja je korisnik ranije pogriješio

### 🧠 Različiti tipovi pitanja

Platforma neće biti ograničena na klasični multiple choice.

Planirani tipovi pitanja uključuju:

* Multiple choice
* Multiple select
* True / False
* Short answer
* Fill in the blank
* Matching
* Ordering
* Categorization
* pitanja temeljena na slikama
* scenario/application pitanja

Novi tipovi pitanja trebaju se moći dodavati bez potrebe za većim promjenama ostatka sustava.

---

## 🤖 AI funkcionalnosti

AI se koristi kao pomoćni alat, a ne kao autoritet koji automatski mijenja sadržaj baze.

Planirane AI funkcionalnosti:

* ekstrakcija sadržaja iz dokumenata
* generiranje prijedloga pitanja
* generiranje različitih tipova pitanja
* ispravljanje formulacije pitanja
* prijedlozi izmjena postojećih pitanja
* generiranje objašnjenja odgovora
* klasifikacija pitanja prema predmetu i temi
* detekcija potencijalnih duplikata
* generiranje alternativnih pitanja koja ispituju isti koncept
* semantičko ocjenjivanje odgovora kod pitanja gdje klasično automatsko ocjenjivanje nije dovoljno

### AI princip

> **AI predlaže → sustav validira → čovjek/zajednica odobrava → sadržaj postaje javno dostupan.**

AI-generated sadržaj se ne smije automatski objaviti bez odgovarajuće validacije.

---

## 📄 Upload i obrada dokumenata

Korisnici će moći učitati dokumente poput PDF-ova koji sadrže:

* stara ispitna pitanja
* pitanja za ponavljanje
* skripte
* druge materijale za učenje

Planirani pipeline:

```text
PDF
 ↓
Upload
 ↓
MarkItDown
 ↓
Markdown
 ↓
Content normalization
 ↓
AI extraction
 ↓
Question proposals
 ↓
Validation
 ↓
Review / Approval
 ↓
Question Bank
```

Originalni dokument treba ostati povezan s izvučenim sadržajem kako bi se mogao pratiti izvor pitanja.

Za svako pitanje, kada je moguće, treba čuvati:

* izvorni dokument
* stranicu dokumenta
* izvorni tekst
* autora/uploadera
* način nastanka pitanja
* verziju pitanja

---

## 👥 Community contributions

Studenti mogu predlagati promjene postojećih pitanja i dodavati nova pitanja.

Primjeri prijedloga:

* ispravak pravopisne greške
* promjena formulacije
* ispravak odgovora
* dodavanje odgovora
* dodavanje objašnjenja
* prijava nejasnog pitanja
* prijava pitanja s više mogućih točnih odgovora
* prijava zastarjelog pitanja
* prijava duplikata

Promjene se ne primjenjuju nužno odmah.

Sustav treba podržavati:

```text
Suggestion
    ↓
Pending
    ↓
Approvals / Rejections
    ↓
Approved
    ↓
New Question Version
```

Za određene promjene može biti dovoljan dovoljan broj community approvala, dok osjetljivije promjene mogu zahtijevati administratorsko odobrenje.

---

## 🛡️ Moderacija i kvaliteta sadržaja

Svako pitanje može biti prijavljeno.

Mogući razlozi prijave:

* netočan odgovor
* više mogućih odgovora
* nejasna formulacija
* pravopisna greška
* zastarjeli sadržaj
* duplikat
* neispravna slika
* neprimjeren sadržaj
* drugi problem

Administratori i moderatori trebaju imati dashboard za pregled:

* novih pitanja
* AI-generated pitanja
* predloženih izmjena
* prijava
* mogućih duplikata
* sadržaja koji čeka odobrenje

---

## 🧠 Personalizirano učenje

Cilj nije samo omogućiti korisniku da riješi nasumičan kviz.

Sustav treba pratiti napredak korisnika po pitanjima i temama.

Za svaki pokušaj mogu se pratiti:

* je li odgovor bio točan
* vrijeme odgovaranja
* broj pokušaja
* broj prethodnih pogrešaka
* kada je pitanje zadnji put riješeno
* kada bi ga trebalo ponovno prikazati
* razina sigurnosti korisnika u odgovor

Na temelju toga sustav može preporučivati pitanja koja korisniku predstavljaju najveći problem.

Primjer:

```text
Moje znanje

Programiranje       █████████░ 90%
Algoritmi            ███████░░░ 70%
Strukture podataka   █████░░░░░ 50%
```

Korisnik može pokrenuti:

> **Vježbaj moje slabe teme**

---

## 🔄 Spaced repetition

Platforma treba podržavati ponavljanje pitanja kroz vrijeme.

Jednostavna početna implementacija može koristiti:

```text
correct → povećaj interval
wrong   → smanji interval
```

Kasnije se algoritam može proširiti na naprednije modele određivanja optimalnog vremena ponavljanja.

---

## 📝 Quiz mode

Korisnik može odabrati:

* predmet
* temu
* broj pitanja
* težinu
* tipove pitanja

i pokrenuti session za vježbanje.

Planirani načini rada:

### Practice

Slobodno vježbanje uz trenutni feedback.

### Review

Ponavljanje pitanja koja je korisnik ranije pogriješio ili označio kao nesigurna.

### Exam simulation

Simulacija stvarnog ispita:

* ograničeno vrijeme
* određeni broj pitanja
* bodovanje
* bez trenutnog feedbacka
* završni rezultat i analiza

---

## 📊 Analytics

Korisnik treba moći vidjeti vlastiti napredak.

Primjeri statistika:

* broj riješenih pitanja
* postotak točnih odgovora
* prosječno vrijeme odgovaranja
* najuspješnije teme
* najslabije teme
* pitanja koja najčešće griješi
* napredak kroz vrijeme
* rezultati simulacija ispita

Cilj analyticsa nije samo prikazati brojke, nego pomoći korisniku odgovoriti na pitanje:

> **Što bih sada trebao učiti?**

---

# 🏗️ Arhitektura

Projekt treba biti modularan i omogućiti buduće proširenje bez velikih promjena postojeće arhitekture.

Osnovni koncept:

```text
Frontend
   │
   ▼
Backend
   │
   ├── Authentication
   ├── Question Engine
   ├── Quiz Engine
   ├── Learning Engine
   ├── Contribution System
   ├── Moderation
   ├── Document Processing
   └── AI Service
             │
             ├── Local LLM
             ├── Gemini
             └── Other providers
   │
   ▼
PostgreSQL
```

---

# 🤖 AI arhitektura

AI provider ne smije biti direktno vezan uz ostatak aplikacije.

Predviđen je abstraction layer:

```text
AIService
   │
   ├── OllamaProvider
   ├── GeminiProvider
   └── OtherProvider
```

Aplikacija treba koristiti apstraktne operacije poput:

```text
generateQuestions()
correctQuestion()
generateExplanation()
classifyQuestion()
detectDuplicates()
evaluateAnswer()
```

Na taj način moguće je promijeniti AI model bez promjene ostatka aplikacije.

---

## 🏠 Local-first AI

Tijekom razvoja prioritet je koristiti lokalne modele kako bi se smanjili troškovi.

Predviđeni pristup:

```text
Local LLM
   ↓
Ollama
```

Cloud AI provideri trebaju biti opcionalni fallback za zadatke gdje lokalni model nije dovoljno kvalitetan.

Primjer:

```text
Easy task
    ↓
Local model

Complex task
    ↓
Cloud model

Cloud unavailable
    ↓
Local fallback
```

AI provider i model moraju biti konfigurabilni putem environment varijabli.

---

# 🛠️ Tehnološki stack

Početno planirani stack:

### Frontend / Backend

* Next.js
* TypeScript
* Tailwind CSS
* shadcn/ui

### Database

* PostgreSQL
* ORM: TBD

### AI

* Ollama
* lokalni open-weight LLM
* opcionalno Gemini / drugi API provider

### Document processing

* Microsoft MarkItDown
* OCR kao buduća mogućnost

### Development

* Git
* GitHub
* Docker
* Claude Code

### Deployment

Deployment tehnologija još nije konačno definirana.

Prioritet je:

1. lokalni development
2. jednostavan deployment
3. minimalni troškovi
4. mogućnost kasnijeg skaliranja

---

# 🗃️ Osnovni data model

Planirani glavni entiteti:

```text
User
Subject
Topic
Question
QuestionVersion
Quiz
QuizAttempt
QuestionAttempt
Document
Suggestion
Approval
Report
UserProgress
```

Odnos pojednostavljeno:

```text
Subject
   │
   └── Topic
          │
          └── Question
                 │
                 ├── QuestionVersion
                 ├── QuestionAttempt
                 ├── Suggestion
                 ├── Report
                 └── Source
```

---

# ❓ Question model

Question sustav mora biti generički i extensible.

Primjer konceptualnog modela:

```text
Question
├── id
├── type
├── subjectId
├── topicId
├── content
├── configuration
├── gradingStrategy
├── explanation
├── difficulty
├── status
├── source
└── metadata
```

Tip pitanja određuje strukturu `configuration` dijela.

Primjer:

```json
{
  "type": "multiple_choice",
  "content": {
    "prompt": "Koja je točna tvrdnja?"
  },
  "configuration": {
    "options": [
      "Odgovor A",
      "Odgovor B",
      "Odgovor C",
      "Odgovor D"
    ],
    "correctOption": 1
  }
}
```

Question engine treba omogućiti dodavanje novih tipova bez izmjene cijelog quiz sustava.

---

# 🔐 Sigurnost i privatnost

Od početka treba voditi računa o:

* zaštiti korisničkih podataka
* sigurnom uploadu dokumenata
* validaciji tipova i veličine datoteka
* sigurnom spremanju API ključeva
* autorizaciji administratorskih funkcija
* kontroli pristupa privatnim dokumentima
* audit logovima za osjetljive promjene

API ključevi i drugi secrets nikada ne smiju biti spremljeni u repository.

---

# ⚖️ Izvori i prava na sadržaj

Platforma može sadržavati pitanja preuzeta iz različitih izvora.

Zbog toga treba pratiti metadata podatke o izvoru:

```text
sourceType
sourceDocument
uploadedBy
sourcePage
license / rights metadata
```

Sustav treba omogućiti uklanjanje sadržaja kada je to potrebno.

Automatsko javno objavljivanje uploadanih materijala nije poželjno bez odgovarajuće kontrole.

---

# 🧪 Testing

Business logic treba biti testiran od početka.

Posebno:

### Unit tests

* question grading
* quiz scoring
* progress calculation
* spaced repetition
* validation
* approval logic

### Integration tests

* authentication
* question creation
* document processing
* AI pipeline
* approval workflow

### E2E tests

Primjer glavnog workflowa:

```text
Login
 ↓
Select subject
 ↓
Select topic
 ↓
Start quiz
 ↓
Answer questions
 ↓
Finish quiz
 ↓
View result
 ↓
View mistakes
```

---

# 🚀 Roadmap

## Phase 0 — Project setup

* [ ] Repository
* [ ] Next.js setup
* [ ] TypeScript
* [ ] Database
* [ ] Docker
* [ ] CI
* [ ] Project documentation

## Phase 1 — Core

* [ ] Authentication
* [ ] Users
* [ ] Subjects
* [ ] Topics
* [ ] Questions
* [ ] Question CRUD

## Phase 2 — Quiz engine

* [ ] Multiple choice
* [ ] Multiple select
* [ ] True/False
* [ ] Short answer
* [ ] Fill in the blank
* [ ] Matching
* [ ] Quiz sessions
* [ ] Scoring

## Phase 3 — Learning

* [ ] User progress
* [ ] Question history
* [ ] Favorites
* [ ] Wrong questions
* [ ] Basic spaced repetition
* [ ] Weak topic detection

## Phase 4 — Community

* [ ] Question suggestions
* [ ] Edit suggestions
* [ ] Approvals
* [ ] Reports
* [ ] Moderation
* [ ] Question versioning

## Phase 5 — Documents

* [ ] PDF upload
* [ ] File validation
* [ ] MarkItDown
* [ ] Markdown extraction
* [ ] Source tracking
* [ ] Extraction preview

## Phase 6 — AI

* [ ] AI abstraction layer
* [ ] Ollama integration
* [ ] Structured JSON output
* [ ] AI question generation
* [ ] Question correction
* [ ] AI explanations
* [ ] Topic classification

## Phase 7 — Advanced learning

* [ ] Exam simulation
* [ ] Advanced spaced repetition
* [ ] Analytics
* [ ] Personalized question selection
* [ ] Alternative question generation
* [ ] Semantic answer evaluation

## Phase 8 — Advanced question types

* [ ] Ordering
* [ ] Categorization
* [ ] Image questions
* [ ] Scenario questions
* [ ] Additional question types

---

# 🎯 MVP cilj

Prva verzija projekta ne treba implementirati sve navedene funkcionalnosti.

MVP treba omogućiti sljedeći workflow:

```text
Student
   ↓
Login
   ↓
Odabere predmet
   ↓
Odabere temu
   ↓
Pokrene kviz
   ↓
Rješava različite tipove pitanja
   ↓
Dobije rezultat
   ↓
Vidi pogrešna pitanja
   ↓
Može ih ponovno vježbati
```

Uz to:

```text
Student
   ↓
Upload PDF
   ↓
MarkItDown
   ↓
Extract content
   ↓
AI predloži pitanja
   ↓
Student/Admin pregleda
   ↓
Approve
   ↓
Question Bank
```

---

# 🔮 Dugoročna vizija

Krajnji cilj nije napraviti samo bazu ispitnih pitanja.

Vizija projekta je razviti **adaptivnu platformu za učenje** koja može odgovoriti na pitanje:

> **"Što bih ja, kao student, sada trebao učiti?"**

Sustav bi na temelju korisnikovih prethodnih odgovora, vremena odgovaranja, težine pitanja, tema i povijesti učenja mogao automatski sastaviti personaliziranu sesiju učenja.

Primjer:

```text
Preporučena sesija — 25 min

1. Termodinamika / Entropija
   5 pitanja

2. Mehanika / Moment sile
   4 pitanja

3. Elektromagnetizam / Gaussov zakon
   6 pitanja

4. Ponavljanje prethodnih pogrešaka
   5 pitanja
```

Time se projekt razvija od obične baze pitanja prema **personaliziranom sustavu za aktivno učenje i pripremu ispita**.

---

## 📌 Status

Projekt je trenutno u fazi planiranja i definiranja arhitekture.

**Status:** 🚧 Pre-development

**Primarna ciljna skupina:** studenti

**Početni scope:** fakultetski predmeti, bez filtriranja po fakultetima

**AI pristup:** local-first, cloud optional

**Prioritet:** funkcionalan i kvalitetan learning engine prije naprednih AI funkcionalnosti.

---

## 📄 License

License će biti definirana naknadno.
