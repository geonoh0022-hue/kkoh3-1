import http from 'node:http';
import {openStore} from './database.mjs';
import {randomBytes,scryptSync,timingSafeEqual,createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {initial,validate,apply,allowStudent,publicView} from './shared.mjs';
import {adapt} from './server-adapter.mjs';
const root=dirname(fileURLToPath(import.meta.url));
const digest=s=>createHash('sha256').update(s).digest('hex');
function passwordHash(value,salt=randomBytes(16).toString('hex')){return salt+':'+scryptSync(value,salt,32).toString('hex');}
function verify(value,encoded){const [salt,hash]=encoded.split(':');return timingSafeEqual(Buffer.from(hash,'hex'),scryptSync(value,salt,32));}
export async function createApp({dataDir,databaseUrl,adminPassword,production=false}={}){
  const db=await openStore({databaseUrl,dataDir,production});
  try{
    await db.exec('CREATE TABLE IF NOT EXISTS app (id INTEGER PRIMARY KEY CHECK(id=1), data TEXT NOT NULL, revision INTEGER NOT NULL); CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY,value TEXT NOT NULL); CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY,expires BIGINT NOT NULL); CREATE TABLE IF NOT EXISTS requests (id TEXT PRIMARY KEY,created BIGINT NOT NULL);');
    if(!await db.get('SELECT value FROM settings WHERE key=?','password')){
      if(typeof adminPassword!=='string'||adminPassword.length<8)throw Error('처음 시작할 때 ADMIN_PASSWORD를 8자 이상으로 설정해주세요.');
      await db.run('INSERT INTO settings VALUES (?,?) ON CONFLICT (key) DO NOTHING','password',passwordHash(adminPassword));
    }
    await db.run('INSERT INTO app VALUES (1,?,0) ON CONFLICT (id) DO NOTHING',JSON.stringify(initial()));
  }catch(err){await db.close();throw err;}
  const source=adapt(readFileSync(join(root,'index.html'),'utf8'));
  const shared=readFileSync(join(root,'shared.mjs'),'utf8');
  const attempts=new Map();
  async function isTeacher(req){const cookie=(req.headers.cookie||'').split(';').map(s=>s.trim()).find(s=>s.startsWith('exam_session='));if(!cookie)return false;const token=cookie.slice(13);const found=await db.get('SELECT expires FROM sessions WHERE token=?',digest(token));return !!found&&found.expires>Date.now();}
  const cookie=(token,age)=>'exam_session='+token+'; Path=/; HttpOnly; SameSite=Strict; Max-Age='+age+(production?'; Secure':'');
  function send(res,status,value,headers={}){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'same-origin',...headers});res.end(typeof value==='string'?value:JSON.stringify(value));}
  async function body(req){let n=0,chunks=[];for await(const c of req){n+=c.length;if(n>20000000)throw Object.assign(Error('요청이 너무 큽니다.'),{status:413});chunks.push(c);}try{return JSON.parse(Buffer.concat(chunks).toString());}catch{throw Object.assign(Error('요청 형식 오류'),{status:400});}}
  const server=http.createServer(async(req,res)=>{
    try{
      const url=new URL(req.url,'http://localhost');
      if(req.method==='GET'&&url.pathname==='/health'){return send(res,200,{ok:true});}
      if(req.method==='GET'&&(url.pathname==='/'||url.pathname==='/index.html'))return send(res,200,source,{'Content-Type':'text/html; charset=utf-8','Content-Security-Policy':"default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"});
      if(req.method==='GET'&&url.pathname==='/shared.mjs')return send(res,200,shared,{'Content-Type':'text/javascript; charset=utf-8'});
      if(req.method==='GET'&&url.pathname==='/api/state'){
        const row=await db.get('SELECT data,revision FROM app');const teacher=await isTeacher(req);const data=JSON.parse(row.data);
        return send(res,200,{database:teacher?data:publicView(data),revision:row.revision,teacher});
      }
      if(req.method!=='POST'||!url.pathname.startsWith('/api/'))return send(res,404,{error:'찾을 수 없습니다.'});
      if(!req.headers.origin||new URL(req.headers.origin).host!==req.headers.host||production&&!req.headers.origin.startsWith('https://'))return send(res,403,{error:'허용되지 않은 요청입니다.'});
      if(!req.headers['content-type']?.startsWith('application/json'))return send(res,415,{error:'JSON 요청이 필요합니다.'});
      const input=await body(req);
      if(url.pathname==='/api/login'){
        const ip=req.socket.remoteAddress;const now=Date.now();for(const [k,v] of attempts)if(v.until<now)attempts.delete(k);
        const record=attempts.get(ip)||{count:0,until:now+900000};if(record.count>=10)return send(res,429,{error:'로그인 시도가 많습니다. 15분 후 다시 시도해주세요.'});
        if(typeof input.password!=='string'||input.password.length>512||!verify(input.password,(await db.get('SELECT value FROM settings WHERE key=?','password')).value)){record.count++;attempts.set(ip,record);return send(res,401,{error:'비밀번호가 맞지 않습니다.'});}
        attempts.delete(ip);await db.run('DELETE FROM sessions WHERE expires<?',now);const token=randomBytes(32).toString('hex');await db.run('INSERT INTO sessions VALUES (?,?)',digest(token),now+8*3600000);
        return send(res,200,{ok:true},{'Set-Cookie':cookie(token,28800)});
      }
      if(url.pathname==='/api/logout'){
        const token=(req.headers.cookie||'').split(';').map(s=>s.trim()).find(s=>s.startsWith('exam_session='))?.slice(13);if(token)await db.run('DELETE FROM sessions WHERE token=?',digest(token));
        return send(res,200,{ok:true},{'Set-Cookie':cookie('',0)});
      }
      const teacher=await isTeacher(req);
      if(url.pathname==='/api/check-password')return send(res,teacher&&typeof input.password==='string'&&input.password.length<=512&&verify(input.password,(await db.get('SELECT value FROM settings WHERE key=?','password')).value)?200:401,{ok:true});
      if(url.pathname==='/api/password'){
        if(!teacher)return send(res,401,{error:'교사 로그인이 필요합니다.'});
        if(typeof input.password!=='string'||input.password.length<8||input.password.length>512)return send(res,400,{error:'비밀번호는 8~512자로 입력해주세요.'});
        await db.transaction(async tx=>{await tx.run('UPDATE settings SET value=? WHERE key=?',passwordHash(input.password),'password');await tx.exec('DELETE FROM sessions');});return send(res,200,{ok:true},{'Set-Cookie':cookie('',0)});
      }
      if(url.pathname==='/api/changes'){
        if(!Array.isArray(input.ops)||input.ops.length>50000||typeof input.id!=='string'||!/^[a-zA-Z0-9-]{16,100}$/.test(input.id))return send(res,400,{error:'변경 요청 형식 오류'});
        if(input.teacher&&!teacher)return send(res,401,{error:'교사 로그인이 만료되었습니다. 다시 로그인해주세요.'});
        const revision=await db.transaction(async tx=>{
          const row=await tx.get('SELECT data,revision FROM app WHERE id=1'+tx.lock);
          if(await tx.get('SELECT id FROM requests WHERE id=?',input.id))return row.revision;
          const data=JSON.parse(row.data);
          if(!teacher)allowStudent(data,input.ops);
          const next=validate(apply(data,input.ops));
          await tx.run('UPDATE app SET data=?,revision=revision+1 WHERE id=1',JSON.stringify(next));
          await tx.run('INSERT INTO requests VALUES (?,?)',input.id,Date.now());
          await tx.run('DELETE FROM requests WHERE created<?',Date.now()-7*86400000);
          return row.revision+1;
        });
        return send(res,200,{ok:true,revision});
      }
      return send(res,404,{error:'찾을 수 없습니다.'});
    }catch(e){send(res,e.status||500,{error:e.status?e.message:'서버 저장에 실패했습니다. 잠시 후 다시 시도해주세요.'});}
  });
  server.requestTimeout=30000;server.headersTimeout=15000;
  return {server,close:async()=>{await new Promise(resolve=>server.close(resolve));await db.close();}};
}
if(typeof process!=='undefined'&&process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const app=await createApp({databaseUrl:process.env.DATABASE_URL,dataDir:process.env.DATA_DIR||join(root,'data'),adminPassword:process.env.ADMIN_PASSWORD,production:process.env.NODE_ENV==='production'});
  app.server.listen(Number(process.env.PORT||3000),'0.0.0.0',()=>console.log('시험기간 이벤트 서버가 시작되었습니다.'));
  const stop=()=>app.close().then(()=>process.exit(0));process.on('SIGTERM',stop);process.on('SIGINT',stop);
}
