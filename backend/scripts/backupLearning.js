require('dotenv').config();
const fs=require('node:fs/promises');
const crypto=require('node:crypto');
const {gzipSync,gunzipSync}=require('node:zlib');
const db=require('../src/lectureStudy/database');
const tables=['study_lectures','study_members','study_chunks','study_jobs','study_messages','study_quizzes','study_attempts','study_usage'];
const magic=Buffer.from('EFSL1');
const limit=128*1024*1024;
const key=()=>{
  const value=process.env.LEARNING_BACKUP_KEY;
  const result=Buffer.from(value||'','base64');
  if(result.length!==32||result.toString('base64')!==value)throw new Error('LEARNING_BACKUP_KEY must be 32 random bytes encoded as base64');
  return result;
};
const encrypt=(snapshot,secret=key())=>{
  const raw=Buffer.from(JSON.stringify(snapshot));
  if(raw.length>limit)throw new Error('Snapshot exceeds 128 MiB; use a database-native backup');
  const iv=crypto.randomBytes(12),cipher=crypto.createCipheriv('aes-256-gcm',secret,iv);
  cipher.setAAD(magic);
  const data=Buffer.concat([cipher.update(gzipSync(raw)),cipher.final()]);
  return Buffer.concat([magic,iv,cipher.getAuthTag(),data]);
};
const decrypt=(data,secret=key())=>{
  if(data.length<34||data.length>limit||!data.subarray(0,5).equals(magic))throw new Error('Invalid encrypted learning snapshot');
  const decipher=crypto.createDecipheriv('aes-256-gcm',secret,data.subarray(5,17));
  decipher.setAAD(magic);decipher.setAuthTag(data.subarray(17,33));
  const compressed=Buffer.concat([decipher.update(data.subarray(33)),decipher.final()]);
  return JSON.parse(gunzipSync(compressed,{maxOutputLength:limit}).toString('utf8'));
};
const migrations=async(client)=>(await client.query('SELECT name FROM study_schema_migrations ORDER BY name')).rows.map(row=>row.name);
const backup=()=>db.transaction(async(client)=>{
  await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY');
  const snapshot={format:1,created_at:new Date().toISOString(),migrations:await migrations(client),tables:{}};
  let bytes=0;
  for(const table of tables){
    const rows=[];
    // A stable snapshot has no concurrent inserts visible. Bound memory before
    // accumulating another page; no database URL or academic rows are exported.
    for(let offset=0;;offset+=500){
      const order=table==='study_usage'?'owner_key,day,kind':table==='study_members'?'owner_key,lecture_id':table==='study_chunks'?'lecture_id,version,id':'id';
      // pg maps DATE to local-midnight Date objects. Export this UTC calendar
      // key explicitly as text so restore cannot shift a usage day by timezone.
      const columns=table==='study_usage'?"owner_key,to_char(day,'YYYY-MM-DD') AS day,kind,requests":'*';
      const page=(await client.query(`SELECT ${columns} FROM ${table} ORDER BY ${order} LIMIT 500 OFFSET $1`,[offset])).rows;
      bytes+=Buffer.byteLength(JSON.stringify(page));
      if(bytes>limit)throw new Error('Snapshot exceeds 128 MiB; use a database-native backup');
      rows.push(...page);if(page.length<500)break;
    }
    snapshot.tables[table]=rows;
  }
  return encrypt(snapshot);
});
const restore=async(data)=>{
  // Authenticate and decompress completely before opening a write transaction.
  const snapshot=decrypt(data);
  if(snapshot.format!==1||!Array.isArray(snapshot.migrations)||!snapshot.tables||
    Object.keys(snapshot.tables).sort().join(',')!==[...tables].sort().join(',')||
    tables.some(table=>!Array.isArray(snapshot.tables[table])))throw new Error('Invalid snapshot manifest');
  return db.transaction(async(client)=>{
    await client.query('LOCK TABLE '+tables.join(',')+' IN ACCESS EXCLUSIVE MODE');
    if(JSON.stringify(await migrations(client))!==JSON.stringify(snapshot.migrations))throw new Error('Learning migration versions must match the snapshot');
    for(const table of tables)if((await client.query(`SELECT 1 FROM ${table} LIMIT 1`)).rowCount)throw new Error('Restore requires an empty migrated learning database');
    for(const table of tables){
      const rows=snapshot.tables[table];
      for(let offset=0;offset<rows.length;offset+=100)await client.query(`INSERT INTO ${table} SELECT * FROM json_populate_recordset(NULL::${table},$1::json)`,[JSON.stringify(rows.slice(offset,offset+100))]);
    }
    await client.query("UPDATE study_jobs SET status='queued',attempts=LEAST(attempts,2),lease_token=NULL,lease_until=NULL,available_at=NOW() WHERE status='running'");
    return {restored_at:new Date().toISOString(),rows:Object.fromEntries(tables.map(table=>[table,snapshot.tables[table].length]))};
  });
};
if(require.main===module)(async()=>{
  const [mode,file]=process.argv.slice(2);
  if(!['backup','restore'].includes(mode)||!file)throw new Error('Usage: node scripts/backupLearning.js backup|restore FILE');
  if(mode==='backup'){
    const encrypted=await backup();await fs.writeFile(file,encrypted,{flag:'wx',mode:0o600});
    console.log('Encrypted learning snapshot saved; store its key separately.');
  }else{
    if((await fs.stat(file)).size>limit)throw new Error('Snapshot exceeds size limit');
    console.log(JSON.stringify(await restore(await fs.readFile(file))));
  }
})().catch(error=>{console.error('Learning backup/restore failed:',error.code||error.message);process.exitCode=1;}).finally(db.close);
module.exports={backup,restore,encrypt,decrypt,tables};
