// ============================================================
// BIG TIME DYNASTY — app logic
// Data is fetched live from data.json on every page load, so this
// page always reflects whatever was last pushed to the repo.
// ============================================================

let DATA = null;
let currentTeam = null;

function fmtDate(d){
  return new Date(d).toLocaleString('en-US', { month:'short', day:'numeric', hour:'numeric', minute:'2-digit' });
}

async function loadData(){
  const res = await fetch('data.json?t=' + Date.now());
  DATA = await res.json();
  DATA._updatedAt = DATA._updatedAt || Date.now();
}

function ownerColor(name){
  return (DATA.owner_color && DATA.owner_color[name]) || '#888';
}

// ---------------- rendering: standings ----------------
function renderStandings(){
  const ladder = document.getElementById('ladder');
  const maxCsv = Math.max(...DATA.teams.map(t => t.avg_csv));
  ladder.innerHTML = DATA.teams.map(t => {
    const pct = (t.avg_csv / maxCsv * 100).toFixed(1);
    return `
      <div class="ladder-row ${t.rank===1?'rank-1':''}" data-team="${t.name}">
        <div class="fillbar" style="width:${pct}%; background:${t.color};"></div>
        <div class="ladder-rank">${t.rank}</div>
        <div class="ladder-main">
          <div class="swatch" style="background:${t.color}"></div>
          <div class="ladder-name">${t.name}${DATA.team_tags && DATA.team_tags[t.name] ? `<span class="ladder-crown">${DATA.team_tags[t.name]}</span>` : ''}</div>
        </div>
        <div class="ladder-stats">
          <div class="stat-block"><span class="v">${t.avg_csv.toFixed(2)}</span><span class="l">Avg CSV</span></div>
          <div class="stat-block"><span class="v">${t.roster}</span><span class="l">Roster</span></div>
          <div class="stat-block"><span class="v">${t.avg_age.toFixed(1)}</span><span class="l">Avg Age</span></div>
        </div>
      </div>`;
  }).join('');

  ladder.querySelectorAll('.ladder-row').forEach(row=>{
    row.addEventListener('click', ()=> openTeam(row.dataset.team));
  });

  // pulse: best/worst starting lineup, best/worst bench — all by avg CSV
  const teamStats = DATA.teams.map(t => {
    const s = DATA.scouting[t.name];
    const starterAvg = s ? s.starter_avg : null;
    const starterNames = new Set((s ? s.starters : []).map(x => x.name));
    const roster = DATA.players.filter(p => p.owner === t.name);
    const bench = roster.filter(p => !starterNames.has(p.name) && p.csv != null);
    const benchAvg = bench.length ? bench.reduce((sum,p)=>sum+p.csv,0)/bench.length : null;
    return { ...t, starterAvg, benchAvg };
  });
  const byStarter = [...teamStats].filter(t=>t.starterAvg!=null).sort((a,b)=>b.starterAvg-a.starterAvg);
  const byBench = [...teamStats].filter(t=>t.benchAvg!=null).sort((a,b)=>b.benchAvg-a.benchAvg);
  const pulse = document.getElementById('pulse');
  pulse.innerHTML = [
    ['Best starting lineup', byStarter[0], byStarter[0].starterAvg],
    ['Worst starting lineup', byStarter[byStarter.length-1], byStarter[byStarter.length-1].starterAvg],
    ['Best bench', byBench[0], byBench[0].benchAvg],
    ['Worst bench', byBench[byBench.length-1], byBench[byBench.length-1].benchAvg],
  ].map(([label, t, val])=>`
    <div class="pos-stat-row">
      <div class="pos-stat-rank">${label}</div>
      <div style="display:flex;align-items:center;gap:8px;"><div class="swatch" style="width:8px;height:8px;background:${t.color}"></div>${t.name}</div>
      <div class="csv-val">${val.toFixed(2)}</div>
    </div>`).join('');

  const byN = document.getElementById('byNumbers');
  const slotLabels = ['QB','RB1','RB2','WR1','WR2','TE','FLEX1','FLEX2','FLEX3','S-FLEX'];
  const slotBest = slotLabels.map((label, i) => {
    const candidates = DATA.teams.map(t => {
      const s = DATA.scouting[t.name];
      if(!s || !s.starters || !s.starters[i]) return null;
      const starter = s.starters[i];
      const player = DATA.players.find(p => p.name === starter.name);
      const csv = player ? player.csv : null;
      if(csv == null) return null;
      return { team: t, playerName: starter.name, csv };
    }).filter(Boolean);
    candidates.sort((a,b)=>b.csv-a.csv);
    return { label, best: candidates[0] };
  });
  byN.innerHTML = slotBest.filter(x=>x.best).map(({label, best})=>`
    <div class="pos-stat-row">
      <div class="pos-stat-rank">${label}</div>
      <div style="display:flex;align-items:center;gap:8px;"><div class="swatch" style="width:8px;height:8px;background:${best.team.color}"></div>${best.team.name} <span style="color:var(--muted2)">&middot; ${best.playerName}</span></div>
      <div class="csv-val">${best.csv.toFixed(2)}</div>
    </div>`).join('');
}

// ---------------- rendering: rankings table (single, mode-toggled) ----------------
function makeRankingsController(cfg){
  const state = { key: cfg.sortDefault || 'rank', dir: (cfg.sortDefault === 'csv' ? 'desc' : 'asc'), mode: 'dynasty' };

  function populateTeamFilter(){
    const sel = document.getElementById(cfg.ids.teamFilter);
    const names = DATA.teams.map(t=>t.name).sort();
    sel.innerHTML = '<option value="">All teams</option>' +
      names.map(n=>`<option value="${n}">${n}</option>`).join('') +
      '<option value="__FA__">Free Agents</option>';
  }

  function csvOf(p){ return state.mode === 'dynasty' ? p.csv_dynasty : p.csv_2026; }

  function getFilteredSorted(){
    const q = document.getElementById(cfg.ids.search).value.trim().toLowerCase();
    const pos = document.getElementById(cfg.ids.posFilter).value;
    const team = document.getElementById(cfg.ids.teamFilter).value;

    let pool = DATA[cfg.dataKey].filter(p => csvOf(p) != null);
    let ranked = pool
      .slice()
      .sort((a,b)=>(csvOf(b)||-1)-(csvOf(a)||-1))
      .map((p,i)=>({...p, rank: i+1, csv: csvOf(p)}));

    let filtered = ranked.filter(p=>{
      if(q && !p.name.toLowerCase().includes(q)) return false;
      if(pos && p.pos !== pos) return false;
      if(team === '__FA__' && p.owner) return false;
      if(team && team !== '__FA__' && p.owner !== team) return false;
      return true;
    });

    const { key, dir } = state;
    filtered.sort((a,b)=>{
      let av = a[key], bv = b[key];
      if(key === 'owner'){ av = av||'zzz'; bv = bv||'zzz'; }
      if(typeof av === 'string'){ av = av.toLowerCase(); bv = (bv||'').toLowerCase(); }
      if(av == null) av = -Infinity;
      if(bv == null) bv = -Infinity;
      if(av < bv) return dir==='asc' ? -1 : 1;
      if(av > bv) return dir==='asc' ? 1 : -1;
      return 0;
    });
    return filtered;
  }

  function render(){
    const rows = getFilteredSorted();
    document.getElementById(cfg.ids.resultCount).textContent = `${rows.length} players`;
    const body = document.getElementById(cfg.ids.body);
    body.innerHTML = rows.slice(0, 400).map(p=>`
      <tr>
        <td class="rank-num">${p.rank}</td>
        <td>${p.name}</td>
        <td><span class="pos-pill pos-${p.pos}">${p.pos}</span></td>
        <td class="mono" style="color:var(--muted)">${p.team||'—'}</td>
        <td class="mono" style="color:var(--muted)">${p.age ? p.age.toFixed(1) : '—'}</td>
        <td class="csv-val">${p.csv!=null ? p.csv.toFixed(2) : '—'}</td>
        <td class="mono" style="color:var(--muted)">${p.season_proj!=null ? p.season_proj.toFixed(1) : '—'}</td>
        <td class="mono" style="color:var(--muted)">${p.week1_proj!=null ? p.week1_proj.toFixed(1) : '—'}</td>
        <td>${p.owner ? `<span class="owner-pill" data-team="${p.owner}"><span class="swatch" style="background:${ownerColor(p.owner)}"></span>${p.owner}</span>` : '<span style="color:var(--muted2)">Free agent</span>'}</td>
      </tr>`).join('');

    body.querySelectorAll('.owner-pill').forEach(el=>{
      el.addEventListener('click', ()=> openTeam(el.dataset.team));
    });

    document.querySelectorAll(`#view-${cfg.viewId} thead th`).forEach(th=>{
      th.classList.toggle('sorted', th.dataset.key === state.key);
    });
  }

  function setMode(mode){
    state.mode = mode;
    document.getElementById('rankingsSub').textContent = mode === 'dynasty'
      ? 'Consensus of FantasyPros, KTC and PFF · projections from Sleeper · click a team name to view their roster'
      : 'Consensus of FantasyPros and PFF · projections from Sleeper · season-long/redraft value, not dynasty · click a team name to view their roster';
    document.getElementById('csvHeaderLabel').textContent = mode === 'dynasty' ? 'Dynasty CSV' : '2026 CSV';
    document.querySelectorAll('#rankModeTabs button').forEach(b=>{
      b.classList.toggle('active', b.dataset.mode === mode);
    });
    render();
  }

  function init(){
    populateTeamFilter();
    render();
    document.getElementById(cfg.ids.search).addEventListener('input', render);
    document.getElementById(cfg.ids.posFilter).addEventListener('change', render);
    document.getElementById(cfg.ids.teamFilter).addEventListener('change', render);
    document.querySelectorAll(`#view-${cfg.viewId} thead th[data-key]`).forEach(th=>{
      th.addEventListener('click', ()=>{
        const key = th.dataset.key;
        if(state.key === key){ state.dir = state.dir==='asc'?'desc':'asc'; }
        else{ state.key = key; state.dir = key==='rank'||key==='age' ? 'asc' : (key==='csv'?'desc':'asc'); }
        render();
      });
    });
    document.getElementById('rankModeTabs').addEventListener('click', (e)=>{
      const btn = e.target.closest('button[data-mode]');
      if(!btn) return;
      setMode(btn.dataset.mode);
    });
  }

  return { init, render, populateTeamFilter, setMode };
}

let rankingsCtrl;

// ---------------- rendering: team detail ----------------
function openTeam(teamName){
  currentTeam = teamName;
  switchView('team');
  renderTeamDetail();
}

function renderTeamsOverview(){
  currentTeam = null;
  document.getElementById('backToStandings').style.display = 'none';
  const grid = DATA.teams.slice().sort((a,b)=>a.rank-b.rank).map(t => `
    <div class="team-card" data-team="${t.name}">
      <div class="swatch" style="background:${t.color}"></div>
      <div class="team-card-main">
        <div class="team-card-name">${t.name}</div>
        <div class="team-card-sub">Power rank #${t.rank} · ${t.avg_csv.toFixed(2)} CSV · ${t.roster} players</div>
      </div>
    </div>`).join('');
  document.getElementById('teamContent').innerHTML = `<div class="team-grid">${grid}</div>`;
  document.querySelectorAll('.team-card').forEach(el=>{
    el.addEventListener('click', ()=> openTeam(el.dataset.team));
  });
}

function renderTeamDetail(){
  document.getElementById('backToStandings').style.display = '';
  const t = DATA.teams.find(x=>x.name===currentTeam);
  const s = DATA.scouting[currentTeam];
  if(!t || !s){ document.getElementById('teamContent').innerHTML = '<p>No data.</p>'; return; }

  const posOrder = ['QB','RB','WR','TE'];
  const posHtml = posOrder.map(pos=>{
    const d = s.positions[pos];
    return `<div class="pos-stat-row">
      <div class="pos-stat-rank">${pos}</div>
      <div>${d.top}</div>
      <div class="csv-val">${d.stat.replace('Rank ','')}</div>
    </div>`;
  }).join('');

  const startersHtml = s.starters.map(st=>`
    <div class="starter-row">
      <div class="slot-tag">${st.slot}</div>
      <div>${st.name}</div>
      <div><span class="pos-pill pos-${st.pos}">${st.pos}</span></div>
    </div>`).join('');

  const roster = DATA.players.filter(p=>p.owner===currentTeam).sort((a,b)=>b.csv-a.csv);
  const rosterHtml = roster.map(p=>`
    <div class="starter-row">
      <div><span class="pos-pill pos-${p.pos}">${p.pos}</span></div>
      <div>${p.name} <span style="color:var(--muted2)">· ${p.team||''}${p.bye?' · bye '+p.bye:''}</span></div>
      <div class="csv-val">${p.ppg!=null ? p.ppg.toFixed(1)+' ppg' : (p.csv!=null ? p.csv.toFixed(2) : '—')}</div>
    </div>`).join('');

  const weekData = DATA.outlook.weekly_breakdown ? DATA.outlook.weekly_breakdown[currentTeam] : null;
  const maxProj = weekData ? Math.max(...weekData.map(w=>w.proj)) : 1;
  const weeklyHtml = weekData ? weekData.map(w=>{
    const pct = (w.proj/maxProj*100).toFixed(0);
    const dip = w.byes > 2;
    return `<div class="week-bar-row">
      <div class="week-bar-label">Wk ${w.week}</div>
      <div class="week-bar-track"><div class="week-bar-fill ${dip?'dip':''}" style="width:${pct}%"></div></div>
      <div class="week-bar-val">${w.proj.toFixed(1)}${w.byes ? ` <span class="bye-flag">${w.byes} bye${w.byes>1?'s':''}</span>` : ''}</div>
    </div>`;
  }).join('') : '';

  const teamTrophyHtml = buildTeamTrophyCase(t.name);
  const rivalsHtml = buildRivalsHtml(t.name);
  const picksHtml = buildTeamPicksHtml(t.name);

  document.getElementById('teamContent').innerHTML = `
    <div class="team-header">
      <div class="swatch" style="background:${t.color}"></div>
      <h1 class="page-title" style="margin:0;">${t.name}</h1>
    </div>
    <p class="page-sub">Rank #${t.rank} league-wide · ${t.avg_csv.toFixed(2)} avg CSV · ${t.roster} players · ${t.avg_age.toFixed(1)} avg age</p>
    ${DATA.team_blurbs && DATA.team_blurbs[t.name] ? `<div class="team-blurb">${DATA.team_blurbs[t.name]}</div>` : ''}

    <div class="grid-3" style="margin-bottom:16px;">
      <div class="card">
        <h3>&#127942; Trophy Case</h3>
        <div class="trophy-grid compact">${teamTrophyHtml}</div>
      </div>
      <div class="card">
        <h3>&#9876;&#65039; Rivals</h3>
        ${rivalsHtml}
      </div>
      <div class="card">
        <h3>&#128203; Draft Picks (2027)</h3>
        ${picksHtml}
      </div>
    </div>

    <div class="grid-2">
      <div class="card">
        <h3>Position Strength</h3>
        ${posHtml}
      </div>
      <div class="card">
        <h3>Optimal Starting Lineup <span style="color:var(--brass)">· ${s.starter_avg!=null?s.starter_avg.toFixed(2):''}</span></h3>
        <div class="starters-list">${startersHtml}</div>
      </div>
    </div>

    <div class="card" style="margin-top:16px;">
      <h3>Full Roster (${roster.length})</h3>
      <div class="starters-list">${rosterHtml}</div>
    </div>

    <div class="card" style="margin-top:16px;">
      <h3>Weekly Projection (bye-adjusted)</h3>
      <div class="week-bars">${weeklyHtml}</div>
    </div>
  `;

  document.querySelectorAll('.rival-name').forEach(el=>{
    el.addEventListener('click', ()=> openTeam(el.dataset.team));
  });
}

function buildTeamPicksHtml(teamName){
  const standings = DATA.outlook.standings.slice().sort((a,b)=>a.seed-b.seed);
  const draftOrder = standings.slice().reverse().map(s => s.team);
  const slotIndex = draftOrder.indexOf(teamName);
  const roundOrdinal = r => r===1?'1st':r===2?'2nd':r===3?'3rd':`${r}th`;

  const owned = [];
  for (let round = 1; round <= 5; round++) {
    const pickNum = `2027 ${round}.${String(slotIndex+1).padStart(2,'0')}`;
    const traded = DATA.traded_picks.find(p => p.year===2027 && p.round===round && p.original_owner===teamName);
    if (!traded) {
      owned.push({ label: pickNum, note: `own ${roundOrdinal(round)}` });
    }
  }
  DATA.traded_picks.forEach(p => {
    if (p.current_owner === teamName) {
      const label = `${p.year} ${p.round}${p.round===1?'st':p.round===2?'nd':p.round===3?'rd':'th'}`;
      owned.push({ label, note: `via trade, orig. ${p.original_owner}` });
    }
  });

  if (!owned.length) return '<div class="net-pick-row" style="color:var(--muted2);">No picks currently owned</div>';
  return owned.map(o => `<div class="rival-row" style="padding:7px 0;"><div><span class="rival-name" style="cursor:default;">${o.label}</span><span class="rival-tier">${o.note}</span></div></div>`).join('');
}

function buildRivalsHtml(teamName){
  const myRivalries = DATA.rivalries.filter(r => r.teamA===teamName || r.teamB===teamName);
  return myRivalries.map(r => {
    const opp = r.teamA===teamName ? r.teamB : r.teamA;
    const oppTeam = DATA.teams.find(t=>t.name===opp);
    let w=0, l=0, t=0;
    DATA.actual_schedule.forEach(g=>{
      if(!g.played) return;
      const isPair = (g.teamA===teamName && g.teamB===opp) || (g.teamA===opp && g.teamB===teamName);
      if(!isPair) return;
      const my = g.teamA===teamName ? g.scoreA : g.scoreB;
      const other = g.teamA===teamName ? g.scoreB : g.scoreA;
      if(my>other) w++; else if(other>my) l++; else t++;
    });
    const recordLabel = t>0 ? `${w}-${l}-${t}` : `${w}-${l}`;
    return `
      <div class="rival-row">
        <span class="swatch" style="background:${oppTeam.color}"></span>
        <div>
          <span class="rival-name" data-team="${opp}">${opp}</span><span class="rival-tier">${r.tier}</span><span class="rival-record">${recordLabel}</span>
        </div>
      </div>`;
  }).join('');
}

function buildTeamTrophyCase(teamName){
  const played = DATA.actual_schedule.filter(g=>g.played && (g.teamA===teamName || g.teamB===teamName));
  const mini = (icon, title, winner, detail) => {
    if(!winner){
      return `<div class="trophy-card"><div class="trophy-icon">${icon}</div><div class="trophy-title">${title}</div><div class="trophy-pending">TBD</div></div>`;
    }
    return `<div class="trophy-card awarded"><div class="trophy-icon">${icon}</div><div class="trophy-title">${title}</div>
      <div class="trophy-winner"><span class="trophy-winner-detail" style="margin-left:0;">${detail}</span></div></div>`;
  };

  let cards = '';

  // season record + all-time record (live, always computed)
  const seasonRec = { w:0, l:0, t:0 };
  played.forEach(g=>{
    const my = g.teamA===teamName ? g.scoreA : g.scoreB;
    const opp = g.teamA===teamName ? g.scoreB : g.scoreA;
    if(my>opp) seasonRec.w++; else if(opp>my) seasonRec.l++; else seasonRec.t++;
  });
  const seasonLabel = seasonRec.t>0 ? `${seasonRec.w}-${seasonRec.l}-${seasonRec.t}` : `${seasonRec.w}-${seasonRec.l}`;
  cards += mini('&#128197;', 'Season Record', true, seasonLabel);

  const tt0 = DATA.team_trophies ? DATA.team_trophies[teamName] : null;
  const priorW = tt0 ? tt0.prior_wins : 0, priorL = tt0 ? tt0.prior_losses : 0, priorT = tt0 ? tt0.prior_ties : 0;
  const atW = priorW + seasonRec.w, atL = priorL + seasonRec.l, atT = priorT + seasonRec.t;
  const atLabel = atT>0 ? `${atW}-${atL}-${atT}` : `${atW}-${atL}`;
  cards += mini('&#127942;&#128197;', 'All-Time Record', true, atLabel);

  // best/worst week this season for this team
  if(played.length){
    const weeks = played.map(g => ({ score: g.teamA===teamName ? g.scoreA : g.scoreB, week: g.week }));
    const best = weeks.slice().sort((a,b)=>b.score-a.score)[0];
    const worst = weeks.slice().sort((a,b)=>a.score-b.score)[0];
    cards += mini('&#128293;', 'Best Week', true, `${best.score.toFixed(1)} pts, ${best.week}`);
    cards += mini('&#128564;', 'Worst Week', true, `${worst.score.toFixed(1)} pts, ${worst.week}`);
  } else {
    cards += mini('&#128293;', 'Best Week', null);
    cards += mini('&#128564;', 'Worst Week', null);
  }

  // rivalry record (combined across both meetings each season)
  const myRivalries = DATA.rivalries.filter(r => r.teamA===teamName || r.teamB===teamName);
  let rivW=0, rivL=0, rivT=0;
  myRivalries.forEach(r=>{
    const opp = r.teamA===teamName ? r.teamB : r.teamA;
    DATA.actual_schedule.forEach(g=>{
      if(!g.played) return;
      const isPair = (g.teamA===teamName && g.teamB===opp) || (g.teamA===opp && g.teamB===teamName);
      if(!isPair) return;
      const myScore = g.teamA===teamName ? g.scoreA : g.scoreB;
      const oppScore = g.teamA===teamName ? g.scoreB : g.scoreA;
      if(myScore>oppScore) rivW++; else if(oppScore>myScore) rivL++; else rivT++;
    });
  });
  const rivPlayed = rivW+rivL+rivT > 0;
  cards += mini('&#9876;&#65039;', 'Rivalry Record', rivPlayed || myRivalries.length, rivPlayed ? `${rivW}-${rivL}${rivT?'-'+rivT:''} vs rivals` : `${rivW}-${rivL} vs rivals`);

  // career/season-end achievements — persistent, empty until earned
  const tt = DATA.team_trophies ? DATA.team_trophies[teamName] : null;
  const champCount = tt ? tt.championships.length : 0;
  cards += mini('&#127942;', 'Championships', champCount>0, champCount>0 ? `${champCount} · ${tt.championships.join(', ')}` : null);
  cards += mini('&#11014;&#65039;', 'Best Season', tt && tt.best_season_record, tt ? tt.best_season_record : null);
  cards += mini('&#11015;&#65039;', 'Worst Season', tt && tt.worst_season_record, tt ? tt.worst_season_record : null);

  return cards;
}

// ---------------- rendering: vegas lines ----------------
function toMoneyline(pct){
  // pct is 0-100 win probability
  const p = pct / 100;
  if(p <= 0) return '+9900';
  if(p >= 1) return '-9900';
  if(p >= 0.5){
    const ml = Math.round(-100 * p / (1-p));
    return ml.toString();
  } else {
    const ml = Math.round(100 * (1-p) / p);
    return `+${ml}`;
  }
}

function toSpread(projA, projB){
  const diff = Math.abs(projA - projB);
  const rounded = Math.round(diff * 2) / 2; // nearest 0.5
  return rounded;
}

function lineCardHtml(g){
  const spread = toSpread(g.projA, g.projB);
  const favA = g.projA >= g.projB;
  const total = (g.projA + g.projB).toFixed(1);
  const mlA = toMoneyline(g.winA);
  const mlB = toMoneyline(g.winB);
  return `
    <div class="line-card">
      <div class="line-team">
        <span class="swatch" style="background:${ownerColor(g.teamA)}"></span>
        <div>
          <div class="tname">${g.teamA}</div>
          <div class="line-figs">
            <div class="line-fig"><span class="lv">${favA ? '-'+spread.toFixed(1) : '+'+spread.toFixed(1)}</span><span class="ll">Spread</span></div>
            <div class="line-fig"><span class="lv">${mlA}</span><span class="ll">ML</span></div>
          </div>
        </div>
      </div>
      <div class="line-total">
        <span class="lv">${total}</span>
        <span class="ll">O/U</span>
      </div>
      <div class="line-team right">
        <span class="swatch" style="background:${ownerColor(g.teamB)}"></span>
        <div>
          <div class="tname">${g.teamB}</div>
          <div class="line-figs">
            <div class="line-fig"><span class="lv">${!favA ? '-'+spread.toFixed(1) : '+'+spread.toFixed(1)}</span><span class="ll">Spread</span></div>
            <div class="line-fig"><span class="lv">${mlB}</span><span class="ll">ML</span></div>
          </div>
        </div>
      </div>
    </div>`;
}

function populateLinesWeekFilter(selectId){
  const weeks = [...new Set(DATA.outlook.schedule.map(g=>g.week))];
  const rivalryWeeks = new Set(['Wk 1','Wk 2','Wk 13','Wk 14']);
  const sel = document.getElementById(selectId);
  sel.innerHTML = weeks.map(w=>`<option value="${w}">${w}${rivalryWeeks.has(w) ? ' ⚔' : ''}</option>`).join('');
}

function renderLines(ids){
  const wk = document.getElementById(ids.weekFilter).value;
  const games = DATA.outlook.schedule.filter(g=>g.week===wk);
  document.getElementById(ids.weekCount).textContent = `${games.length} lines`;
  document.getElementById(ids.list).innerHTML = games.map(lineCardHtml).join('');

  const futures = DATA.outlook.champ_odds.slice().sort((a,b)=>b.champ_pct-a.champ_pct);
  document.getElementById(ids.futuresBody).innerHTML = futures.map(f=>{
    const team = DATA.teams.find(t=>t.name===f.team);
    return `
    <tr>
      <td><span class="owner-pill" data-team="${f.team}"><span class="swatch" style="background:${team.color}"></span>${f.team}</span></td>
      <td class="mono">O ${(f.avg_wins).toFixed(1)}</td>
      <td class="mono">${toMoneyline(f.playoff_pct)}</td>
      <td class="csv-val">${toMoneyline(f.champ_pct)}</td>
    </tr>`;
  }).join('');
  document.querySelectorAll(`#${ids.futuresBody} .owner-pill`).forEach(el=>{
    el.addEventListener('click', ()=> openTeam(el.dataset.team));
  });
}

const linesIdsOutlook = { weekFilter:'linesWeekFilter2', weekCount:'linesWeekCount2', list:'linesList2', futuresBody:'futuresBody2' };

function renderAllLines(){
  renderLines(linesIdsOutlook);
}

// ---------------- rendering: draft picks ----------------
// ---------------- rendering: draft picks ----------------
function renderDraftBoard(){
  const teamMap = {}; DATA.teams.forEach(t => { teamMap[t.name] = t; });
  const standings = DATA.outlook.standings.slice().sort((a,b)=>a.seed-b.seed);
  // draft order = reverse of projected final standings (worst record picks first)
  const draftOrder = standings.slice().reverse().map(s => s.team);

  const roundOrdinal = r => r===1?'1st':r===2?'2nd':r===3?'3rd':`${r}th`;

  let html = '';
  for (let round = 1; round <= 5; round++) {
    let slotsHtml = '';
    draftOrder.forEach((origTeam, i) => {
      const pickNum = `${round}.${String(i+1).padStart(2,'0')}`;
      const traded = DATA.traded_picks.find(p => p.year===2027 && p.round===round && p.original_owner===origTeam);
      const currentOwner = traded ? traded.current_owner : origTeam;
      const team = teamMap[currentOwner];
      slotsHtml += `<div class="draft-slot ${traded?'traded':''}">
        <div class="draft-slot-num">${pickNum}</div>
        <div class="draft-slot-team"><span class="swatch" style="width:8px;height:8px;background:${team.color}"></span>${currentOwner}</div>
        ${traded ? `<div class="draft-slot-orig">orig. ${origTeam}</div>` : ''}
      </div>`;
    });
    html += `<div class="draft-round">
      <div class="draft-round-label">Round ${round} (${roundOrdinal(round)})</div>
      <div class="draft-round-grid">${slotsHtml}</div>
    </div>`;
  }
  document.getElementById('draftBoard').innerHTML = html;
}

function renderDraftPicks(){
  const teamMap = {}; DATA.teams.forEach(t => { teamMap[t.name] = t; });

  document.getElementById('tradedPicksList').innerHTML = DATA.traded_picks.map(p => {
    const flowHtml = p.chain.map((step, i) => {
      const teamName = step.split(' (')[0];
      const team = teamMap[teamName];
      const isLast = i === p.chain.length - 1;
      const color = team ? team.color : '#888';
      return `${i>0 ? '<span class="pick-arrow">&#8594;</span>' : ''}<span class="pick-team-chip ${isLast?'current':''}" style="${isLast?'':'background:var(--surface2)'}"><span class="swatch" style="width:8px;height:8px;background:${color}"></span>${step}</span>`;
    }).join('');
    return `<div class="pick-card">
      <div class="pick-label">${p.year} ${p.round}${p.round===1?'st':p.round===2?'nd':p.round===3?'rd':'th'}</div>
      <div class="pick-flow">${flowHtml}</div>
    </div>`;
  }).join('');

  const netByTeam = {};
  DATA.teams.forEach(t => { netByTeam[t.name] = { gained: [], lost: [] }; });
  DATA.traded_picks.forEach(p => {
    const label = `${p.year} ${p.round}${p.round===1?'st':p.round===2?'nd':p.round===3?'rd':'th'}`;
    if (netByTeam[p.current_owner]) netByTeam[p.current_owner].gained.push(label);
    if (netByTeam[p.original_owner] && p.original_owner !== p.current_owner) netByTeam[p.original_owner].lost.push(label);
  });

  document.getElementById('netPicksGrid').innerHTML = DATA.teams.map(t => {
    const n = netByTeam[t.name];
    const netCount = n.gained.length - n.lost.length;
    const netLabel = netCount > 0 ? `+${netCount}` : netCount < 0 ? `${netCount}` : '0';
    return `<div class="trophy-card">
      <div class="trophy-title" style="display:flex;align-items:center;gap:6px;"><span class="swatch" style="width:8px;height:8px;background:${t.color}"></span>${t.name}</div>
      <div class="net-pick-row">${n.gained.length ? `<span class="gain">+ ${n.gained.join(', + ')}</span>` : ''}</div>
      <div class="net-pick-row">${n.lost.length ? `<span class="loss">&minus; ${n.lost.join(', &minus; ')}</span>` : ''}</div>
      ${!n.gained.length && !n.lost.length ? '<div class="net-pick-row" style="color:var(--muted2);">No picks traded</div>' : ''}
    </div>`;
  }).join('');
}

// ---------------- rendering: league news ----------------
function renderNewsPosts(){
  document.getElementById('newsPostsList').innerHTML = DATA.news_posts.map(p=>`
    <div class="news-post">
      <div class="news-date">${p.date}</div>
      <div class="news-title">${p.title}</div>
      <div class="news-body">${p.body}</div>
    </div>`).join('');
}

function renderTransactions(){
  document.getElementById('transactionsList').innerHTML = DATA.transactions.map(tx=>{
    if(tx.type === 'trade'){
      const parts = tx.teams.map(team => `<b>${team}</b> gets ${tx.gives[team].join(', ')}`).join(' &middot; ');
      const analysisHtml = tx.winner ? `
        <div class="txn-analysis">
          <div class="txn-winner"><span class="winner-badge">&#127942; Winner: ${tx.winner}</span></div>
          <div class="txn-impact-grid">
            ${tx.teams.map(team => `<div class="txn-impact"><b>${team}:</b> ${tx.impact[team]}</div>`).join('')}
          </div>
        </div>` : '';
      return `<div class="txn-row">
        <span class="txn-tag trade">Trade</span>
        <div class="txn-body"><span class="txn-date">${tx.date}</span>
          <div class="txn-main">${parts}</div>
          ${tx.note ? `<div class="txn-note">${tx.note}</div>` : ''}
          ${analysisHtml}
        </div>
      </div>`;
    }
    if(tx.type === 'add'){
      return `<div class="txn-row">
        <span class="txn-tag add">Add</span>
        <div class="txn-body"><span class="txn-date">${tx.date}</span>
          <div class="txn-main"><b>${tx.team}</b> added ${tx.players.join(', ')}</div>
          ${tx.note ? `<div class="txn-note">${tx.note}</div>` : ''}
        </div>
      </div>`;
    }
    if(tx.type === 'drop'){
      return `<div class="txn-row">
        <span class="txn-tag drop">Drop</span>
        <div class="txn-body"><span class="txn-date">${tx.date}</span>
          <div class="txn-main"><b>${tx.team}</b> dropped ${tx.players.join(', ')}</div>
          ${tx.note ? `<div class="txn-note">${tx.note}</div>` : ''}
        </div>
      </div>`;
    }
    if(tx.type === 'adddrop'){
      return `<div class="txn-row">
        <span class="txn-tag add">Add/Drop</span>
        <div class="txn-body"><span class="txn-date">${tx.date}</span>
          <div class="txn-main"><b>${tx.team}</b> added ${tx.adds.join(', ')}, dropped ${tx.drops.join(', ')}</div>
          ${tx.note ? `<div class="txn-note">${tx.note}</div>` : ''}
        </div>
      </div>`;
    }
    return '';
  }).join('');
}

// ---------------- rendering: trophy case ----------------
function renderLiveTrophies(){
  const played = DATA.actual_schedule.filter(g=>g.played);
  const teamMap = {}; DATA.teams.forEach(t=>{ teamMap[t.name]=t; });

  const cards = [];

  const gameScores = [];
  played.forEach(g=>{
    gameScores.push({team:g.teamA, score:g.scoreA, week:g.week});
    gameScores.push({team:g.teamB, score:g.scoreB, week:g.week});
  });

  const mkCard = (icon, title, desc, winner) => {
    if(!winner){
      return `<div class="trophy-card"><div class="trophy-icon">${icon}</div><div class="trophy-title">${title}</div><div class="trophy-desc">${desc}</div><div class="trophy-pending">Not decided yet — check back after Week 1</div></div>`;
    }
    return `<div class="trophy-card awarded"><div class="trophy-icon">${icon}</div><div class="trophy-title">${title}</div><div class="trophy-desc">${desc}</div>
      <div class="trophy-winner"><span class="swatch" style="background:${teamMap[winner.team].color}"></span><span class="trophy-winner-name">${winner.team}</span><span class="trophy-winner-detail">${winner.detail}</span></div></div>`;
  };

  if(gameScores.length){
    const high = gameScores.slice().sort((a,b)=>b.score-a.score)[0];
    cards.push(mkCard('&#128293;', 'Highest Single Week', 'Best individual scoring week so far', {team:high.team, detail:`${high.score.toFixed(1)} pts, ${high.week}`}));
    const low = gameScores.slice().sort((a,b)=>a.score-b.score)[0];
    cards.push(mkCard('&#128564;', 'Dud of the Week', 'Worst individual scoring week so far', {team:low.team, detail:`${low.score.toFixed(1)} pts, ${low.week}`}));
  } else {
    cards.push(mkCard('&#128293;', 'Highest Single Week', 'Best individual scoring week so far', null));
    cards.push(mkCard('&#128564;', 'Dud of the Week', 'Worst individual scoring week so far', null));
  }

  if(played.length){
    const closest = played.slice().sort((a,b)=> Math.abs(a.scoreA-a.scoreB) - Math.abs(b.scoreA-b.scoreB))[0];
    const margin = Math.abs(closest.scoreA - closest.scoreB);
    const winner = closest.scoreA > closest.scoreB ? closest.teamA : closest.teamB;
    const loser = closest.scoreA > closest.scoreB ? closest.teamB : closest.teamA;
    cards.push(mkCard('&#127919;', 'Closest Match', 'Nail-biter of the season so far', {team:winner, detail:`beat ${loser} by ${margin.toFixed(1)}, ${closest.week}`}));

    const blowout = played.slice().sort((a,b)=> Math.abs(b.scoreA-b.scoreB) - Math.abs(a.scoreA-a.scoreB))[0];
    const bMargin = Math.abs(blowout.scoreA - blowout.scoreB);
    const bWinner = blowout.scoreA > blowout.scoreB ? blowout.teamA : blowout.teamB;
    const bLoser = blowout.scoreA > blowout.scoreB ? blowout.teamB : blowout.teamA;
    cards.push(mkCard('&#128293;&#128293;', 'Mercy Rule', 'Biggest blowout of the season so far', {team:bWinner, detail:`beat ${bLoser} by ${bMargin.toFixed(1)}, ${blowout.week}`}));
  } else {
    cards.push(mkCard('&#127919;', 'Closest Match', 'Nail-biter of the season so far', null));
    cards.push(mkCard('&#128293;&#128293;', 'Mercy Rule', 'Biggest blowout of the season so far', null));
  }

  const standings = {};
  DATA.teams.forEach(t=>{ standings[t.name] = {w:0,l:0,pf:0}; });
  played.forEach(g=>{
    standings[g.teamA].pf += g.scoreA; standings[g.teamB].pf += g.scoreB;
    if(g.scoreA>g.scoreB){ standings[g.teamA].w++; standings[g.teamB].l++; }
    else if(g.scoreB>g.scoreA){ standings[g.teamB].w++; standings[g.teamA].l++; }
  });
  const withGames = DATA.teams.filter(t=>standings[t.name].w+standings[t.name].l>0);

  if(withGames.length){
    const byRecord = withGames.slice().sort((a,b)=> standings[b.name].w-standings[a.name].w || standings[b.name].pf-standings[a.name].pf);
    const leader = byRecord[0];
    cards.push(mkCard('&#128081;', 'Current League Leader', 'Best record right now', {team:leader.name, detail:`${standings[leader.name].w}-${standings[leader.name].l}`}));
    const last = byRecord[byRecord.length-1];
    cards.push(mkCard('&#128703;', 'Current Basement Dweller', 'Worst record right now', {team:last.name, detail:`${standings[last.name].w}-${standings[last.name].l}`}));
  } else {
    cards.push(mkCard('&#128081;', 'Current League Leader', 'Best record right now', null));
    cards.push(mkCard('&#128703;', 'Current Basement Dweller', 'Worst record right now', null));
  }

  document.getElementById('liveTrophies').innerHTML = cards.join('');
}

function renderAllTimeTrophies(){
  document.getElementById('allTimeTrophies').innerHTML = DATA.all_time_records.map(r=>{
    if(!r.team){
      return `<div class="trophy-card"><div class="trophy-icon">${r.icon}</div><div class="trophy-title">${r.title}</div><div class="trophy-desc">${r.desc}</div><div class="trophy-pending">No record set yet — league is brand new</div></div>`;
    }
    const team = DATA.teams.find(t=>t.name===r.team);
    return `<div class="trophy-card awarded"><div class="trophy-icon">${r.icon}</div><div class="trophy-title">${r.title}</div><div class="trophy-desc">${r.desc}</div>
      <div class="trophy-winner"><span class="swatch" style="background:${team.color}"></span><span class="trophy-winner-name">${r.team}</span><span class="trophy-winner-detail">${r.detail||''}${r.season ? ' · '+r.season : ''}</span></div></div>`;
  }).join('');
}

function renderSeasonTrophies(){
  document.getElementById('seasonTrophies').innerHTML = DATA.season_awards.map(a=>{
    if(!a.winner){
      return `<div class="trophy-card"><div class="trophy-icon">${a.icon}</div><div class="trophy-title">${a.title}</div><div class="trophy-desc">${a.desc}</div><div class="trophy-pending">TBD — decided at season's end</div></div>`;
    }
    const team = DATA.teams.find(t=>t.name===a.winner);
    return `<div class="trophy-card awarded"><div class="trophy-icon">${a.icon}</div><div class="trophy-title">${a.title}</div><div class="trophy-desc">${a.desc}</div>
      <div class="trophy-winner"><span class="swatch" style="background:${team.color}"></span><span class="trophy-winner-name">${a.winner}</span><span class="trophy-winner-detail">${a.detail||''}</span></div></div>`;
  }).join('');
}

// ---------------- rendering: rivalry record ----------------
function renderRivalries(){
  const teamMap = {};
  DATA.teams.forEach(t => { teamMap[t.name] = t; });

  const computeRecord = (teamA, teamB) => {
    let wA=0, wB=0, t=0;
    DATA.actual_schedule.forEach(g => {
      if(!g.played) return;
      const isPair = (g.teamA===teamA && g.teamB===teamB) || (g.teamA===teamB && g.teamB===teamA);
      if(!isPair) return;
      const scoreA = g.teamA===teamA ? g.scoreA : g.scoreB;
      const scoreB = g.teamA===teamA ? g.scoreB : g.scoreA;
      if(scoreA > scoreB) wA++;
      else if(scoreB > scoreA) wB++;
      else t++;
    });
    return { wA, wB, t };
  };

  document.getElementById('rivalryList').innerHTML = DATA.rivalries.map(r => {
    const rec = computeRecord(r.teamA, r.teamB);
    const tA = teamMap[r.teamA], tB = teamMap[r.teamB];
    const recordLabel = rec.t > 0 ? `${rec.wA}-${rec.wB}-${rec.t}` : `${rec.wA}-${rec.wB}`;
    return `
      <div class="rivalry-row">
        <div class="rivalry-team"><span class="swatch" style="background:${tA.color}"></span>${r.teamA}</div>
        <div class="rivalry-record">${recordLabel}</div>
        <div class="rivalry-team right"><span class="swatch" style="background:${tB.color}"></span>${r.teamB}</div>
        <div class="rivalry-tier">${r.tier}</div>
      </div>`;
  }).join('');
}

// ---------------- rendering: head to head ----------------
function renderH2H(){
  const teams = DATA.teams.slice().sort((a,b)=>a.rank-b.rank);
  const records = {};
  teams.forEach(t => { records[t.name] = {}; });

  DATA.h2h_structure.forEach(pair => {
    records[pair.teamA][pair.teamB] = { w:0, l:0, t:0, games: pair.games };
    records[pair.teamB][pair.teamA] = { w:0, l:0, t:0, games: pair.games };
  });

  DATA.actual_schedule.forEach(g => {
    if(!g.played) return;
    if(g.scoreA > g.scoreB){
      records[g.teamA][g.teamB].w++; records[g.teamB][g.teamA].l++;
    } else if(g.scoreB > g.scoreA){
      records[g.teamB][g.teamA].w++; records[g.teamA][g.teamB].l++;
    } else {
      records[g.teamA][g.teamB].t++; records[g.teamB][g.teamA].t++;
    }
  });

  let html = '<tr><th class="row-label">Team</th>' + teams.map(t=>`<th>${t.name}</th>`).join('') + '</tr>';
  teams.forEach(rowTeam => {
    html += `<tr><th class="row-label"><span style="display:inline-flex;align-items:center;gap:6px;"><span class="swatch" style="width:8px;height:8px;background:${rowTeam.color}"></span>${rowTeam.name}</span></th>`;
    teams.forEach(colTeam => {
      if(rowTeam.name === colTeam.name){
        html += '<td class="self">—</td>';
      } else {
        const rec = records[rowTeam.name][colTeam.name];
        if(!rec){
          html += '<td class="no-games">·</td>';
        } else {
          const label = rec.t > 0 ? `${rec.w}-${rec.l}-${rec.t}` : `${rec.w}-${rec.l}`;
          html += `<td class="record">${label}</td>`;
        }
      }
    });
    html += '</tr>';
  });
  document.getElementById('h2hTable').innerHTML = html;
}

// ---------------- rendering: league rules ----------------
function renderRules(){
  const r = DATA.league_rules;
  const rowsHtml = arr => arr.map(x=>`<div class="rule-row"><div class="rl">${x.label}</div><div class="rv">${x.value}</div></div>`).join('');
  document.getElementById('rulesBasics').innerHTML = rowsHtml(r.basics);
  document.getElementById('rulesWaivers').innerHTML = rowsHtml(r.waivers);
  document.getElementById('rulesRoster').innerHTML = rowsHtml(r.roster);
  document.getElementById('rulesScoring').innerHTML = Object.entries(r.scoring).map(([cat, items])=>`
    <div class="card">
      <h3>${cat}</h3>
      ${rowsHtml(items)}
    </div>`).join('');
}

// ---------------- rendering: 2026 real schedule ----------------
function realMatchupHtml(g){
  const played = g.played;
  const aWin = played && g.scoreA > g.scoreB;
  const bWin = played && g.scoreB > g.scoreA;
  return `
    <div class="matchup ${played ? '' : 'unplayed'} ${g.rivalry ? 'rivalry' : ''}">
      <div class="side">
        <div class="swatch" style="background:${ownerColor(g.teamA)}"></div>
        <div>
          <div class="tname ${aWin?'winner':''}">${g.teamA}${aWin?' &#9819;':''}</div>
        </div>
        <div class="score-val ${aWin?'winner':''}">${played ? g.scoreA.toFixed(1) : '—'}</div>
      </div>
      <div class="vs">
        <span class="status-badge ${played?'final':''}">${played ? 'FINAL' : 'NOT PLAYED'}</span>
        ${g.rivalry ? '<span class="rivalry-tag">&#9876; Rivalry</span>' : ''}
      </div>
      <div class="side right">
        <div class="swatch" style="background:${ownerColor(g.teamB)}"></div>
        <div>
          <div class="tname ${bWin?'winner':''}">${g.teamB}${bWin?' &#9819;':''}</div>
        </div>
        <div class="score-val ${bWin?'winner':''}">${played ? g.scoreB.toFixed(1) : '—'}</div>
      </div>
    </div>`;
}

function populateScheduleWeekFilter(){
  const weeks = [...new Set(DATA.actual_schedule.map(g=>g.week))];
  const rivalryWeeks = new Set(DATA.actual_schedule.filter(g=>g.rivalry).map(g=>g.week));
  const sel = document.getElementById('scheduleWeekFilter');
  sel.innerHTML = weeks.map(w=>`<option value="${w}">${w}${rivalryWeeks.has(w) ? ' ⚔ Rivalry' : ''}</option>`).join('');
}

function renderRealSchedule(){
  const wk = document.getElementById('scheduleWeekFilter').value;
  const games = DATA.actual_schedule.filter(g=>g.week===wk);
  const playedCount = games.filter(g=>g.played).length;
  document.getElementById('scheduleWeekCount').textContent = `${playedCount} of ${games.length} played`;
  document.getElementById('realScheduleList').innerHTML = games.map(realMatchupHtml).join('');
}

function renderSeasonStandings(){
  const weekNum = w => parseInt(w.replace('Wk ','').trim(), 10);
  const standings = {};
  DATA.teams.forEach(t => { standings[t.name] = { w:0, l:0, t:0, pf:0, pa:0, games:[] }; });

  DATA.actual_schedule.filter(g=>g.played).forEach(g => {
    standings[g.teamA].pf += g.scoreA; standings[g.teamA].pa += g.scoreB;
    standings[g.teamB].pf += g.scoreB; standings[g.teamB].pa += g.scoreA;
    let resA, resB;
    if(g.scoreA > g.scoreB){ standings[g.teamA].w++; standings[g.teamB].l++; resA='W'; resB='L'; }
    else if(g.scoreB > g.scoreA){ standings[g.teamB].w++; standings[g.teamA].l++; resA='L'; resB='W'; }
    else { standings[g.teamA].t++; standings[g.teamB].t++; resA='T'; resB='T'; }
    standings[g.teamA].games.push({week:weekNum(g.week), result:resA});
    standings[g.teamB].games.push({week:weekNum(g.week), result:resB});
  });

  const rows = DATA.teams.map(t => ({ name:t.name, color:t.color, ...standings[t.name] }));
  rows.sort((a,b) => b.w - a.w || b.pf - a.pf);

  const streakOf = games => {
    if(!games.length) return null;
    const sorted = games.slice().sort((a,b)=>a.week-b.week);
    const last = sorted[sorted.length-1].result;
    if(last === 'T') return 'T1';
    let count = 0;
    for(let i=sorted.length-1; i>=0; i--){
      if(sorted[i].result === last) count++; else break;
    }
    return last + count;
  };

  document.getElementById('seasonStandingsBody').innerHTML = rows.map((r,i)=>{
    const seed = i+1;
    const seedClass = seed<=2 ? 'seed-bye' : (seed<=6 ? 'seed-playoff' : 'seed-out');
    const streak = streakOf(r.games);
    let streakHtml = '<span class="streak-none">—</span>';
    if(streak){
      const cls = streak[0]==='W' ? 'streak-w' : (streak[0]==='L' ? 'streak-l' : 'streak-none');
      streakHtml = `<span class="${cls}">${streak}</span>`;
    }
    return `<tr class="${seedClass}">
      <td>${seed}</td>
      <td><span class="owner-pill" data-team="${r.name}"><span class="swatch" style="background:${r.color}"></span>${r.name}</span></td>
      <td class="mono">${r.w}</td>
      <td class="mono">${r.l}</td>
      <td class="mono" style="color:var(--muted)">${r.t}</td>
      <td class="csv-val">${r.pf.toFixed(1)}</td>
      <td class="mono" style="color:var(--muted)">${r.pa.toFixed(1)}</td>
      <td>${streakHtml}</td>
    </tr>`;
  }).join('');
  document.querySelectorAll('#seasonStandingsBody .owner-pill').forEach(el=>{
    el.addEventListener('click', ()=> openTeam(el.dataset.team));
  });
}

// ---------------- rendering: outlook ----------------
function teamPill(name){
  const c = ownerColor(name);
  return `<div class="side"><div class="swatch" style="background:${c}"></div><div><div class="tname" id="tn"></div></div></div>`;
}

function renderChampionCard(){
  const o = DATA.outlook;
  document.getElementById('championCard').innerHTML = `
    <div class="trophy">&#127942;</div>
    <div>
      <div class="ctitle">Projected Champion</div>
      <div class="cname" style="color:${ownerColor(o.champion)}">${o.champion}</div>
    </div>
    <div class="cpct">
      <div class="v">${o.champion_pct}%</div>
      <div class="l">Title Odds</div>
    </div>
  `;
}

function matchupHtml(g){
  const aWin = g.winner === g.teamA;
  const rivalryWeeks = new Set(['Wk 1','Wk 2','Wk 13','Wk 14']);
  const isRivalry = rivalryWeeks.has(g.week);
  return `
    <div class="matchup ${isRivalry ? 'rivalry' : ''}">
      <div class="side">
        <div class="swatch" style="background:${ownerColor(g.teamA)}"></div>
        <div>
          <div class="tname ${aWin?'winner':''}">${g.teamA}${aWin?' &#9819;':''}</div>
          <div class="tproj">${g.projA} proj</div>
        </div>
        <div class="tpct">${g.winA}%</div>
      </div>
      <div class="vs">${isRivalry ? '<span class="rivalry-tag">&#9876; Rivalry</span>' : 'VS'}</div>
      <div class="side right">
        <div class="swatch" style="background:${ownerColor(g.teamB)}"></div>
        <div>
          <div class="tname ${!aWin?'winner':''}">${g.teamB}${!aWin?' &#9819;':''}</div>
          <div class="tproj">${g.projB} proj</div>
        </div>
        <div class="tpct">${g.winB}%</div>
      </div>
    </div>`;
}

function populateWeekFilter(){
  const weeks = [...new Set(DATA.outlook.schedule.map(g=>g.week))];
  const rivalryWeeks = new Set(['Wk 1','Wk 2','Wk 13','Wk 14']);
  const sel = document.getElementById('weekFilter');
  sel.innerHTML = weeks.map(w=>`<option value="${w}">${w}${rivalryWeeks.has(w) ? ' ⚔ Rivalry' : ''}</option>`).join('');
}

function renderSchedule(){
  const wk = document.getElementById('weekFilter').value;
  const games = DATA.outlook.schedule.filter(g=>g.week===wk);
  document.getElementById('weekCount').textContent = `${games.length} matchups`;
  document.getElementById('scheduleList').innerHTML = games.map(matchupHtml).join('');
}

function renderOutlookStandings(){
  document.getElementById('standingsBody').innerHTML = DATA.outlook.standings.map(s=>`
    <tr>
      <td class="rank-num">${s.seed}</td>
      <td><span class="owner-pill" data-team="${s.team}"><span class="swatch" style="background:${ownerColor(s.team)}"></span>${s.team}</span></td>
      <td class="mono">${s.w}-${s.l}</td>
      <td class="mono" style="color:var(--muted)">${s.pf}</td>
      <td class="csv-val">${s.avg_wins}</td>
      <td class="mono">${s.playoff_pct}%</td>
      <td class="mono" style="color:var(--muted)">${s.bye_pct}%</td>
    </tr>`).join('');
  document.querySelectorAll('#standingsBody .owner-pill').forEach(el=>{
    el.addEventListener('click', ()=> openTeam(el.dataset.team));
  });
}

function renderPlayoffs(){
  const p = DATA.outlook.playoffs;
  document.getElementById('playoffBracket').innerHTML = `
    <div class="bracket-round">
      <div class="bracket-round-label">Week 15 · Quarterfinals</div>
      ${matchupHtml(p.qf1)}
      ${matchupHtml(p.qf2)}
      <div class="bye-note">Seeds 1 &amp; 2 (${DATA.outlook.standings[0].team}, ${DATA.outlook.standings[1].team}) — first round bye</div>
    </div>
    <div class="bracket-round">
      <div class="bracket-round-label">Week 16 · Semifinals</div>
      ${matchupHtml(p.semi1)}
      ${matchupHtml(p.semi2)}
    </div>
    <div class="bracket-round">
      <div class="bracket-round-label">Week 17 · Championship</div>
      ${matchupHtml(p.final)}
    </div>
  `;
}

function renderOdds(){
  document.getElementById('oddsBody').innerHTML = DATA.outlook.champ_odds.map(o=>`
    <tr>
      <td><span class="owner-pill" data-team="${o.team}"><span class="swatch" style="background:${ownerColor(o.team)}"></span>${o.team}</span></td>
      <td class="mono">${o.avg_wins}</td>
      <td class="mono">${o.playoff_pct}%</td>
      <td class="mono" style="color:var(--muted)">${o.bye_pct}%</td>
      <td class="mono" style="color:var(--muted)">${o.final_pct}%</td>
      <td class="csv-val">${o.champ_pct}%</td>
    </tr>`).join('');
  document.querySelectorAll('#oddsBody .owner-pill').forEach(el=>{
    el.addEventListener('click', ()=> openTeam(el.dataset.team));
  });
}

function renderOutlook(){
  renderChampionCard();
  populateWeekFilter();
  renderSchedule();
  renderOutlookStandings();
  renderPlayoffs();
  renderOdds();
}

// ---------------- view switching ----------------
function switchView(view){
  document.querySelectorAll('.view').forEach(v=>v.classList.remove('active'));
  document.getElementById(`view-${view}`).classList.add('active');
  document.querySelectorAll('#nav button').forEach(b=>{
    b.classList.toggle('active', b.dataset.view === view);
  });
}

// ---------------- init ----------------
async function init(){
  await loadData();

  document.getElementById('updatedAt').textContent = fmtDate(DATA._updatedAt);
  renderStandings();

  rankingsCtrl = makeRankingsController({
    dataKey: 'players_merged', viewId: 'rankings',
    ids: { search:'search', posFilter:'posFilter', teamFilter:'teamFilter', resultCount:'resultCount', body:'rankingsBody' },
    sortDefault: 'rank'
  });
  rankingsCtrl.init();

  renderOutlook();
  populateScheduleWeekFilter();
  renderRealSchedule();
  renderSeasonStandings();
  document.getElementById('scheduleWeekFilter').addEventListener('change', renderRealSchedule);
  renderH2H();
  renderRivalries();
  renderRules();
  renderLiveTrophies();
  renderAllTimeTrophies();
  renderSeasonTrophies();
  renderNewsPosts();
  renderTransactions();
  renderDraftPicks();
  renderDraftBoard();

  populateLinesWeekFilter('linesWeekFilter2');
  renderAllLines();
  document.getElementById('linesWeekFilter2').addEventListener('change', ()=>renderLines(linesIdsOutlook));

  document.getElementById('weekFilter').addEventListener('change', renderSchedule);

  document.getElementById('outlookTabs').addEventListener('click', (e)=>{
    const btn = e.target.closest('button[data-otab]');
    if(!btn) return;
    document.querySelectorAll('#outlookTabs button').forEach(b=>b.classList.remove('active'));
    btn.classList.add('active');
    document.querySelectorAll('.otab-view').forEach(v=>v.classList.remove('active'));
    document.getElementById(`otab-${btn.dataset.otab}`).classList.add('active');
  });

  document.getElementById('nav').addEventListener('click', (e)=>{
    const btn = e.target.closest('button[data-view]');
    if(!btn) return;
    switchView(btn.dataset.view);
    if(btn.dataset.view === 'team') renderTeamsOverview();
  });

  document.getElementById('backToStandings').addEventListener('click', ()=> renderTeamsOverview());

  // poll for updates every 60s so open tabs pick up new pushes without a manual refresh
  setInterval(async ()=>{
    try{
      const res = await fetch('data.json?t=' + Date.now());
      const fresh = await res.json();
      if(fresh._updatedAt && fresh._updatedAt !== DATA._updatedAt){
        DATA = fresh;
        DATA._updatedAt = DATA._updatedAt || Date.now();
        document.getElementById('updatedAt').textContent = fmtDate(DATA._updatedAt);
        rankingsCtrl.populateTeamFilter();
        renderStandings();
        rankingsCtrl.render();
        renderOutlook();
        populateScheduleWeekFilter();
        renderRealSchedule();
        renderSeasonStandings();
        renderH2H();
        renderRivalries();
        renderRules();
        renderLiveTrophies();
        renderAllTimeTrophies();
        renderSeasonTrophies();
        renderNewsPosts();
        renderTransactions();
        renderDraftPicks();
        renderDraftBoard();
        populateLinesWeekFilter('linesWeekFilter2');
        renderAllLines();
        if(currentTeam) renderTeamDetail();
      }
    }catch(e){}
  }, 60000);
}

init();
