(() => {
  const $ = id => document.getElementById(id);
  const roleNames = { blind: '색깔 제한 해제 담당', mute: '말 없는 매뉴얼 담당', deaf: '듣지 못하는 해결 담당' };
  let ws, role, host = false, connected = false, lastStatus = 'waiting';
  const send = (type, data = {}) => { if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type, ...data })); };
  const status = text => { $('lobbyStatus').textContent = text; };
  function connect(kind) {
    if (connected) return;
    if (!('WebSocket' in window)) { status('이 브라우저는 온라인 연결을 지원하지 않아요.'); return; }
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = location.host || 'localhost:3000';
    ws = new WebSocket(`${protocol}//${host}/api/ws`);
    status('게임 서버에 연결하는 중…');
    ws.onopen = () => send(kind, { code: $('roomCode').value.trim().toUpperCase(), name: $('playerName').value.trim(), role: $('playerRole').value });
    ws.onmessage = event => {
      const msg = JSON.parse(event.data);
      if (msg.type === 'error') { status(msg.message); return; }
      if (msg.type === 'joined') {
        connected = true; role = msg.role; host = msg.host;
        $('roomInfo').hidden = false; $('inviteCode').textContent = msg.code;
        $('overlay').style.display = 'grid'; $('readyBtn').textContent = '규칙 확인 완료';
        document.querySelector('.modal h2').textContent = '플레이어를 기다려요.';
        status(`내 역할: ${roleNames[role]} · 방 코드 ${msg.code}`);
        document.body.dataset.role = role;
        $('startBtn').style.display = 'none'; $('resetBtn').style.display = 'none';
        $('audioBtn').style.display = 'none'; $('replayBtn').style.display = $('passBtn').style.display = 'none';
        if (role === 'deaf') $('audioStatus').textContent = '기기를 음소거하세요. 매뉴얼 규칙과 폭탄 신호를 조합해요.';
        if (role === 'mute') $('audioStatus').textContent = '매뉴얼을 읽고 아래 버튼으로 규칙을 무음 전달하세요.';
        if (role === 'blind') $('audioStatus').textContent = '색 대신 번호 지시를 확인하고 폭탄 버튼을 직접 누르세요.';
        configureRole();
        return;
      }
      if (msg.type === 'state') renderState(msg);
      if (msg.type === 'team-message' && role === 'deaf') { $('message').textContent = `매뉴얼 전달 › ${msg.text}`; $('message').classList.remove('empty'); }
      if (msg.type === 'guide' && role === 'blind') { $('deafHint').style.display = 'block'; $('deafHint').innerHTML = `<strong>해결 담당의 지시 ›</strong> ${msg.text}`; $('operatorNote').innerHTML = '번호를 확인한 뒤 해당 폭탄 버튼을 누르세요.'; }
    };
    ws.onclose = () => { connected = false; status('연결이 종료됐어요. 서버를 실행하고 http://localhost:3000 에서 참가해 주세요.'); };
    ws.onerror = () => status('게임 서버에 연결할 수 없어요. 서버를 실행한 뒤 http://localhost:3000 으로 접속해 주세요.');
  }
  const moduleInfo = [
    { q: '매뉴얼 규칙: <em>파란 별</em>이면 2번 버튼을 누른다.', manual: '매뉴얼: 파란 별 → 2번 버튼', hint: '폭탄 신호: 파란 별', clue: '표시 색: 파랑　기호: ★　상태: 점멸', direction: 2 },
    { q: '매뉴얼 규칙: <em>빨간 원</em>이면 3번 버튼을 누른다.', manual: '매뉴얼: 빨간 원 → 3번 버튼', hint: '폭탄 신호: 빨간 원', clue: '표시 색: 빨강　기호: ●　상태: 고정', direction: 3 },
    { q: '매뉴얼 규칙: <em>초록 삼각형</em>이면 1번 버튼을 누른다.', manual: '매뉴얼: 초록 삼각형 → 1번 버튼', hint: '폭탄 신호: 초록 삼각형', clue: '표시 색: 초록　기호: ▲　상태: 빠르게 점멸', direction: 1 }
  ];
  function configureRole() {
    document.querySelector('.arena .controls').style.display = 'none';
    if (role === 'blind') {
      $('question').style.display = $('subhint').style.display = 'none';
      $('deafHint').style.display = 'block'; $('deafHint').innerHTML = '<strong>해결 담당의 번호 지시를 기다리세요.</strong>';
      document.querySelector('.msg-head').style.display = $('message').style.display = $('messageButtons').style.display = 'none'; $('choices').style.display = 'flex';
      $('operatorNote').innerHTML = '색 정보 대신 <b>해결 담당이 알려주는 번호</b>를 보고 폭탄 버튼을 누르세요.';
      const bindChoices = () => $('choices').querySelectorAll('[data-index]').forEach(b => b.onclick = e => { e.stopPropagation(); send('answer', { choice: Number(b.dataset.index) }); });
      bindChoices();
      const observer = new MutationObserver(bindChoices); observer.observe($('choices'), { childList: true });
    } else if (role === 'mute') {
      $('question').style.display = 'block'; $('question').innerHTML = moduleInfo[0].q; $('subhint').style.display = $('deafHint').style.display = 'none';
      $('choices').style.display = 'none'; $('messageButtons').style.display = 'grid'; $('messageButtons').innerHTML = `<button class="msg-btn">매뉴얼 규칙을 해결 담당에게 전달</button>`;
      $('operatorNote').textContent = '매뉴얼을 읽고 무음 메시지 버튼으로 규칙을 해결 담당에게 보내세요.';
      $('messageButtons').querySelector('button').onclick = () => { const info = moduleInfo[Number(($('round').textContent.match(/\d/) || [1])[0]) - 1]; $('message').textContent = `전달 완료 › ${info.manual}`; $('message').classList.remove('empty'); send('message', { text: info.manual }); };
    } else {
      $('choices').style.display = 'none'; $('question').style.display = 'none';
      $('subhint').style.display = $('deafHint').style.display = 'block'; $('messageButtons').style.display = 'grid';
      $('subhint').textContent = moduleInfo[0].hint; $('deafHint').innerHTML = '<strong>폭탄 신호 ›</strong> ' + moduleInfo[0].clue;
      $('operatorNote').innerHTML = '폭탄 신호와 전달받은 매뉴얼을 조합해 번호를 정하고 <b>색깔 제한 담당에게 지시</b>하세요.';
      $('messageButtons').innerHTML = [1,2,3].map(n => `<button class="msg-btn" data-guide="${n}">${n}번 버튼이라고 알리기</button>`).join('');
      $('messageButtons').querySelectorAll('[data-guide]').forEach(b => b.onclick = () => { const n = Number(b.dataset.guide); $('message').textContent = `지시 전달 › ${n}번 버튼`; $('message').classList.remove('empty'); send('guide', { text: `${n}번 버튼을 누르세요.` }); });
    }
  }
  function renderState(s) {
    $('inviteCode').textContent = s.code;
    $('playerList').innerHTML = s.players.map(p => `${p.connected ? '●' : '○'} ${p.name} · ${roleNames[p.role]}${p.role === s.host ? ' · 방장' : ''}`).join('<br>');
    const count = s.players.length;
    host = s.isHost;
    $('onlineStart').disabled = !host || count !== 3 || s.status === 'playing';
    $('onlineStart').textContent = s.status === 'playing' ? '게임 진행 중' : count === 3 ? (host ? '게임 시작' : '방장이 시작하기를 기다리는 중') : `${count}/3명 접속 · 플레이어 대기 중`;
    $('timer').textContent = `${String(Math.floor(s.timeLeft / 60)).padStart(2, '0')}:${String(s.timeLeft % 60).padStart(2, '0')}`;
    $('timer').className = 'timer' + (s.timeLeft <= 20 ? ' danger' : s.timeLeft <= 45 ? ' warn' : '');
    for (let i = 1; i <= 3; i++) $(`s${i}`).classList.toggle('hit', i <= s.strikes);
    if (s.status === 'playing' && lastStatus !== 'playing') {
      $('overlay').style.display = 'none'; $('round').textContent = `MODULE 0${s.round + 1} / 03`;
      $('message').textContent = '작전 시작! 듣지 못하는 담당의 신호를 기다리세요.'; $('message').classList.remove('empty');
      if (role === 'blind' && window.onlineAudio && 'speechSynthesis' in window) { const u = new SpeechSynthesisUtterance('작전 시작. 눈을 감고 팀원의 음성 지시를 기다리세요.'); u.lang = 'ko-KR'; speechSynthesis.speak(u); }
    }
    if (s.status === 'playing' && s.round !== Number(($('round').textContent.match(/\d/) || [1])[0]) - 1) {
      $('round').textContent = `MODULE 0${s.round + 1} / 03`;
      if (role === 'mute') $('question').innerHTML = moduleInfo[s.round].q;
      if (role === 'deaf') { $('subhint').textContent = moduleInfo[s.round].hint; $('deafHint').innerHTML = '<strong>폭탄 신호 ›</strong> ' + moduleInfo[s.round].clue; $('message').textContent = '말 없는 담당이 매뉴얼 규칙을 보내기를 기다리세요.'; $('message').classList.add('empty'); }
      if (role === 'blind') $('deafHint').innerHTML = '<strong>새 모듈</strong> · 해결 담당의 번호 지시를 기다리세요.';
    }
    if (s.status === 'won' || s.status === 'failed') {
      $('overlay').style.display = 'none'; $('question').style.display = 'block';
      $('question').innerHTML = s.status === 'won' ? '<em>폭탄 해제 성공!</em> 세 명이 임무를 완수했어요.' : '<em>작전 실패</em> 팀원과 다시 도전해 보세요.';
      $('deafHint').style.display = role === 'deaf' ? 'block' : 'none';
      $('message').textContent = s.status === 'won' ? 'MISSION COMPLETE · 함께 해냈어요!' : 'MISSION FAILED · 방장이 다시 시작할 수 있어요.';
      $('onlineStart').textContent = '방장이 새 게임을 시작할 수 있어요';
    }
    if (s.status === 'paused') { $('overlay').style.display = 'grid'; status('플레이어 연결이 끊겨 작전을 멈췄어요. 다시 참가하면 이어갈 수 있어요.'); }
    if (s.status === 'waiting') { $('overlay').style.display = 'grid'; status(`내 역할: ${roleNames[role]} · 방 코드 ${s.code} · ${count}/3명`); }
    lastStatus = s.status;
  }
  $('createRoom').onclick = () => connect('create');
  $('joinRoom').onclick = () => connect('join');
  $('onlineStart').onclick = () => send('start');
  $('readyBtn').onclick = () => { document.querySelector('.modal p').textContent = '색깔 제한 담당이 폭탄을 누릅니다. 말 없는 담당은 매뉴얼 규칙을 무음 전달하고, 듣지 못하는 담당은 폭탄 신호와 규칙을 풀어 번호를 시각적으로 알려줍니다.'; status('세 명 모두 다른 컴퓨터에서 같은 방 코드로 접속하면 됩니다.'); };
  $('copyInvite').onclick = async () => {
    let base = location.protocol === 'file:' ? 'http://localhost:3000/' : location.href;
    if (location.hostname === 'localhost' || location.protocol === 'file:') {
      try {
        const host = location.host || 'localhost:3000';
        const info = await fetch(`${location.protocol === 'https:' ? 'https:' : 'http:'}//${host}/network-addresses`).then(r => r.json());
        if (info.addresses?.length) base = `http://${info.addresses[0]}:3000/`;
      } catch { /* The room code below still works when a link cannot be generated. */ }
    }
    const url = new URL(base); url.searchParams.set('room', $('inviteCode').textContent);
    try { await navigator.clipboard.writeText(url.toString()); status(`같은 Wi-Fi 초대 링크를 복사했어요. 다른 역할을 선택하고 참가하세요.`); }
    catch { status(`초대 주소 ${url.toString()} · 코드 ${$('inviteCode').textContent}를 팀원에게 알려주세요.`); }
  };
  const room = new URLSearchParams(location.search).get('room'); if (room) $('roomCode').value = room;
})();
