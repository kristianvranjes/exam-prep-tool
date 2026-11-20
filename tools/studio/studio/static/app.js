// ExamPrep studio review page. Plain DOM, no dependencies. All question and page text
// is inserted as text nodes, never as HTML: generated content is untrusted.
"use strict";

const token = new URLSearchParams(location.search).get("t") || "";
const state = { units: [], unitId: null, view: null, index: 0, editing: false };

const TYPES = {
  MULTIPLE_CHOICE: "Višestruki izbor",
  MULTIPLE_SELECT: "Višestruki odabir",
  TRUE_FALSE: "Točno/netočno",
  SHORT_ANSWER: "Kratki odgovor",
  NUMERIC: "Brojčani odgovor",
  TABLE: "Tablica za popunjavanje",
  CIRCUIT: "Sklop",
  WAVEFORM: "Vremenski dijagram",
};
const SPEC_FIELD = { TABLE: "table", CIRCUIT: "circuit", WAVEFORM: "waveform" };

// TABLE: the grid with every cell to fill marked with its key; the other two as their JSON.
function specBlock(content) {
  const spec = content[SPEC_FIELD[content.type]];
  const expr = content.expr && el("p", { class: "key" }, `Funkcija: ${content.expr}`);
  if (content.type === "TABLE" && spec && Array.isArray(spec.rows)) {
    const head = [spec.row_labels ? el("th", null, spec.corner || "") : null, (spec.columns || []).map((c) => el("th", null, c))];
    const rows = spec.rows.map((row, r) =>
      el(
        "tr",
        null,
        spec.row_labels ? el("th", null, spec.row_labels[r]) : null,
        row.map((cell) =>
          cell && typeof cell === "object"
            ? el("td", { class: "correct" }, el("span", { class: "mark" }, `✓ ${cell.answer}`))
            : el("td", null, String(cell)),
        ),
      ),
    );
    return [expr, el("table", { class: "spec-table" }, el("thead", null, el("tr", null, head)), el("tbody", null, rows)),
      spec.values ? el("p", { class: "key" }, `Dopuštene vrijednosti: ${spec.values.join(", ")}`) : el("p", { class: "key" }, "Student upisuje vrijednosti.")];
  }
  return [expr, el("pre", { class: "spec-json" }, JSON.stringify(spec, null, 2))];
}
const SEVERITY = { error: "Greška", warn: "Provjeriti", info: "Napomena" };
const DECISION = { accept: "Prihvaćeno", edit: "Prihvaćeno s izmjenama", reject: "Odbijeno" };
const FLAGS = {
  invalid_schema: "Ne prolazi shemu uvoza",
  no_source: "Nema izvora",
  quote_not_found: "Citat nije na stranici",
  quote_weak: "Citat se samo djelomično poklapa",
  quote_short: "Citat je prekratak",
  duplicate: "Duplikat",
  near_duplicate: "Gotovo duplikat",
  refers_to_source: "Tekst spominje izvor, slajd ili predavanje",
  unit_uncertain: "Cjelina nije sigurna",
  exam_key_disputed: "Slajdovi upućuju na drugi odgovor od rješenja",
  exam_key_problem: "Ključ s ispita: model vidi problem",
  exam_unexplained: "Ključ i objašnjenje nisu dobiveni",
  all_or_none_option: "Opcija »sve/ništa od navedenog«",
  options_too_similar: "Preslične opcije",
  negated_stem: "Negirano pitanje",
  correct_option_longest: "Ključ je najduža opcija",
  no_explanation: "Nema objašnjenja",
  explanation_names_option_letter: "Objašnjenje spominje slovo opcije (opcije su izmiješane)",
  verifier_disagrees: "Provjeravatelj se ne slaže s ključem",
  verifier_unanswerable: "Iz stranice se ne može odgovoriti",
  verifier_problem: "Provjeravatelj vidi problem",
  verifier_unsure: "Provjeravatelj nije siguran",
};
const LETTERS = "ABCDEF";

function el(tag, attrs, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs || {})) {
    if (value === null || value === undefined || value === false) continue;
    if (key.startsWith("on")) node.addEventListener(key.slice(2), value);
    else if (key === "class") node.className = value;
    else node.setAttribute(key, value === true ? "" : value);
  }
  return appendAll(node, children);
}

// Appends nested lists of nodes and strings; null, undefined and false add nothing.
function appendAll(node, children) {
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

function fill(node, ...children) {
  node.replaceChildren();
  return appendAll(node, children);
}

function setStatus(message, isError) {
  const status = document.getElementById("status");
  status.textContent = message || "";
  status.classList.toggle("error", Boolean(isError));
}

async function api(path, body) {
  const options = { headers: { "X-Studio-Token": token } };
  if (body !== undefined) {
    options.method = "POST";
    options.headers["Content-Type"] = "application/json";
    options.body = JSON.stringify(body);
  }
  const response = await fetch(path, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Greška ${response.status}`);
  return data;
}

function current() {
  return state.view && state.view.items[state.index];
}

async function loadUnits() {
  const data = await api("/api/units");
  state.units = data.units;
  document.getElementById("course").textContent = data.course;
  renderUnits();
}

async function openUnit(unitId, keepId) {
  state.unitId = unitId;
  state.view = await api(`/api/units/${encodeURIComponent(unitId)}`);
  const at = keepId ? state.view.items.findIndex((i) => i.id === keepId) : -1;
  state.index = at >= 0 ? at : 0;
  state.editing = false;
  const listed = state.units.find((u) => u.id === unitId);
  if (listed) listed.stats = state.view.stats;
  renderUnits();
  renderQueue();
  renderDetail();
}

function progress(stats) {
  if (!stats) return "nije generirano";
  return `${stats.total - stats.undecided}/${stats.total} odlučeno`;
}

function renderUnits() {
  const list = document.getElementById("units");
  fill(list,
    ...state.units.map((unit) =>
      el(
        "li",
        null,
        el(
          "button",
          {
            type: "button",
            "aria-current": unit.id === state.unitId ? "true" : null,
            disabled: !unit.generated,
            onclick: () => openUnit(unit.id).catch((e) => setStatus(e.message, true)),
          },
          el("span", { class: "unit-title" }, `${unit.id} ${unit.title}`),
          el("span", { class: "unit-meta" }, progress(unit.stats)),
        ),
      ),
    ),
  );
}

function renderSummary() {
  const box = document.getElementById("unit-summary");
  const view = state.view;
  if (!view || !view.generated) return fill(box);
  const s = view.stats;
  const notes = [];
  if (!view.checked) notes.push(el("p", null, "Provjere nisu pokrenute na ovim pitanjima: pokrenite studio check."));
  if (!view.verified) notes.push(el("p", null, "Provjeravatelj nije pokrenut na ovim pitanjima."));
  const sampleLeft = Math.max(0, s.sample_needed - s.unflagged_reviewed);
  let hint = null;
  if (s.rejected_in_sample) hint = "U uzorku je odbijeno neoznačeno pitanje: pregledajte svako.";
  else if (sampleLeft && s.remaining_unflagged) hint = `Za skupno prihvaćanje pregledajte još ${sampleLeft} neoznačenih.`;
  fill(box,
    ...notes,
    el("p", null, `Označena: ${s.flagged_reviewed}/${s.flagged} pregledano. Neoznačena: ${s.unflagged_reviewed}/${s.unflagged} u uzorku.`),
    el("p", null, `Prihvaćeno ${s.accepted}, s izmjenama ${s.edited}, odbijeno ${s.rejected}, neodlučeno ${s.undecided}.`),
    el("button", { type: "button", disabled: !s.bulk_allowed, onclick: acceptUnflagged }, `Prihvati preostala neoznačena (${s.remaining_unflagged})`),
    hint && el("p", null, hint),
  );
}

function renderQueue() {
  renderSummary();
  const list = document.getElementById("queue");
  const items = state.view ? state.view.items : [];
  fill(list,
    ...items.map((item, index) => {
      const severity = item.flags.length ? item.flags[0].severity : null;
      const parts = [item.id, TYPES[item.content.type] || item.content.type];
      if (severity && severity !== "info") parts.push(SEVERITY[severity]);
      parts.push(item.decision ? DECISION[item.decision.decision] : "neodlučeno");
      return el(
        "li",
        null,
        el(
          "button",
          {
            type: "button",
            "aria-current": index === state.index ? "true" : null,
            onclick: () => select(index),
          },
          el("span", { class: "item-stem" }, item.content.stem),
          el("span", { class: "item-meta" }, parts.join(" · ")),
        ),
      );
    }),
  );
}

function select(index) {
  if (!state.view || !state.view.items.length) return;
  state.index = Math.max(0, Math.min(state.view.items.length - 1, index));
  state.editing = false;
  renderQueue();
  renderDetail();
  const active = document.querySelector('#queue button[aria-current="true"]');
  if (active) active.scrollIntoView({ block: "nearest" });
}

function keyBlock(content) {
  const kind = content.type;
  if (kind === "MULTIPLE_CHOICE" || kind === "MULTIPLE_SELECT") {
    return el(
      "ol",
      { class: "options" },
      content.options.map((option, i) =>
        el(
          "li",
          { class: option.is_correct ? "correct" : null },
          el("span", { class: "letter" }, LETTERS[i]),
          el("span", null, option.text),
          option.is_correct && el("span", { class: "mark" }, "✓ točno"),
        ),
      ),
    );
  }
  if (SPEC_FIELD[kind]) return specBlock(content);
  if (kind === "TRUE_FALSE") return el("p", { class: "key" }, `Ključ: ${content.correct_answer ? "točno" : "netočno"}`);
  if (kind === "SHORT_ANSWER") return el("p", { class: "key" }, `Referentni odgovor: ${content.reference_answer}`);
  const tolerance = [
    content.absolute_tolerance && `± ${content.absolute_tolerance}`,
    content.relative_tolerance && `± ${Number(content.relative_tolerance) * 100} %`,
  ].filter(Boolean).join(", ");
  const unit = content.unit ? ` ${content.unit}` : "";
  return el("p", { class: "key" }, `Ključ: ${content.correct_value}${unit}${tolerance ? ` (${tolerance})` : ""}`);
}

function verifierAnswer(item) {
  const v = item.verdict;
  const kind = item.content.type;
  if (!v.answerable) return "ne može odgovoriti iz stranice";
  if (kind === "MULTIPLE_CHOICE" || kind === "MULTIPLE_SELECT") return v.choice.join(", ") || "bez odgovora";
  if (kind === "TRUE_FALSE") return v.truth === null ? "bez odgovora" : v.truth ? "točno" : "netočno";
  if (kind === "NUMERIC") return v.value || "bez odgovora";
  if (SPEC_FIELD[kind]) return (v.values || []).join(" ") || "bez odgovora";
  return v.reference_supported ? "referentni odgovor je poduprt" : "referentni odgovor nije poduprt";
}

function verdictBlock(item) {
  const v = item.verdict;
  if (!v) return el("p", { class: "empty" }, "Provjeravatelj nije odgovorio na ovo pitanje.");
  const outcome = v.agrees === true ? "slaže se s ključem" : v.agrees === false ? "ne slaže se s ključem" : "nije mogao odgovoriti";
  const kind = v.agrees === true ? "agree" : v.agrees === false ? "disagree" : "unsure";
  return el(
    "div",
    { class: `verdict ${kind}` },
    el("p", null, el("strong", null, `Odgovor: ${verifierAnswer(item)}`), ` · ${outcome} · sigurnost: ${v.confidence}`),
    el("p", null, v.reason),
    v.problem && el("p", null, el("strong", null, "Problem: "), v.problem),
  );
}

function pageBlock(source) {
  if (!source) return el("p", { class: "empty" }, "Pitanje nema izvor.");
  const text = source.text;
  const span = source.highlight;
  const body = span
    ? [text.slice(0, span[0]), el("mark", null, text.slice(span[0], span[1])), text.slice(span[1])]
    : [text];
  return [
    el("p", null, `${source.pdf}, str. ${source.page}`),
    el("p", { class: "quote" }, `Citat: ${source.quote}`),
    el("div", { class: "page", tabindex: "0", "aria-label": "Tekst stranice" }, ...body),
  ];
}

function originBlock(origin) {
  const where = origin.appearances.map((a) => `${a.file}, zadatak ${a.number}`).join("; ");
  const key = origin.key === "marked" ? "ključ iz rješenja na ispitu" : "ključ odredio model iz slajdova";
  return [
    el("p", null, `${where} (${key})`),
    el("pre", { class: "original" }, origin.original),
  ];
}

function renderDetail() {
  const detail = document.getElementById("detail");
  const item = current();
  if (!item) {
    fill(detail, el("p", { class: "empty" }, state.view ? "Nema pitanja." : "Odaberite jedinicu."));
    return;
  }
  const c = item.content;
  const decision = item.decision;
  const tags = [
    el("span", { class: "tag" }, item.id),
    el("span", { class: "tag" }, TYPES[c.type] || c.type),
    c.difficulty && el("span", { class: "tag" }, `težina ${c.difficulty}`),
    decision && el("span", { class: `tag ${decision.decision}` }, DECISION[decision.decision] + (decision.bulk ? " (skupno)" : "")),
  ];
  const shown = decision && decision.content ? decision.content : c;
  fill(detail,
    el("div", { class: "meta" }, tags),
    state.editing
      ? editor(item)
      : [
          el("p", { class: "stem" }, shown.stem),
          keyBlock(shown),
          shown.explanation && el("p", { class: "explanation" }, shown.explanation),
          decision && decision.content && el("p", { class: "empty" }, "Prikazana je uređena verzija."),
        ],
    el("h3", null, "Provjere"),
    item.flags.length
      ? el("ul", { class: "flags" }, item.flags.map((f) =>
          el("li", { class: `flag ${f.severity}` }, el("strong", null, `${SEVERITY[f.severity]}: ${FLAGS[f.code] || f.code}`), f.detail)))
      : el("p", { class: "empty" }, state.view.checked ? "Bez oznaka." : "Provjere nisu pokrenute."),
    el("h3", null, "Provjeravatelj"),
    verdictBlock(item),
    item.origin && el("h3", null, "S ispita"),
    item.origin && originBlock(item.origin),
    el("h3", null, "Izvor"),
    pageBlock(item.source),
    state.editing ? null : actions(item),
  );
}

function actions(item) {
  const note = el("input", {
    type: "text",
    id: "note",
    placeholder: "Bilješka uz odbijanje (neobavezno)",
    "aria-label": "Bilješka uz odbijanje",
    value: (item.decision && item.decision.note) || "",
  });
  return el(
    "div",
    { class: "actions" },
    el("button", { type: "button", class: "action primary", disabled: Boolean(item.schema_error), onclick: () => decide("accept") }, "Prihvati (a)"),
    el("button", { type: "button", class: "action", onclick: startEdit }, "Uredi (e)"),
    note,
    el("button", { type: "button", class: "action danger", onclick: () => decide("reject") }, "Odbij (r)"),
    item.decision && el("button", { type: "button", class: "action", onclick: () => decide(null) }, "Poništi (u)"),
  );
}

function nextUndecided(fromId) {
  const items = state.view.items;
  const start = items.findIndex((i) => i.id === fromId);
  for (let step = 1; step <= items.length; step++) {
    const candidate = items[(start + step) % items.length];
    if (!candidate.decision) return candidate.id;
  }
  return fromId;
}

async function decide(decision, content) {
  const item = current();
  if (!item) return;
  if (decision === "accept" && item.schema_error) {
    setStatus("Pitanje ne prolazi shemu: uredite ga.", true);
    return;
  }
  const noteField = document.getElementById("note");
  const body = { decision };
  if (decision === "reject" && noteField) body.note = noteField.value;
  if (decision === "edit") body.content = content;
  try {
    await api(`/api/units/${encodeURIComponent(state.unitId)}/questions/${encodeURIComponent(item.id)}`, body);
  } catch (error) {
    setStatus(error.message, true);
    if (decision === "edit") throw error;
    return;
  }
  setStatus(`${item.id}: ${decision ? DECISION[decision] : "odluka poništena"}.`);
  await openUnit(state.unitId, item.id);
  if (decision) {
    const target = nextUndecided(item.id);
    select(state.view.items.findIndex((i) => i.id === target));
  }
}

async function acceptUnflagged() {
  try {
    const result = await api(`/api/units/${encodeURIComponent(state.unitId)}/accept-unflagged`, {});
    setStatus(`Skupno prihvaćeno: ${result.accepted}.`);
    await openUnit(state.unitId, current() && current().id);
  } catch (error) {
    setStatus(error.message, true);
  }
}

function startEdit() {
  state.editing = true;
  renderDetail();
  const first = document.querySelector(".editor textarea");
  if (first) first.focus();
}

let fieldCount = 0;
function field(label, control) {
  fieldCount += 1;
  control.id = `field-${fieldCount}`;
  return [el("label", { for: control.id }, label), control];
}

function editor(item) {
  const base = item.decision && item.decision.content ? item.decision.content : item.content;
  const c = JSON.parse(JSON.stringify(base));
  const kind = c.type;
  const stem = el("textarea", null, c.stem);
  const explanation = el("textarea", null, c.explanation || "");
  const difficulty = el(
    "select",
    null,
    el("option", { value: "" }, "—"),
    [1, 2, 3, 4, 5].map((n) => el("option", { value: String(n), selected: c.difficulty === n }, String(n))),
  );
  const error = el("p", { class: "error-text", role: "alert" });
  const parts = [field("Pitanje", stem)];
  let collect = () => ({});

  if (kind === "MULTIPLE_CHOICE" || kind === "MULTIPLE_SELECT") {
    const rows = c.options.map((option, i) => {
      const text = el("input", { type: "text", value: option.text, "aria-label": `Opcija ${LETTERS[i]}` });
      const mark = el("input", {
        type: kind === "MULTIPLE_CHOICE" ? "radio" : "checkbox",
        name: "correct",
        checked: option.is_correct,
        "aria-label": `Opcija ${LETTERS[i]} je točna`,
      });
      const row = el("div", { class: "option-row" }, el("span", { class: "letter" }, LETTERS[i]), text, el("label", null, mark, " točno"));
      return { text, mark, row };
    });
    parts.push(el("label", null, "Opcije"), rows.map((r) => r.row));
    collect = () => ({ options: rows.map((r) => ({ text: r.text.value, is_correct: r.mark.checked })) });
  } else if (kind === "TRUE_FALSE") {
    const answer = el(
      "select",
      null,
      el("option", { value: "true", selected: c.correct_answer === true }, "točno"),
      el("option", { value: "false", selected: c.correct_answer === false }, "netočno"),
    );
    parts.push(field("Ključ", answer));
    collect = () => ({ correct_answer: answer.value === "true" });
  } else if (SPEC_FIELD[kind]) {
    const spec = el("textarea", { class: "spec-json", rows: "14", spellcheck: "false" }, JSON.stringify(c[SPEC_FIELD[kind]], null, 2));
    const expr = el("input", { type: "text", value: c.expr || "" });
    parts.push(field("Specifikacija (JSON)", spec), field("Funkcija (expr, neobavezno)", expr));
    collect = () => {
      let parsed;
      try {
        parsed = JSON.parse(spec.value);
      } catch (e) {
        throw new Error(`Specifikacija nije ispravan JSON: ${e.message}`);
      }
      return { [SPEC_FIELD[kind]]: parsed, ...(expr.value.trim() ? { expr: expr.value.trim() } : {}) };
    };
  } else if (kind === "SHORT_ANSWER") {
    const reference = el("textarea", null, c.reference_answer || "");
    parts.push(field("Referentni odgovor", reference));
    collect = () => ({ reference_answer: reference.value });
  } else {
    const inputs = {};
    const names = [
      ["correct_value", "Ključ"],
      ["absolute_tolerance", "Apsolutna tolerancija"],
      ["relative_tolerance", "Relativna tolerancija (udio, 0.01 = 1 %)"],
      ["unit", "Jedinica"],
    ];
    for (const [name, label] of names) {
      inputs[name] = el("input", { type: "text", value: c[name] || "" });
      parts.push(field(label, inputs[name]));
    }
    collect = () =>
      Object.fromEntries(Object.entries(inputs).filter(([, i]) => i.value.trim()).map(([n, i]) => [n, i.value.trim()]));
  }
  parts.push(field("Objašnjenje", explanation), field("Težina", difficulty), error);

  async function save() {
    try {
      const content = {
        type: kind,
        stem: stem.value,
        explanation: explanation.value.trim() || null,
        difficulty: difficulty.value ? Number(difficulty.value) : null,
        ...collect(),
      };
      await decide("edit", content);
    } catch (e) {
      error.textContent = e.message;
    }
  }
  function cancel() {
    state.editing = false;
    renderDetail();
  }
  return el(
    "div",
    { class: "editor" },
    parts,
    el(
      "div",
      { class: "actions" },
      el("button", { type: "button", class: "action primary", onclick: save }, "Spremi i prihvati"),
      el("button", { type: "button", class: "action", onclick: cancel }, "Odustani (Esc)"),
    ),
  );
}

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && state.editing) {
    state.editing = false;
    renderDetail();
    return;
  }
  const target = event.target;
  if (event.ctrlKey || event.metaKey || event.altKey) return;
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return;
  const actionsByKey = {
    j: () => select(state.index + 1),
    ArrowDown: () => select(state.index + 1),
    k: () => select(state.index - 1),
    ArrowUp: () => select(state.index - 1),
    a: () => decide("accept"),
    r: () => decide("reject"),
    e: () => startEdit(),
    u: () => current() && current().decision && decide(null),
  };
  const run = actionsByKey[event.key];
  if (run && state.view && state.view.items.length) {
    event.preventDefault();
    run();
  }
});

if (!token) setStatus("Nedostaje token: otvorite adresu koju je ispisala naredba studio review.", true);
else loadUnits().catch((error) => setStatus(error.message, true));
