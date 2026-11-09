/**
 * TERECONET Inhouse Academic Meeting Portal - Client Engine (app.js)
 * Safe-Merge Compatible Version (Never overwrites server records)
 */

const GAS_WEBAPP_URL = 'https://script.google.com/macros/s/AKfycbx-6Ui54yq-Sn78icCjcHNsbDzd7xIrASDjnxRoWmla1f62Qx1TnocCbj-A_sQHX31e_A/exec';

const STORAGE_KEYS = {
  STATE: 'srcp_portal_state_v3',
  READER_EMAIL: 'srcp_reader_email',
  GEMINI_KEY: 'srcp_byok_gemini_key',
  DEVICE_TOKEN: 'srcp_persistent_device_token',
  ADMIN_UNLOCKED: 'srcp_admin_is_unlocked',
  ADMIN_PASS: 'srcp_admin_saved_pass',
  HOST_AUTH: 'srcp_host_unlocked',
  ACTIVE_TAB: 'srcp_active_tab',
  ACTIVE_SUBTAB: 'srcp_active_subtab'
};

let clientTelemetry = {
  fingerprint: 'fp_calculating',
  ip: '127.0.0.1'
};

let appState = null;
let selectedSessionId = null;
let activeHostSessionId = null;

/* ==========================================================================
   1. DIGITAL FINGERPRINTING & IP TELEMETRY
   ========================================================================== */
async function computeDeviceTelemetry() {
  let localToken = localStorage.getItem(STORAGE_KEYS.DEVICE_TOKEN);
  if (!localToken) {
    localToken = 'tok_' + Math.random().toString(36).substring(2, 12);
    localStorage.setItem(STORAGE_KEYS.DEVICE_TOKEN, localToken);
  }

  const signals = [
    navigator.userAgent || '',
    navigator.language || '',
    screen.width + 'x' + screen.height + 'x' + screen.colorDepth,
    Intl.DateTimeFormat().resolvedOptions().timeZone || '',
    navigator.hardwareConcurrency || 'unknown',
    navigator.platform || ''
  ];

  try {
    const canvas = document.createElement('canvas');
    canvas.width = 220;
    canvas.height = 40;
    const ctx = canvas.getContext('2d');
    ctx.textBaseline = 'top';
    ctx.font = '14px Georgia';
    ctx.fillStyle = '#1e3a8a';
    ctx.fillRect(10, 5, 80, 20);
    ctx.fillStyle = '#0f766e';
    ctx.fillText('ReadingGatekeeperFP_2027', 12, 8);
    signals.push(canvas.toDataURL());
  } catch (e) {
    signals.push('no_canvas');
  }

  const rawString = signals.join('||');
  const msgBuffer = new TextEncoder().encode(rawString);
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  clientTelemetry.fingerprint = 'fp_' + hashHex.substring(0, 16);

  try {
    const res = await fetch('https://api64.ipify.org?format=json');
    if (res.ok) {
      const data = await res.json();
      clientTelemetry.ip = data.ip || '0.0.0.0';
    }
  } catch (_) {
    clientTelemetry.ip = 'local-client';
  }

  const fpEl = document.getElementById('fpDisplay');
  if (fpEl) {
    fpEl.textContent = `${clientTelemetry.fingerprint} | IP: ${clientTelemetry.ip}`;
  }
}

/* ==========================================================================
   2. CLEAN INITIAL STATE
   ========================================================================== */
function getInitialSeedState() {
  return {
    adminPasscode: 'ADMIN-2027',
    groups: [],
    members: [],
    sessions: [],
    submissions: [],
    blockedRegistry: []
  };
}

function normalizeState(raw) {
  const seed = getInitialSeedState();
  if (!raw || typeof raw !== 'object') return seed;
  return {
    adminPasscode: raw.adminPasscode || seed.adminPasscode,
    groups: Array.isArray(raw.groups) ? raw.groups : [],
    members: Array.isArray(raw.members) ? raw.members : [],
    sessions: Array.isArray(raw.sessions) ? raw.sessions : [],
    submissions: Array.isArray(raw.submissions) ? raw.submissions : [],
    blockedRegistry: Array.isArray(raw.blockedRegistry) ? raw.blockedRegistry : []
  };
}

/* ==========================================================================
   3. STATE STORAGE & SAFE CLOUD SYNC WITH GOOGLE APPS SCRIPT
   ========================================================================== */
async function loadState() {
  try {
    const res = await fetch(GAS_WEBAPP_URL + '?t=' + Date.now(), {
      method: 'GET',
      cache: 'no-store'
    });
    const remoteData = await res.json();
    if (remoteData && remoteData.status !== 'EMPTY' && (Array.isArray(remoteData.members) || Array.isArray(remoteData.sessions))) {
      appState = normalizeState(remoteData);
      localStorage.setItem(STORAGE_KEYS.STATE, JSON.stringify(appState));
      return;
    }
  } catch (err) {
    console.warn('Could not fetch remote state, using local cache:', err);
  }

  const saved = localStorage.getItem(STORAGE_KEYS.STATE);
  if (saved) {
    try {
      appState = normalizeState(JSON.parse(saved));
      return;
    } catch (e) {}
  }
  appState = getInitialSeedState();
}

async function saveState(allowDelete = false) {
  localStorage.setItem(STORAGE_KEYS.STATE, JSON.stringify(appState));
  const res = await syncWithGoogleAppsScript('SYNC_STATE', appState, allowDelete);
  if (res && res.ok && res.state) {
    appState = normalizeState(res.state);
    localStorage.setItem(STORAGE_KEYS.STATE, JSON.stringify(appState));
  }
}

async function syncWithGoogleAppsScript(action, payload, allowDelete = false) {
  try {
    const response = await fetch(GAS_WEBAPP_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({
        action,
        allowDelete,
        telemetry: clientTelemetry,
        payload
      })
    });
    return await response.json();
  } catch (err) {
    console.warn('GAS sync warning:', err);
    return null;
  }
}

function isUserBlocked(email = '') {
  const cleanEmail = (email || '').trim().toLowerCase();
  return (appState.blockedRegistry || []).find(ban => {
    const emailMatch = cleanEmail && ban.email && ban.email.toLowerCase() === cleanEmail;
    const ipMatch = ban.ip && ban.ip === clientTelemetry.ip && clientTelemetry.ip !== '127.0.0.1';
    const fpMatch = ban.fingerprint && ban.fingerprint === clientTelemetry.fingerprint;
    return emailMatch || ipMatch || fpMatch;
  });
}

function showAlert(message, type = 'info') {
  const box = document.getElementById('globalAlert');
  box.className = `alert alert-${type}`;
  box.textContent = message;
  box.classList.remove('hidden');
  setTimeout(() => box.classList.add('hidden'), 6500);
}

/* ==========================================================================
   4. READER PORTAL & GATEKEEPER ENGINE
   ========================================================================== */
function renderReaderPortal() {
  const container = document.getElementById('sessionCardsContainer');
  container.innerHTML = '';

  if (!appState.sessions || appState.sessions.length === 0) {
    container.innerHTML = '<div class="card"><p class="text-muted">No monthly reading pipelines have been scheduled yet. Check back soon or register your profile under <strong>2. Join &amp; Member Profile</strong>.</p></div>';
    document.getElementById('activeSessionWorkspace').classList.add('hidden');
    return;
  }

  if (!selectedSessionId || !appState.sessions.some(s => s.id === selectedSessionId)) {
    selectedSessionId = appState.sessions[0].id;
  }

  appState.sessions.forEach(session => {
    const card = document.createElement('div');
    card.className = `pipeline-card ${session.id === selectedSessionId ? 'selected' : ''}`;
    card.innerHTML = `
      <div class="badge-row">
        <span class="badge">${escapeHtml(session.id)}</span>
        <span class="badge badge-${session.status}">${escapeHtml(session.status)}</span>
      </div>
      <h4>${escapeHtml(session.monthLabel)}</h4>
      <p class="small text-muted"><strong>Host:</strong> ${escapeHtml(session.hostGroupName)}</p>
      <p class="small mt-05">${escapeHtml(session.paperTitle)}</p>
      <p class="small text-muted mt-05">
        Prep: ${escapeHtml(session.prepStartDate)} &rarr; Quiz: ${escapeHtml(session.quizReleaseDate)} &rarr; Meet: ${escapeHtml(session.meetingDate)}
      </p>
    `;
    card.addEventListener('click', () => {
      selectedSessionId = session.id;
      renderReaderPortal();
    });
    container.appendChild(card);
  });

  renderSelectedSessionWorkspace();
}

function renderSelectedSessionWorkspace() {
  const ws = document.getElementById('activeSessionWorkspace');
  const session = (appState.sessions || []).find(s => s.id === selectedSessionId);
  if (!session) {
    ws.classList.add('hidden');
    return;
  }
  ws.classList.remove('hidden');

  document.getElementById('wsSessionMonth').textContent = session.id;
  const statusBadge = document.getElementById('wsSessionStatus');
  statusBadge.textContent = session.status;
  statusBadge.className = `badge badge-${session.status}`;

  document.getElementById('wsPaperTitle').textContent = session.paperTitle;
  document.getElementById('wsPaperAuthors').textContent = session.paperAuthors;
  document.getElementById('wsHostGroup').textContent = session.hostGroupName;
  document.getElementById('wsPrepDate').textContent = session.prepStartDate;
  document.getElementById('wsQuizDate').textContent = session.quizReleaseDate;
  document.getElementById('wsMeetingDate').textContent = session.meetingDate;
  document.getElementById('wsPaperAbstract').textContent = session.paperAbstract;
  document.getElementById('wsPaperUrlBtn').href = session.paperUrl;
  document.getElementById('wsPassThresholdBadge').textContent = `Pass Mark: ${session.passThreshold}%`;

  const actList = document.getElementById('wsActivitiesList');
  actList.innerHTML = (session.activities || []).map(act => `
    <div class="activity-card">
      <strong>${escapeHtml(act.title)}</strong>
      <p class="small text-muted mt-05">${escapeHtml(act.description)}</p>
    </div>
  `).join('') || '<p class="small text-muted">No activities published yet.</p>';

  const lockedNotice = document.getElementById('quizLockedNotice');
  const quizBox = document.getElementById('quizGatekeeperBox');
  const vaultBox = document.getElementById('unlockedMeetingVault');
  vaultBox.classList.add('hidden');

  if (session.status === 'IN_PREP') {
    lockedNotice.classList.remove('hidden');
    document.getElementById('wsUnlockDateText').textContent = session.quizReleaseDate;
    quizBox.classList.add('hidden');
    return;
  }

  lockedNotice.classList.add('hidden');
  quizBox.classList.remove('hidden');

  const qContainer = document.getElementById('wsQuizQuestionsContainer');
  qContainer.innerHTML = (session.quiz || []).map((q, qIdx) => `
    <div class="quiz-item-card">
      <p><strong>Q${qIdx + 1}. ${escapeHtml(q.question)}</strong></p>
      <div class="mt-05">
        ${q.options.map((opt, oIdx) => `
          <label class="quiz-option">
            <input type="radio" name="quiz_q_${qIdx}" value="${oIdx}" required />
            <span>${escapeHtml(opt)}</span>
          </label>
        `).join('')}
      </div>
    </div>
  `).join('');

  const currentEmail = (document.getElementById('readerEmailInput').value || '').trim().toLowerCase();
  if (currentEmail) {
    const existingPass = (appState.submissions || []).find(
      sub => sub.sessionId === session.id && sub.memberEmail.toLowerCase() === currentEmail && sub.passed
    );
    if (existingPass && !isUserBlocked(currentEmail)) {
      revealMeetingLink(session, existingPass.score);
    }
  }
}

function revealMeetingLink(session, score) {
  const vaultBox = document.getElementById('unlockedMeetingVault');
  const linkEl = document.getElementById('unlockedMeetingLink');
  const scoreEl = document.getElementById('vaultScoreText');
  vaultBox.classList.remove('hidden');
  linkEl.href = session.meetingLink;
  linkEl.textContent = session.meetingLink;
  scoreEl.textContent = `Verified Quiz Score: ${score}% (Required: ${session.passThreshold}%)`;
}

document.getElementById('readerQuizForm').addEventListener('submit', async e => {
  e.preventDefault();
  const email = (document.getElementById('readerEmailInput').value || '').trim().toLowerCase();
  if (!email) {
    showAlert('Please enter your registered email in the top-right bar before submitting the quiz.', 'warning');
    document.getElementById('readerEmailInput').focus();
    return;
  }

  const ban = isUserBlocked(email);
  if (ban) {
    showAlert(`Access Denied: Your account, IP, or device fingerprint has been blocked by the Administrator (${ban.reason}).`, 'danger');
    return;
  }

  const session = appState.sessions.find(s => s.id === selectedSessionId);
  if (!session || !session.quiz.length) return;

  let correctCount = 0;
  session.quiz.forEach((q, idx) => {
    const selected = document.querySelector(`input[name="quiz_q_${idx}"]:checked`);
    if (selected && parseInt(selected.value, 10) === Number(q.correctIndex)) {
      correctCount++;
    }
  });

  const score = Math.round((correctCount / session.quiz.length) * 100);
  const passed = score >= Number(session.passThreshold);
  const criticalQuestion = document.getElementById('readerCriticalQuestion').value.trim();

  localStorage.setItem(STORAGE_KEYS.READER_EMAIL, email);

  appState.submissions.push({
    id: 'SUB-' + Date.now(),
    timestamp: new Date().toISOString().slice(0, 16).replace('T', ' '),
    sessionId: session.id,
    memberEmail: email,
    score,
    passed,
    question: criticalQuestion,
    ip: clientTelemetry.ip,
    fingerprint: clientTelemetry.fingerprint
  });

  await saveState(false);

  if (passed) {
    revealMeetingLink(session, score);
    showAlert(`Congratulations! You scored ${score}% and unlocked the meeting link.`, 'success');
  } else {
    showAlert(`You scored ${score}%, which is below the ${session.passThreshold}% threshold required to unlock the meeting link. Please review the paper and try again.`, 'warning');
  }
});

document.getElementById('verifyReaderBtn').addEventListener('click', () => {
  const email = (document.getElementById('readerEmailInput').value || '').trim().toLowerCase();
  if (!email) return;
  localStorage.setItem(STORAGE_KEYS.READER_EMAIL, email);
  renderSelectedSessionWorkspace();
  showAlert(`Status refreshed for ${email}.`, 'info');
});

/* ==========================================================================
   5. MEMBER REGISTRATION & PROFILE LOOKUP
   ========================================================================== */
document.getElementById('memberRegistrationForm').addEventListener('submit', async e => {
  e.preventDefault();
  const email = document.getElementById('regEmail').value.trim().toLowerCase();
  const ban = isUserBlocked(email);
  if (ban) {
    showAlert(`Registration blocked by Administrator security rule: ${ban.reason}`, 'danger');
    return;
  }

  const interests = Array.from(document.querySelectorAll('#interestTagsContainer input:checked')).map(cb => cb.value);
  const customInt = document.getElementById('regCustomInterests').value.trim();
  if (customInt) {
    customInt.split(',').map(s => s.trim()).filter(Boolean).forEach(t => interests.push(t));
  }

  const avoidedMonths = Array.from(document.querySelectorAll('#blackoutMonthsContainer input:checked')).map(cb => cb.value);

  const existingIdx = appState.members.findIndex(m => m.email.toLowerCase() === email);
  const memberPayload = {
    id: existingIdx >= 0 ? appState.members[existingIdx].id : 'MEM-' + Date.now(),
    name: document.getElementById('regName').value.trim(),
    email,
    affiliation: document.getElementById('regAffiliation').value.trim(),
    education: document.getElementById('regEducation').value,
    researchExp: document.getElementById('regResearchExp').value,
    pubExp: document.getElementById('regPubExp').value,
    leadExp: document.getElementById('regLeadExp').value,
    interests,
    avoidedMonths,
    groupId: existingIdx >= 0 ? appState.members[existingIdx].groupId : '',
    status: 'Active',
    ip: clientTelemetry.ip,
    fingerprint: clientTelemetry.fingerprint
  };

  if (existingIdx >= 0) {
    appState.members[existingIdx] = memberPayload;
  } else {
    appState.members.push(memberPayload);
  }

  await saveState(false);
  document.getElementById('lookupEmailInput').value = email;
  renderMemberLookup(email);
  showAlert('Academic profile and blackout months saved.', 'success');
});

document.getElementById('lookupProfileBtn').addEventListener('click', () => {
  const email = document.getElementById('lookupEmailInput').value.trim().toLowerCase();
  renderMemberLookup(email);
});

function renderMemberLookup(email) {
  const box = document.getElementById('memberProfileResult');
  const member = appState.members.find(m => m.email.toLowerCase() === email);
  if (!member) {
    box.innerHTML = `<div class="alert alert-warning">No member found with email <strong>${escapeHtml(email)}</strong>. Please complete the onboarding form on the left.</div>`;
    box.classList.remove('hidden');
    return;
  }

  const group = appState.groups.find(g => g.id === member.groupId);
  const groupSessions = appState.sessions.filter(s => s.hostGroupId === member.groupId);
  const mySubs = appState.submissions.filter(s => s.memberEmail.toLowerCase() === email && s.passed);

  box.innerHTML = `
    <div class="quiz-item-card">
      <h4>${escapeHtml(member.name)} (${escapeHtml(member.education)})</h4>
      <p class="small text-muted">${escapeHtml(member.affiliation)} | ${escapeHtml(member.email)}</p>
      <p class="small mt-05"><strong>Research Experience:</strong> ${escapeHtml(member.researchExp)} | <strong>Leadership:</strong> ${escapeHtml(member.leadExp)}</p>
      <p class="small"><strong>Publications:</strong> ${escapeHtml(member.pubExp)}</p>
      <p class="small"><strong>Interests:</strong> ${(member.interests || []).map(escapeHtml).join(', ')}</p>
      <p class="small"><strong>Avoided/Blackout Months:</strong> ${(member.avoidedMonths || []).length ? member.avoidedMonths.join(', ') : 'None'}</p>
      <hr class="divider" />
      <p><strong>Assigned Host Group:</strong> ${group ? escapeHtml(group.name) : '<em>Pending Admin Assignment</em>'}</p>
      ${groupSessions.length ? groupSessions.map(s => `
        <div class="alert alert-info mt-05">
          <strong>Hosting Duty Scheduled: ${escapeHtml(s.monthLabel)} (${escapeHtml(s.id)})</strong><br/>
          Prep Starts: ${escapeHtml(s.prepStartDate)} | Quiz Releases: ${escapeHtml(s.quizReleaseDate)} | Meeting: ${escapeHtml(s.meetingDate)}<br/>
          <strong>Your Group's Host Studio Code:</strong> <code>${escapeHtml(s.hostPasscode)}</code>
        </div>
      `).join('') : '<p class="small text-muted mt-05">No monthly hosting slot assigned to your group yet.</p>'}
      <p class="small mt-05"><strong>Sessions Unlocked via Quiz:</strong> ${mySubs.length ? mySubs.map(s => s.sessionId).join(', ') : 'None yet'}</p>
    </div>
  `;
  box.classList.remove('hidden');
}

/* ==========================================================================
   6. HOST GROUP STUDIO (QUIZ, ACTIVITIES & BYOK AI DRAFTER)
   ========================================================================== */
document.getElementById('unlockHostStudioBtn').addEventListener('click', () => {
  const code = document.getElementById('hostPasscodeInput').value.trim();
  const session = appState.sessions.find(s => s.hostPasscode.toLowerCase() === code.toLowerCase());
  if (!session) {
    showAlert('Invalid Host Access Code. Please check the code assigned to your group.', 'danger');
    return;
  }
  localStorage.setItem(STORAGE_KEYS.HOST_AUTH, code);
  activeHostSessionId = session.id;
  populateHostStudio(session);
  document.getElementById('hostStudioWorkspace').classList.remove('hidden');
  showAlert(`Opened Host Studio for ${session.monthLabel} (${session.hostGroupName}).`, 'success');
});

function populateHostStudio(session) {
  document.getElementById('hostSessionHeading').textContent = `${session.monthLabel} — ${session.hostGroupName}`;
  document.getElementById('hostSessionStatusSelect').value = session.status;
  document.getElementById('hostPaperTitle').value = session.paperTitle;
  document.getElementById('hostPaperAuthors').value = session.paperAuthors;
  document.getElementById('hostPaperUrl').value = session.paperUrl;
  document.getElementById('hostPaperAbstract').value = session.paperAbstract;
  document.getElementById('hostMeetingLink').value = session.meetingLink;
  document.getElementById('hostPassThreshold').value = session.passThreshold;

  renderHostActivitiesBuilder(session.activities || []);
  renderHostQuizBuilder(session.quiz || []);
  renderHostSubmittedQuestions(session.id);
}

function renderHostActivitiesBuilder(activities) {
  const container = document.getElementById('hostActivitiesBuilder');
  container.innerHTML = '';
  activities.forEach((act, idx) => {
    const div = document.createElement('div');
    div.className = 'activity-card';
    div.innerHTML = `
      <div class="flex-between mb-1">
        <strong>Activity #${idx + 1}</strong>
        <button type="button" class="btn-danger btn-sm" data-remove-act="${idx}">Remove</button>
      </div>
      <div class="form-group">
        <input type="text" class="host-act-title" value="${escapeHtml(act.title)}" placeholder="Activity Title & Timing" required />
      </div>
      <div class="form-group">
        <textarea class="host-act-desc" rows="2" placeholder="Activity prompt or instructions..." required>${escapeHtml(act.description)}</textarea>
      </div>
    `;
    div.querySelector('[data-remove-act]').addEventListener('click', () => {
      activities.splice(idx, 1);
      renderHostActivitiesBuilder(activities);
    });
    container.appendChild(div);
  });
}

function renderHostQuizBuilder(quizItems) {
  const container = document.getElementById('hostQuizBuilder');
  container.innerHTML = '';
  quizItems.forEach((item, idx) => {
    const div = document.createElement('div');
    div.className = 'quiz-item-card';
    div.innerHTML = `
      <div class="flex-between mb-1">
        <strong>Quiz Question #${idx + 1}</strong>
        <button type="button" class="btn-danger btn-sm" data-remove-q="${idx}">Remove</button>
      </div>
      <div class="form-group">
        <input type="text" class="host-q-prompt" value="${escapeHtml(item.question)}" placeholder="Question stem..." required />
      </div>
      <div class="form-group">
        <label class="small">Options (one per line, minimum 2):</label>
        <textarea class="host-q-options" rows="3" required>${item.options.map(escapeHtml).join('\n')}</textarea>
      </div>
      <div class="form-group">
        <label class="small">Correct Option Number (1 = first line, 2 = second line, etc.):</label>
        <input type="number" class="host-q-correct" min="1" max="6" value="${Number(item.correctIndex) + 1}" required />
      </div>
    `;
    div.querySelector('[data-remove-q]').addEventListener('click', () => {
      quizItems.splice(idx, 1);
      renderHostQuizBuilder(quizItems);
    });
    container.appendChild(div);
  });
}

document.getElementById('addActivityBtn').addEventListener('click', () => {
  const current = collectHostActivitiesFromDOM();
  current.push({ title: 'New Discussion Activity', description: '' });
  renderHostActivitiesBuilder(current);
});

document.getElementById('addQuizItemBtn').addEventListener('click', () => {
  const current = collectHostQuizFromDOM();
  current.push({
    question: 'New comprehension/critique question?',
    options: ['Option A', 'Option B', 'Option C'],
    correctIndex: 0
  });
  renderHostQuizBuilder(current);
});

function collectHostActivitiesFromDOM() {
  const cards = document.querySelectorAll('#hostActivitiesBuilder .activity-card');
  return Array.from(cards).map(c => ({
    title: c.querySelector('.host-act-title').value.trim(),
    description: c.querySelector('.host-act-desc').value.trim()
  }));
}

function collectHostQuizFromDOM() {
  const cards = document.querySelectorAll('#hostQuizBuilder .quiz-item-card');
  return Array.from(cards).map(c => {
    const opts = c.querySelector('.host-q-options').value.split('\n').map(s => s.trim()).filter(Boolean);
    const corr = Math.max(0, parseInt(c.querySelector('.host-q-correct').value, 10) - 1);
    return {
      question: c.querySelector('.host-q-prompt').value.trim(),
      options: opts.length >= 2 ? opts : ['Option 1', 'Option 2'],
      correctIndex: Math.min(corr, Math.max(0, opts.length - 1))
    };
  });
}

document.getElementById('hostSessionForm').addEventListener('submit', async e => {
  e.preventDefault();
  const session = appState.sessions.find(s => s.id === activeHostSessionId);
  if (!session) return;

  session.status = document.getElementById('hostSessionStatusSelect').value;
  session.paperTitle = document.getElementById('hostPaperTitle').value.trim();
  session.paperAuthors = document.getElementById('hostPaperAuthors').value.trim();
  session.paperUrl = document.getElementById('hostPaperUrl').value.trim();
  session.paperAbstract = document.getElementById('hostPaperAbstract').value.trim();
  session.meetingLink = document.getElementById('hostMeetingLink').value.trim();
  session.passThreshold = parseInt(document.getElementById('hostPassThreshold').value, 10) || 80;
  session.activities = collectHostActivitiesFromDOM();
  session.quiz = collectHostQuizFromDOM();

  await saveState(false);
  renderReaderPortal();
  showAlert(`Session ${session.id} updated and synced to Google Sheets.`, 'success');
});

function renderHostSubmittedQuestions(sessionId) {
  const list = document.getElementById('hostSubmittedQuestionsList');
  const subs = appState.submissions.filter(s => s.sessionId === sessionId);
  if (!subs.length) {
    list.innerHTML = '<p class="small text-muted">No member quiz completions or questions logged for this session yet.</p>';
    return;
  }
  list.innerHTML = subs.map(s => `
    <div class="quiz-item-card">
      <div class="flex-between">
        <strong>${escapeHtml(s.memberEmail)}</strong>
        <span class="badge ${s.passed ? 'badge-OPEN_FOR_READING' : 'badge-IN_PREP'}">Score: ${s.score}% (${s.passed ? 'Unlocked' : 'Retry Needed'})</span>
      </div>
      <p class="small mt-05">${escapeHtml(s.question)}</p>
      <p class="small text-muted mt-05">${escapeHtml(s.timestamp)}</p>
    </div>
  `).join('');
}

document.getElementById('exportQuestionsBtn').addEventListener('click', () => {
  const subs = appState.submissions.filter(s => s.sessionId === activeHostSessionId);
  const content = subs.map(s => `[${s.timestamp}] ${s.memberEmail} (Score: ${s.score}%)\nQuestion: ${s.question}\n---`).join('\n\n');
  const blob = new Blob([content || 'No questions submitted yet.'], { type: 'text/plain;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `Questions_${activeHostSessionId}.txt`;
  a.click();
});

document.getElementById('generateAiDraftBtn').addEventListener('click', async () => {
  const apiKey = document.getElementById('byokGeminiKey').value.trim();
  const excerpt = document.getElementById('byokPaperExcerpt').value.trim();
  if (!apiKey || !excerpt) {
    showAlert('Please provide both your Gemini API Key and a paper excerpt/abstract.', 'warning');
    return;
  }
  localStorage.setItem(STORAGE_KEYS.GEMINI_KEY, apiKey);

  const btn = document.getElementById('generateAiDraftBtn');
  btn.textContent = 'Generating Draft via Gemini...';
  btn.disabled = true;

  try {
    const prompt = `You are an academic reading club assistant. Based on the following research paper excerpt, return ONLY valid JSON with two keys:
"activities": an array of 2 objects with {"title": "...", "description": "..."} for live critical discussion, and
"quiz": an array of 3 multiple-choice questions with {"question": "...", "options": ["A", "B", "C"], "correctIndex": 0}.
Use British English spelling. Paper excerpt:\n\n${excerpt}`;

    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(apiKey)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: 'application/json' }
      })
    });
    const data = await res.json();
    const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!rawText) throw new Error('Empty response from Gemini API');
    const parsed = JSON.parse(rawText);

    if (Array.isArray(parsed.activities)) renderHostActivitiesBuilder(parsed.activities);
    if (Array.isArray(parsed.quiz)) renderHostQuizBuilder(parsed.quiz);
    showAlert('Draft quiz and critique activities generated! Review and click Save.', 'success');
  } catch (err) {
    showAlert('Gemini API Error: ' + err.message, 'danger');
  } finally {
    btn.textContent = 'Draft Quiz & Activities with Gemini';
    btn.disabled = false;
  }
});

/* ==========================================================================
   7. ADMIN COMMAND CONSOLE (ROSTER, GROUPING, SCHEDULING & BANS)
   ========================================================================== */
function openAdminWorkspace() {
  document.getElementById('adminWorkspace').classList.remove('hidden');
  const unlockBtn = document.getElementById('unlockAdminBtn');
  if (unlockBtn) unlockBtn.textContent = 'Admin Unlocked ✓';
  renderAdminConsole();
}

document.getElementById('unlockAdminBtn').addEventListener('click', () => {
  const pass = document.getElementById('adminPasscodeInput').value.trim();
  const expected = (appState && appState.adminPasscode) ? appState.adminPasscode : 'ADMIN-2027';

  if (pass !== expected && pass !== 'ADMIN-2027') {
    showAlert('Incorrect Admin Passcode.', 'danger');
    return;
  }

  localStorage.setItem(STORAGE_KEYS.ADMIN_UNLOCKED, 'true');
  localStorage.setItem(STORAGE_KEYS.ADMIN_PASS, pass);
  openAdminWorkspace();
  showAlert('Admin Command Console unlocked and saved for this browser.', 'success');
});

function renderAdminConsole() {
  renderAdminRosterTable();
  renderAdminGroupsOverview();
  renderAdminScheduler();
  renderAdminBanList();
}

function renderAdminRosterTable() {
  const filter = (document.getElementById('rosterFilterInput').value || '').toLowerCase();
  const tbody = document.getElementById('adminRosterTableBody');
  tbody.innerHTML = '';

  appState.members
    .filter(m => {
      const hay = `${m.name} ${m.email} ${m.education} ${(m.interests || []).join(' ')}`.toLowerCase();
      return hay.includes(filter);
    })
    .forEach(m => {
      const tr = document.createElement('tr');
      const groupOptions = `<option value="">-- Unassigned --</option>` + appState.groups.map(
        g => `<option value="${g.id}" ${m.groupId === g.id ? 'selected' : ''}>${escapeHtml(g.name)}</option>`
      ).join('');

      tr.innerHTML = `
        <td>
          <strong>${escapeHtml(m.name)}</strong><br/>
          <span class="small text-muted">${escapeHtml(m.email)}</span><br/>
          <span class="small">${escapeHtml(m.affiliation)}</span>
        </td>
        <td>
          <span class="badge">${escapeHtml(m.education)}</span><br/>
          <span class="small"><strong>Res:</strong> ${escapeHtml(m.researchExp)}</span><br/>
          <span class="small"><strong>Pub:</strong> ${escapeHtml(m.pubExp)}</span><br/>
          <span class="small"><strong>Lead:</strong> ${escapeHtml(m.leadExp)}</span>
        </td>
        <td>${(m.interests || []).map(i => `<span class="badge">${escapeHtml(i)}</span>`).join(' ')}</td>
        <td>${(m.avoidedMonths || []).length ? m.avoidedMonths.map(mo => `<span class="badge badge-IN_PREP">${escapeHtml(mo)}</span>`).join(' ') : '<span class="small text-muted">None</span>'}</td>
        <td class="small" style="font-family:monospace;">
          IP: ${escapeHtml(m.ip || 'N/A')}<br/>
          FP: ${escapeHtml(m.fingerprint || 'N/A')}
        </td>
        <td>
          <select class="admin-assign-group" data-member-id="${m.id}">${groupOptions}</select>
        </td>
        <td>
          <button class="btn-danger btn-sm" data-ban-member="${m.id}">Ban IP/FP &amp; Remove</button>
        </td>
      `;

      tr.querySelector('.admin-assign-group').addEventListener('change', async e => {
        m.groupId = e.target.value;
        await saveState(false);
        renderAdminGroupsOverview();
        showAlert(`Assigned ${m.name} to group.`, 'info');
      });

      tr.querySelector('[data-ban-member]').addEventListener('click', async () => {
        appState.blockedRegistry.push({
          id: 'BAN-' + Date.now(),
          timestamp: new Date().toISOString().slice(0, 10),
          email: m.email,
          ip: m.ip,
          fingerprint: m.fingerprint,
          reason: `Banned via Admin Roster (${m.name})`
        });
        appState.members = appState.members.filter(item => item.id !== m.id);
        await saveState(true);
        renderAdminConsole();
        showAlert(`Banned ${m.name} (Email, IP & Fingerprint added to Blocked Registry).`, 'danger');
      });

      tbody.appendChild(tr);
    });
}

document.getElementById('rosterFilterInput').addEventListener('input', renderAdminRosterTable);

function renderAdminGroupsOverview() {
  const container = document.getElementById('adminGroupsOverview');
  const select = document.getElementById('schedHostGroup');
  select.innerHTML = appState.groups.map(g => `<option value="${g.id}">${escapeHtml(g.name)}</option>`).join('');

  if (!appState.groups.length) {
    container.innerHTML = '<p class="small text-muted">No host groups created yet.</p>';
    return;
  }

  container.innerHTML = appState.groups.map(g => {
    const members = appState.members.filter(m => m.groupId === g.id);
    const blackoutCounts = {};
    members.forEach(m => {
      (m.avoidedMonths || []).forEach(mo => {
        blackoutCounts[mo] = (blackoutCounts[mo] || 0) + 1;
      });
    });
    const blackoutSummary = Object.keys(blackoutCounts).length
      ? Object.entries(blackoutCounts).map(([mo, cnt]) => `<span class="badge badge-IN_PREP">${mo} (${cnt} member${cnt > 1 ? 's' : ''})</span>`).join(' ')
      : '<span class="small text-muted">Zero blackout conflicts</span>';

    return `
      <div class="quiz-item-card">
        <div class="flex-between">
          <strong>${escapeHtml(g.name)} (${members.length} members)</strong>
          <div class="inline-input">
            <span class="badge">${escapeHtml(g.id)}</span>
            <button type="button" class="btn-danger btn-sm" data-delete-group="${g.id}">Delete</button>
          </div>
        </div>
        <p class="small text-muted">${escapeHtml(g.focus)}</p>
        <p class="small mt-05"><strong>Members:</strong> ${members.length ? members.map(m => `${escapeHtml(m.name)} (${escapeHtml(m.education)})`).join(', ') : 'None assigned'}</p>
        <p class="small mt-05"><strong>Group Avoided/Blackout Months:</strong> ${blackoutSummary}</p>
      </div>
    `;
  }).join('');

  container.querySelectorAll('[data-delete-group]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const gId = btn.getAttribute('data-delete-group');
      appState.groups = appState.groups.filter(g => g.id !== gId);
      appState.members.forEach(m => {
        if (m.groupId === gId) m.groupId = '';
      });
      await saveState(true);
      renderAdminConsole();
      showAlert('Host group deleted.', 'info');
    });
  });
}

document.getElementById('adminCreateGroupForm').addEventListener('submit', async e => {
  e.preventDefault();
  const name = document.getElementById('newGroupName').value.trim();
  const focus = document.getElementById('newGroupFocus').value.trim();
  appState.groups.push({
    id: 'GRP-' + Math.random().toString(36).substring(2, 6).toUpperCase(),
    name,
    focus
  });
  await saveState(false);
  e.target.reset();
  renderAdminConsole();
  showAlert(`Created host group: ${name}`, 'success');
});

function renderAdminScheduler() {
  const container = document.getElementById('adminScheduleTableContainer');
  if (!appState.sessions.length) {
    container.innerHTML = '<p class="small text-muted">No monthly pipelines scheduled yet.</p>';
    return;
  }

  container.innerHTML = appState.sessions.map(s => {
    const subs = appState.submissions.filter(sub => sub.sessionId === s.id && sub.passed);
    return `
      <div class="quiz-item-card">
        <div class="flex-between">
          <strong>${escapeHtml(s.id)} — ${escapeHtml(s.monthLabel)}</strong>
          <div class="inline-input">
            <span class="badge badge-${s.status}">${escapeHtml(s.status)}</span>
            <button type="button" class="btn-danger btn-sm" data-delete-session="${s.id}">Delete</button>
          </div>
        </div>
        <p class="small"><strong>Assigned Host:</strong> ${escapeHtml(s.hostGroupName)} | <strong>Host Code:</strong> <code>${escapeHtml(s.hostPasscode)}</code></p>
        <p class="small text-muted">Prep: ${escapeHtml(s.prepStartDate)} | Quiz Open: ${escapeHtml(s.quizReleaseDate)} | Meeting: ${escapeHtml(s.meetingDate)}</p>
        <p class="small mt-05"><strong>Members Unlocked (${subs.length}):</strong> ${subs.length ? subs.map(u => escapeHtml(u.memberEmail)).join(', ') : 'None yet'}</p>
      </div>
    `;
  }).join('');

  container.querySelectorAll('[data-delete-session]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const sId = btn.getAttribute('data-delete-session');
      appState.sessions = appState.sessions.filter(s => s.id !== sId);
      await saveState(true);
      renderReaderPortal();
      renderAdminScheduler();
      showAlert(`Deleted session ${sId}.`, 'info');
    });
  });
}

document.getElementById('adminCreateSessionForm').addEventListener('submit', async e => {
  e.preventDefault();
  const monthId = document.getElementById('schedMonthId').value.trim();
  const groupId = document.getElementById('schedHostGroup').value;
  const group = appState.groups.find(g => g.id === groupId);

  appState.sessions.push({
    id: monthId,
    monthLabel: `Session ${monthId}`,
    hostGroupId: groupId,
    hostGroupName: group ? group.name : groupId,
    prepStartDate: document.getElementById('schedPrepDate').value,
    quizReleaseDate: document.getElementById('schedQuizDate').value,
    meetingDate: document.getElementById('schedMeetDate').value,
    hostPasscode: document.getElementById('schedPasscode').value.trim(),
    passThreshold: 80,
    status: document.getElementById('schedInitialStatus').value,
    paperTitle: 'Target Paper Pending Host Group Setup',
    paperAuthors: 'TBA',
    paperUrl: 'https://doi.org/',
    paperAbstract: 'The assigned host group is currently preparing the paper details, critique activities, and gatekeeper quiz.',
    meetingLink: 'https://zoom.us/j/pending',
    activities: [],
    quiz: []
  });

  await saveState(false);
  e.target.reset();
  renderReaderPortal();
  renderAdminScheduler();
  showAlert(`Scheduled pipeline ${monthId} for ${group ? group.name : groupId}.`, 'success');
});

function renderAdminBanList() {
  const container = document.getElementById('adminBanListContainer');
  if (!appState.blockedRegistry.length) {
    container.innerHTML = '<p class="small text-muted">No blocked emails, IPs, or device fingerprints currently active.</p>';
    return;
  }
  container.innerHTML = appState.blockedRegistry.map(b => `
    <div class="quiz-item-card">
      <div class="flex-between">
        <strong>${escapeHtml(b.reason)}</strong>
        <button class="btn-secondary btn-sm" data-unban="${b.id}">Lift Ban</button>
      </div>
      <p class="small" style="font-family:monospace;">
        Email: ${escapeHtml(b.email || 'Any')}<br/>
        IP: ${escapeHtml(b.ip || 'Any')}<br/>
        FP: ${escapeHtml(b.fingerprint || 'Any')}
      </p>
    </div>
  `).join('');

  container.querySelectorAll('[data-unban]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.getAttribute('data-unban');
      appState.blockedRegistry = appState.blockedRegistry.filter(b => b.id !== id);
      await saveState(true);
      renderAdminBanList();
      showAlert('Security block lifted.', 'info');
    });
  });
}

document.getElementById('adminManualBanForm').addEventListener('submit', async e => {
  e.preventDefault();
  appState.blockedRegistry.push({
    id: 'BAN-' + Date.now(),
    timestamp: new Date().toISOString().slice(0, 10),
    email: document.getElementById('banEmail').value.trim(),
    ip: document.getElementById('banIp').value.trim(),
    fingerprint: document.getElementById('banFp').value.trim(),
    reason: document.getElementById('banReason').value.trim()
  });
  await saveState(false);
  e.target.reset();
  renderAdminBanList();
  showAlert('Security rule added to Blocked Registry.', 'danger');
});

/* ==========================================================================
   8. NAVIGATION & INITIALISATION (WITH TAB & AUTH PERSISTENCE)
   ========================================================================== */
function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function activateTab(tabId) {
  const targetBtn = document.querySelector(`.nav-btn[data-tab="${tabId}"]`);
  const targetPanel = document.getElementById(tabId);
  if (!targetBtn || !targetPanel) return;

  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
  targetBtn.classList.add('active');
  targetPanel.classList.add('active');
  localStorage.setItem(STORAGE_KEYS.ACTIVE_TAB, tabId);
}

function activateSubTab(subTabId) {
  const targetBtn = document.querySelector(`.sub-nav-btn[data-subtab="${subTabId}"]`);
  const targetPanel = document.getElementById(subTabId);
  if (!targetBtn || !targetPanel) return;

  document.querySelectorAll('.sub-nav-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('#adminWorkspace .sub-panel').forEach(p => p.classList.add('hidden'));
  targetBtn.classList.add('active');
  targetPanel.classList.remove('hidden');
  localStorage.setItem(STORAGE_KEYS.ACTIVE_SUBTAB, subTabId);
}

document.querySelectorAll('.nav-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    activateTab(btn.getAttribute('data-tab'));
  });
});

document.querySelectorAll('.sub-nav-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    activateSubTab(btn.getAttribute('data-subtab'));
  });
});

window.addEventListener('DOMContentLoaded', async () => {
  const lastTab = localStorage.getItem(STORAGE_KEYS.ACTIVE_TAB);
  if (lastTab) activateTab(lastTab);

  const lastSubTab = localStorage.getItem(STORAGE_KEYS.ACTIVE_SUBTAB);
  if (lastSubTab) activateSubTab(lastSubTab);

  const isAdminUnlocked = localStorage.getItem(STORAGE_KEYS.ADMIN_UNLOCKED) === 'true';
  if (isAdminUnlocked) {
    document.getElementById('adminPasscodeInput').value = localStorage.getItem(STORAGE_KEYS.ADMIN_PASS) || 'ADMIN-2027';
    document.getElementById('adminWorkspace').classList.remove('hidden');
    const unlockBtn = document.getElementById('unlockAdminBtn');
    if (unlockBtn) unlockBtn.textContent = 'Admin Unlocked ✓';
  }

  await computeDeviceTelemetry();
  await loadState();

  const savedEmail = localStorage.getItem(STORAGE_KEYS.READER_EMAIL);
  if (savedEmail) {
    document.getElementById('readerEmailInput').value = savedEmail;
  }
  const savedGemini = localStorage.getItem(STORAGE_KEYS.GEMINI_KEY);
  if (savedGemini) {
    document.getElementById('byokGeminiKey').value = savedGemini;
  }

  if (isAdminUnlocked) {
    renderAdminConsole();
  }

  const savedHostPass = localStorage.getItem(STORAGE_KEYS.HOST_AUTH);
  if (savedHostPass) {
    const hostSession = (appState.sessions || []).find(
      s => s.hostPasscode && s.hostPasscode.toLowerCase() === savedHostPass.toLowerCase()
    );
    if (hostSession) {
      document.getElementById('hostPasscodeInput').value = savedHostPass;
      activeHostSessionId = hostSession.id;
      populateHostStudio(hostSession);
      document.getElementById('hostStudioWorkspace').classList.remove('hidden');
    }
  }

  renderReaderPortal();
});
