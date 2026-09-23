import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createApp} from './server.mjs';
import {diff} from './shared.mjs';
export async function runTests(factory=createApp){
  const dir=await mkdtemp(join(tmpdir(),'exam-events-test-'));let app;
  const start=async()=>{app=await factory({dataDir:dir,adminPassword:'test-password-123'});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));return 'http://127.0.0.1:'+app.server.address().port;};
  let url=await start(),cookie='',count=0;
  const request=async(route,data,teacher=false,origin=url)=>{const r=await fetch(url+route,{method:data===undefined?'GET':'POST',headers:{'Content-Type':'application/json',Origin:origin,...(teacher?{Cookie:cookie}:{})},body:data===undefined?undefined:JSON.stringify(data)});return {status:r.status,data:await r.json(),cookie:r.headers.get('set-cookie')};};
  const change=(before,after,teacher=false)=>request('/api/changes',{id:crypto.randomUUID(),ops:diff(before,after),teacher},teacher);
  try{
    assert.equal((await request('/api/login',{password:'incorrect'})).status,401);count++;
    const login=await request('/api/login',{password:'test-password-123'});assert.equal(login.status,200);cookie=login.cookie.split(';')[0];assert.match(login.cookie,/HttpOnly/);count++;
    const base=(await request('/api/state',undefined,true)).data.database;
    const seeded=structuredClone(base),year=seeded.activeYear,exam=seeded.activeExam,s=seeded.years[year].sessions[exam];
    seeded.years[year].roster=[{id:'s_a',name:'테스트가'},{id:'s_b',name:'테스트나'}];s.students=seeded.years[year].roster.map(r=>({...r,studyJoined:false,studyExcluded:false,studyMinutes:'',plannerJoined:false,plannerExcluded:false,plannerDates:[],lotto:{math:{pred:'',actual:''}}}));s.exams=[{id:'exam_a',subject:'수학',subjectKey:'math',date:'',period:'',range:'',note:''}];
    assert.equal((await change(base,seeded)).status,403);count++;
    assert.equal((await change(base,seeded,true)).status,200);count++;
    const a=structuredClone(seeded),b=structuredClone(seeded);a.years[year].sessions[exam].students[0].lotto.math.pred='80';b.years[year].sessions[exam].students[1].lotto.math.pred='90';
    const parallel=await Promise.all([change(seeded,a),change(seeded,b)]);assert.equal(JSON.stringify(parallel.map(r=>r.status)),JSON.stringify([200,200]));let latest=(await request('/api/state')).data.database;assert.equal(JSON.stringify(latest.years[year].sessions[exam].students.map(s=>s.lotto.math.pred)),JSON.stringify(['80','90']));count++;
    const stale=structuredClone(seeded);stale.years[year].sessions[exam].students[0].lotto.math.pred='70';assert.equal((await change(seeded,stale)).status,409);count++;
    const invalid=structuredClone(latest);invalid.years[year].sessions[exam].students[0].lotto.math.actual='101';assert.equal((await change(latest,invalid)).status,400);count++;
    const closed=structuredClone(latest);closed.years[year].sessions[exam].lottoPredWindow={start:'2000-01-01',end:'2000-01-02'};assert.equal((await change(latest,closed,true)).status,200);const blocked=structuredClone(closed);blocked.years[year].sessions[exam].students[0].lotto.math.pred='85';assert.equal((await change(closed,blocked)).status,403);count++;
    const actual=structuredClone(closed);actual.years[year].sessions[exam].students[0].lotto.math.actual='82';assert.equal((await change(closed,actual)).status,200);count++;
    assert.equal((await request('/api/login',{password:'test-password-123'},false,'https://other.example')).status,403);count++;
    const beforeRestart=(await request('/api/state')).data.database;await app.close();url=await start();assert.equal(JSON.stringify((await request('/api/state')).data.database),JSON.stringify(beforeRestart));count++;
    assert.equal((await request('/api/logout',{},true)).status,200);assert.equal((await request('/api/state',undefined,true)).data.teacher,false);count++;
    return {passed:count,checks:['교사 로그인','교사 권한 검증','동시 학생 점수 저장','충돌 감지','점수 범위 검증','기간 검증','출처 검증','재시작 후 유지','로그아웃']};
  }finally{await app.close();if(!dir.startsWith(join(tmpdir(),'exam-events-test-')))throw Error('Unsafe test path');await rm(dir,{recursive:true,force:true});}
}
if(typeof process!=='undefined'&&process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)console.log(await runTests());
