/* ──────────────────────────────────────────────────────────────
   Secondary views for the Iarsma redesign mockup.
   Renders clickable Calendar / Contacts / Approvals / Activity /
   Settings screens into #otherView. Reuses globals from the main
   script: colorFor(), KIND_LABEL, setTheme(), openCompose().
   ────────────────────────────────────────────────────────────── */
(function () {
  function av(name, kind, initials, size) {
    const s = size || 34;
    return `<span class="av2" title="${KIND_LABEL[kind] || ''}" style="width:${s}px;height:${s}px;font-size:${Math.round(s * 0.4)}px;background:${colorFor(name, kind)}">${initials}</span>`;
  }
  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');

  /* ── APPROVALS ──────────────────────────────────────────── */
  const APPROVALS = [
    { agent: 'Triage agent', tool: 'mail.modify', scopes: ['mail:modify'], time: '4 min ago',
      summary: 'Label 4 messages in Inbox as “Receipts”.',
      preview: ['Add label <code>Receipts</code> to <b>4</b> messages', 'No messages moved or deleted', 'Reversible for 30 days'],
      raw: '{\n  "tool": "mail.modify",\n  "op": "addKeyword",\n  "keyword": "$receipts",\n  "messageIds": ["m_18a", "m_2b0", "m_41c", "m_55e"]\n}' },
    { agent: 'Scheduling agent', tool: 'event.create', scopes: ['calendar:write'], time: '22 min ago',
      summary: 'Hold “Design review”, Thu 2:00–3:00 PM on Work.',
      preview: ['Create event <b>Design review</b>', 'Thu 2:00 PM \u2192 3:00 PM \u00b7 calendar <code>Work</code>', 'Invites: 3 attendees (no mail sent yet)'],
      raw: '{\n  "tool": "event.create",\n  "calendarId": "work",\n  "title": "Design review",\n  "start": "2026-06-04T14:00",\n  "duration": "PT1H"\n}' },
    { agent: 'Triage agent', tool: 'files.propose_write', scopes: ['files:write'], time: '1 hour ago',
      summary: 'docs/triage-scopes.md — clarify least-privilege defaults.',
      preview: ['Write <code>docs/triage-scopes.md</code>', '<span class="diff-add">+12</span> / <span class="diff-del">\u22123</span> lines', 'Commit on branch <code>main</code>'],
      raw: '{\n  "tool": "files.propose_write",\n  "path": "docs/triage-scopes.md",\n  "message": "clarify least-privilege defaults",\n  "baseSha": "9fab317"\n}' },
  ];
  function apvView() {
    return `<div class="viewpanel">
      <div class="vp-head"><h2 class="vp-title">Approvals</h2><span class="vp-sub" id="apvSub">3 pending</span><span class="spacer"></span>
        <div class="seg" id="apvTabs">
          <button data-v="pending" aria-pressed="true">Pending</button>
          <button data-v="approved">Approved</button>
          <button data-v="denied">Denied</button>
          <button data-v="all">All</button>
        </div>
      </div>
      <div class="vp-body" id="apvBody">${APPROVALS.map(apvCard).join('')}</div>
    </div>`;
  }
  function apvCard(a, i) {
    return `<div class="apv-card" data-i="${i}">
      <div class="apv-top">
        ${av(a.agent, 'agent', a.agent.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase(), 34)}
        <span class="nm">${a.agent}</span>
        <span class="badge agent">Agent</span>
        <span class="badge tool">${a.tool}</span>
        <span class="time">${a.time}</span>
      </div>
      <div class="apv-scopes">${a.scopes.map(s => `<span class="badge mono">${s}</span>`).join('')}</div>
      <div class="apv-summary">${a.summary}</div>
      <div class="preview">
        <div class="preview-title">What changes</div>
        <ul class="preview-list">${a.preview.map(p => `<li>${p}</li>`).join('')}</ul>
        <div style="margin-top:8px"><button class="linkbtn" data-raw>View raw JSON</button></div>
        <pre class="apv-raw">${esc(a.raw)}</pre>
      </div>
      <div class="apv-actions">
        <button class="btn ok sm" data-act="approve"><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>Approve</button>
        <button class="btn btn-destructive sm" data-act="deny">Deny</button>
        <button class="btn btn-ghost sm" data-act="open">Open in Activity</button>
      </div>
    </div>`;
  }

  /* ── ACTIVITY ───────────────────────────────────────────── */
  const ACTS = [
    { actor: 'You', kind: 'human', i: 'BE', cls: 'ui', time: 'Today 9:42', action: 'auth.signin', mode: 'commit' },
    { actor: 'Triage agent', kind: 'agent', i: 'TA', cls: 'agent', time: 'Today 9:40', action: 'mail.modify', mode: 'commit',
      params: '{ "op": "addKeyword", "keyword": "$receipts", "count": 4 }', undo: true },
    { actor: 'Scheduling agent', kind: 'agent', i: 'SA', cls: 'agent', time: 'Today 9:18', action: 'event.create', mode: 'preview' },
    { actor: 'You', kind: 'human', i: 'BE', cls: 'ui', time: 'Today 8:55', action: 'mail.send', mode: 'commit', undo: true },
    { actor: 'Triage agent', kind: 'agent', i: 'TA', cls: 'agent', time: 'Yest 18:30', action: 'files.propose_write', mode: 'preview' },
  ];
  function actView() {
    return `<div class="viewpanel">
      <div class="vp-head"><h2 class="vp-title">Activity</h2><span class="spacer"></span>
        <div class="act-int"><span class="badge ok" role="status"><svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>Chain verified</span>
        <button class="btn btn-ghost sm" id="actVerify">Re-verify</button></div>
      </div>
      <div class="vp-body">
        <div class="act-filters">
          ${['Actor|All actors|You|Triage agent|Scheduling agent', 'Action|All actions|mail.modify|mail.send|event.create', 'Mode|All|preview|commit', 'When|All time|Last hour|Today|Last 7 days'].map(f => {
            const [lbl, ...opts] = f.split('|');
            return `<div class="act-fg"><label>${lbl}</label><select class="sel">${opts.map(o => `<option>${o}</option>`).join('')}</select></div>`;
          }).join('')}
        </div>
        <table class="tbl"><thead><tr><th>Time</th><th>Actor</th><th>Action</th><th>Mode</th><th></th><th></th></tr></thead>
        <tbody id="actBody">${ACTS.map(actRow).join('')}</tbody></table>
        <div class="act-pager"><button class="btn btn-ghost sm" disabled>Previous</button><span class="vp-sub">Page 1 of 9</span><button class="btn btn-ghost sm">Next</button></div>
      </div>
    </div>`;
  }
  function actRow(a, i) {
    const modeBadge = a.mode === 'commit' ? `<span class="badge">commit</span>` : `<span class="badge warn">preview</span>`;
    return `<tr data-i="${i}">
      <td class="mono" style="color:var(--text-2)">${a.time}</td>
      <td><span class="actor">${av(a.actor, a.kind, a.i, 26)}<span class="nm">${a.actor}</span><span class="badge ${a.kind === 'agent' ? 'agent' : 'sys'}">${a.cls}</span></span></td>
      <td class="mono">${a.action}</td>
      <td>${modeBadge}</td>
      <td>${a.undo ? '<button class="linkbtn" data-undo>Undo</button>' : ''}</td>
      <td style="text-align:right"><button class="iconbtn" data-exp aria-label="Expand" style="width:26px;height:26px"><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg></button></td>
    </tr>${a.params ? `<tr class="act-detail" data-detail="${i}" style="display:none"><td colspan="6"><div class="act-kv"><b>params</b> ${esc(a.params)}<br><b>hash</b> 3f9a1c\u2026e22b &nbsp; <b>prev</b> 7c0b48\u2026a91d &nbsp; <b>seq</b> 184</div></td></tr>` : ''}`;
  }

  /* ── SETTINGS ───────────────────────────────────────────── */
  const SET_SECTIONS = [['appearance', 'Appearance'], ['identities', 'Identities'], ['tokens', 'Agent tokens'], ['files', 'Files'], ['account', 'Account']];
  let setActive = 'appearance';
  function setView() {
    return `<div class="viewpanel"><div class="vp-head"><h2 class="vp-title">Settings</h2></div>
      <div class="vp-body"><div class="set-wrap">
        <nav class="set-nav" id="setNav">${SET_SECTIONS.map(([id, lbl]) => `<button data-s="${id}" class="${id === setActive ? 'active' : ''}">${lbl}</button>`).join('')}</nav>
        <div id="setPanel">${setPanel(setActive)}</div>
      </div></div></div>`;
  }
  function setPanel(s) {
    if (s === 'appearance') return `
      <div class="set-section"><div class="set-h3">Appearance</div><div class="set-desc">Theme, accent and density. These mirror the quick controls in the sidebar footer.</div>
        <div class="set-row"><span class="set-label">Theme</span>
          <div class="seg" id="setTheme"><button data-v="light" aria-pressed="${document.documentElement.getAttribute('data-theme') !== 'dark'}">Light</button><button data-v="dark" aria-pressed="${document.documentElement.getAttribute('data-theme') === 'dark'}">Dark</button><button data-v="system">System</button></div>
        </div>
        <div class="set-row"><span class="set-label">Accent</span><div class="set-appearance-swatches" id="setSwatches"></div></div>
        <div class="set-row"><span class="set-label">Density</span>
          <div class="seg" id="setDensity"><button data-v="0.85">Dense</button><button data-v="1" aria-pressed="true">Normal</button><button data-v="1.25">Spacious</button></div>
        </div>
      </div>`;
    if (s === 'tokens') return `
      <div class="set-section"><div class="set-h3">Issue a new agent token</div><div class="set-desc">Each agent gets its own scoped, expiring credential — no shared keys.</div>
        <div class="set-row"><span class="set-label">Agent name</span><input class="set-input" placeholder="e.g. Triage agent" /></div>
        <div class="scope-group"><div class="sg-title">Mail</div><div class="scope-chips">${['mail:read', 'mail:draft', 'mail:send', 'mail:modify', 'mail:delete'].map((s, i) => `<button class="chip-toggle" aria-pressed="${i < 2}">${s}</button>`).join('')}</div></div>
        <div class="scope-group"><div class="sg-title">Calendar &amp; Contacts</div><div class="scope-chips">${['calendar:read', 'calendar:write', 'contacts:read', 'contacts:write'].map(s => `<button class="chip-toggle" aria-pressed="false">${s}</button>`).join('')}</div></div>
        <div class="scope-group"><div class="sg-title">Files &amp; Memory</div><div class="scope-chips">${['files:read', 'files:write', 'memory:annotations.read', 'memory:profile.propose'].map(s => `<button class="chip-toggle" aria-pressed="false">${s}</button>`).join('')}</div></div>
        <div class="set-row"><span class="set-label">Lifetime</span><div class="seg"><button>1 hour</button><button aria-pressed="true">1 day</button><button>7 days</button><button>30 days</button></div></div>
        <button class="btn btn-primary" id="setIssue">Issue token</button>
      </div>
      <div class="set-section"><div class="set-h3">Active tokens</div>
        <table class="tbl"><thead><tr><th>Name</th><th>Scopes</th><th>Last used</th><th>Expires</th><th>Status</th><th></th></tr></thead><tbody>
          ${[['Triage agent', ['mail:read', 'mail:modify'], '4 min ago', 'in 18h', 1], ['Scheduling agent', ['calendar:write'], '22 min ago', 'in 5d', 1], ['Old importer', ['mail:read'], '12 days ago', 'expired', 0]].map(t => `<tr>
            <td style="font-weight:600">${t[0]}</td><td>${t[1].map(s => `<span class="badge mono">${s}</span>`).join(' ')}</td><td class="vp-sub" style="color:var(--text-2)">${t[2]}</td><td class="vp-sub" style="color:var(--text-2)">${t[3]}</td>
            <td>${t[4] ? '<span class="badge ok">Active</span>' : '<span class="badge">Revoked</span>'}</td>
            <td>${t[4] ? '<button class="btn btn-destructive sm">Revoke</button>' : ''}</td></tr>`).join('')}
        </tbody></table>
      </div>`;
    if (s === 'files') return `<div class="set-section"><div class="set-h3">Files / GitHub</div><div class="set-desc">Connect a repository to browse and edit files, and to let agents propose writes.</div>
      <div class="set-secret" style="border-color:var(--border);background:var(--surface-2)"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>Connected to <code>r3moteBee/iarsma</code> <span class="vp-sub">(branch: main)</span><span class="spacer"></span><button class="btn btn-ghost sm">Disconnect</button></div></div>`;
    if (s === 'identities') return `<div class="set-section"><div class="set-h3">Sending identities</div><div class="set-desc">Addresses you can send “From”.</div>
      <table class="tbl"><thead><tr><th>Name</th><th>Address</th><th>Default</th></tr></thead><tbody>
      <tr><td style="font-weight:600">Brent Ellis</td><td class="mono">brent@r3motely.com</td><td><span class="badge ok">Default</span></td></tr>
      <tr><td style="font-weight:600">Support</td><td class="mono">support@r3motely.com</td><td></td></tr></tbody></table></div>`;
    return `<div class="set-section"><div class="set-h3">Account</div>
      <div class="set-row"><span class="set-label">Signed in as</span><span>brent@r3motely.com</span></div>
      <div class="set-row"><span class="set-label">Server</span><span class="mono vp-sub" style="color:var(--text-2)">sw-mail.r3motely.com</span></div>
      <button class="btn btn-destructive sm">Sign out</button></div>`;
  }

  /* ── CONTACTS ───────────────────────────────────────────── */
  const CONTACTS = [
    { nm: 'Dana Holt', em: 'dana@r3motely.com', org: 'Engineering · iarsma', phone: '+1 (415) 555-0142' },
    { nm: 'Marcus Reed', em: 'marcus@r3motely.com', org: 'Product', phone: '+1 (415) 555-0188' },
    { nm: 'Nadia Okonkwo', em: 'nadia@r3motely.com', org: 'Security', phone: '+1 (628) 555-0119' },
    { nm: 'Priya Lal', em: 'priya@r3motely.com', org: 'Design', phone: '+1 (510) 555-0173' },
  ];
  let conSel = 2;
  function conView() {
    const groups = {};
    CONTACTS.forEach((c, i) => { const L = c.nm[0].toUpperCase(); (groups[L] = groups[L] || []).push(i); });
    const list = Object.keys(groups).sort().map(L => `<div class="con-sec">${L}</div>` + groups[L].map(i => conItem(CONTACTS[i], i)).join('')).join('');
    return `<div class="viewpanel"><div class="con-wrap">
      <div class="con-list">
        <div class="con-search"><input class="set-input" type="search" placeholder="Search contacts" aria-label="Search contacts" /><button class="btn btn-primary sm">Add</button></div>
        <div class="con-scroll" id="conScroll">${list}</div>
      </div>
      <div class="con-detail" id="conDetail">${conDetail(CONTACTS[conSel])}</div>
    </div></div>`;
  }
  function conItem(c, i) {
    return `<button class="con-item ${i === conSel ? 'sel' : ''}" data-i="${i}">${av(c.nm, 'human', c.nm.split(' ').map(w => w[0]).join('').slice(0, 2), 32)}<span class="ci-txt"><span class="ci-nm">${c.nm}</span><span class="ci-em">${c.em}</span></span></button>`;
  }
  function conDetail(c) {
    return `<div class="con-dhead">${av(c.nm, 'human', c.nm.split(' ').map(w => w[0]).join('').slice(0, 2), 64)}
        <div><h2 class="con-name">${c.nm}</h2><div class="con-org">${c.org}</div></div>
        <div class="con-dactions"><button class="btn btn-primary sm" id="conMsg"><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="M22 7l-10 7L2 7"/></svg>Message</button><button class="btn btn-secondary sm">Edit</button><button class="btn btn-destructive sm">Delete</button></div>
      </div>
      <div class="con-sectitle">Email</div><div class="con-detrow"><span class="lbl">work</span><span>${c.em}</span></div>
      <div class="con-sectitle">Phone</div><div class="con-detrow"><span class="lbl">mobile</span><span>${c.phone}</span></div>
      <div class="con-sectitle">Organization</div><div class="con-detrow"><span>${c.org}</span></div>`;
  }

  /* ── CALENDAR ───────────────────────────────────────────── */
  const CAL_DEFS = { personal: ['Personal', 'hsl(150 50% 45%)'], work: ['Work', 'hsl(205 90% 52%)'], agent: ['Agent holds', 'var(--accent)'] };
  const CAL_EVENTS = [
    { d: 3, cal: 'work', t: '9:00', title: 'Standup' },
    { d: 8, cal: 'work', t: '10:00', title: 'Sprint planning' },
    { d: 8, cal: 'personal', t: '12:30', title: 'Lunch w/ Sam' },
    { d: 8, cal: 'work', t: '15:00', title: '1:1 with Dana' },
    { d: 12, cal: 'agent', t: '16:00', title: 'Hold: review prep', tentative: true },
    { d: 17, cal: 'personal', t: '11:00', title: 'Dentist' },
    { d: 22, cal: 'work', t: '14:00', title: 'Design review' },
  ];
  const calState = { offset: 0, view: 'month', hidden: new Set() };
  const MN = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  function calColor(cal) { return CAL_DEFS[cal][1]; }
  function calView() {
    return `<div class="viewpanel"><div class="cal-wrap">
      <div class="cal-rail">
        <button class="btn btn-primary sm" id="calNew" style="width:100%;margin-bottom:14px"><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>New event</button>
        <h4>My calendars</h4>
        ${Object.keys(CAL_DEFS).map(k => `<label class="cal-cal" style="--cc:${CAL_DEFS[k][1]}"><input type="checkbox" data-cal="${k}" ${calState.hidden.has(k) ? '' : 'checked'}/><span class="dot"></span>${CAL_DEFS[k][0]}</label>`).join('')}
      </div>
      <div class="cal-main" id="calMain">${calBody()}</div>
    </div></div>`;
  }
  function calBody() {
    const now = new Date();
    const base = new Date(now.getFullYear(), now.getMonth() + calState.offset, 1);
    const head = `<div class="cal-head">
        <span class="cal-monthlabel">${MN[base.getMonth()]} ${base.getFullYear()}</span>
        <span class="cal-navbtns"><button class="iconbtn" data-nav="-1" aria-label="Previous"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg></button>
        <button class="btn btn-ghost sm" data-nav="0">Today</button>
        <button class="iconbtn" data-nav="1" aria-label="Next"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg></button></span>
        <span class="spacer"></span>
        <div class="seg" id="calSeg"><button data-v="month" aria-pressed="${calState.view === 'month'}">Month</button><button data-v="week" aria-pressed="${calState.view === 'week'}">Week</button><button data-v="day" aria-pressed="${calState.view === 'day'}">Day</button></div>
      </div>`;
    return head + (calState.view === 'month' ? calMonth(base, now) : calTime(base, now));
  }
  function calMonth(base, now) {
    const y = base.getFullYear(), m = base.getMonth();
    const start = new Date(y, m, 1).getDay();
    const dim = new Date(y, m + 1, 0).getDate();
    const cells = [];
    for (let i = 0; i < start; i++) cells.push(null);
    for (let d = 1; d <= dim; d++) cells.push(d);
    while (cells.length % 7) cells.push(null);
    const dow = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(d => `<div class="cal-dow">${d}</div>`).join('');
    const body = cells.map(d => {
      if (d === null) return `<div class="cal-cell off"></div>`;
      const isToday = calState.offset === 0 && d === now.getDate();
      const evs = CAL_EVENTS.filter(e => e.d === d && !calState.hidden.has(e.cal));
      const chips = evs.slice(0, 3).map(e => `<div class="cal-chip ${e.tentative ? 'tentative' : ''}" style="background:${calColor(e.cal)}" title="${e.title}"><span class="t">${e.t}</span> ${e.title}</div>`).join('');
      const more = evs.length > 3 ? `<div class="cal-more">+${evs.length - 3} more</div>` : '';
      return `<div class="cal-cell ${isToday ? 'today' : ''}"><span class="cal-daynum">${d}</span>${chips}${more}</div>`;
    }).join('');
    return `<div class="cal-grid">${dow}${body}</div>`;
  }
  function calTime(base, now) {
    const isDay = calState.view === 'day';
    const cols = isDay ? 1 : 7;
    const hours = []; for (let h = 7; h <= 20; h++) hours.push(h);
    const fmtH = h => (h === 12 ? '12 PM' : h > 12 ? (h - 12) + ' PM' : h + ' AM');
    // events on "today" column only, for illustration
    const todays = CAL_EVENTS.filter(e => e.d === now.getDate() && !calState.hidden.has(e.cal));
    const dayEvents = todays.length ? todays : [{ cal: 'work', t: '10:00', title: 'Sprint planning' }, { cal: 'agent', t: '16:00', title: 'Hold: review prep', tentative: true }];
    const rows = hours.map(h => `<div class="cal-hr-label">${fmtH(h)}</div><div class="cal-hr-slot">${dayEvents.filter(e => parseInt(e.t) === (h > 12 && e.t.indexOf(':') ? h : h) && Math.floor(parseInt(e.t)) === h).map(e => `<div class="cal-ev ${e.tentative ? 'tentative' : ''}" style="background:${e.tentative ? 'transparent' : calColor(e.cal)};${e.tentative ? 'border:1px dashed var(--accent);color:var(--accent-active)' : ''};top:4px;height:40px">${e.t} ${e.title}</div>`).join('')}</div>`).join('');
    const nowTop = ((now.getHours() - 7) * 48) + (now.getMinutes() / 60 * 48);
    const nowLine = (now.getHours() >= 7 && now.getHours() <= 20) ? `<div class="cal-now" style="top:${28 + nowTop}px"></div>` : '';
    return `<div class="cal-timegrid"><div class="cal-allday"><div class="lbl">all-day</div><div class="slot"><span class="badge" style="background:${calColor('personal')};color:#fff">Out of office</span></div></div>
      <div class="cal-hours" style="position:relative">${rows}${nowLine}</div></div>`;
  }

  /* ── Wiring ─────────────────────────────────────────────── */
  function wire(view, ov) {
    if (view === 'approvals') {
      ov.querySelectorAll('#apvTabs button').forEach(b => b.onclick = () => { ov.querySelectorAll('#apvTabs button').forEach(x => x.setAttribute('aria-pressed', 'false')); b.setAttribute('aria-pressed', 'true'); });
      ov.querySelectorAll('.apv-card').forEach(card => {
        card.querySelector('[data-raw]').onclick = () => card.querySelector('.apv-raw').classList.toggle('open');
        const actions = card.querySelector('.apv-actions');
        card.querySelectorAll('[data-act]').forEach(b => b.onclick = () => {
          const a = b.dataset.act;
          if (a === 'open') { goView('activity'); return; }
          actions.innerHTML = a === 'approve'
            ? '<span class="apv-done ok">\u2713 Approved \u2014 committed to the action log</span>'
            : '<span class="apv-done no">\u2715 Denied</span>';
          const sub = document.getElementById('apvSub');
          if (sub) { const n = Math.max(0, parseInt(sub.textContent) - 1); sub.textContent = n + ' pending'; }
        });
      });
    }
    if (view === 'activity') {
      ov.querySelectorAll('[data-exp]').forEach(b => b.onclick = () => {
        const tr = b.closest('tr'); const det = tr.nextElementSibling;
        if (det && det.classList.contains('act-detail')) { const open = det.style.display !== 'none'; det.style.display = open ? 'none' : ''; b.style.transform = open ? '' : 'rotate(180deg)'; }
      });
      const v = ov.querySelector('#actVerify'); if (v) v.onclick = () => { v.textContent = 'Verified \u2713'; };
    }
    if (view === 'settings') {
      const panel = ov.querySelector('#setPanel');
      ov.querySelectorAll('#setNav button').forEach(b => b.onclick = () => {
        setActive = b.dataset.s;
        ov.querySelectorAll('#setNav button').forEach(x => x.classList.toggle('active', x === b));
        panel.innerHTML = setPanel(setActive);
        wireSettingsPanel(panel);
      });
      wireSettingsPanel(panel);
    }
    if (view === 'contacts') {
      ov.querySelectorAll('.con-item').forEach(it => it.onclick = () => {
        conSel = +it.dataset.i;
        ov.querySelectorAll('.con-item').forEach(x => x.classList.toggle('sel', x === it));
        ov.querySelector('#conDetail').innerHTML = conDetail(CONTACTS[conSel]);
        const msg = ov.querySelector('#conMsg'); if (msg) msg.onclick = openCompose;
      });
      const msg = ov.querySelector('#conMsg'); if (msg) msg.onclick = openCompose;
    }
    if (view === 'calendar') wireCalendar(ov);
  }
  function wireSettingsPanel(panel) {
    // Appearance controls actually drive the page
    const sw = panel.querySelector('#setSwatches');
    if (sw) {
      const ACC = [['Ember', 18, 100, 60], ['Amber', 38, 95, 55], ['Sky', 205, 90, 52], ['Violet', 265, 75, 62], ['Teal', 175, 65, 42], ['Rose', 345, 80, 60]];
      sw.innerHTML = ACC.map(([n, h, s, l], i) => `<button class="swatch" title="${n}" aria-label="${n}" aria-pressed="${i === 0}" style="--sw:hsl(${h} ${s}% ${l}%)"></button>`).join('');
      sw.querySelectorAll('.swatch').forEach((b, i) => b.onclick = () => {
        const [, h, s, l] = ACC[i];
        document.documentElement.style.setProperty('--accent-h', h);
        document.documentElement.style.setProperty('--accent-s', s + '%');
        document.documentElement.style.setProperty('--accent-l', l + '%');
        sw.querySelectorAll('.swatch').forEach(x => x.setAttribute('aria-pressed', 'false'));
        b.setAttribute('aria-pressed', 'true');
      });
    }
    panel.querySelectorAll('#setTheme button').forEach(b => b.onclick = () => { if (b.dataset.v !== 'system') setTheme(b.dataset.v); panel.querySelectorAll('#setTheme button').forEach(x => x.setAttribute('aria-pressed', x === b ? 'true' : 'false')); });
    panel.querySelectorAll('#setDensity button').forEach(b => b.onclick = () => { document.documentElement.style.setProperty('--density', b.dataset.v); panel.querySelectorAll('#setDensity button').forEach(x => x.setAttribute('aria-pressed', x === b ? 'true' : 'false')); });
    panel.querySelectorAll('.chip-toggle').forEach(c => c.onclick = () => c.setAttribute('aria-pressed', c.getAttribute('aria-pressed') === 'true' ? 'false' : 'true'));
    const iss = panel.querySelector('#setIssue'); if (iss) iss.onclick = () => { iss.textContent = 'Issued \u2713'; setTimeout(() => iss.textContent = 'Issue token', 1600); };
  }
  function wireCalendar(ov) {
    const main = ov.querySelector('#calMain');
    ov.querySelectorAll('[data-cal]').forEach(c => c.onchange = () => { if (c.checked) calState.hidden.delete(c.dataset.cal); else calState.hidden.add(c.dataset.cal); main.innerHTML = calBody(); wireCalendar(ov); });
    main.querySelectorAll('[data-nav]').forEach(b => b.onclick = () => { const n = +b.dataset.nav; calState.offset = n === 0 ? 0 : calState.offset + n; main.innerHTML = calBody(); wireCalendar(ov); });
    main.querySelectorAll('#calSeg button').forEach(b => b.onclick = () => { calState.view = b.dataset.v; main.innerHTML = calBody(); wireCalendar(ov); });
    const nw = ov.querySelector('#calNew'); if (nw) nw.onclick = openCompose;
  }

  window.renderSecondary = function (view, ov) {
    const fn = { approvals: apvView, activity: actView, settings: setView, contacts: conView, calendar: calView }[view];
    if (!fn) return false;
    ov.innerHTML = fn();
    wire(view, ov);
    return true;
  };
})();
