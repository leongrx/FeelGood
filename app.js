
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});

const $ = id => document.getElementById(id);
const todayKey = () => new Date().toISOString().slice(0, 10);

let state = {
  templates: JSON.parse(localStorage.getItem('sf_tpls') || 'null') || [
    {
      id: 'tpl_emom',
      name: 'EMOM',
      exercises: [
        { name: 'Pull Up', note: 'Saubere Form, volle ROM', sets: Array.from({ length: 5 }, () => ({ kg: 20, reps: 5 })) },
        { name: 'Chest Dip', note: '', sets: Array.from({ length: 5 }, () => ({ kg: 20, reps: 8 })) }
      ]
    }
  ],
  history: JSON.parse(localStorage.getItem('sf_hist') || '[]'),
  cals: JSON.parse(localStorage.getItem('sf_cals') || '{}'),
  cfg: JSON.parse(localStorage.getItem('sf_cfg') || '{"key":"","goal":2500,"bw":80}')
};

let activeWorkout = JSON.parse(localStorage.getItem('sf_live') || 'null');
let timerInterval = null;
let emomSeconds = 0;
let emomInterval = null;

function persist() {
  localStorage.setItem('sf_tpls', JSON.stringify(state.templates));
  localStorage.setItem('sf_hist', JSON.stringify(state.history));
  localStorage.setItem('sf_cals', JSON.stringify(state.cals));
  localStorage.setItem('sf_cfg', JSON.stringify(state.cfg));
  if (activeWorkout) localStorage.setItem('sf_live', JSON.stringify(activeWorkout));
  else localStorage.removeItem('sf_live');
}

function switchTab(tab) {
  ['history', 'workout', 'calories', 'setup'].forEach(t => {
    $('view-' + t).classList.toggle('hidden', t !== tab);
    $('nav-' + t).classList.toggle('active', t === tab);
  });
  if (tab === 'history') renderHistory();
  if (tab === 'workout') renderWorkoutTab();
  if (tab === 'calories') renderCalories();
}

function getPreviousSet(exName, setIdx) {
  for (const w of state.history) {
    const ex = w.exercises.find(e => e.name.toLowerCase() === exName.toLowerCase());
    if (ex && ex.sets[setIdx]) {
      return `+${ex.sets[setIdx].kg} kg × ${ex.sets[setIdx].reps}`;
    }
  }
  return '—';
}

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
    <div class="stark-card">
      <div class="ex-header">
        <span style="font-size:1.15rem;font-weight:700;color:#fff;">${t.name}</span>
        <button class="btn btn-ghost btn-sm" onclick="deleteTemplate(${idx})" style="color:var(--crimson);">✕</button>
      </div>
      <div style="color:var(--muted);font-size:0.9rem;margin-bottom:10px;">
        ${t.exercises.map(e => `${e.sets.length} × ${e.name}`).join(' · ')}
      </div>
      <button class="btn btn-arc" onclick="startFromTemplate(${idx})">MISSION STARTEN</button>
    </div>
  `).join('');
}

function toggleNewTpl() { $('new-tpl-form').classList.toggle('hidden'); }

function saveTemplate() {
  const name = $('tpl-name').value.trim();
  const exs = $('tpl-exs').value.split(',').map(s => s.trim()).filter(Boolean);
  if (!name || !exs.length) return;
  state.templates.unshift({
    id: 'tpl_' + Date.now(),
    name,
    exercises: exs.map(e => ({ name: e, note: '', sets: [{ kg: 0, reps: 8 }, { kg: 0, reps: 8 }, { kg: 0, reps: 8 }] }))
  });
  $('tpl-name').value = ''; $('tpl-exs').value = '';
  $('new-tpl-form').classList.add('hidden');
  persist(); renderTemplates();
}

function deleteTemplate(idx) { state.templates.splice(idx, 1); persist(); renderTemplates(); }

function startFromTemplate(idx) {
  const tpl = state.templates[idx];
  activeWorkout = {
    name: tpl.name,
    startedAt: Date.now(),
    exercises: tpl.exercises.map(ex => ({
      name: ex.name,
      note: ex.note || '',
      sets: ex.sets.map(s => ({ kg: s.kg, reps: s.reps, done: false }))
    }))
  };
  persist(); renderWorkoutTab();
}

function startEmptyWorkout() {
  activeWorkout = { name: 'Freies Training', startedAt: Date.now(), exercises: [] };
  persist(); renderWorkoutTab();
}

function renderLiveExercises() {
  $('live-exercises').innerHTML = activeWorkout.exercises.map((ex, eIdx) => `
    <div class="stark-card">
      <div class="ex-header">
        <span class="ex-name">${ex.name}</span>
        <button class="btn btn-ghost btn-sm" onclick="removeLiveEx(${eIdx})" style="color:var(--muted);">✕</button>
      </div>
      <input placeholder="Schreibe eine Notiz..." value="${ex.note || ''}"
        onchange="activeWorkout.exercises[${eIdx}].note=this.value;persist();"
        style="background:#141b2d;border:none;font-size:0.88rem;padding:6px 8px;margin-bottom:6px;color:#cbd5e1;">
      <div class="set-grid-head">
        <div>SET</div><div>VORHERIGES</div><div>(+KG)</div><div>WDHL.</div><div>✓</div>
      </div>
      ${ex.sets.map((s, sIdx) => `
        <div class="set-row ${s.done ? 'done' : ''}">
          <div class="set-num">${sIdx + 1}</div>
          <div class="set-prev">${getPreviousSet(ex.name, sIdx)}</div>
          <input class="set-inp" type="number" step="0.5" value="${s.kg}"
            onchange="updateSet(${eIdx},${sIdx},'kg',this.value)">
          <input class="set-inp" type="number" value="${s.reps}"
            onchange="updateSet(${eIdx},${sIdx},'reps',this.value)">
          <button class="check-btn" onclick="toggleSetDone(${eIdx},${sIdx})">✓</button>
        </div>
      `).join('')}
      <button class="btn btn-ghost btn-sm" style="width:100%;margin-top:8px;color:var(--arc);" onclick="addSet(${eIdx})">
        + SET HINZUFÜGEN
      </button>
    </div>
  `).join('');
}

function addExerciseToLive() {
  const n = $('new-ex-name').value.trim();
  if (!n) return;
  activeWorkout.exercises.push({ name: n, note: '', sets: [{ kg: 0, reps: 8, done: false }] });
  $('new-ex-name').value = '';
  persist(); renderLiveExercises();
}

function removeLiveEx(eIdx) { activeWorkout.exercises.splice(eIdx, 1); persist(); renderLiveExercises(); }

function addSet(eIdx) {
  const sets = activeWorkout.exercises[eIdx].sets;
  const last = sets[sets.length - 1] || { kg: 0, reps: 8 };
  sets.push({ kg: last.kg, reps: last.reps, done: false });
  persist(); renderLiveExercises();
}

function updateSet(eIdx, sIdx, field, val) {
  activeWorkout.exercises[eIdx].sets[sIdx][field] = parseFloat(val) || 0;
  persist();
}

function toggleSetDone(eIdx, sIdx) {
  activeWorkout.exercises[eIdx].sets[sIdx].done = !activeWorkout.exercises[eIdx].sets[sIdx].done;
  persist(); renderLiveExercises();
}

function startClock() {
  clearInterval(timerInterval);
  timerInterval = setInterval(() => {
    if (!activeWorkout) return;
    const sec = Math.floor((Date.now() - activeWorkout.startedAt) / 1000);
    const m = String(Math.floor(sec / 60)).padStart(2, '0');
    const s = String(sec % 60).padStart(2, '0');
    $('live-timer').textContent = `${m}:${s}`;
  }, 1000);
}

function toggleEmomTimer() {
  if (emomInterval) {
    clearInterval(emomInterval); emomInterval = null;
    $('emom-btn').textContent = 'EMOM 60s';
    return;
  }
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
  if (!confirm('Aktives Workout verwerfen?')) return;
  activeWorkout = null;
  clearInterval(timerInterval); clearInterval(emomInterval);
  persist(); renderWorkoutTab();
}

function finishWorkout() {
  const durationMin = Math.max(1, Math.round((Date.now() - activeWorkout.startedAt) / 60000));
  const bw = parseFloat(state.cfg.bw) || 0;
  let totalVol = 0;
  let prs = 0;

  const cleanedExercises = activeWorkout.exercises.map(ex => {
    const validSets = ex.sets.filter(s => s.done || s.reps > 0);
    let best = { kg: 0, reps: 0, score: -1 };
    validSets.forEach(s => {
      totalVol += (bw + Number(s.kg)) * Number(s.reps);
      const score = Number(s.kg) * 100 + Number(s.reps);
      if (score > best.score) best = { kg: s.kg, reps: s.reps, score };
    });

    const prevBest = state.history.reduce((max, h) => {
      const found = h.exercises.find(e => e.name.toLowerCase() === ex.name.toLowerCase());
      return found && found.bestScore > max ? found.bestScore : max;
    }, 0);
    if (best.score > prevBest && prevBest > 0) prs++;

    return {
      name: ex.name,
      sets: validSets.map(s => ({ kg: s.kg, reps: s.reps })),
      bestText: validSets.length ? `+${best.kg} kg × ${best.reps}` : '—',
      bestScore: best.score
    };
  }).filter(e => e.sets.length > 0);

  if (!cleanedExercises.length) return alert('Bitte mindestens 1 Satz eintragen oder abhaken.');

  state.history.unshift({
    id: Date.now(),
    name: activeWorkout.name,
    dateISO: new Date().toISOString(),
    durationMin,
    totalVol: Math.round(totalVol),
    prs,
    exercises: cleanedExercises
  });

  activeWorkout = null;
  clearInterval(timerInterval); clearInterval(emomInterval);
  persist();
  switchTab('history');
}

function renderHistory() {
  $('hist-count').textContent = `${state.history.length} WORKOUTS`;
  if (!state.history.length) {
    $('history-list').innerHTML = `<div class="stark-card">Noch keine Einsätze protokolliert. Starte deine erste Mission unter <b>Workout</b>.</div>`;
    return;
  }

  $('history-list').innerHTML = state.history.map(w => {
    const d = new Date(w.dateISO);
    const dateStr = d.toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
      + ' um ' + d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });

    return `
      <div class="stark-card">
        <div style="font-size:1.15rem;font-weight:700;color:#fff;">${w.name}</div>
        <div style="font-size:0.85rem;color:var(--muted);margin-bottom:10px;">${dateStr}</div>
        <div class="hist-row" style="font-weight:700;color:var(--arc);font-size:0.82rem;margin-bottom:4px;">
          <span>Sets</span><span>Bestes Set</span>
        </div>
        ${w.exercises.map(ex => `
          <div class="hist-row">
            <span>${ex.sets.length} × ${ex.name}</span>
            <span style="color:#cbd5e1;">${ex.bestText}</span>
          </div>
        `).join('')}
        <div class="hist-meta">
          <span>🕒 ${w.durationMin}m</span>
          <span>🏋️ ${w.totalVol} kg</span>
          <span>🏆 ${w.prs} PRs</span>
        </div>
      </div>
    `;
  }).join('');
}

function getTodayList() {
  const k = todayKey();
  if (!state.cals[k]) state.cals[k] = [];
  return state.cals[k];
}

function previewFoodImg() {
  const f = $('food-img').files[0];
  if (f) $('ai-msg').textContent = `Bild geladen: ${f.name} – bereit für Analyse.`;
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
  const key = state.cfg.key;
  if (!key) return alert('Bitte zuerst unter SYSTEM den Gemini API-Key speichern.');
  const text = $('food-input').value.trim();
  const file = $('food-img').files[0];
  if (!text && !file) return;

  $('ai-msg').textContent = 'J.A.R.V.I.S. scannt Nährwerte...';
  try {
    const parts = [{
      text: `Analysiere diese Mahlzeit (${text || 'siehe Bild'}). Schätze realistische Kalorien und Makros. Antworte NUR mit reinem JSON ohne Markdown: {"item":"Kurzname","kcal":450,"protein":35,"carbs":40,"fat":12}`
    }];
    if (file) {
      const b64 = await fileToBase64(file);
      parts.push({ inline_data: { mime_type: file.type || 'image/jpeg', data: b64 } });
    }

    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${key}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts }] })
    });
    const data = await res.json();
    const raw = data.candidates[0].content.parts[0].text.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(raw);

    getTodayList().unshift(parsed);
    $('food-input').value = '';
    $('food-img').value = '';
    $('ai-msg').textContent = `Erfasst: ${parsed.item} (+${parsed.kcal} kcal)`;
    persist(); renderCalories();
  } catch (e) {
    $('ai-msg').textContent = 'Scan fehlgeschlagen – API-Key oder Verbindung prüfen.';
  }
}

function renderCalories() {
  $('cal-date').textContent = new Date().toLocaleDateString('de-DE');
  const list = getTodayList();
  const sum = list.reduce((a, b) => a + Number(b.kcal || 0), 0);
  const p = list.reduce((a, b) => a + Number(b.protein || 0), 0);
  const c = list.reduce((a, b) => a + Number(b.carbs || 0), 0);
  const f = list.reduce((a, b) => a + Number(b.fat || 0), 0);
  const goal = Number(state.cfg.goal) || 2500;

  $('cal-sum').textContent = sum;
  $('cal-goal-lbl').textContent = goal;
  $('m-prot').textContent = `${p}g`;
  $('m-carb').textContent = `${c}g`;
  $('m-fat').textContent = `${f}g`;

  const pct = Math.min(100, Math.round((sum / goal) * 100));
  $('cal-ring').style.setProperty('--pct', pct + '%');

  $('food-list').innerHTML = list.map((item, idx) => `
    <div class="stark-card" style="padding:10px 14px;display:flex;justify-content:space-between;align-items:center;">
      <div>
        <div style="font-weight:700;color:#fff;">${item.item}</div>
        <div style="font-size:0.82rem;color:var(--muted);">P: ${item.protein}g · C: ${item.carbs}g · F: ${item.fat}g</div>
      </div>
      <div style="display:flex;align-items:center;gap:10px;">
        <span style="font-family:'Orbitron';color:var(--arc);font-weight:700;">${item.kcal}</span>
        <button class="btn btn-ghost btn-sm" onclick="removeFood(${idx})">✕</button>
      </div>
    </div>
  `).join('') || `<div class="stark-card">Heute noch keine Treibstoff-Zufuhr protokolliert.</div>`;
}

function removeFood(idx) { getTodayList().splice(idx, 1); persist(); renderCalories(); }
function resetTodayCals() { state.cals[todayKey()] = []; persist(); renderCalories(); }

function loadSettingsUI() {
  $('cfg-key').value = state.cfg.key || '';
  $('cfg-goal').value = state.cfg.goal || 2500;
  $('cfg-bw').value = state.cfg.bw || 80;
}

function saveSettings() {
  state.cfg.key = $('cfg-key').value.trim();
  state.cfg.goal = Number($('cfg-goal').value) || 2500;
  state.cfg.bw = parseFloat($('cfg-bw').value) || 80;
  persist();
  alert('Stark-Systemparameter gespeichert.');
}

function exportBackup() {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `stark-fit-backup-${todayKey()}.json`;
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

loadSettingsUI();
if (activeWorkout) switchTab('workout');
else renderHistory();
