export const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const keyed=a=>Array.isArray(a)&&a.every(x=>object(x)&&typeof x.id==='string')&&new Set(a.map(x=>x.id)).size===a.length;
export function diff(a,b,path=[]){
  if(same(a,b))return [];
  if(keyed(a)&&keyed(b)&&path.at(-1)==='students'){
    const out=[];
    for(const id of new Set([...a,...b].map(x=>x.id)))out.push(...diff(a.find(x=>x.id===id),b.find(x=>x.id===id),[...path,'@'+id]));
    return out;
  }
  if(object(a)&&object(b))return [...new Set([...Object.keys(a),...Object.keys(b)])].flatMap(k=>diff(a[k],b[k],[...path,k]));
  return [{path,had:a!==undefined,before:a??null,has:b!==undefined,after:b??null}];
}
export function apply(db,ops){
  const next=structuredClone(db);
  for(const op of ops){
    if(!Array.isArray(op.path)||!op.path.length||op.path.length>12||op.path.some(k=>typeof k!=='string'||['__proto__','prototype','constructor'].includes(k)))throw Error('변경 경로 오류');
    let parent=next;
    for(const key of op.path.slice(0,-1)){
      parent=key.startsWith('@')&&Array.isArray(parent)?parent.find(x=>x.id===key.slice(1)):Object.hasOwn(parent??{},key)?parent[key]:undefined;
      if(!parent||typeof parent!=='object')throw conflict();
    }
    const key=op.path.at(-1),index=key.startsWith('@')&&Array.isArray(parent)?parent.findIndex(x=>x.id===key.slice(1)):null;
    const current=index===null?parent[key]:index<0?undefined:parent[index];
    if(!same(current,op.had?op.before:undefined))throw conflict();
    if(index!==null){if(!op.has){if(index>=0)parent.splice(index,1);}else if(index<0)parent.push(op.after);else parent[index]=op.after;}
    else if(op.has)parent[key]=op.after;else delete parent[key];
  }
  return next;
}
export function conflict(){return Object.assign(Error('다른 기기에서 같은 기록이 변경되었습니다. 최신 기록을 확인하고 다시 입력해주세요.'),{status:409});}
const fail=()=>{throw Object.assign(Error('기록 형식이 올바르지 않습니다.'),{status:400});};
const id=x=>typeof x==='string'&&/^[a-zA-Z0-9_-]{1,100}$/.test(x);
const text=(x,max)=>typeof x==='string'&&x.length<=max;
const date=x=>typeof x==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(x)&&Number.isFinite(Date.parse(x))&&new Date(x).toISOString().slice(0,10)===x;
const score=x=>x===''||(['string','number'].includes(typeof x)&&String(x).trim()!==''&&Number.isFinite(Number(x))&&Number(x)>=0&&Number(x)<=100);
const examKeys=['1-1','1-2','2-1','2-2'];
export function validate(db){
  if(!object(db)||db.version!==3||!object(db.years)||Object.keys(db.years).length>201||!examKeys.includes(db.activeExam)||!Object.hasOwn(db.years,db.activeYear))fail();
  for(const [year,bucket] of Object.entries(db.years)){
    if(!/^(20\d{2}|21\d{2}|2200)$/.test(year)||!object(bucket)||!Array.isArray(bucket.roster)||bucket.roster.length>1000||!object(bucket.sessions))fail();
    if(bucket.roster.some(s=>!id(s.id)||!text(s.name,100)||!s.name.trim())||new Set(bucket.roster.map(s=>s.id)).size!==bucket.roster.length)fail();
    for(const [key,session] of Object.entries(bucket.sessions)){
      if(!examKeys.includes(key)||!object(session)||!Array.isArray(session.students)||session.students.length!==bucket.roster.length||new Set(session.students.map(s=>s.id)).size!==session.students.length)fail();
      for(const s of session.students){
        if(!bucket.roster.some(r=>r.id===s.id&&r.name===s.name)||!object(s.lotto))fail();
        for(const flag of ['studyJoined','studyExcluded','plannerJoined','plannerExcluded'])if(typeof s[flag]!=='boolean')fail();
        if(s.studyMinutes!==''&&(!Number.isSafeInteger(s.studyMinutes)||s.studyMinutes<0))fail();
        if(s.plannerDates!==undefined&&(!Array.isArray(s.plannerDates)||s.plannerDates.length>5000||s.plannerDates.some(x=>!date(x))||new Set(s.plannerDates).size!==s.plannerDates.length))fail();
        for(const [sub,points] of Object.entries(s.lotto)){if(!/^(eng|math|sci|hist|sub_[a-f0-9_]+)$/.test(sub)||!object(points)||!score(points.pred)||!score(points.actual))fail();}
      }
      for(const k of ['eventPeriod','lottoPredWindow'])if(session[k]){const w=session[k];if(!object(w)||![w.start,w.end].every(x=>x===''||date(x))||w.start&&w.end&&w.start>w.end)fail();}
      if(session.examDday&&(!date(session.examDday.date)||!text(session.examDday.title,60)))fail();
      if(!Array.isArray(session.exams)||session.exams.length>500)fail();
      for(const e of session.exams){if(!id(e.id)||!text(e.subject,40)||!e.subject.trim()||!id(e.subjectKey)||!['date','period','range','note'].every(k=>typeof e[k]==='string')||e.date&&!date(e.date)||e.period.length>20||e.range.length>3000||e.note.length>1000)fail();}
    }
  }
  if(!db.years[db.activeYear].sessions[db.activeExam])fail();
  return db;
}
export function initial(){const now=new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Seoul'}),year=now.slice(0,4),exam=Number(now.slice(5,7))<8?'1-1':'2-1';return {version:3,activeYear:year,activeExam:exam,years:{[year]:{roster:[],sessions:{[exam]:{students:[],exams:[],lottoPredWindow:{start:'',end:''}}}}}};}
export function publicView(db){const y=db.activeYear,e=db.activeExam;return {version:3,activeYear:y,activeExam:e,years:{[y]:{roster:db.years[y].roster,sessions:{[e]:db.years[y].sessions[e]}}}};}
export function allowStudent(db,ops){
  const session=db.years[db.activeYear].sessions[db.activeExam];
  const today=new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Seoul'});
  for(const op of ops){
    const p=op.path;
    if(p[0]!=='years'||p[1]!==db.activeYear||p[2]!=='sessions'||p[3]!==db.activeExam||p[4]!=='students'||!session.students.some(s=>'@'+s.id===p[5])||!op.has)throw Object.assign(Error('교사 로그인이 필요한 변경입니다.'),{status:403});
    if(p.length===7&&['studyJoined','studyExcluded','studyMinutes','plannerJoined','plannerExcluded','plannerDates'].includes(p[6])){if(p[6]==='plannerDates'&&(!Array.isArray(op.after)||op.after.some(x=>x>today)))fail();continue;}
    if(p.length===9&&p[6]==='lotto'&&session.exams.some(e=>e.subjectKey===p[7]&&e.subject.replace(/\s/g,'')!=='자기주도학습')&&['pred','actual'].includes(p[8])){
      if(!score(op.after)||op.after===''||Number(op.after)<(p[8]==='pred'?40:0))fail();
      const w=session.lottoPredWindow;
      if(p[8]==='pred'&&(w?.start&&today<w.start||w?.end&&today>w.end))throw Object.assign(Error('지금은 예상 점수 입력 기간이 아닙니다.'),{status:403});
      continue;
    }
    throw Object.assign(Error('허용되지 않은 변경입니다.'),{status:403});
  }
}
