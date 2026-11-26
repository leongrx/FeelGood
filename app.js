const APP_VERSION = 'v4.0';
const GITHUB_REPO = 'leongrx/FeelGood';

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js?v=' + Date.now()).catch(() => {});
}

const $ = id => document.getElementById(id);
const todayKey = () => new Date().toISOString().slice(0, 10);

const ACCENT_MAP = {
  '#00e5ff': 'rgba(0, 229, 255, 0.14)',
  '#ef4444': 'rgba(239, 68, 68, 0.15)',
  '#f59e0b': 'rgba(245, 158, 11, 0.15)',
  '#10b981': 'rgba(16, 185, 129, 0.15)',
  '#a855f7': 'rgba(168, 85, 247, 0.15)'
};

let state = {
  templates: JSON.parse(localStorage.getItem('sf_tpls') || 'null') || [
    {
      id: 'tpl_emom',
      name: 'EMOM',
      isEmom: true,
      exercises: [
        { name: 'Pull Up', kg: 20, setsCount: 5, reps: 5 },
        { name: 'Chest Dip', kg: 20, setsCount: 5, reps: 8 }
      ]
    }
  ],
  history: JSON.parse(localStorage.getItem('sf_hist') || '[]'),
  cals: JSON.parse(localStorage.getItem('sf_cals') || '{}'),
  burned: JSON.parse(localStorage.getItem('sf_burn') || '{}'),
  cfg: JSON.parse(localStorage.getItem('sf_cfg') || 'null') || {
    key: '',
    accent: '#00e5ff',
    gender: 'm',
    age: 28,
    height: 180,
    weight: 80,
    activity: 1.55,
    goalOverride: 0
  }
};

let activeWorkout = JSON.parse(localStorage.getItem('sf_live') || 'null');
let editingTplIdx = null;
let timerInterval = null;
let emomSeconds = 0;
let emomInterval = null;

// Direkter GitHub-Pull / Cache-Bypass ohne Datenverlust
async function pullLatestFromGitHub() {
  const btn = $('pull-btn');
  if (btn) btn.textContent = 'Lädt...';
  try {
    if ('caches' in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map(k => caches.delete(k)));
    }
    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map(r => r.unregister()));
    }
  } catch (e) {}
  const baseUrl = window.location.origin + window.location.pathname;
  window.location.replace(baseUrl + '?pull=' + Date.now());
}

async function fetchGitHubStatus() {
  const el = $('gh-status');
  if (!el) return;
  try {
    const res = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/commits/main`, { cache: 'no-store' });
    if (!res.ok) throw new Error();
    const data = await res.json();
    const sha = data.sha.slice(0, 7);
    const time = new Date(data.commit.author.date).toLocaleString('de-DE', {
      day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'
    });
    el.textContent = `App ${APP_VERSION} · GitHub Stand: #${sha} (${time})`;
  } catch (e) {
    el.textContent = `App ${APP_VERSION} · Bereit für GitHub-Pull`;
  }
}

function openGitHubRepo(subpath = '') {
  window.open(`https://github.com/${GITHUB_REPO}${subpath}`, '_blank');
}

function applyAccent(hex) {
  const color = ACCENT_MAP[hex] ? hex : '#00e5ff';
  document.documentElement.style.setProperty('--accent', color);
  document.documentElement.style.setProperty('--accent-soft', ACCENT_MAP[color]);
  document.querySelectorAll('.swatch').forEach(el => {
    el.classList.toggle('active', el.dataset.color === color);
  });
}

function persist() {
  localStorage.setItem('sf_tpls', JSON.stringify(state.templates));
  localStorage.setItem('sf_hist', JSON.stringify(state.history));
  localStorage.setItem('sf_cals', JSON.stringify(state.cals));
  localStorage.setItem('sf_burn', JSON.stringify(state.burned));
  localStorage.setItem('sf_cfg', JSON.stringify(state.cfg));
  if (activeWorkout) localStorage.setItem('sf_live', JSON.stringify(activeWorkout));
  else localStorage.removeItem('sf_live');
}

function calcDailyTarget() {
  if (Number(state.cfg.goalOverride) > 0) return Number(state.cfg.goalOverride);
  const w = Number(state.cfg.weight) || 80;
  const h = Number(state.cfg.height) || 180;
  const a = Number(state.cfg.age) || 28;
  const s = state.cfg.gender === 'f' ? -161 : 5;
  const bmr = 10 * w + 6.25 * h - 5 * a + s;
  return Math.round(bmr * (Number(state.cfg.activity) || 1.55));
}

function calcWorkoutCalories(durationMin, totalMovedKg, isEmom) {
  const bw = Number(state.cfg.weight) || 80;
  const hours = Math.max(durationMin, 1) / 60;
  const met = isEmom ? 7.5 : 5.5;
  const baseBurn = met * bw * hours;
  const loadBonus = (totalMovedKg / 1000) * 12;
  return Math.round(baseBurn + loadBonus);
}

function switchTab(tab) {
  ['history', 'workout', 'calories', 'setup'].forEach(t => {
    $('view-' + t).classList.toggle('hidden', t !== tab);
    $('nav-' + t).classList.toggle('active', t === tab);
  });
  if (tab === 'history') renderHistory();
  if (tab === 'workout') renderWorkoutTab();
  if (tab === 'calories') renderCalories();
  if (tab === 'setup') {
    loadSettingsUI();
    fetchGitHubStatus();
  }
}

function getPreviousSummary(exName) {
  for (const w of state.history) {
    const ex = w.exercises.find(e => e.name.toLowerCase() === exName.toLowerCase());
    if (ex) return `+${ex.kg} kg × ${ex.reps} (${ex.sets.length} Sets)`;
  }
  return 'Keine Vorwerte';
}

// WORKOUT & VORLAGEN
function renderWorkoutTab() {
  if (activeWorkout) {
    $('active-session-box').classList.remove('hidden');
    $('templates-box').classList.add('hidden');
    $('live-title').textContent = activeWorkout.name;
    renderLiveExercises();
    startClock();
  } else {
    $('active-session-box').classList.add('hidden');
    $('templates-box').classList.remove('hidden');
    renderTemplates();
  }
}

function renderTemplates() {
  $('templates-list').innerHTML = state.templates.map((t, idx) => `
    <div class="card">
      <div class="row" style="justify-content:space-between;margin-bottom:6px;">
        <div>
          <strong style="font-size:1.05rem;">${t.name}</strong>
          ${t.isEmom ? `<span class="pill" style="font-size:0.7rem;padding:2px 6px;margin-left:6px;">EMOM</span>` : ''}
        </div>
        <div class="row" style="gap:6px;">
          <button class="btn btn-ghost btn-sm" onclick="editTemplate(${idx})">Bearbeiten</button>
          <button class="btn btn-ghost btn-sm" onclick="duplicateTemplate(${idx})">Kopie</button>
          <button class="btn btn-danger btn-sm" onclick="deleteTemplate(${idx})">✕</button>
        </div>
      </div>
      <div style="color:var(--muted);font-size:0.88rem;margin-bottom:10px;">
        ${t.exercises.map(e => `${e.setsCount} × ${e.name} (+${e.kg} kg)`).join(' · ')}
      </div>
      <button class="btn btn-soft" onclick="startFromTemplate(${idx})">Workout starten</button>
    </div>
  `).join('') || `<div class="card" style="color:var(--muted);">Noch keine Vorlagen gespeichert.</div>`;
}

function openNewTemplateForm() {
  editingTplIdx = null;
  $('tpl-form-title').textContent = 'Neue Vorlage';
  $('tpl-name').value = '';
  $('tpl-is-emom').checked = false;
  $('tpl-ex-builder').innerHTML = '';
  addBuilderRow();
  $('tpl-editor').classList.remove('hidden');
}

function editTemplate(idx) {
  editingTplIdx = idx;
  const t = state.templates[idx];
  $('tpl-form-title').textContent = 'Vorlage bearbeiten';
  $('tpl-name').value = t.name;
  $('tpl-is-emom').checked = !!t.isEmom;
  $('tpl-ex-builder').innerHTML = '';
  t.exercises.forEach(e => addBuilderRow(e.name, e.kg, e.setsCount, e.reps));
  $('tpl-editor').classList.remove('hidden');
}

function closeTemplateForm() {
  $('tpl-editor').classList.add('hidden');
  editingTplIdx = null;
}

function addBuilderRow(name = '', kg = 0, setsCount = 5, reps = 8) {
  const div = document.createElement('div');
  div.className = 'card';
  div.style.padding = '10px';
  div.style.background = 'var(--surface-2)';
  div.innerHTML = `
    <div class="row" style="margin-bottom:6px;">
      <input class="b-name" placeholder="Übungsname (z.B. Pull Up)" value="${name}">
      <button class="btn btn-danger btn-sm" onclick="this.closest('.card').remove()">✕</button>
    </div>
    <div class="grid-3">
      <div><label class="lbl">+KG (alle Sets)</label><input class="b-kg" type="number" step="0.5" value="${kg}"></div>
      <div><label class="lbl">Sätze</label><input class="b-sets" type="number" value="${setsCount}"></div>
      <div><label class="lbl">Wdhl.</label><input class="b-reps" type="number" value="${reps}"></div>
    </div>
  `;
  $('tpl-ex-builder').appendChild(div);
}

function saveTemplate() {
  const name = $('tpl-name').value.trim();
  const isEmom = $('tpl-is-emom').checked;
  const rows = [...$('tpl-ex-builder').querySelectorAll('.card')];
  const exercises = rows.map(r => ({
    name: r.querySelector('.b-name').value.trim(),
    kg: parseFloat(r.querySelector('.b-kg').value) || 0,
    setsCount: Math.max(1, parseInt(r.querySelector('.b-sets').value) || 3),
    reps: Math.max(1, parseInt(r.querySelector('.b-reps').value) || 8)
  })).filter(e => e.name);

  if (!name || !exercises.length) return alert('Bitte Vorlagen-Name und mindestens 1 Übung angeben.');

  const tplObj = {
    id: editingTplIdx !== null ? state.templates[editingTplIdx].id : 'tpl_' + Date.now(),
    name,
    isEmom,
    exercises
  };

  if (editingTplIdx !== null) state.templates[editingTplIdx] = tplObj;
  else state.templates.unshift(tplObj);

  closeTemplateForm();
  persist();
  renderTemplates();
}

function duplicateTemplate(idx) {
  const copy = JSON.parse(JSON.stringify(state.templates[idx]));
  copy.id = 'tpl_' + Date.now();
  copy.name += ' (Kopie)';
  state.templates.splice(idx + 1, 0, copy);
  persist();
  renderTemplates();
}

function deleteTemplate(idx) {
  if (!confirm(`Vorlage "${state.templates[idx].name}" wirklich löschen?`)) return;
  state.templates.splice(idx, 1);
  persist();
  renderTemplates();
}

function startFromTemplate(idx) {
  const tpl = state.templates[idx];
  activeWorkout = {
    name: tpl.name,
    isEmom: !!tpl.isEmom,
    startedAt: Date.now(),
    exercises: tpl.exercises.map(ex => ({
      name: ex.name,
      kg: ex.kg,
      sets: Array.from({ length: ex.setsCount }, () => ({ reps: ex.reps, done: false }))
    }))
  };
  persist();
  renderWorkoutTab();
}

function startEmptyWorkout() {
  activeWorkout = { name: 'Freies Workout', isEmom: false, startedAt: Date.now(), exercises: [] };
  persist();
  renderWorkoutTab();
}

function renderLiveExercises() {
  const sec = Math.max(60, Math.floor((Date.now() - activeWorkout.startedAt) / 1000));
  $('live-kcal').textContent = `~${calcLiveCalories(sec)} kcal`;

  $('live-exercises').innerHTML = activeWorkout.exercises.map((ex, eIdx) => `
    <div class="card">
      <div class="ex-top">
        <div>
          <div class="ex-title">${ex.name}</div>
          <div style="font-size:0.78rem;color:var(--muted);">Letztes Mal: ${getPreviousSummary(ex.name)}</div>
        </div>
        <div class="uniform-kg-box">
          <span style="font-size:0.78rem;color:var(--muted);">+KG</span>
          <input type="number" step="0.5" value="${ex.kg}" onchange="setUniformWeight(${eIdx}, this.value)">
          <button class="btn btn-danger btn-sm" onclick="removeLiveEx(${eIdx})">✕</button>
        </div>
      </div>

      <div class="set-head">
        <div>SET</div><div>GEWICHT</div><div>WDHL.</div><div>✓</div>
      </div>
      ${ex.sets.map((s, sIdx) => `
        <div class="set-row ${s.done ? 'done' : ''}">
          <div class="set-badge">${sIdx + 1}</div>
          <div style="font-size:0.9rem;color:var(--muted);font-weight:600;">+${ex.kg} kg</div>
          <input class="set-reps" type="number" value="${s.reps}" onchange="updateReps(${eIdx},${sIdx},this.value)">
          <button class="chk" onclick="toggleSetDone(${eIdx},${sIdx})">✓</button>
        </div>
      `).join('')}

      <div class="row" style="margin-top:8px;">
        <button class="btn btn-ghost btn-sm" style="flex:1;" onclick="addSet(${eIdx})">+ Set</button>
        <button class="btn btn-ghost btn-sm" style="flex:1;" onclick="removeLastSet(${eIdx})">- Set</button>
      </div>
    </div>
  `).join('');
}

function setUniformWeight(eIdx, val) {
  activeWorkout.exercises[eIdx].kg = parseFloat(val) || 0;
  persist();
  renderLiveExercises();
}

function updateReps(eIdx, sIdx, val) {
  activeWorkout.exercises[eIdx].sets[sIdx].reps = parseInt(val) || 0;
  persist();
}

function toggleSetDone(eIdx, sIdx) {
  activeWorkout.exercises[eIdx].sets[sIdx].done = !activeWorkout.exercises[eIdx].sets[sIdx].done;
  persist();
  renderLiveExercises();
}

function addSet(eIdx) {
  const sets = activeWorkout.exercises[eIdx].sets;
  const lastReps = sets.length ? sets[sets.length - 1].reps : 8;
  sets.push({ reps: lastReps, done: false });
  persist();
  renderLiveExercises();
}

function removeLastSet(eIdx) {
  if (activeWorkout.exercises[eIdx].sets.length > 1) {
    activeWorkout.exercises[eIdx].sets.pop();
    persist();
    renderLiveExercises();
  }
}

function addExerciseToLive() {
  const name = $('new-ex-name').value.trim();
  const kg = parseFloat($('new-ex-kg').value) || 0;
  if (!name) return;
  activeWorkout.exercises.push({
    name,
    kg,
    sets: [{ reps: 8, done: false }, { reps: 8, done: false }, { reps: 8, done: false }]
  });
  $('new-ex-name').value = '';
  $('new-ex-kg').value = '';
  persist();
  renderLiveExercises();
}

function removeLiveEx(eIdx) {
  activeWorkout.exercises.splice(eIdx, 1);
  persist();
  renderLiveExercises();
}

function calcLiveCalories(elapsedSec) {
  const bw = Number(state.cfg.weight) || 80;
  let moved = 0;
  activeWorkout.exercises.forEach(ex => {
    ex.sets.forEach(s => {
      if (s.done) moved += (bw + Number(ex.kg)) * Number(s.reps);
    });
  });
  return calcWorkoutCalories(elapsedSec / 60, moved, activeWorkout.isEmom);
}

function startClock() {
  clearInterval(timerInterval);
  timerInterval = setInterval(() => {
    if (!activeWorkout) return;
    const sec = Math.floor((Date.now() - activeWorkout.startedAt) / 1000);
    const m = String(Math.floor(sec / 60)).padStart(2, '0');
    const s = String(sec % 60).padStart(2, '0');
    $('live-timer').textContent = `${m}:${s}`;
    $('live-kcal').textContent = `~${calcLiveCalories(sec)} kcal`;
  }, 1000);
}

function toggleEmomTimer() {
  if (emomInterval) {
    clearInterval(emomInterval);
    emomInterval = null;
    $('emom-btn').textContent = 'EMOM 60s';
    return;
  }
  activeWorkout.isEmom = true;
  emomSeconds = 60;
  $('emom-btn').textContent = `EMOM ${emomSeconds}s`;
  emomInterval = setInterval(() => {
    emomSeconds--;
    if (emomSeconds <= 0) {
      emomSeconds = 60;
      if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
    }
    $('emom-btn').textContent = `EMOM ${emomSeconds}s`;
  }, 1000);
}

function cancelWorkout() {
  if (!confirm('Workout abbrechen und verwerfen?')) return;
  activeWorkout = null;
  clearInterval(timerInterval);
  clearInterval(emomInterval);
  persist();
  renderWorkoutTab();
}

function finishWorkout() {
  const durationMin = Math.max(1, Math.round((Date.now() - activeWorkout.startedAt) / 60000));
  const bw = Number(state.cfg.weight) || 80;
  let totalVol = 0;
  let prs = 0;

  const cleaned = activeWorkout.exercises.map(ex => {
    const validSets = ex.sets.filter(s => s.done || s.reps > 0);
    let maxReps = 0;
    validSets.forEach(s => {
      totalVol += (bw + Number(ex.kg)) * Number(s.reps);
      if (Number(s.reps) > maxReps) maxReps = Number(s.reps);
    });
    const score = Number(ex.kg) * 100 + maxReps;
    const prevBest = state.history.reduce((m, h) => {
      const f = h.exercises.find(e => e.name.toLowerCase() === ex.name.toLowerCase());
      return f && f.bestScore > m ? f.bestScore : m;
    }, 0);
    if (score > prevBest && prevBest > 0) prs++;

    return {
      name: ex.name,
      kg: ex.kg,
      reps: maxReps,
      sets: validSets,
      bestText: validSets.length ? `+${ex.kg} kg × ${maxReps}` : '—',
      bestScore: score
    };
  }).filter(e => e.sets.length > 0);

  if (!cleaned.length) return alert('Bitte mindestens 1 Satz abhaken.');

  const burnedKcal = calcWorkoutCalories(durationMin, totalVol, activeWorkout.isEmom);

  const k = todayKey();
  if (!state.burned[k]) state.burned[k] = [];
  state.burned[k].unshift({
    id: Date.now(),
    label: `Workout: ${activeWorkout.name} (${durationMin}m)`,
    kcal: burnedKcal
  });

  state.history.unshift({
    id: Date.now(),
    name: activeWorkout.name,
    isEmom: activeWorkout.isEmom,
    dateISO: new Date().toISOString(),
    durationMin,
    totalVol: Math.round(totalVol),
    burnedKcal,
    prs,
    exercises: cleaned
  });

  activeWorkout = null;
  clearInterval(timerInterval);
  clearInterval(emomInterval);
  persist();
  switchTab('history');
}

// VERLAUF
function renderHistory() {
  $('hist-count').textContent = `${state.history.length} Workouts`;
  if (!state.history.length) {
    $('history-list').innerHTML = `<div class="card" style="color:var(--muted);">Noch keine Workouts gespeichert.</div>`;
    return;
  }

  $('history-list').innerHTML = state.history.map((w, idx) => {
    const d = new Date(w.dateISO);
    const dateStr = d.toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' })
      + ' · ' + d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });

    return `
      <div class="card">
        <div class="row" style="justify-content:space-between;">
          <div>
            <strong style="font-size:1.05rem;">${w.name}</strong>
            <div style="font-size:0.8rem;color:var(--muted);margin-bottom:8px;">${dateStr}</div>
          </div>
          <button class="btn btn-ghost btn-sm" onclick="saveHistoryAsTemplate(${idx})">Als Vorlage</button>
        </div>
        ${w.exercises.map(ex => `
          <div class="hist-line">
            <span>${ex.sets.length} × ${ex.name}</span>
            <span style="color:var(--muted);">${ex.bestText}</span>
          </div>
        `).join('')}
        <div class="hist-meta">
          <span>🕒 ${w.durationMin}m</span>
          <span>🏋️ ${w.totalVol} kg</span>
          <span>🔥 ${w.burnedKcal || 0} kcal</span>
          <span>🏆 ${w.prs} PRs</span>
        </div>
      </div>
    `;
  }).join('');
}

function saveHistoryAsTemplate(idx) {
  const w = state.history[idx];
  state.templates.unshift({
    id: 'tpl_' + Date.now(),
    name: w.name,
    isEmom: !!w.isEmom,
    exercises: w.exercises.map(ex => ({
      name: ex.name,
      kg: ex.kg,
      setsCount: ex.sets.length,
      reps: ex.reps || 8
    }))
  });
  persist();
  alert(`"${w.name}" als Vorlage gespeichert.`);
}

// KALORIEN & KI
function getTodayFoods() {
  const k = todayKey();
  if (!state.cals[k]) state.cals[k] = [];
  return state.cals[k];
}

function getTodayBurned() {
  const k = todayKey();
  if (!state.burned[k]) state.burned[k] = [];
  return state.burned[k];
}

function addManualBurn() {
  const label = $('burn-label').value.trim() || 'Aktivität / Sport';
  const kcal = parseInt($('burn-kcal').value) || 0;
  if (kcal <= 0) return;
  getTodayBurned().unshift({ id: Date.now(), label, kcal });
  $('burn-label').value = '';
  $('burn-kcal').value = '';
  persist();
  renderCalories();
}

function removeBurn(idx) {
  getTodayBurned().splice(idx, 1);
  persist();
  renderCalories();
}

function fileToBase64(file) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result.split(',')[1]);
    r.onerror = rej;
    r.readAsDataURL(file);
  });
}

async function analyzeFoodAI() {
  const key = (state.cfg.key || '').trim();
  if (!key) return alert('Bitte zuerst in den Einstellungen deinen Gemini API-Key hinterlegen.');
  const text = $('food-input').value.trim();
  const file = $('food-img').files[0];
  if (!text && !file) return;

  $('ai-msg').textContent = 'Berechne Nährwerte...';
  try {
    const parts = [{
      text: `Schätze realistische Kalorien und Makros für: "${text || 'siehe Bild'}". Antworte NUR mit gültigem JSON ohne Markdown: {"item":"Kurzname","kcal":400,"protein":30,"carbs":40,"fat":12}`
    }];
    if (file) {
      const b64 = await fileToBase64(file);
      parts.push({ inline_data: { mime_type: file.type || 'image/jpeg', data: b64 } });
    }

    const res = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': key
      },
      body: JSON.stringify({ contents: [{ parts }] })
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error?.message || `HTTP ${res.status}`);
    }

    const raw = data.candidates[0].content.parts[0].text.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(raw);

    getTodayFoods().unshift(parsed);
    $('food-input').value = '';
    $('food-img').value = '';
    $('ai-msg').textContent = `Hinzugefügt: ${parsed.item} (${parsed.kcal} kcal)`;
    persist();
    renderCalories();
  } catch (e) {
    $('ai-msg').textContent = `Fehler: ${e.message}`;
  }
}

function renderCalories() {
  const foods = getTodayFoods();
  const burns = getTodayBurned();
  const eaten = foods.reduce((a, b) => a + Number(b.kcal || 0), 0);
  const activeBurn = burns.reduce((a, b) => a + Number(b.kcal || 0), 0);
  const p = foods.reduce((a, b) => a + Number(b.protein || 0), 0);
  const c = foods.reduce((a, b) => a + Number(b.carbs || 0), 0);
  const f = foods.reduce((a, b) => a + Number(b.fat || 0), 0);
  const target = calcDailyTarget() + activeBurn;
  const remaining = target - eaten;

  $('cal-eaten').textContent = eaten;
  $('cal-burned').textContent = activeBurn;
  $('cal-rem').textContent = remaining;
  $('cal-rem').style.color = remaining >= 0 ? 'var(--accent)' : 'var(--danger)';
  $('cal-macros').textContent = `Ziel inkl. Aktivität: ${target} kcal · P: ${p}g · C: ${c}g · F: ${f}g`;

  $('food-list').innerHTML = foods.map((item, idx) => `
    <div class="card" style="padding:10px 12px;display:flex;justify-content:space-between;align-items:center;">
      <div>
        <strong>${item.item}</strong>
        <div style="font-size:0.8rem;color:var(--muted);">P: ${item.protein}g · C: ${item.carbs}g · F: ${item.fat}g</div>
      </div>
      <div class="row">
        <span style="font-weight:700;color:var(--accent);">${item.kcal} kcal</span>
        <button class="btn btn-ghost btn-sm" onclick="removeFood(${idx})">✕</button>
      </div>
    </div>
  `).join('') || `<div class="card" style="color:var(--muted);">Heute noch keine Mahlzeiten eingetragen.</div>`;

  $('burn-list').innerHTML = burns.map((b, idx) => `
    <div class="card" style="padding:10px 12px;display:flex;justify-content:space-between;align-items:center;">
      <span>${b.label}</span>
      <div class="row">
        <span style="font-weight:700;color:var(--accent);">-${b.kcal} kcal</span>
        <button class="btn btn-ghost btn-sm" onclick="removeBurn(${idx})">✕</button>
      </div>
    </div>
  `).join('') || `<div class="card" style="color:var(--muted);">Keine aktiven Kalorien eingetragen.</div>`;
}

function removeFood(idx) { getTodayFoods().splice(idx, 1); persist(); renderCalories(); }

// EINSTELLUNGEN
function selectAccent(hex) {
  state.cfg.accent = hex;
  applyAccent(hex);
  persist();
}

function loadSettingsUI() {
  $('cfg-key').value = state.cfg.key || '';
  $('cfg-gender').value = state.cfg.gender || 'm';
  $('cfg-age').value = state.cfg.age || 28;
  $('cfg-height').value = state.cfg.height || 180;
  $('cfg-weight').value = state.cfg.weight || 80;
  $('cfg-activity').value = state.cfg.activity || 1.55;
  $('cfg-goal').value = state.cfg.goalOverride || '';
  $('calc-tdee-info').textContent = `Berechneter Tagesbedarf: ${calcDailyTarget()} kcal`;
}

function saveSettings() {
  state.cfg.key = $('cfg-key').value.trim();
  state.cfg.gender = $('cfg-gender').value;
  state.cfg.age = parseInt($('cfg-age').value) || 28;
  state.cfg.height = parseInt($('cfg-height').value) || 180;
  state.cfg.weight = parseFloat($('cfg-weight').value) || 80;
  state.cfg.activity = parseFloat($('cfg-activity').value) || 1.55;
  state.cfg.goalOverride = parseInt($('cfg-goal').value) || 0;
  persist();
  loadSettingsUI();
  alert('Einstellungen gespeichert.');
}

function exportBackup() {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `feelgood-backup-${todayKey()}.json`;
  a.click();
}

function importBackup() {
  const raw = prompt('JSON-Backup hier einfügen:');
  if (!raw) return;
  try {
    state = JSON.parse(raw);
    persist();
    location.reload();
  } catch (e) {
    alert('Ungültiges JSON-Format.');
  }
}

// Init
applyAccent(state.cfg.accent);
if (activeWorkout) switchTab('workout');
else renderHistory();
