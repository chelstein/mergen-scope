/* KedgeIQ parser/FFT worker.
   Runs the heavy CPU-bound parser and FFT pipelines off the main thread
   so large files don't freeze the UI. The worker shares the same module
   files as the main thread; AudioContext is main-thread only, so the
   audio path receives already-decoded channel arrays from the main thread. */
self.window=self;
self.global=self;

var _workerQuery=(self.location&&self.location.search)||"";
importScripts(
  "./trace-model.js"+_workerQuery,
  "./touchstone-math-helpers.js"+_workerQuery,
  "./file-store-helpers.js"+_workerQuery,
  "./parser-helpers.js"+_workerQuery
);

var PH=self.ParserHelpers||{};

function postOk(id,result){self.postMessage({id:id,ok:true,result:result});}
function postErr(id,err){self.postMessage({id:id,ok:false,error:err&&err.message||String(err)});}

self.onmessage=function(ev){
  var msg=ev.data||{};
  var id=msg.id;
  try{
    if(msg.kind==="audio-channels"){
      if(typeof PH.parseAudioFromChannels!=="function")throw new Error("parseAudioFromChannels not available in worker.");
      postOk(id,PH.parseAudioFromChannels(msg.channels,msg.sampleRate,msg.fileName,msg.options));
      return;
    }
    if(msg.kind==="iq-file"){
      if(typeof PH.parseIqFile!=="function")throw new Error("parseIqFile not available in worker.");
      postOk(id,PH.parseIqFile(msg.arrayBuffer,msg.fileName,msg.options));
      return;
    }
    if(msg.kind==="sigmf-pair"){
      if(typeof PH.parseSigmfPair!=="function")throw new Error("parseSigmfPair not available in worker.");
      postOk(id,PH.parseSigmfPair(msg.metaText,msg.dataBuffer,msg.baseName,msg.options));
      return;
    }
    if(msg.kind==="measurement"){
      if(typeof PH.parseMeasurementFile!=="function")throw new Error("parseMeasurementFile not available in worker.");
      postOk(id,PH.parseMeasurementFile(msg.text,msg.fileName));
      return;
    }
    if(msg.kind==="mask"){
      if(typeof PH.parseSpecMaskJson!=="function")throw new Error("parseSpecMaskJson not available in worker.");
      postOk(id,PH.parseSpecMaskJson(msg.text,msg.fileName));
      return;
    }
    throw new Error("Unknown parser kind: "+msg.kind);
  }catch(err){postErr(id,err);}
};
