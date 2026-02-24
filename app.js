(function(){
  "use strict";

  const $ = (sel) => document.querySelector(sel);
  const el = (tag, attrs={}, ...children) => {
    const node = document.createElement(tag);
    for (const [k,v] of Object.entries(attrs||{})) {
      if (k === "class") node.className = v;
      else if (k === "html") node.innerHTML = v;
      else if (k.startsWith("on") && typeof v === "function") node.addEventListener(k.slice(2), v);
      else node.setAttribute(k, v);
    }
    for (const c of children) {
      if (c === null || c === undefined) continue;
      node.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
    }
    return node;
  };

  const shuffle = (arr) => {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  };

  const normalizeText = (s) => (s||"")
    .toLowerCase()
    .replaceAll("ё", "е")
    .replace(/[^a-zа-я0-9%₽\s]/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

  const clamp = (n, a, b) => Math.max(a, Math.min(b, n));

  const state = {
    startedAt: null,
    name: "",
    shuffle: true,
    questions: [],
    idx: 0,
    answers: {},
  };

  const screenIntro = $("#screenIntro");
  const screenQuiz = $("#screenQuiz");
  const screenResults = $("#screenResults");

  const inpName = $("#inpName");
  const chkShuffle = $("#chkShuffle");

  const btnStart = $("#btnStart");
  const btnRestart = $("#btnRestart");
  const btnPrev = $("#btnPrev");
  const btnNext = $("#btnNext");
  const btnSkip = $("#btnSkip");

  const qText = $("#qText");
  const qHint = $("#qHint");
  const pillDimension = $("#pillDimension");
  const pillWeight = $("#pillWeight");
  const answerArea = $("#answerArea");

  const progressBar = $("#progressBar");
  const progressText = $("#progressText");
  const warnText = $("#warnText");

  const overallScore = $("#overallScore");
  const resTitle = $("#resTitle");
  const resSubtitle = $("#resSubtitle");
  const strengths = $("#strengths");
  const improvements = $("#improvements");
  const dimensionTable = $("#dimensionTable");
  const openReview = $("#openReview");
  const btnAgain = $("#btnAgain");
  const btnCopy = $("#btnCopy");
  const btnDownload = $("#btnDownload");

  $("#buildInfo").textContent = (TEST_META && TEST_META.build) ? TEST_META.build : "";

  btnStart.addEventListener("click", () => {
    state.name = (inpName.value || "").trim();
    state.shuffle = !!chkShuffle.checked;
    startTest();
  });

  btnRestart.addEventListener("click", () => {
    if (!confirm("Сбросить прогресс и начать заново?")) return;
    resetAll();
  });

  btnPrev.addEventListener("click", () => {
    saveCurrentAnswer(false);
    state.idx = clamp(state.idx - 1, 0, state.questions.length - 1);
    renderQuestion();
  });

  btnSkip.addEventListener("click", () => {
    state.answers[state.questions[state.idx].id] = { skipped: true };
    state.idx = clamp(state.idx + 1, 0, state.questions.length);
    if (state.idx >= state.questions.length) finish();
    else renderQuestion();
  });

  btnNext.addEventListener("click", () => {
    const ok = saveCurrentAnswer(true);
    if (!ok) return;
    state.idx = clamp(state.idx + 1, 0, state.questions.length);
    if (state.idx >= state.questions.length) finish();
    else renderQuestion();
  });

  btnAgain?.addEventListener("click", () => resetAll());

  btnCopy?.addEventListener("click", () => {
    const report = buildReport();
    const text = makeShortSummary(report);
    navigator.clipboard.writeText(text).then(() => {
      toast("Итог скопирован.");
    }).catch(() => toast("Не получилось скопировать. Можно выделить текст вручную."));
  });

  btnDownload?.addEventListener("click", () => {
    const report = buildReport();
    const blob = new Blob([JSON.stringify(report, null, 2)], {type:"application/json"});
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "report_economic_buyer_test.json";
    a.click();
    URL.revokeObjectURL(a.href);
  });

  function toast(msg){
    warnText.textContent = msg;
    warnText.classList.add("show");
    setTimeout(() => warnText.classList.remove("show"), 1800);
  }

  function resetAll(){
    state.startedAt = null;
    state.questions = [];
    state.idx = 0;
    state.answers = {};
    show(screenIntro);
    hide(screenQuiz);
    hide(screenResults);
    warnText.textContent = "";
    inpName.value = "";
    chkShuffle.checked = true;
  }

  function startTest(){
    state.startedAt = new Date().toISOString();
    state.idx = 0;
    state.answers = {};

    state.questions = QUESTIONS.map(q => JSON.parse(JSON.stringify(q)));

    if (state.shuffle){
      shuffle(state.questions);
      for (const q of state.questions){
        if (Array.isArray(q.options)) shuffle(q.options);
      }
    }

    hide(screenIntro);
    hide(screenResults);
    show(screenQuiz);
    renderQuestion();
  }

  function show(node){ node.classList.remove("hidden"); }
  function hide(node){ node.classList.add("hidden"); }

  function renderQuestion(){
    warnText.textContent = "";
    warnText.classList.remove("show");

    const q = state.questions[state.idx];
    if (!q) return;

    const p = Math.round(((state.idx + 1) / state.questions.length) * 100);
    progressBar.style.width = p + "%";
    progressText.textContent = `Вопрос ${state.idx + 1} из ${state.questions.length}`;

    const dim = DIMENSIONS[q.dimension];
    pillDimension.textContent = dim ? dim.name : (q.dimension || "Компетенция");
    pillWeight.textContent = `Вес: ${q.weight ?? 1}`;

    qText.textContent = q.text;
    qHint.textContent = q.hint || "";

    answerArea.innerHTML = "";
    answerArea.appendChild(renderAnswerControl(q));

    btnPrev.disabled = state.idx === 0;
    btnNext.textContent = (state.idx === state.questions.length - 1) ? "Завершить" : "Дальше";

    restoreCurrentAnswer(q);
  }

  function renderAnswerControl(q){
    const wrap = el("div", {class:"answer"});

    if (q.type === "single"){
      const name = "q_" + q.id;
      for (let i=0;i<q.options.length;i++){
        const opt = q.options[i];
        const id = `${name}_${i}`;
        wrap.appendChild(
          el("label", {class:"option", for:id},
            el("input", {type:"radio", id, name, value: String(i)}),
            el("span", {}, opt.text)
          )
        );
      }
    } else if (q.type === "multi"){
      const name = "q_" + q.id;
      for (let i=0;i<q.options.length;i++){
        const opt = q.options[i];
        const id = `${name}_${i}`;
        wrap.appendChild(
          el("label", {class:"option", for:id},
            el("input", {type:"checkbox", id, name, value: String(i)}),
            el("span", {}, opt.text)
          )
        );
      }
    } else if (q.type === "likert"){
      const name = "q_" + q.id;
      const scale = el("div", {class:"scale"});
      for (let i=1;i<=5;i++){
        const id = `${name}_${i}`;
        scale.appendChild(
          el("label", {for:id},
            el("input", {type:"radio", id, name, value:String(i)}),
            el("span", {}, String(i))
          )
        );
      }
      wrap.appendChild(el("div", {class:"muted hint"}, "1 — совсем нет / 5 — полностью да"));
      wrap.appendChild(scale);
    } else if (q.type === "open"){
      const id = "q_" + q.id;
      wrap.appendChild(el("textarea", {id, placeholder:"Напиши ответ здесь…"}));
      if (q.rubric?.note){
        wrap.appendChild(el("p", {class:"muted hint"}, q.rubric.note));
      }
    } else {
      wrap.appendChild(el("p", {class:"muted"}, "Неизвестный тип вопроса: " + q.type));
    }

    return wrap;
  }

  function restoreCurrentAnswer(q){
    const a = state.answers[q.id];
    if (!a) return;

    if (q.type === "single"){
      if (a.choiceIdx === undefined) return;
      const radio = document.querySelector(`input[name="q_${q.id}"][value="${a.choiceIdx}"]`);
      if (radio) radio.checked = true;
    } else if (q.type === "multi"){
      const set = new Set(a.choiceIdxs || []);
      const boxes = document.querySelectorAll(`input[name="q_${q.id}"]`);
      boxes.forEach(b => { b.checked = set.has(Number(b.value)); });
    } else if (q.type === "likert"){
      if (!a.value) return;
      const radio = document.querySelector(`input[name="q_${q.id}"][value="${a.value}"]`);
      if (radio) radio.checked = true;
    } else if (q.type === "open"){
      const ta = document.querySelector(`#q_${q.id}`);
      if (ta) ta.value = a.text || "";
    }
  }

  function saveCurrentAnswer(requireAnswer){
    const q = state.questions[state.idx];
    if (!q) return false;

    const res = { skipped: false };

    if (q.type === "single"){
      const checked = document.querySelector(`input[name="q_${q.id}"]:checked`);
      if (!checked){
        if (requireAnswer) return warn("Выбери один вариант ответа (или нажми «Пропустить»).");
        return true;
      }
      res.choiceIdx = Number(checked.value);
    } else if (q.type === "multi"){
      const checked = [...document.querySelectorAll(`input[name="q_${q.id}"]:checked`)];
      if (checked.length === 0){
        if (requireAnswer) return warn("Отметь хотя бы один вариант (или нажми «Пропустить»).");
        return true;
      }
      res.choiceIdxs = checked.map(x => Number(x.value));
    } else if (q.type === "likert"){
      const checked = document.querySelector(`input[name="q_${q.id}"]:checked`);
      if (!checked){
        if (requireAnswer) return warn("Выбери значение по шкале 1–5 (или нажми «Пропустить»).");
        return true;
      }
      res.value = Number(checked.value);
    } else if (q.type === "open"){
      const ta = document.querySelector(`#q_${q.id}`);
      const txt = (ta?.value || "").trim();
      if (!txt){
        if (requireAnswer) return warn("Напиши ответ (или нажми «Пропустить»).");
        return true;
      }
      res.text = txt;
    }

    state.answers[q.id] = res;
    return true;
  }

  function warn(msg){
    warnText.textContent = msg;
    warnText.classList.add("show");
    return false;
  }

  function scoreQuestion(q, ans){
    if (!ans || ans.skipped) return {points:0, maxPoints: 1, skipped:true};

    if (q.type === "single"){
      const opt = q.options?.[ans.choiceIdx];
      const max = Math.max(...q.options.map(o => o.score ?? 0), 0);
      return {points: opt?.score ?? 0, maxPoints: max || 5};
    }

    if (q.type === "multi"){
      const idxs = ans.choiceIdxs || [];
      let pts = 0;
      for (const i of idxs){
        pts += (q.options?.[i]?.score ?? 0);
      }
      const max = q.multiMaxScore ?? pts;
      return {points: clamp(pts, 0, max), maxPoints: max};
    }

    if (q.type === "likert"){
      const v = clamp(Number(ans.value || 0), 0, 5);
      return {points: v, maxPoints: 5};
    }

    if (q.type === "open"){
      const txt = normalizeText(ans.text || "");
      const rubric = q.rubric;
      if (!rubric || !Array.isArray(rubric.items)){
        return {points: 0, maxPoints: 1, details: {note:"Нет рубрики"}};
      }
      const found = [];
      let pts = 0;
      for (const item of rubric.items){
        const hit = (item.keywords || []).some(k => txt.includes(normalizeText(k)));
        if (hit){
          pts += (item.points || 0);
          found.push({label:item.label, points:item.points});
        }
      }
      pts = clamp(pts, 0, rubric.maxPoints || 10);
      return {
        points: pts,
        maxPoints: rubric.maxPoints || 10,
        details: { found, text: ans.text || "", note: rubric.note || "" }
      };
    }

    return {points:0, maxPoints:1, details:{note:"Неизвестный тип"}};
  }

  function buildReport(){
    const perDim = {};
    const openAnswers = [];

    let totalWeighted = 0;
    let totalWeight = 0;

    for (const q of state.questions){
      const ans = state.answers[q.id] || {skipped:true};
      const s = scoreQuestion(q, ans);
      const ratio = s.maxPoints ? (s.points / s.maxPoints) : 0;
      const w = Number(q.weight ?? 1);

      totalWeighted += ratio * w;
      totalWeight += w;

      if (!perDim[q.dimension]){
        perDim[q.dimension] = {weight:0, weighted:0, questions:0};
      }
      perDim[q.dimension].weight += w;
      perDim[q.dimension].weighted += ratio * w;
      perDim[q.dimension].questions += 1;

      if (q.type === "open"){
        openAnswers.push({
          id: q.id,
          dimension: q.dimension,
          question: q.text,
          answer: ans.text || "",
          score: s.points,
          maxScore: s.maxPoints,
          found: s.details?.found || [],
          note: s.details?.note || "",
          weight: w,
        });
      }
    }

    const dims = Object.entries(perDim).map(([key, v]) => {
      const pct = v.weight ? Math.round((v.weighted / v.weight) * 100) : 0;
      return {
        key,
        name: DIMENSIONS[key]?.name || key,
        percent: pct,
        why: DIMENSIONS[key]?.why || "",
        doNext: DIMENSIONS[key]?.doNext || [],
      };
    }).sort((a,b) => b.percent - a.percent);

    const overall = totalWeight ? Math.round((totalWeighted / totalWeight) * 100) : 0;

    return {
      meta: {
        title: TEST_META.title,
        build: TEST_META.build,
        finishedAt: new Date().toISOString(),
        startedAt: state.startedAt,
        name: state.name,
        shuffled: state.shuffle,
        questionCount: state.questions.length,
      },
      overallPercent: overall,
      dimensions: dims,
      openAnswers,
    };
  }

  function levelTag(p){
    if (p >= 80) return {cls:"good", text:"сильно"};
    if (p >= 60) return {cls:"ok", text:"нормально"};
    return {cls:"bad", text:"нужно усилить"};
  }

  function finish(){
    const report = buildReport();
    renderResults(report);
    hide(screenQuiz);
    hide(screenIntro);
    show(screenResults);
  }

  function renderResults(report){
    const name = report.meta?.name ? `${report.meta.name}, ` : "";
    resTitle.textContent = "Результаты";
    resSubtitle.textContent = `${name}вот твой профиль по работе с экономическим покупателем.`;
    overallScore.textContent = `${report.overallPercent}%`;

    strengths.innerHTML = "";
    improvements.innerHTML = "";

    const dims = report.dimensions || [];
    const best = dims.slice(0, 3);
    const worst = dims.slice().sort((a,b)=>a.percent-b.percent).slice(0, 3);

    const renderKpi = (d) => {
      const tag = levelTag(d.percent);
      const box = el("div", {class:"kpi"},
        el("h3", {}, d.name),
        el("div", {class:"small"}, d.why || ""),
        el("div", {class:"bar"}, el("div", {style:`width:${d.percent}%`})),
        el("div", {class:"small"}, `${d.percent}% · `, el("span", {class:`tag ${tag.cls}`}, tag.text))
      );
      if (d.doNext?.length){
        const ul = el("ul", {class:"small"});
        d.doNext.slice(0,3).forEach(x => ul.appendChild(el("li", {}, x)));
        box.appendChild(ul);
      }
      return box;
    };

    best.forEach(d => strengths.appendChild(renderKpi(d)));
    worst.forEach(d => improvements.appendChild(renderKpi(d)));

    dimensionTable.innerHTML = "";
    const tbl = el("table", {class:"table"});
    tbl.appendChild(el("thead", {},
      el("tr", {},
        el("th", {}, "Компетенция"),
        el("th", {}, "Уровень"),
        el("th", {}, "Статус"),
        el("th", {}, "Коротко что делать")
      )
    ));
    const tbody = el("tbody");
    for (const d of dims){
      const tag = levelTag(d.percent);
      const next = (d.doNext || []).slice(0,1)[0] || "—";
      tbody.appendChild(el("tr", {},
        el("td", {}, d.name),
        el("td", {}, `${d.percent}%`),
        el("td", {}, el("span", {class:`tag ${tag.cls}`}, tag.text)),
        el("td", {class:"muted"}, next)
      ));
    }
    tbl.appendChild(tbody);
    dimensionTable.appendChild(tbl);

    openReview.innerHTML = "";
    if (!report.openAnswers?.length){
      openReview.appendChild(el("p", {class:"muted"}, "Открытых ответов не было."));
    } else {
      for (const oa of report.openAnswers){
        const dimName = DIMENSIONS[oa.dimension]?.name || oa.dimension;
        const pct = oa.maxScore ? Math.round((oa.score/oa.maxScore)*100) : 0;
        const tag = levelTag(pct);

        const box = el("div", {class:"kpi"},
          el("div", {class:"muted hint"}, `Вопрос ${oa.id} · ${dimName} · вес ${oa.weight}`),
          el("h3", {}, oa.question),
          el("div", {class:"small"}, "Твой ответ:"),
          el("div", {class:"answer"}, el("div", {}, oa.answer || "—")),
          el("div", {class:"small"}, `Оценка: ${oa.score}/${oa.maxScore} · `, el("span", {class:`tag ${tag.cls}`}, tag.text)),
        );

        const found = oa.found || [];
        if (found.length){
          const ul = el("ul", {class:"small"});
          found.forEach(f => ul.appendChild(el("li", {}, `${f.label} (+${f.points})`)));
          box.appendChild(el("div", {class:"small muted"}, "Что засчитала рубрика:"));
          box.appendChild(ul);
        } else {
          box.appendChild(el("div", {class:"small muted"},
            "Рубрика не нашла ключевые элементы. Подсказка: добавь маркеры деньги/риск/срок/следующий шаг."
          ));
        }

        openReview.appendChild(box);
      }
    }
  }

  function makeShortSummary(report){
    const lines = [];
    lines.push(`${report.meta?.title || "Тест"} — итог: ${report.overallPercent}%`);
    const top = (report.dimensions || []).slice(0,2);
    const low = (report.dimensions || []).slice().sort((a,b)=>a.percent-b.percent).slice(0,2);
    if (top.length){
      lines.push("Сильные зоны: " + top.map(d => `${d.name} (${d.percent}%)`).join("; "));
    }
    if (low.length){
      lines.push("Усилить: " + low.map(d => `${d.name} (${d.percent}%)`).join("; "));
    }
    return lines.join("\n");
  }

})();