// Keep index.html byte-for-byte identical to the supplied file.
// Apply only storage/authentication integration when serving the page.
export function adapt(original){
  let html=original;
  const replace=(a,b)=>{if(!html.includes(a))throw Error('HTML 연동 위치를 찾지 못했습니다: '+a.slice(0,80));html=html.replace(a,b);};
  replace('(function(){',String.raw`(async function(){
  const {diff}=await import('/shared.mjs');
  async function api(url,payload){
    const response=await fetch(url,{method:payload===undefined?'GET':'POST',credentials:'same-origin',headers:payload===undefined?{}:{'Content-Type':'application/json'},body:payload===undefined?undefined:JSON.stringify(payload),signal:AbortSignal.timeout(15000)});
    const result=await response.json();if(!response.ok)throw Error(result.error||'요청 실패');return result;
  }
  const boot=await api('/api/state');
  let baseline=null,saveQueue=Promise.resolve(true),pending=0,failed=false,revision=boot.revision,refreshing=false;
  function markSaved(){document.getElementById('saveStatus').textContent='서버에 저장됨 · '+new Date().toLocaleTimeString('ko-KR',{hour:'2-digit',minute:'2-digit'});}
  function refreshData(result){
    database=result.database;teacherAdminUnlocked=result.teacher;revision=result.revision;
    state=openSession(database.activeYear,database.activeExam);syncSubjects();renderAll();
    if(!studentView.hidden)renderStudentEntryForm();
    commitCurrent();baseline=structuredClone(database);
  }
  async function waitSaved(){return await saveQueue;}
  window.addEventListener('beforeunload',e=>{if(pending){e.preventDefault();e.returnValue='';}});
`);
  const a=html.indexOf('  function saveState(){'),b=html.indexOf('\n  function makeStudent',a);
  if(a<0||b<0)throw Error('saveState missing');
  html=html.slice(0,a)+String.raw`  function saveState(){
    if(failed){alert('저장 연결을 복구 중입니다. 잠시 후 다시 입력해주세요.');return false;}
    syncSubjects();commitCurrent();const snapshot=structuredClone(database),ops=diff(baseline,snapshot);baseline=snapshot;
    if(!ops.length)return true;
    const request={id:crypto.randomUUID(),ops,teacher:teacherAdminUnlocked};pending++;
    document.getElementById('saveStatus').textContent='서버에 저장 중…';
    saveQueue=saveQueue.then(async previous=>{
      if(!previous)return false;
      try{const result=await api('/api/changes',request);revision=-1;markSaved();return true;}
      catch(err){failed=true;document.getElementById('saveStatus').textContent='저장 실패 · '+err.message;seConfirm.hidden=true;alert('저장되지 않았습니다. '+err.message);return false;}
    }).finally(async()=>{
      pending--;
      if(!pending&&failed){try{refreshData(await api('/api/state'));failed=false;saveQueue=Promise.resolve(true);document.getElementById('saveStatus').textContent='서버 기록을 다시 불러왔습니다. 실패한 입력을 다시 입력해주세요.';}catch{document.getElementById('saveStatus').textContent='서버 연결 실패 · 새로고침 후 다시 입력해주세요.';}}
    });
    renderSummary();return true;
  }
`+html.slice(b);
  const la=html.indexOf('  function loadDatabase(){'),lb=html.indexOf('\n  function openSession',la);
  html=html.slice(0,la)+'  function loadDatabase(){return structuredClone(boot.database);}\n'+html.slice(lb);
  replace('let teacherAdminUnlocked = false;','let teacherAdminUnlocked = boot.teacher;');
  const pa=html.indexOf('  function getLottoPin(){'),pb=html.indexOf('\n  function renderLottoGate',pa);
  html=html.slice(0,pa)+"  function getLottoPin(){return 'server-auth';}\n"+html.slice(pb);
  const ca=html.indexOf("  document.getElementById('lottoChangePinForm').addEventListener('submit'"),cb=html.indexOf('\n  function buildLottoHead',ca);
  html=html.slice(0,ca)+String.raw`  document.getElementById('lottoChangePinForm').addEventListener('submit',async e=>{
    e.preventDefault();if(!requireTeacherAdmin()||!await waitSaved())return;
    try{await api('/api/password',{password:document.getElementById('lottoChangePinInput').value.trim()});lottoChangePinBox.hidden=true;teacherAdminUnlocked=false;refreshData(await api('/api/state'));alert('비밀번호가 변경됐어요. 새 비밀번호로 다시 로그인해주세요.');}catch(err){alert(err.message);}
  });
`+html.slice(cb);
  replace("document.getElementById('resetAllBtn').addEventListener('click', () => {","document.getElementById('resetAllBtn').addEventListener('click', async () => {");
  replace("      if(input !== pin){\n        alert('비밀번호가 달라요.');\n        return;\n      }","      try{await api('/api/check-password',{password:input});}catch{alert('비밀번호가 달라요.');return;}");
  replace("document.getElementById('studentEntryForm').addEventListener('submit', e => {","document.getElementById('studentEntryForm').addEventListener('submit', async e => {");
  replace("    saveState();\n    renderLottoDiffBoard();\n    updateLottoCalculations();","    if(!saveState()||!await waitSaved())return;\n    renderLottoDiffBoard();\n    updateLottoCalculations();");
  replace("document.getElementById('contextForm').onsubmit=e=>{","document.getElementById('contextForm').onsubmit=async e=>{");
  replace('    if(!saveState())return;','    if(!saveState()||!await waitSaved())return;');
  replace("document.getElementById('backupBtn').onclick=()=>{","document.getElementById('backupBtn').onclick=async()=>{\n    if(!await waitSaved())return;");
  replace("  function setMode(mode){","  async function setMode(mode){\n    if(mode==='student'){if(!await waitSaved())return;try{await api('/api/logout',{});refreshData(await api('/api/state'));}catch(err){alert(err.message);return;}}");
  const ta=html.indexOf("  document.getElementById('teacherAdminForm').onsubmit="),tb=html.indexOf('\n  buildLottoHead();',ta);
  html=html.slice(0,ta)+String.raw`  document.getElementById('teacherAdminForm').onsubmit=async e=>{
    e.preventDefault();const input=document.getElementById('teacherAdminPin');
    if(!await waitSaved())return;
    try{await api('/api/login',{password:input.value});input.value='';document.getElementById('teacherAdminError').textContent='';refreshData(await api('/api/state'));}
    catch(err){document.getElementById('teacherAdminError').textContent=err.message;input.select();}
  };
  document.getElementById('teacherAdminLock').onclick=async()=>{
    if(!await waitSaved())return;
    try{await api('/api/logout',{});clearExamForm();refreshData(await api('/api/state'));}catch(err){alert(err.message);}
  };
`+html.slice(tb);
  replace('  renderAll();\n})();',String.raw`  renderAll();commitCurrent();baseline=structuredClone(database);markSaved();
  // The original recovery fields are not used for server authentication.
  for(const id of ['lottoChangeQuestion','lottoChangeAnswer'])document.getElementById(id).hidden=true;
  setInterval(async()=>{
    if(pending||failed||refreshing||document.hidden||/^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement.tagName)||editingExamId||seNameSelect.value||document.getElementById('examSubject').value||rosterInput.value)return;
    refreshing=true;
    try{const result=await api('/api/state');if(!pending&&(result.revision!==revision||result.teacher!==teacherAdminUnlocked)){refreshData(result);markSaved();}}
    catch{document.getElementById('saveStatus').textContent='서버 연결 확인 중 · 저장 시 연결이 필요합니다.';}finally{refreshing=false;}
  },5000);
})().catch(err=>{document.getElementById('saveStatus').textContent='서버 연결 실패 · 새로고침해주세요';document.querySelectorAll('button,input,select').forEach(x=>x.disabled=true);alert('서버 기록을 불러오지 못했습니다. '+err.message);});`);
  html=html.replace('이 기기의 브라우저에 저장됩니다. 다른 PC·휴대폰과 자동으로 연동되지 않습니다.','서버에 저장됩니다. 다른 PC·휴대폰에서도 같은 기록을 확인할 수 있습니다.').replace('교사용 기기에서 관리하고, 학생 입력은 선생님이 함께 확인해주세요. 화면 잠금은 표시를 가리는 기능이며 서버 로그인이나 데이터 암호화 기능은 아닙니다. 백업 파일에는 이름과 점수가 포함됩니다.','교사 로그인 후 명단과 시험 정보를 관리할 수 있습니다. 백업 파일에는 이름과 점수가 포함됩니다.').replace('선생님 기기에서 함께 입력하는 화면입니다. 본인 인증 기능은 없습니다.','이름을 선택해 점수를 입력하는 화면입니다. 본인 인증 기능은 없습니다.');
  return html;
}
