// Fault proxy for the isolated browser fixture. Never use with production.
const http=require('node:http');
const {randomUUID}=require('node:crypto');
const {WebSocket,WebSocketServer}=require('ws');
function startProxy(){
  if(process.env.NODE_ENV!=='test')throw new Error('The Oral Exam fault proxy requires NODE_ENV=test');
  const connections=new Set();
  const log=(event,connection)=>console.info(JSON.stringify({event:`fixture_proxy.${event}`,connection,at:new Date().toISOString()}));
  const server=http.createServer((req,res)=>{
    if(req.url==='/__fixture/drop'&&req.method==='POST'){
      res.setHeader('Access-Control-Allow-Origin','http://localhost:3110');
      const current=[...connections].findLast(c=>c.peer.readyState===WebSocket.OPEN);
      if(!current){res.writeHead(409);res.end('No active test connection');return;}
      // A gateway lost its browser-side TCP connection without yet closing its
      // server-side connection. Stop pong forwarding: the real watchdog remains.
      current.orphan=true;log('drop_browser',current.id);current.peer.terminate();
      res.setHeader('Content-Type','application/json');res.end(JSON.stringify({dropped:true,connection:current.id}));return;
    }
    const upstream=http.request({host:'127.0.0.1',port:5000,path:req.url,method:req.method,headers:req.headers},response=>{
      res.writeHead(response.statusCode,response.headers);response.pipe(res);
    });
    upstream.on('error',()=>{res.writeHead(502);res.end('Local fixture is unavailable');});req.pipe(upstream);
  });
  const wss=new WebSocketServer({noServer:true});
  server.on('upgrade',(req,socket,head)=>wss.handleUpgrade(req,socket,head,peer=>{
    const connection={peer,id:randomUUID(),orphan:false};connections.add(connection);log('connect',connection.id);
    // autoPong=false is essential: transport pongs must represent the browser.
    const upstream=new WebSocket('ws://127.0.0.1:5000/api/oral-exam/realtime',{origin:req.headers.origin,autoPong:false});
    connection.upstream=upstream;const queued=[];
    peer.on('message',(raw,binary)=>{if(upstream.readyState===WebSocket.OPEN)upstream.send(raw,{binary});else queued.push([raw,binary]);});
    upstream.on('open',()=>{for(const [raw,binary] of queued)upstream.send(raw,{binary});queued.length=0;});
    upstream.on('message',(raw,binary)=>{if(peer.readyState===WebSocket.OPEN)peer.send(raw,{binary});});
    upstream.on('ping',data=>{if(peer.readyState===WebSocket.OPEN)peer.ping(data);});
    peer.on('pong',data=>{if(upstream.readyState===WebSocket.OPEN)upstream.pong(data);});
    peer.on('close',()=>{if(!connection.orphan)upstream.close();});
    upstream.on('close',(code,reason)=>{
      log('upstream_close',connection.id);connections.delete(connection);
      if(peer.readyState===WebSocket.OPEN){if(code===1006)peer.terminate();else peer.close(code,reason);}
    });
    upstream.on('error',()=>{if(peer.readyState===WebSocket.OPEN)peer.terminate();});
    peer.on('error',()=>{});
  }));
  server.listen(5500,'127.0.0.1',()=>console.info('Isolated Oral Exam fault proxy: http://localhost:5500'));
  const close=()=>{for(const c of connections){c.peer.terminate();c.upstream.terminate();}wss.close();server.close();};
  process.once('SIGINT',close);process.once('SIGTERM',close);
  return {server,close};
}
if(require.main===module)startProxy();
module.exports={startProxy};
