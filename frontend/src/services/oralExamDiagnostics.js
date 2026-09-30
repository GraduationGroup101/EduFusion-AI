export function oralLifecycle(event,fields={}) {
  const allowed=['session','connection','server_connection','code','reason','attempt','delay_ms'];
  const record={event:`oral_exam.${event}`,at:new Date().toISOString()};
  for(const key of allowed)if(fields[key]!==undefined)record[key]=fields[key];
  console.info('Oral Exam:',record);
}
