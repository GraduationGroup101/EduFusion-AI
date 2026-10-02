// Deliberately accept lifecycle metadata only, never handshake/provider payloads.
function lifecycle(event,fields={}) {
  const allowed=['session','connection','phase','code','reason','status','stage','attempt','elapsed_ms','pong_age_ms','lease_remaining_ms','auth_remaining_seconds','error_class','provider','provider_status','provider_code'];
  const record={event:`oral_exam.${event}`,at:new Date().toISOString()};
  for(const key of allowed)if(fields[key]!==undefined)record[key]=fields[key];
  console.info(JSON.stringify(record));
}
module.exports={lifecycle};
