// PostgreSQL in deployment; SQLite is used only for local tests.
import {mkdirSync} from 'node:fs';
import {join} from 'node:path';
export async function openStore({databaseUrl,dataDir,production=false}){
  if(databaseUrl){
    const {default:pg}=await import('pg');
    const parsed=new URL(databaseUrl);
    if(!['postgres:','postgresql:'].includes(parsed.protocol))throw Error('DATABASE_URL 형식 오류');
    // Verify the database server certificate. Do not use rejectUnauthorized:false.
    parsed.searchParams.delete('sslmode');parsed.searchParams.delete('ssl');
    const pool=new pg.Pool({connectionString:parsed.toString(),ssl:production?{rejectUnauthorized:true}:undefined,max:5,connectionTimeoutMillis:15000,idleTimeoutMillis:10000});
    pool.on('error',()=>console.error('데이터베이스 연결이 종료되었습니다. 다음 요청에서 다시 연결합니다.'));
    const wrap=client=>({
      exec:sql=>client.query(sql),
      get:async(sql,...args)=>(await client.query(sql.replace(/\?/g,(()=>{let i=0;return()=>'$'+(++i)})()),args)).rows[0],
      run:async(sql,...args)=>client.query(sql.replace(/\?/g,(()=>{let i=0;return()=>'$'+(++i)})()),args),
      lock:' FOR UPDATE'
    });
    const store=wrap(pool);
    store.transaction=async fn=>{const client=await pool.connect();try{await client.query('BEGIN');const value=await fn(wrap(client));await client.query('COMMIT');return value;}catch(err){await client.query('ROLLBACK');throw err;}finally{client.release();}};
    store.close=()=>pool.end();return store;
  }
  if(production)throw Error('무료 Render 배포에는 Neon DATABASE_URL이 필요합니다. 임시 디스크에 저장하지 않습니다.');
  if(!dataDir)throw Error('로컬 DATA_DIR가 필요합니다.');
  const {DatabaseSync}=await import('node:sqlite');mkdirSync(dataDir,{recursive:true});
  const db=new DatabaseSync(join(dataDir,'events.sqlite'));db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;');
  let queue=Promise.resolve();
  const exclusive=fn=>{const next=queue.then(fn);queue=next.catch(()=>{});return next;};
  const direct={exec:sql=>db.exec(sql),get:(sql,...args)=>db.prepare(sql).get(...args),run:(sql,...args)=>db.prepare(sql).run(...args),lock:''};
  return {
    exec:sql=>exclusive(()=>direct.exec(sql)),get:(sql,...args)=>exclusive(()=>direct.get(sql,...args)),run:(sql,...args)=>exclusive(()=>direct.run(sql,...args)),lock:'',
    transaction:fn=>exclusive(async()=>{db.exec('BEGIN IMMEDIATE');try{const value=await fn(direct);db.exec('COMMIT');return value;}catch(err){db.exec('ROLLBACK');throw err;}}),
    close:()=>exclusive(()=>db.close())
  };
}
