(function(global){
  var TM=global.TraceModel||{};
  var FSH=global.FileStoreHelpers||{};
  var TSH=global.TouchstoneMathHelpers||{};
  var makeTrace=TM.makeTrace||function(prefix,fileName,traceName){return {name:prefix+traceName,dn:prefix+traceName,fileName:fileName,data:[]};};
  var dedupeParsedTraces=FSH.dedupeParsedTraces||function(traces){return traces||[];};
  var normalizeTraceData=FSH.normalizeTraceData||function(data){return data||[];};
  var cx=TSH.cx||function(re,im){return {re:isFinite(re)?Number(re):0,im:isFinite(im)?Number(im):0};};
  var touchstonePairToComplex=TSH.touchstonePairToComplex||function(dataFormat,a,b){
    var fmt=String(dataFormat||"MA").trim().toUpperCase();
    if(fmt==="RI")return cx(a,b);
    if(fmt==="DB")return cx(Math.pow(10,Number(a)/20)*Math.cos(Number(b)*Math.PI/180),Math.pow(10,Number(a)/20)*Math.sin(Number(b)*Math.PI/180));
    var mag=Number(a),ang=Number(b)*Math.PI/180;
    return cx(mag*Math.cos(ang),mag*Math.sin(ang));
  };
  var buildMatrixOrder=TSH.buildMatrixOrder||function(portCount,matrixFormat){
    var n=Math.max(1,Math.floor(Number(portCount)||0));
    var fmt=String(matrixFormat||"full").trim().toLowerCase();
    var order=[];
    var row,col;
    if(fmt==="lower"){
      for(col=0;col<n;col++){
        for(row=col;row<n;row++)order.push({row:row,col:col});
      }
      return order;
    }
    if(fmt==="upper"){
      for(col=0;col<n;col++){
        for(row=0;row<=col;row++)order.push({row:row,col:col});
      }
      return order;
    }
    for(col=0;col<n;col++){
      for(row=0;row<n;row++)order.push({row:row,col:col});
    }
    return order;
  };
  var normalizeReferenceArray=TSH.normalizeReferenceArray||function(referenceOhms,portCount){
    var n=Math.max(1,Math.floor(Number(portCount)||0));
    if(Array.isArray(referenceOhms)){
      if(referenceOhms.length===1){
        var single=Number(referenceOhms[0]);
        if(!isFinite(single)||single<=0)return null;
        var rep=[];
        for(var i=0;i<n;i++)rep.push(single);
        return rep;
      }
      if(referenceOhms.length!==n)return null;
      var out=[];
      for(var j=0;j<referenceOhms.length;j++){
        var value=Number(referenceOhms[j]);
        if(!isFinite(value)||value<=0)return null;
        out.push(value);
      }
      return out;
    }
    var scalar=Number(referenceOhms);
    if(!isFinite(scalar)||scalar<=0)return null;
    var arr=[];
    for(var k=0;k<n;k++)arr.push(scalar);
    return arr;
  };
  var expandOrderedValuesToMatrix=TSH.expandOrderedValuesToMatrix||function(portCount,matrixFormat,values){
    var n=Math.max(1,Math.floor(Number(portCount)||0));
    var fmt=String(matrixFormat||"full").trim().toLowerCase();
    var order=buildMatrixOrder(n,fmt);
    if(!Array.isArray(values)||values.length!==order.length)return null;
    var matrix=[];
    for(var row=0;row<n;row++){
      var line=[];
      for(var col=0;col<n;col++)line.push(cx(0,0));
      matrix.push(line);
    }
    for(var i=0;i<order.length;i++){
      var entry=order[i];
      var value=values[i]||cx(0,0);
      matrix[entry.row][entry.col]=cx(value.re,value.im);
      if(fmt!=="full"&&entry.row!==entry.col)matrix[entry.col][entry.row]=cx(value.re,value.im);
    }
    return matrix;
  };
  var getTouchstoneFileBaseName=TSH.getTouchstoneFileBaseName||function(fileName){
    var name=String(fileName||"").replace(/^.*[\\/]/,"");
    return name.replace(/\.[^.]+$/,"")||name||"touchstone";
  };
  var _fc=0;

  function resetParserFileCounter(){
    _fc=0;
  }

  function syncParserFileCounter(files){
    var nextCount=Array.isArray(files)?files.length:0;
    if(nextCount>_fc)_fc=nextCount;
  }

  function nearestPoint(tr,freq,left,right){
    if(!tr||!tr.data||!tr.data.length||!isFinite(freq))return null;
    var data=tr.data;
    var lo=0,hi=data.length-1,mid;
    if(left!=null||right!=null){
      while(lo<data.length&&left!=null&&data[lo].freq<left)lo++;
      while(hi>=0&&right!=null&&data[hi].freq>right)hi--;
      if(lo>hi)return null;
    }
    while(lo<hi){
      mid=(lo+hi)>>1;
      if(data[mid].freq<freq)lo=mid+1; else hi=mid;
    }
    var idx=lo;
    var best=data[idx],bestDist=Math.abs(data[idx].freq-freq);
    if(idx>0){
      var p=data[idx-1],d=Math.abs(p.freq-freq);
      if(d<bestDist){best=p;bestDist=d;idx=idx-1;}
    }
    if(idx+1<data.length){
      var n=data[idx+1],d2=Math.abs(n.freq-freq);
      if(d2<bestDist){best=n;bestDist=d2;idx=idx+1;}
    }
    if(data.length>1){
      var prev=idx>0?data[idx-1]:null;
      var next=idx+1<data.length?data[idx+1]:null;
      var localStep=Math.min(
        prev?Math.abs(best.freq-prev.freq):Infinity,
        next?Math.abs(next.freq-best.freq):Infinity
      );
      if(!isFinite(localStep)||localStep<=0){
        var span=Math.abs(data[data.length-1].freq-data[0].freq);
        localStep=data.length>1?span/(data.length-1):Infinity;
      }
      var maxDist=isFinite(localStep)&&localStep>0?localStep*2.5:Infinity;
      if(bestDist>maxDist)return null;
    }
    return best;
  }

  function getFirstNonCommentLine(text){
    var lines=String(text||"").split(/\r?\n/);
    for(var i=0;i<lines.length;i++){
      var line=lines[i].replace(/^\uFEFF/,"").trim();
      if(!line)continue;
      if(line.charAt(0)==="!")continue;
      return line;
    }
    return "";
  }

  function isTouchstoneFileName(fileName){
    return /\.(s\d+p)$/i.test(String(fileName||""));
  }

  function getTouchstonePortCountFromFileName(fileName){
    var match=String(fileName||"").match(/\.s(\d+)p$/i);
    return match?Math.max(1,parseInt(match[1],10)):null;
  }

  function looksLikeTouchstoneText(text){
    var first=getFirstNonCommentLine(text);
    if(!first)return false;
    if(/^\[Version\]/i.test(first))return true;
    if(/^\[(Number of Ports|Reference|Network Data|Matrix Format|End)\]/i.test(first))return true;
    if(/^#/i.test(first))return true;
    return false;
  }

  function detectImportedFileFormat(text,fileName){
    if(isTouchstoneFileName(fileName))return "touchstone";
    if(looksLikeTouchstoneText(text))return "touchstone";
    return "rs-dat";
  }

  function parseRSDat(text,fileName){
    _fc++;
    var prefix=fileName.replace(/\.[^.]+$/,'')+" ";
    var lines=text.split(/\r?\n/),meta={},traces=[],cur=null,inData=false,hadTraceDecl=false;
    for(var i=0;i<lines.length;i++){
      var trimmed=lines[i].trim();
      if(!trimmed){if(inData)inData=false;continue;}
      var parts=trimmed.split(';').map(function(s){return s.trim();});
      if(inData&&cur){
        var nums=parts.filter(function(s){return s!=='';}).map(Number);
        if(nums.length>=2&&nums.every(function(n){return !isNaN(n);})){cur.data.push({freq:nums[0],amp:nums[1]});continue;}
        if(nums.length===1&&!isNaN(nums[0])){cur.data.push({amp:nums[0]});continue;}
        inData=false;
      }
      if(/^Trace$/i.test(parts[0])&&parts[1]&&/^\d+$/.test(parts[1])){
        hadTraceDecl=true;
        cur=makeTrace(prefix,fileName,"Tr"+parts[1],_fc);
        traces.push(cur);
        continue;
      }
      if(/^Trace Mode$/i.test(parts[0])&&cur){cur.mode=parts[1]||'';continue;}
      if(/^Detector$/i.test(parts[0])&&cur){cur.detector=parts[1]||'';continue;}
      if(/^Values$/i.test(parts[0])){
        inData=true;
        if(!cur){
          cur=makeTrace(prefix,fileName,"Tr"+(traces.length+1),_fc);
          traces.push(cur);
        }
        continue;
      }
      if(parts.length>=2&&/^[a-zA-Z]/.test(parts[0])){
        var nv=parseFloat(parts[1]);
        meta[parts[0]]=!isNaN(nv)&&parts[1]!==''?{value:nv,unit:parts[2]||''}:parts[1];
      }
    }
    if(traces.length===0&&!hadTraceDecl){
      cur=makeTrace(prefix,fileName,'Tr1',_fc);
      for(var j=0;j<lines.length;j++){
        var p=lines[j].trim().split(';').filter(function(s){return s.trim()!=='';}).map(Number);
        if(p.length>=2&&p.every(function(n){return !isNaN(n);})){cur.data.push({freq:p[0],amp:p[1]});}
        else if(p.length===1&&!isNaN(p[0])&&cur.data.length>0)cur.data.push({amp:p[0]});
      }
      if(cur.data.length>0)traces.push(cur);
    }
    traces=dedupeParsedTraces(traces.filter(function(t){return t.data.length>0;}));
    var sf=meta["Start"]&&meta["Start"].value||0;
    var ef=meta["Stop"]&&meta["Stop"].value||0;
    traces.forEach(function(tr){
      if(tr.data.length>0&&tr.data[0].freq===undefined){
        var n=tr.data.length;
        tr.data.forEach(function(d,idx){d.freq=sf+(idx/Math.max(n-1,1))*(ef-sf);});
      }
      tr.data=normalizeTraceData(tr.data);
      tr.units={
        x:(meta["StartXAxis"]&&meta["StartXAxis"].unit)||(meta["StopXAxis"]&&meta["StopXAxis"].unit)||(meta["Center Freq"]&&meta["Center Freq"].unit)||"Hz",
        y:(meta["Ref Level"]&&meta["Ref Level"].unit)||"dBm"
      };
    });
    traces=dedupeParsedTraces(traces.filter(function(t){return t.data&&t.data.length>0;}));
    return {format:"rs-dat",meta:meta,traces:traces};
  }

  function parseTouchstoneOptionLine(trimmed,state){
    var tokens=trimmed.slice(1).trim().split(/\s+/).filter(Boolean);
    if(!tokens.length)return;
    for(var i=0;i<tokens.length;i++){
      var token=tokens[i];
      var upper=token.toUpperCase();
      if(upper==="HZ"||upper==="KHZ"||upper==="MHZ"||upper==="GHZ"){
        state.freqUnit=upper==="HZ"?"Hz":upper==="KHZ"?"kHz":upper==="MHZ"?"MHz":"GHz";
        continue;
      }
      if(upper==="S"||upper==="Y"||upper==="Z"||upper==="G"||upper==="H"){
        state.parameterType=upper;
        continue;
      }
      if(upper==="DB"||upper==="MA"||upper==="RI"){
        state.dataFormat=upper;
        continue;
      }
      if(upper==="R"){
        i++;
        if(i>=tokens.length)throw new Error("Touchstone option line is missing a reference value after R.");
        var ref=Number(tokens[i]);
        if(!isFinite(ref)||ref<=0)throw new Error("Touchstone reference resistance must be a real positive number.");
        state.optionReference=ref;
        continue;
      }
      throw new Error("Unsupported Touchstone option token: "+token);
    }
    if(state.parameterType!=="S"){
      throw new Error("Unsupported Touchstone parameter type '"+state.parameterType+"'. Only S-parameters are supported.");
    }
  }

  function parseTouchstoneKeyword(trimmed,state){
    var match=trimmed.match(/^\[([^\]]+)\]\s*(.*)$/);
    if(!match)return false;
    var keyword=match[1].trim().toLowerCase();
    var arg=match[2].trim();
    if(keyword==="version"){
      state.version=2;
      state.versionString=arg||"2.0";
      return true;
    }
    if(keyword==="number of ports"){
      var portCount=parseInt(arg,10);
      if(!isFinite(portCount)||portCount<=0)throw new Error("Touchstone [Number of Ports] must be a positive integer.");
      state.portCount=portCount;
      return true;
    }
    if(keyword==="reference"){
      var refs=arg.split(/\s+/).filter(Boolean).map(Number);
      if(!refs.length)throw new Error("Touchstone [Reference] must include at least one real positive value.");
      refs.forEach(function(value){
        if(!isFinite(value)||value<=0)throw new Error("Touchstone [Reference] values must be real positive numbers.");
      });
      state.referenceOhms=refs;
      return true;
    }
    if(keyword==="network data"){
      state.inNetworkData=true;
      return true;
    }
    if(keyword==="end"){
      state.ended=true;
      return true;
    }
    if(keyword==="matrix format"){
      var fmt=arg.trim().toLowerCase();
      if(fmt!=="full"&&fmt!=="upper"&&fmt!=="lower")throw new Error("Unsupported Touchstone matrix format '"+arg+"'.");
      state.matrixFormat=fmt;
      return true;
    }
    if(keyword==="number of frequencies"){
      var count=parseInt(arg,10);
      if(isFinite(count)&&count>0)state.expectedFrequencyCount=count;
      return true;
    }
    if(keyword==="mixed-mode order"){
      throw new Error("Mixed-mode Touchstone files are not supported yet.");
    }
    return true;
  }

  function extractNumbersFromLine(trimmed){
    if(!trimmed)return [];
    return trimmed.split(/\s+/).filter(Boolean).map(Number).filter(function(n){return isFinite(n);});
  }

  function parseTouchstone(text,fileName){
    _fc++;
    text=String(text||"");
    fileName=String(fileName||"touchstone.s2p");
    var lines=text.split(/\r?\n/);
    var comments=[];
    var state={
      version:1,
      versionString:"1.0",
      portCount:getTouchstonePortCountFromFileName(fileName),
      parameterType:"S",
      dataFormat:"MA",
      freqUnit:"GHz",
      optionReference:50,
      referenceOhms:null,
      matrixFormat:"full",
      inNetworkData:false,
      ended:false,
      sawOptionLine:false,
      expectedFrequencyCount:null
    };
    var dataTokens=[];
    for(var i=0;i<lines.length;i++){
      var raw=lines[i].replace(/^\uFEFF/,"");
      var commentIndex=raw.indexOf("!");
      if(commentIndex>=0){
        var comment=raw.slice(commentIndex+1).trim();
        if(comment)comments.push(comment);
        raw=raw.slice(0,commentIndex);
      }
      var trimmed=raw.trim();
      if(!trimmed||state.ended)continue;
      if(trimmed.charAt(0)==="["){
        parseTouchstoneKeyword(trimmed,state);
        continue;
      }
      if(trimmed.charAt(0)==="#"){
        parseTouchstoneOptionLine(trimmed,state);
        state.sawOptionLine=true;
        continue;
      }
      if(!state.sawOptionLine){
        throw new Error("Touchstone data encountered before the option line.");
      }
      dataTokens=dataTokens.concat(extractNumbersFromLine(trimmed));
    }
    if(!state.sawOptionLine)throw new Error("Touchstone file is missing an option line.");
    if(!state.portCount)throw new Error("Unable to determine the Touchstone port count.");
    if(getTouchstonePortCountFromFileName(fileName)&&getTouchstonePortCountFromFileName(fileName)!==state.portCount){
      throw new Error("Touchstone port count does not match the file extension.");
    }
    if(state.referenceOhms==null){
      state.referenceOhms=[state.optionReference];
    }
    state.referenceOhms=normalizeReferenceArray(state.referenceOhms,state.portCount);
    if(!state.referenceOhms)throw new Error("Unsupported Touchstone reference format. Provide one real positive reference or one real positive value per port.");
    var order=buildMatrixOrder(state.portCount,state.matrixFormat);
    var expectedPerSample=1+(order.length*2);
    if(!dataTokens.length){
      return {
        format:"touchstone",
        meta:{
          "Format":"Touchstone",
          "Version":state.versionString,
          "Port Count":state.portCount,
          "Parameter Type":state.parameterType,
          "Data Format":state.dataFormat,
          "Frequency Unit":state.freqUnit,
          "Reference":state.referenceOhms.length===1?state.referenceOhms[0]:(state.referenceOhms.join(", "))
        },
        touchstoneNetwork:{
          parameterType:state.parameterType,
          portCount:state.portCount,
          referenceOhms:state.referenceOhms.slice(),
          freqUnit:state.freqUnit,
          dataFormat:state.dataFormat,
          comments:comments.slice(),
          samples:[],
          matrixFormat:state.matrixFormat,
          version:state.version
        },
        traces:[]
      };
    }
    var samples=[];
    var idx=0;
    var freqScaleMap={Hz:1,kHz:1e3,MHz:1e6,GHz:1e9};
    while(idx<dataTokens.length){
      if(idx+expectedPerSample>dataTokens.length){
        throw new Error("Incomplete Touchstone network data at frequency sample "+(samples.length+1)+".");
      }
      var freqValue=dataTokens[idx++];
      var freqScale=freqScaleMap[state.freqUnit]||1e9;
      var freqHz=freqValue*freqScale;
      var values=[];
      for(var j=0;j<order.length;j++){
        var first=dataTokens[idx++];
        var second=dataTokens[idx++];
        values.push(touchstonePairToComplex(state.dataFormat,first,second));
      }
      var matrix=expandOrderedValuesToMatrix(state.portCount,state.matrixFormat,values);
      if(!matrix)throw new Error("Unable to reconstruct the Touchstone network matrix.");
      samples.push({freq:freqHz,sMatrix:matrix});
    }
    if(state.expectedFrequencyCount!=null&&state.expectedFrequencyCount!==samples.length){
      throw new Error("Touchstone [Number of Frequencies] does not match the parsed sample count.");
    }
    var meta={
      "Format":"Touchstone",
      "Version":state.versionString,
      "Port Count":state.portCount,
      "Parameter Type":state.parameterType,
      "Data Format":state.dataFormat,
      "Frequency Unit":state.freqUnit,
      "Reference":state.referenceOhms.length===1?state.referenceOhms[0]:(state.referenceOhms.join(", "))
    };
    return {
      format:"touchstone",
      meta:meta,
      touchstoneNetwork:{
        parameterType:state.parameterType,
        portCount:state.portCount,
        referenceOhms:state.referenceOhms.slice(),
        freqUnit:state.freqUnit,
        dataFormat:state.dataFormat,
        comments:comments.slice(),
        samples:samples,
        matrixFormat:state.matrixFormat,
        version:state.version
      },
      traces:[]
    };
  }

  function parseImportedFile(text,fileName){
    if(detectImportedFileFormat(text,fileName)==="touchstone"){
      return parseTouchstone(text,fileName);
    }
    return parseRSDat(text,fileName);
  }

  function parseMeasurementFile(text,fileName){
    return parseImportedFile(text,fileName);
  }

  function isAudioFileName(fileName){
    return /\.(mp3|wav)$/i.test(String(fileName||""));
  }

  function isSpecMaskFileName(fileName){
    return /\.mask\.json$/i.test(String(fileName||""));
  }

  function freqScaleForUnit(unit){
    var key=String(unit||"Hz").trim().toLowerCase();
    if(key==="hz")return 1;
    if(key==="khz")return 1e3;
    if(key==="mhz")return 1e6;
    if(key==="ghz")return 1e9;
    return 1;
  }

  function parseSpecMaskJson(text,fileName){
    _fc++;
    var fc=_fc;
    var parsed;
    try{parsed=JSON.parse(String(text||""));}
    catch(e){throw new Error("Mask file is not valid JSON: "+(e&&e.message||e));}
    if(!parsed||typeof parsed!=="object")throw new Error("Mask file must be a JSON object.");
    var rawPoints=parsed.points||parsed.segments||parsed.data;
    if(!Array.isArray(rawPoints)||!rawPoints.length)throw new Error("Mask file is missing a non-empty 'points' array.");
    var freqScale=freqScaleForUnit(parsed.freqUnit||parsed.freq_unit||(parsed.units&&parsed.units.x));
    var data=[];
    for(var i=0;i<rawPoints.length;i++){
      var pt=rawPoints[i];
      var f=null,limit=null;
      if(Array.isArray(pt)&&pt.length>=2){f=Number(pt[0]);limit=Number(pt[1]);}
      else if(pt&&typeof pt==="object"){
        f=Number(pt.freq!=null?pt.freq:(pt.f!=null?pt.f:pt.frequency));
        limit=Number(pt.limit!=null?pt.limit:(pt.amp!=null?pt.amp:pt.value));
      }
      if(!isFinite(f)||!isFinite(limit))continue;
      data.push({freq:f*freqScale,amp:limit});
    }
    if(data.length<2)throw new Error("Mask file must define at least 2 valid points.");
    data.sort(function(a,b){return a.freq-b.freq;});
    var maskType=String(parsed.type||"upper").toLowerCase();
    if(maskType!=="upper"&&maskType!=="lower")maskType="upper";
    var name=parsed.name||String(fileName||"mask").replace(/^.*[\\/]/,"").replace(/\.[^.]+$/,"");
    var prefix=name+" ";
    var trace=makeTrace(prefix,fileName,"Limit",fc);
    trace.data=normalizeTraceData(data);
    trace.units={x:"Hz",y:String(parsed.limitUnit||(parsed.units&&parsed.units.y)||"dBm")};
    trace.kind="mask";
    trace.maskType=maskType;
    if(parsed.color)trace.color=String(parsed.color);
    var meta={
      "Format":"Spec Mask",
      "Mask Type":maskType,
      "Points":data.length,
      "Limit Unit":trace.units.y,
      "Freq Range":{value:[data[0].freq,data[data.length-1].freq],unit:"Hz"}
    };
    return {format:"mask",meta:meta,traces:[trace]};
  }

  function buildMaskComplianceReport(maskTrace,traces){
    if(!maskTrace||!Array.isArray(maskTrace.data)||!maskTrace.data.length)return null;
    var maskType=String(maskTrace.maskType||"upper").toLowerCase();
    var data=maskTrace.data;
    function interpAtFreq(freq){
      if(freq<=data[0].freq)return data[0].amp;
      if(freq>=data[data.length-1].freq)return data[data.length-1].amp;
      var lo=0,hi=data.length-1,mid;
      while(lo<hi-1){
        mid=(lo+hi)>>1;
        if(data[mid].freq<=freq)lo=mid;else hi=mid;
      }
      var a=data[lo],b=data[hi];
      var t=b.freq===a.freq?0:(freq-a.freq)/(b.freq-a.freq);
      return a.amp+(b.amp-a.amp)*t;
    }
    var reports=[];
    (Array.isArray(traces)?traces:[]).forEach(function(tr){
      if(!tr||tr===maskTrace)return;
      if((tr.kind||"raw")==="mask")return;
      if(!Array.isArray(tr.data)||!tr.data.length)return;
      var inRange=tr.data.filter(function(p){
        return p.freq>=data[0].freq&&p.freq<=data[data.length-1].freq;
      });
      if(!inRange.length){
        reports.push({trace:tr,coverage:0,violations:0,worstMarginDb:null,pass:true,reason:"out of mask range"});
        return;
      }
      var violations=0,worst=null;
      for(var i=0;i<inRange.length;i++){
        var pt=inRange[i];
        var lim=interpAtFreq(pt.freq);
        var margin=maskType==="upper"?(lim-pt.amp):(pt.amp-lim);
        if(margin<0)violations++;
        if(worst==null||margin<worst)worst=margin;
      }
      reports.push({
        trace:tr,
        coverage:inRange.length,
        violations:violations,
        worstMarginDb:worst,
        pass:violations===0,
        reason:null
      });
    });
    return reports;
  }

  function radix2FFT(re,im){
    var n=re.length;
    if(n<2)return;
    for(var i=1,j=0;i<n;i++){
      var bit=n>>1;
      for(;j&bit;bit>>=1){j^=bit;}
      j^=bit;
      if(i<j){
        var tr=re[i];re[i]=re[j];re[j]=tr;
        var ti=im[i];im[i]=im[j];im[j]=ti;
      }
    }
    for(var len=2;len<=n;len<<=1){
      var half=len>>1;
      var ang=-2*Math.PI/len;
      var wRe=Math.cos(ang),wIm=Math.sin(ang);
      for(var s=0;s<n;s+=len){
        var cRe=1,cIm=0;
        for(var k=0;k<half;k++){
          var idx=s+k,jdx=idx+half;
          var tRe=re[jdx]*cRe-im[jdx]*cIm;
          var tIm=re[jdx]*cIm+im[jdx]*cRe;
          re[jdx]=re[idx]-tRe;
          im[jdx]=im[idx]-tIm;
          re[idx]+=tRe;
          im[idx]+=tIm;
          var nRe=cRe*wRe-cIm*wIm;
          cIm=cRe*wIm+cIm*wRe;
          cRe=nRe;
        }
      }
    }
  }

  var AUDIO_WINDOWS={
    rectangular:{label:"Rectangular",fn:function(N){var w=new Float32Array(N);for(var i=0;i<N;i++)w[i]=1;return w;}},
    hann:{label:"Hann",fn:function(N){var w=new Float32Array(N);for(var i=0;i<N;i++)w[i]=0.5*(1-Math.cos(2*Math.PI*i/(N-1)));return w;}},
    hamming:{label:"Hamming",fn:function(N){var w=new Float32Array(N);for(var i=0;i<N;i++)w[i]=0.54-0.46*Math.cos(2*Math.PI*i/(N-1));return w;}},
    blackman:{label:"Blackman",fn:function(N){var w=new Float32Array(N);for(var i=0;i<N;i++){var t=2*Math.PI*i/(N-1);w[i]=0.42-0.5*Math.cos(t)+0.08*Math.cos(2*t);}return w;}},
    blackmanharris:{label:"Blackman-Harris",fn:function(N){var a=[0.35875,-0.48829,0.14128,-0.01168];var w=new Float32Array(N);for(var i=0;i<N;i++){var t=2*Math.PI*i/(N-1);w[i]=a[0]+a[1]*Math.cos(t)+a[2]*Math.cos(2*t)+a[3]*Math.cos(3*t);}return w;}},
    flattop:{label:"Flat-top",fn:function(N){var a=[0.21557895,-0.41663158,0.277263158,-0.083578947,0.006947368];var w=new Float32Array(N);for(var i=0;i<N;i++){var t=2*Math.PI*i/(N-1);w[i]=a[0]+a[1]*Math.cos(t)+a[2]*Math.cos(2*t)+a[3]*Math.cos(3*t)+a[4]*Math.cos(4*t);}return w;}}
  };
  var AUDIO_FFT_SIZES=[256,512,1024,2048,4096,8192,16384,32768];
  var AUDIO_DEFAULT_OPTIONS={fftSize:8192,window:"hann",overlap:0.5,channel:"auto"};

  function normalizeAudioFftOptions(options){
    var opts=Object.assign({},AUDIO_DEFAULT_OPTIONS,options||{});
    var size=Number(opts.fftSize);
    if(!isFinite(size))size=AUDIO_DEFAULT_OPTIONS.fftSize;
    var pow=1;while(pow*2<=size)pow<<=1;
    if(pow<256)pow=256;
    if(pow>32768)pow=32768;
    opts.fftSize=pow;
    if(!AUDIO_WINDOWS[opts.window])opts.window=AUDIO_DEFAULT_OPTIONS.window;
    var ov=Number(opts.overlap);
    if(!isFinite(ov))ov=AUDIO_DEFAULT_OPTIONS.overlap;
    opts.overlap=Math.min(0.95,Math.max(0,ov));
    if(opts.channel!=="auto"&&!isFinite(Number(opts.channel))){
      opts.channel=AUDIO_DEFAULT_OPTIONS.channel;
    }
    return opts;
  }

  function selectAudioChannelSamples(channels,channelOption){
    if(!channels||!channels.length)return new Float32Array(0);
    if(channelOption!=="auto"){
      var idx=Math.max(0,Math.min(channels.length-1,parseInt(channelOption,10)||0));
      return channels[idx];
    }
    if(channels.length===1)return channels[0];
    var len=channels[0].length;
    var mono=new Float32Array(len);
    for(var c=0;c<channels.length;c++){
      var src=channels[c];
      for(var i=0;i<len;i++)mono[i]+=src[i];
    }
    for(var k=0;k<len;k++)mono[k]/=channels.length;
    return mono;
  }

  function computeAudioSpectrogram(samples,sampleRate,opts,maxFrames){
    var settings=normalizeAudioFftOptions(opts);
    var len=samples.length;
    if(!len)throw new Error("Audio has no samples for spectrogram.");
    var N=settings.fftSize;
    while(N>len)N>>=1;
    if(N<256)throw new Error("Audio is too short for the requested spectrogram FFT size.");
    var hop=Math.max(1,Math.floor(N*(1-settings.overlap)));
    var winFn=(AUDIO_WINDOWS[settings.window]||AUDIO_WINDOWS.hann).fn;
    var win=winFn(N);
    var winSum=0;for(var w=0;w<N;w++)winSum+=win[w];
    var maxF=Math.max(8,Math.min(maxFrames||300,Math.floor((len-N)/hop)+1));
    var totalFrames=Math.max(1,Math.floor((len-N)/hop)+1);
    var stride=Math.max(1,Math.floor(totalFrames/maxF));
    var halfBins=N>>1;
    var binCount=halfBins+1;
    var keptFrames=Math.floor(totalFrames/stride);
    if(keptFrames<1)keptFrames=1;
    var data=new Float32Array(keptFrames*binCount);
    var frameTimes=new Float32Array(keptFrames);
    var re=new Float64Array(N);
    var im=new Float64Array(N);
    var minDb=Infinity,maxDb=-Infinity;
    for(var fi=0;fi<keptFrames;fi++){
      var start=fi*stride*hop;
      if(start+N>len)start=len-N;
      for(var s=0;s<N;s++){re[s]=samples[start+s]*win[s];im[s]=0;}
      radix2FFT(re,im);
      var rowOffset=fi*binCount;
      for(var b=0;b<binCount;b++){
        var mag=Math.sqrt(re[b]*re[b]+im[b]*im[b]);
        var scale=(b===0||b===halfBins)?1:2;
        var amp=(mag/winSum)*scale;
        var db=20*Math.log10(amp+1e-12);
        if(db<-160)db=-160;
        if(db<minDb)minDb=db;
        if(db>maxDb)maxDb=db;
        data[rowOffset+b]=db;
      }
      frameTimes[fi]=start/sampleRate;
    }
    if(!isFinite(minDb))minDb=-120;
    if(!isFinite(maxDb))maxDb=0;
    return {
      data:data,
      frameTimes:frameTimes,
      frameCount:keptFrames,
      binCount:binCount,
      sampleRate:sampleRate,
      fftSize:N,
      hopSize:hop,
      stride:stride,
      window:settings.window,
      minDb:minDb,
      maxDb:maxDb,
      durationSec:len/sampleRate
    };
  }

  function computeAudioFftTrace(samples,sampleRate,opts){
    opts=normalizeAudioFftOptions(opts);
    var len=samples.length;
    if(!len)throw new Error("Audio file contains no samples.");
    var N=Math.min(opts.fftSize,1);
    while(N*2<=opts.fftSize)N<<=1;
    while(N>len)N>>=1;
    if(N<256)throw new Error("Audio is too short for the requested FFT size.");
    var hop=Math.max(1,Math.floor(N*(1-opts.overlap)));
    var winFn=(AUDIO_WINDOWS[opts.window]||AUDIO_WINDOWS.hann).fn;
    var win=winFn(N);
    var winSum=0;for(var w=0;w<N;w++)winSum+=win[w];
    var halfBins=N>>1;
    var sum=new Float64Array(halfBins+1);
    var re=new Float64Array(N);
    var im=new Float64Array(N);
    var frames=0;
    for(var start=0;start+N<=len;start+=hop){
      for(var s=0;s<N;s++){re[s]=samples[start+s]*win[s];im[s]=0;}
      radix2FFT(re,im);
      for(var b=0;b<=halfBins;b++)sum[b]+=Math.sqrt(re[b]*re[b]+im[b]*im[b]);
      frames++;
    }
    if(!frames){
      for(var z=0;z<N;z++){re[z]=z<len?samples[z]*win[z]:0;im[z]=0;}
      radix2FFT(re,im);
      for(var b2=0;b2<=halfBins;b2++)sum[b2]=Math.sqrt(re[b2]*re[b2]+im[b2]*im[b2]);
      frames=1;
    }
    var data=[];
    for(var b3=0;b3<=halfBins;b3++){
      var avg=sum[b3]/frames;
      var scale=(b3===0||b3===halfBins)?1:2;
      var amp=(avg/winSum)*scale;
      var db=20*Math.log10(amp+1e-12);
      if(db<-160)db=-160;
      data.push({freq:b3*sampleRate/N,amp:db});
    }
    return {data:data,fftSize:N,frames:frames,hop:hop};
  }

  function aWeightDb(f){
    if(!isFinite(f)||f<=0)return -120;
    var f2=f*f;
    var num=12194*12194*f2*f2;
    var den=(f2+20.6*20.6)*Math.sqrt((f2+107.7*107.7)*(f2+737.9*737.9))*(f2+12194*12194);
    return 20*Math.log10(num/den)+2.0;
  }

  function cWeightDb(f){
    if(!isFinite(f)||f<=0)return -120;
    var f2=f*f;
    var num=12194*12194*f2;
    var den=(f2+20.6*20.6)*(f2+12194*12194);
    return 20*Math.log10(num/den)+0.062;
  }

  function computeAudioMetrics(samples,sampleRate,fftSeries){
    var n=samples.length;
    if(!n)return null;
    var peak=0,rmsSq=0;
    for(var i=0;i<n;i++){
      var x=samples[i];
      var a=x<0?-x:x;
      if(a>peak)peak=a;
      rmsSq+=x*x;
    }
    var rms=Math.sqrt(rmsSq/n);
    var peakDbFs=20*Math.log10(peak||1e-12);
    var rmsDbFs=20*Math.log10(rms||1e-12);
    var crestDb=peakDbFs-rmsDbFs;
    var spec=[];
    var totalPwr=0;
    var data=fftSeries&&fftSeries.data?fftSeries.data:[];
    for(var k=0;k<data.length;k++){
      var lin=Math.pow(10,Number(data[k].amp)/20);
      var pwr=lin*lin;
      spec.push({freq:Number(data[k].freq),pwr:pwr});
      totalPwr+=pwr;
    }
    var globalMax=null,globalMaxIdx=-1;
    for(var b=1;b<spec.length;b++){
      if(!globalMax||spec[b].pwr>globalMax.pwr){globalMax=spec[b];globalMaxIdx=b;}
    }
    var fundamentalHz=globalMax?globalMax.freq:null;
    var dominantPeaks=[];
    if(globalMax){
      var threshPwr=globalMax.pwr*Math.pow(10,-12/10);
      for(var b2=1;b2<spec.length-1;b2++){
        var p=spec[b2];
        if(p.pwr>=threshPwr&&p.pwr>spec[b2-1].pwr&&p.pwr>=spec[b2+1].pwr){
          dominantPeaks.push({freq:p.freq,pwr:p.pwr,idx:b2});
        }
      }
      dominantPeaks.sort(function(a,b){return b.pwr-a.pwr;});
      if(dominantPeaks.length>8)dominantPeaks=dominantPeaks.slice(0,8);
      if(!dominantPeaks.length)dominantPeaks=[{freq:globalMax.freq,pwr:globalMax.pwr,idx:globalMaxIdx}];
    }
    var thdNPercent=null;
    if(dominantPeaks.length&&totalPwr>0){
      var resid=0;
      for(var c=0;c<spec.length;c++){
        var f=spec[c].freq,inNotch=false;
        for(var pi=0;pi<dominantPeaks.length;pi++){
          var notch=Math.max(30,dominantPeaks[pi].freq*0.02);
          if(Math.abs(f-dominantPeaks[pi].freq)<=notch){inNotch=true;break;}
        }
        if(!inNotch)resid+=spec[c].pwr;
      }
      thdNPercent=Math.sqrt(resid/totalPwr)*100;
    }
    var easAttention=null;
    if(dominantPeaks.length){
      function findPeakNear(targetHz,tolHz){
        var best=null;
        for(var i=0;i<dominantPeaks.length;i++){
          if(Math.abs(dominantPeaks[i].freq-targetHz)<=tolHz){
            if(!best||dominantPeaks[i].pwr>best.pwr)best=dominantPeaks[i];
          }
        }
        return best;
      }
      var p853=findPeakNear(853.05,8);
      var p960=findPeakNear(960.05,8);
      if(p853&&p960){
        var db853=10*Math.log10(p853.pwr+1e-30);
        var db960=10*Math.log10(p960.pwr+1e-30);
        if(Math.abs(db853-db960)<=8){
          easAttention={
            f1:p853.freq,f2:p960.freq,
            db1:db853,db2:db960
          };
        }
      }
    }
    var snrDb=null;
    if(spec.length>=20){
      var sorted=spec.slice().sort(function(a,b){return b.pwr-a.pwr;});
      var topN=Math.max(1,Math.floor(sorted.length*0.01));
      var top=sorted.slice(0,topN);
      var bot=sorted.slice(Math.floor(sorted.length*0.5));
      var topMean=0;for(var t=0;t<top.length;t++)topMean+=top[t].pwr;topMean/=top.length;
      var botMean=0;for(var u=0;u<bot.length;u++)botMean+=bot[u].pwr;botMean/=bot.length;
      if(botMean>0)snrDb=10*Math.log10(topMean/botMean);
    }
    function weightedRmsDb(weightFn){
      if(!totalPwr)return null;
      var weighted=0;
      for(var w=0;w<spec.length;w++){
        var g=Math.pow(10,weightFn(spec[w].freq)/20);
        weighted+=spec[w].pwr*g*g;
      }
      var ratio=weighted/totalPwr;
      if(!isFinite(ratio)||ratio<=0)return null;
      return rmsDbFs+10*Math.log10(ratio);
    }
    return {
      peakDbFs:peakDbFs,
      rmsDbFs:rmsDbFs,
      crestDb:crestDb,
      aRmsDbFs:weightedRmsDb(aWeightDb),
      cRmsDbFs:weightedRmsDb(cWeightDb),
      fundamentalHz:fundamentalHz,
      thdNPercent:thdNPercent,
      snrDb:snrDb,
      fundIdx:globalMaxIdx,
      dominantPeaks:dominantPeaks,
      easAttention:easAttention
    };
  }

  function computeAmBroadcastMetrics(samples,sampleRate,fftSeries,baseMetrics){
    if(!samples||!samples.length)return null;
    var n=samples.length;
    var maxPos=0,maxNeg=0;
    for(var i=0;i<n;i++){
      var x=samples[i];
      if(x>maxPos)maxPos=x;
      if(-x>maxNeg)maxNeg=-x;
    }
    var ref=Math.max(maxPos,maxNeg)||1e-12;
    var modPosPercent=(maxPos/ref)*100;
    var modNegPercent=(maxNeg/ref)*100;
    var asymmetryDb=20*Math.log10((maxPos+1e-12)/(maxNeg+1e-12));
    var spec=[];
    var data=fftSeries&&fftSeries.data?fftSeries.data:[];
    for(var k=0;k<data.length;k++){
      spec.push({freq:Number(data[k].freq),db:Number(data[k].amp)});
    }
    function levelAtBand(centerHz,halfWindowHz){
      var maxDb=-Infinity;
      for(var i=0;i<spec.length;i++){
        if(Math.abs(spec[i].freq-centerHz)<=halfWindowHz&&spec[i].db>maxDb)maxDb=spec[i].db;
      }
      return isFinite(maxDb)?maxDb:null;
    }
    function levelAvgInRange(loHz,hiHz){
      var sum=0,count=0;
      for(var i=0;i<spec.length;i++){
        if(spec[i].freq>=loHz&&spec[i].freq<=hiHz){sum+=spec[i].db;count++;}
      }
      return count?sum/count:null;
    }
    var ref1k=levelAvgInRange(800,1200);
    var hum60Db=levelAtBand(60,3);
    var hum120Db=levelAtBand(120,3);
    var hum180Db=levelAtBand(180,3);
    var hum240Db=levelAtBand(240,3);
    var hum50Db=levelAtBand(50,3);
    var hum100Db=levelAtBand(100,3);
    var hum150Db=levelAtBand(150,3);
    var hum200Db=levelAtBand(200,3);
    var humPeakDb=null;
    [hum60Db,hum120Db,hum180Db,hum240Db,hum50Db,hum100Db,hum150Db,hum200Db].forEach(function(v){
      if(v!=null&&(humPeakDb==null||v>humPeakDb))humPeakDb=v;
    });
    var nyquist=sampleRate/2;
    var floorDb=ref1k!=null?ref1k-10:-50;
    var audioBwHz=null;
    for(var i=spec.length-1;i>=0;i--){
      if(spec[i].freq>nyquist)continue;
      if(spec[i].db>=floorDb){audioBwHz=spec[i].freq;break;}
    }
    var nrsc102=levelAtBand(10200,150);
    var nrsc11=levelAtBand(11000,150);
    var nrsc15=levelAtBand(15000,300);
    var maskFloor=ref1k!=null?ref1k:-30;
    var nrscOverages=[];
    if(nrsc102!=null)nrscOverages.push({label:"10.2 kHz",overDb:nrsc102-(maskFloor-30)});
    if(nrsc11!=null)nrscOverages.push({label:"11 kHz",overDb:nrsc11-(maskFloor-40)});
    if(nrsc15!=null&&nyquist>15000)nrscOverages.push({label:"15 kHz",overDb:nrsc15-(maskFloor-60)});
    var worstOverage=null;
    nrscOverages.forEach(function(o){if(worstOverage==null||o.overDb>worstOverage.overDb)worstOverage=o;});
    var nrscPass=worstOverage==null||worstOverage.overDb<=0;
    function clamp01(x){return Math.max(0,Math.min(1,x));}
    var symPenalty=clamp01(Math.abs(asymmetryDb)/6);
    var symScore=20*(1-symPenalty);
    var nrscScore=nrscPass?25:Math.max(0,25-(worstOverage?worstOverage.overDb:0)*2);
    var humRel=null;
    if(humPeakDb!=null&&ref1k!=null)humRel=humPeakDb-ref1k;
    var humScore;
    if(humRel==null)humScore=10;
    else if(humRel<=-50)humScore=15;
    else if(humRel<=-30)humScore=15-((-30-humRel)*0)+(humRel+50)*-0.25;
    else humScore=Math.max(0,5-(humRel+30)*0.2);
    humScore=Math.max(0,Math.min(15,humScore));
    var bwScore;
    if(audioBwHz==null)bwScore=7;
    else if(audioBwHz<3500)bwScore=Math.max(0,8*audioBwHz/3500);
    else if(audioBwHz<=10500)bwScore=15;
    else bwScore=Math.max(8,15-((audioBwHz-10500)/2000)*5);
    bwScore=Math.max(0,Math.min(15,bwScore));
    var crestDb=baseMetrics&&baseMetrics.crestDb!=null?baseMetrics.crestDb:null;
    var crestScore;
    if(crestDb==null)crestScore=8;
    else if(crestDb<6)crestScore=Math.max(0,crestDb*1.5);
    else if(crestDb<=15)crestScore=15;
    else crestScore=Math.max(0,15-(crestDb-15)*1.5);
    crestScore=Math.max(0,Math.min(15,crestScore));
    var rmsDb=baseMetrics&&baseMetrics.rmsDbFs!=null?baseMetrics.rmsDbFs:null;
    var lufsTarget=-24;
    var lufsScore;
    if(rmsDb==null)lufsScore=5;
    else{
      var dist=Math.abs(rmsDb-lufsTarget);
      if(dist<=2)lufsScore=10;
      else if(dist<=6)lufsScore=10-(dist-2)*1.5;
      else lufsScore=Math.max(0,4-(dist-6)*0.5);
    }
    lufsScore=Math.max(0,Math.min(10,lufsScore));
    var amScore=Math.round(symScore+nrscScore+humScore+bwScore+crestScore+lufsScore);
    if(amScore<0)amScore=0;if(amScore>100)amScore=100;
    return {
      modPosPercent:modPosPercent,
      modNegPercent:modNegPercent,
      asymmetryDb:asymmetryDb,
      humPeakDb:humPeakDb,
      humPeakRelDb:humRel,
      hum60Db:hum60Db,hum120Db:hum120Db,hum180Db:hum180Db,
      hum50Db:hum50Db,hum100Db:hum100Db,hum150Db:hum150Db,
      audioBwHz:audioBwHz,
      nrscPass:nrscPass,
      nrscWorstOverage:worstOverage,
      amScore:amScore,
      subScores:{
        symmetry:Math.round(symScore),
        nrsc:Math.round(nrscScore),
        hum:Math.round(humScore),
        bandwidth:Math.round(bwScore),
        crest:Math.round(crestScore),
        loudness:Math.round(lufsScore)
      }
    };
  }

  function computeFmBroadcastMetrics(samples,sampleRate,fftSeries,baseMetrics){
    if(!samples||!samples.length)return null;
    var spec=[];
    var data=fftSeries&&fftSeries.data?fftSeries.data:[];
    for(var k=0;k<data.length;k++){
      spec.push({freq:Number(data[k].freq),db:Number(data[k].amp)});
    }
    function levelAtBand(centerHz,halfWindowHz){
      var maxDb=-Infinity;
      for(var i=0;i<spec.length;i++){
        if(Math.abs(spec[i].freq-centerHz)<=halfWindowHz&&spec[i].db>maxDb)maxDb=spec[i].db;
      }
      return isFinite(maxDb)?maxDb:null;
    }
    function bandEnergyDb(loHz,hiHz){
      var pwr=0,count=0;
      for(var i=0;i<spec.length;i++){
        if(spec[i].freq>=loHz&&spec[i].freq<=hiHz){
          var lin=Math.pow(10,spec[i].db/20);
          pwr+=lin*lin;
          count++;
        }
      }
      if(!count||pwr<=0)return null;
      return 10*Math.log10(pwr/count);
    }
    var nyquist=sampleRate/2;
    var compositeMode=nyquist>=60000;
    var n=samples.length;
    var peak=0,negPeak=0;
    for(var i=0;i<n;i++){
      var x=samples[i];
      if(x>peak)peak=x;
      if(-x>negPeak)negPeak=-x;
    }
    var peakOverall=Math.max(peak,negPeak)||1e-12;
    var asymmetryDb=20*Math.log10((peak+1e-12)/(negPeak+1e-12));
    var emphSlopeDb=null;
    var lf=bandEnergyDb(400,800);
    var hf=bandEnergyDb(8000,12000);
    if(lf!=null&&hf!=null){
      emphSlopeDb=hf-lf;
    }
    var preEmphPresent=emphSlopeDb!=null&&emphSlopeDb>=8;
    var audioBwHz=null;
    var ref1k=null;
    var sumNear1k=0,countNear1k=0;
    for(var s=0;s<spec.length;s++){
      if(spec[s].freq>=800&&spec[s].freq<=1200){sumNear1k+=spec[s].db;countNear1k++;}
    }
    if(countNear1k)ref1k=sumNear1k/countNear1k;
    var floor=ref1k!=null?ref1k-10:-50;
    for(var bw=spec.length-1;bw>=0;bw--){
      var f=spec[bw].freq;
      if(f>nyquist)continue;
      if(compositeMode&&f>15500)continue;
      if(spec[bw].db>=floor){audioBwHz=f;break;}
    }
    var composite=null;
    if(compositeMode){
      var pilotDb=levelAtBand(19000,80);
      var lminusrEnergyDb=bandEnergyDb(23000,53000);
      var subDb=levelAtBand(38000,150);
      var rdsDb=levelAtBand(57000,200);
      var sca67Db=nyquist>67500?levelAtBand(67000,300):null;
      var sca92Db=nyquist>92500?levelAtBand(92000,400):null;
      var lplusrEnergyDb=bandEnergyDb(50,15000);
      var pilotRel=null,rdsRel=null,subRel=null;
      if(pilotDb!=null&&lplusrEnergyDb!=null)pilotRel=pilotDb-lplusrEnergyDb;
      if(rdsDb!=null&&lplusrEnergyDb!=null)rdsRel=rdsDb-lplusrEnergyDb;
      if(subDb!=null&&lplusrEnergyDb!=null)subRel=subDb-lplusrEnergyDb;
      var pilotPresent=pilotDb!=null&&ref1k!=null&&pilotDb>ref1k-50;
      var rdsPresent=rdsDb!=null&&ref1k!=null&&rdsDb>ref1k-55;
      var sca67Present=sca67Db!=null&&ref1k!=null&&sca67Db>ref1k-55;
      var sca92Present=sca92Db!=null&&ref1k!=null&&sca92Db>ref1k-55;
      var stereoIndicated=pilotPresent&&subDb!=null&&ref1k!=null&&subDb>ref1k-50;
      composite={
        pilotDb:pilotDb,
        pilotRelDb:pilotRel,
        pilotPresent:pilotPresent,
        subDb:subDb,
        subRelDb:subRel,
        stereoIndicated:stereoIndicated,
        lminusrEnergyDb:lminusrEnergyDb,
        rdsDb:rdsDb,
        rdsRelDb:rdsRel,
        rdsPresent:rdsPresent,
        sca67Db:sca67Db,
        sca67Present:sca67Present,
        sca92Db:sca92Db,
        sca92Present:sca92Present
      };
    }
    function clamp(x,lo,hi){return Math.max(lo,Math.min(hi,x));}
    var symScore=clamp(20-Math.abs(asymmetryDb)*3,0,20);
    var bwScore;
    if(audioBwHz==null)bwScore=12;
    else if(audioBwHz<8000)bwScore=clamp(20*audioBwHz/8000,0,20);
    else if(audioBwHz<=15500)bwScore=20;
    else bwScore=clamp(20-(audioBwHz-15500)/200,0,20);
    var emphScore;
    if(emphSlopeDb==null)emphScore=10;
    else if(preEmphPresent)emphScore=20;
    else emphScore=clamp(emphSlopeDb*1.5+10,0,20);
    var crestDb=baseMetrics&&baseMetrics.crestDb!=null?baseMetrics.crestDb:null;
    var crestScore;
    if(crestDb==null)crestScore=10;
    else if(crestDb<6)crestScore=clamp(crestDb*2.5,0,15);
    else if(crestDb<=18)crestScore=15;
    else crestScore=clamp(15-(crestDb-18)*1.5,0,15);
    var compositeScore=null;
    if(composite){
      var pilotScore=composite.pilotPresent?12:0;
      var stereoScore=composite.stereoIndicated?8:0;
      var rdsScore=composite.rdsPresent?5:0;
      compositeScore=pilotScore+stereoScore+rdsScore;
    }
    var fmScore;
    if(compositeMode){
      fmScore=Math.round(symScore+bwScore+emphScore*0.5+crestScore*0.5+compositeScore+15);
    }else{
      fmScore=Math.round(symScore+bwScore+emphScore+crestScore+25);
    }
    fmScore=clamp(fmScore,0,100);
    return {
      mode:compositeMode?"composite":"audio",
      sampleRate:sampleRate,
      audioBwHz:audioBwHz,
      asymmetryDb:asymmetryDb,
      preEmphSlopeDb:emphSlopeDb,
      preEmphPresent:preEmphPresent,
      composite:composite,
      fmScore:fmScore,
      subScores:{
        symmetry:Math.round(symScore),
        bandwidth:Math.round(bwScore),
        preEmph:Math.round(compositeMode?emphScore*0.5:emphScore),
        crest:Math.round(compositeMode?crestScore*0.5:crestScore),
        composite:compositeScore!=null?Math.round(compositeScore):null
      }
    };
  }

  function formatHz(hz){
    if(hz==null||!isFinite(hz))return null;
    if(hz>=1e6)return (hz/1e6).toFixed(3)+" MHz";
    if(hz>=1e3)return (hz/1e3).toFixed(3)+" kHz";
    return hz.toFixed(1)+" Hz";
  }

  function parseAudioFromChannels(channels,sampleRate,fileName,options){
    _fc++;
    var fc=_fc;
    var opts=normalizeAudioFftOptions(options);
    if(!Array.isArray(channels)||!channels.length)throw new Error("Audio file has no decoded channels.");
    var ch=channels.length;
    var samples=selectAudioChannelSamples(channels,opts.channel);
    var result=computeAudioFftTrace(samples,sampleRate,opts);
    var prefix=String(fileName||"audio").replace(/^.*[\\/]/,"").replace(/\.[^.]+$/,"")+" ";
    var label="FFT";
    if(opts.channel!=="auto")label="FFT_ch"+(parseInt(opts.channel,10)||0);
    var trace=makeTrace(prefix,fileName,label,fc);
    trace.data=normalizeTraceData(result.data);
    trace.units={x:"Hz",y:"dBFS"};
    var metrics=null;
    try{metrics=computeAudioMetrics(samples,sampleRate,result);}catch(_){metrics=null;}
    var meta={
      "Format":"Audio",
      "Sample Rate":{value:sampleRate,unit:"Hz"},
      "Channels":ch,
      "Channel":opts.channel==="auto"?"mono mix":("ch "+(parseInt(opts.channel,10)||0)),
      "Sample Count":samples.length,
      "FFT Size":result.fftSize,
      "Window":(AUDIO_WINDOWS[opts.window]&&AUDIO_WINDOWS[opts.window].label)||opts.window,
      "Overlap":Math.round(opts.overlap*100)+"%",
      "Frames Averaged":result.frames
    };
    if(metrics){
      meta["Peak"]=metrics.peakDbFs.toFixed(2)+" dBFS";
      meta["RMS"]=metrics.rmsDbFs.toFixed(2)+" dBFS";
      meta["Crest Factor"]=metrics.crestDb.toFixed(2)+" dB";
      if(metrics.aRmsDbFs!=null)meta["A-weighted RMS"]=metrics.aRmsDbFs.toFixed(2)+" dBFS(A)";
      if(metrics.cRmsDbFs!=null)meta["C-weighted RMS"]=metrics.cRmsDbFs.toFixed(2)+" dBFS(C)";
      if(metrics.fundamentalHz!=null)meta["Fundamental"]=formatHz(metrics.fundamentalHz);
      var notchedCount=(metrics.dominantPeaks&&metrics.dominantPeaks.length)||0;
      if(metrics.thdNPercent!=null){
        var thdNote=notchedCount>1?" ("+notchedCount+" tones notched)":"";
        meta["THD+N"]=metrics.thdNPercent.toFixed(3)+" %"+thdNote;
      }
      if(metrics.snrDb!=null)meta["SNR (est.)"]=metrics.snrDb.toFixed(1)+" dB";
      if(metrics.dominantPeaks&&metrics.dominantPeaks.length>1){
        meta["Dominant Tones"]=metrics.dominantPeaks.map(function(p){return formatHz(p.freq);}).join(" · ");
      }
      if(metrics.easAttention){
        var ea=metrics.easAttention;
        meta["EAS Attention"]=formatHz(ea.f1)+" + "+formatHz(ea.f2)+" · "+ea.db1.toFixed(1)+" / "+ea.db2.toFixed(1)+" dBFS · matched";
      }
    }
    var amMetrics=null;
    try{amMetrics=computeAmBroadcastMetrics(samples,sampleRate,result,metrics);}catch(_){amMetrics=null;}
    if(amMetrics){
      meta["AM Modulation"]="+"+amMetrics.modPosPercent.toFixed(1)+"% / -"+amMetrics.modNegPercent.toFixed(1)+"% · asymmetry "+(amMetrics.asymmetryDb>=0?"+":"")+amMetrics.asymmetryDb.toFixed(2)+" dB";
      if(amMetrics.audioBwHz!=null)meta["AM Audio BW"]=formatHz(amMetrics.audioBwHz);
      if(amMetrics.nrscWorstOverage){
        var w=amMetrics.nrscWorstOverage;
        meta["AM NRSC-1 Mask"]=(amMetrics.nrscPass?"PASS":"FAIL")+" · worst "+w.label+" "+(w.overDb>=0?"+":"")+w.overDb.toFixed(1)+" dB";
      }else if(amMetrics.nrscPass){
        meta["AM NRSC-1 Mask"]="PASS · no HF content above mask";
      }
      if(amMetrics.humPeakRelDb!=null){
        meta["AM Hum (worst)"]=amMetrics.humPeakRelDb.toFixed(1)+" dB rel 1 kHz";
      }
      var s=amMetrics.subScores||{};
      meta["AM Broadcast Score"]=amMetrics.amScore+" / 100 · sym "+s.symmetry+" · NRSC "+s.nrsc+" · hum "+s.hum+" · BW "+s.bandwidth+" · crest "+s.crest+" · loud "+s.loudness;
    }
    var fmMetrics=null;
    try{fmMetrics=computeFmBroadcastMetrics(samples,sampleRate,result,metrics);}catch(_){fmMetrics=null;}
    if(fmMetrics){
      meta["FM Mode"]=fmMetrics.mode==="composite"?"Composite (MPX) · "+(sampleRate/1000).toFixed(0)+" kS/s":"Program audio · "+(sampleRate/1000).toFixed(0)+" kS/s";
      if(fmMetrics.audioBwHz!=null)meta["FM Audio BW"]=formatHz(fmMetrics.audioBwHz);
      meta["FM Symmetry"]=(fmMetrics.asymmetryDb>=0?"+":"")+fmMetrics.asymmetryDb.toFixed(2)+" dB";
      if(fmMetrics.preEmphSlopeDb!=null){
        meta["FM Pre-emphasis"]=(fmMetrics.preEmphPresent?"Detected · ":"Flat · ")+(fmMetrics.preEmphSlopeDb>=0?"+":"")+fmMetrics.preEmphSlopeDb.toFixed(1)+" dB (8-12 kHz vs 400-800 Hz)";
      }
      if(fmMetrics.composite){
        var c=fmMetrics.composite;
        if(c.pilotDb!=null){
          meta["FM 19 kHz Pilot"]=(c.pilotPresent?"Present · ":"Absent · ")+c.pilotDb.toFixed(1)+" dBFS"+(c.pilotRelDb!=null?(" · "+(c.pilotRelDb>=0?"+":"")+c.pilotRelDb.toFixed(1)+" dB rel L+R"):"");
        }
        if(c.subDb!=null){
          meta["FM 38 kHz L-R"]=(c.stereoIndicated?"Stereo · ":"Mono / inactive · ")+c.subDb.toFixed(1)+" dBFS";
        }
        if(c.rdsDb!=null){
          meta["FM 57 kHz RDS"]=(c.rdsPresent?"Present · ":"Absent · ")+c.rdsDb.toFixed(1)+" dBFS";
        }
        if(c.sca67Db!=null){
          meta["FM 67 kHz SCA"]=(c.sca67Present?"Present · ":"Absent · ")+c.sca67Db.toFixed(1)+" dBFS";
        }
        if(c.sca92Db!=null){
          meta["FM 92 kHz SCA"]=(c.sca92Present?"Present · ":"Absent · ")+c.sca92Db.toFixed(1)+" dBFS";
        }
      }
      var fs=fmMetrics.subScores||{};
      var subParts="sym "+fs.symmetry+" · BW "+fs.bandwidth+" · pre-emph "+fs.preEmph+" · crest "+fs.crest;
      if(fs.composite!=null)subParts+=" · MPX "+fs.composite;
      meta["FM Broadcast Score"]=fmMetrics.fmScore+" / 100 · "+subParts;
    }
    var sameMessage=null;
    try{sameMessage=decodeEasSameMessage(samples,sampleRate);}catch(_){sameMessage=null;}
    if(sameMessage&&(sameMessage.headers.length||sameMessage.endOfMessage)){
      if(sameMessage.headers.length){
        var primary=sameMessage.headers[0];
        meta["EAS SAME Header"]=primary.raw;
        if(primary.originator)meta["EAS Originator"]=primary.originator+(primary.originatorName?" · "+primary.originatorName:"");
        if(primary.event)meta["EAS Event"]=primary.event+(primary.eventName?" · "+primary.eventName:"");
        if(primary.locations&&primary.locations.length){
          meta["EAS Locations"]=primary.locations.map(function(l){
            var subTxt=l.subdivision==="0"?"":(" subdiv "+l.subdivision);
            return l.raw+(l.stateAbbr?(" ("+l.stateAbbr+(subTxt||"")+")"):"");
          }).join(" · ");
        }
        if(primary.durationMin!=null){
          var dh=Math.floor(primary.durationMin/60),dm=primary.durationMin%60;
          meta["EAS Duration"]=dh+"h "+dm.toString().padStart(2,"0")+"m";
        }
        if(primary.issued){
          var iz=primary.issued;
          meta["EAS Issued"]="Julian day "+iz.julianDay+" · "+iz.hour.toString().padStart(2,"0")+":"+iz.minute.toString().padStart(2,"0")+" UTC";
        }
        if(primary.stationId)meta["EAS Station ID"]=primary.stationId;
        if(sameMessage.headers.length>1)meta["EAS Header Repeats"]=sameMessage.headers.length+" copies decoded";
      }
      if(sameMessage.endOfMessage)meta["EAS End-of-Message"]="NNNN sequence detected";
    }
    var spectrogram=null;
    try{spectrogram=computeAudioSpectrogram(samples,sampleRate,opts,300);}catch(_){spectrogram=null;}
    var correlationBuffer=null;
    try{
      var maxCorrSeconds=30;
      var maxCorrSamples=Math.floor(8000*maxCorrSeconds);
      var srTarget=8000;
      var decim=Math.max(1,Math.floor(sampleRate/srTarget));
      var srCorr=sampleRate/decim;
      var nOut=Math.min(maxCorrSamples,Math.floor(samples.length/decim));
      if(nOut>=4096){
        var corr=new Float32Array(nOut);
        for(var i=0;i<nOut;i++)corr[i]=samples[i*decim];
        correlationBuffer={samples:corr,sampleRate:srCorr};
      }
    }catch(_){correlationBuffer=null;}
    return {format:"audio",meta:meta,traces:[trace],spectrogram:spectrogram,correlationBuffer:correlationBuffer};
  }

  function parseAudioFile(arrayBuffer,fileName,options){
    var ACtor=global.AudioContext||global.webkitAudioContext;
    if(!ACtor)return Promise.reject(new Error("Web Audio API is not available in this browser."));
    var ctx=new ACtor();
    var bufferCopy=arrayBuffer.slice(0);
    return new Promise(function(resolve,reject){
      var done=false;
      var ok=function(buf){if(done)return;done=true;resolve(buf);};
      var fail=function(err){if(done)return;done=true;reject(err instanceof Error?err:new Error("Unable to decode audio file."));};
      try{
        var p=ctx.decodeAudioData(bufferCopy,ok,fail);
        if(p&&typeof p.then==="function")p.then(ok,fail);
      }catch(e){fail(e);}
    }).then(function(buffer){
      try{ctx.close();}catch(_){}
      var ch=buffer.numberOfChannels||1;
      var channels=[];
      for(var c=0;c<ch;c++)channels.push(buffer.getChannelData(c).slice(0));
      return parseAudioFromChannels(channels,buffer.sampleRate,fileName,options);
    });
  }

  var IQ_DEFAULT_OPTIONS={
    iqSampleFormat:"cf32_le",
    iqSampleRateHz:2400000,
    iqCenterFreqHz:0
  };

  function isIqFileName(fileName){
    return /\.(cfile|cf32|fc32|cs16|sc16|cu8)$/i.test(String(fileName||""));
  }
  function isSigmfMetaFileName(fileName){
    return /\.sigmf-meta$/i.test(String(fileName||""));
  }
  function isSigmfDataFileName(fileName){
    return /\.sigmf-data$/i.test(String(fileName||""));
  }
  function getSigmfBasename(fileName){
    return String(fileName||"").replace(/^.*[\\/]/,"").replace(/\.sigmf-(data|meta)$/i,"");
  }
  function guessIqFormatFromName(fileName){
    var name=String(fileName||"").toLowerCase();
    if(/\.(cs16|sc16|ci16)(\.|$)/.test(name))return "ci16_le";
    if(/\.cu8(\.|$)/.test(name))return "cu8";
    if(/\.(cfile|cf32|fc32)(\.|$)/.test(name))return "cf32_le";
    return null;
  }

  function decodeIqBuffer(arrayBuffer,format){
    var fmt=String(format||"cf32_le").toLowerCase().replace(/-/g,"_");
    if(fmt==="cf32_le"||fmt==="cf32"||fmt==="fc32"||fmt==="rf32_iq"){
      var floats=new Float32Array(arrayBuffer);
      var n=Math.floor(floats.length/2);
      var I=new Float32Array(n),Q=new Float32Array(n);
      for(var i=0;i<n;i++){I[i]=floats[2*i];Q[i]=floats[2*i+1];}
      return {I:I,Q:Q};
    }
    if(fmt==="ci16_le"||fmt==="ci16"||fmt==="cs16"||fmt==="sc16"||fmt==="ri16_iq"){
      var ints=new Int16Array(arrayBuffer);
      var n2=Math.floor(ints.length/2);
      var I2=new Float32Array(n2),Q2=new Float32Array(n2);
      for(var j=0;j<n2;j++){I2[j]=ints[2*j]/32768;Q2[j]=ints[2*j+1]/32768;}
      return {I:I2,Q:Q2};
    }
    if(fmt==="cu8"||fmt==="ru8_iq"){
      var bytes=new Uint8Array(arrayBuffer);
      var n3=Math.floor(bytes.length/2);
      var I3=new Float32Array(n3),Q3=new Float32Array(n3);
      for(var k=0;k<n3;k++){I3[k]=(bytes[2*k]-127.5)/127.5;Q3[k]=(bytes[2*k+1]-127.5)/127.5;}
      return {I:I3,Q:Q3};
    }
    throw new Error("Unsupported IQ sample format: "+format);
  }

  function computeIqFftTrace(I,Q,sampleRate,centerFreqHz,opts){
    opts=normalizeAudioFftOptions(opts);
    var len=I.length;
    if(!len)throw new Error("IQ stream contains no samples.");
    var N=opts.fftSize;
    while(N>len)N>>=1;
    if(N<256)throw new Error("IQ stream is too short for the requested FFT size.");
    var hop=Math.max(1,Math.floor(N*(1-opts.overlap)));
    var winFn=(AUDIO_WINDOWS[opts.window]||AUDIO_WINDOWS.hann).fn;
    var win=winFn(N);
    var winSum=0;for(var w=0;w<N;w++)winSum+=win[w];
    var sum=new Float64Array(N);
    var re=new Float64Array(N);
    var im=new Float64Array(N);
    var frames=0;
    for(var start=0;start+N<=len;start+=hop){
      for(var s=0;s<N;s++){
        var ws=win[s];
        re[s]=I[start+s]*ws;
        im[s]=Q[start+s]*ws;
      }
      radix2FFT(re,im);
      for(var b=0;b<N;b++)sum[b]+=Math.sqrt(re[b]*re[b]+im[b]*im[b]);
      frames++;
    }
    if(!frames){
      for(var z=0;z<N;z++){
        var wz=win[z];
        re[z]=z<len?I[z]*wz:0;
        im[z]=z<len?Q[z]*wz:0;
      }
      radix2FFT(re,im);
      for(var b2=0;b2<N;b2++)sum[b2]=Math.sqrt(re[b2]*re[b2]+im[b2]*im[b2]);
      frames=1;
    }
    var data=[];
    var half=N>>1;
    for(var k=0;k<N;k++){
      var binIdx=(k+half)%N;
      var avg=sum[binIdx]/frames;
      var amp=avg/winSum;
      var binFreq=(k-half)*sampleRate/N;
      var dbIq=20*Math.log10(amp+1e-12);
      if(dbIq<-160)dbIq=-160;
      data.push({freq:centerFreqHz+binFreq,amp:dbIq});
    }
    return {data:data,fftSize:N,frames:frames,hop:hop};
  }

  function nextPow2(n){
    var p=1;while(p<n)p<<=1;return p;
  }
  function compareTwoAudioSources(bufA,bufB){
    if(!bufA||!bufB||!bufA.samples||!bufB.samples)return null;
    var srA=Number(bufA.sampleRate)||1,srB=Number(bufB.sampleRate)||1;
    if(Math.abs(srA-srB)>1)return {error:"Sample rates differ ("+srA.toFixed(0)+" vs "+srB.toFixed(0)+" Hz). Resample both files to the same rate first."};
    var sr=srA;
    var lenA=bufA.samples.length,lenB=bufB.samples.length;
    var n=Math.min(lenA,lenB);
    if(n<2048)return {error:"Need at least ~0.25 s of audio in both files."};
    var maxN=Math.min(n,131072);
    var a=new Float32Array(maxN),b=new Float32Array(maxN);
    for(var i=0;i<maxN;i++){a[i]=bufA.samples[i];b[i]=bufB.samples[i];}
    function meanRemove(buf){
      var s=0;for(var k=0;k<buf.length;k++)s+=buf[k];
      var m=s/buf.length;
      for(var k2=0;k2<buf.length;k2++)buf[k2]-=m;
    }
    meanRemove(a);meanRemove(b);
    var rmsA=0,rmsB=0;
    for(var p1=0;p1<maxN;p1++){rmsA+=a[p1]*a[p1];rmsB+=b[p1]*b[p1];}
    rmsA=Math.sqrt(rmsA/maxN);rmsB=Math.sqrt(rmsB/maxN);
    var rmsDbA=20*Math.log10(rmsA||1e-12);
    var rmsDbB=20*Math.log10(rmsB||1e-12);
    var loudnessDiffDb=rmsDbA-rmsDbB;
    var Nfft=nextPow2(2*maxN);
    var aRe=new Float64Array(Nfft),aIm=new Float64Array(Nfft);
    var bRe=new Float64Array(Nfft),bIm=new Float64Array(Nfft);
    for(var c=0;c<maxN;c++){aRe[c]=a[c];bRe[c]=b[c];}
    radix2FFT(aRe,aIm);
    radix2FFT(bRe,bIm);
    var pRe=new Float64Array(Nfft),pIm=new Float64Array(Nfft);
    for(var f=0;f<Nfft;f++){
      var ar=aRe[f],ai=aIm[f],br=bRe[f],biV=-bIm[f];
      pRe[f]=ar*br-ai*biV;
      pIm[f]=ar*biV+ai*br;
    }
    for(var fi=0;fi<Nfft;fi++)pIm[fi]=-pIm[fi];
    radix2FFT(pRe,pIm);
    for(var fk=0;fk<Nfft;fk++){pRe[fk]/=Nfft;pIm[fk]/=Nfft;}
    var bestIdx=0,bestVal=-Infinity;
    var searchRange=Math.min(Nfft,Math.floor(sr*5));
    for(var s=0;s<searchRange;s++){
      var v=pRe[s];
      if(v>bestVal){bestVal=v;bestIdx=s;}
    }
    for(var s2=Nfft-searchRange;s2<Nfft;s2++){
      var v2=pRe[s2];
      if(v2>bestVal){bestVal=v2;bestIdx=s2;}
    }
    var lag=bestIdx<Nfft/2?bestIdx:bestIdx-Nfft;
    var offsetSec=lag/sr;
    var corrCoef=bestVal/(rmsA*rmsB+1e-30);
    if(corrCoef>1)corrCoef=1;if(corrCoef<-1)corrCoef=-1;
    var verdict;
    if(corrCoef>=0.9)verdict="Same content · "+(Math.abs(offsetSec)<0.05?"in sync":(offsetSec>0?"B leads ":"A leads ")+Math.abs(offsetSec*1000).toFixed(0)+" ms");
    else if(corrCoef>=0.6)verdict="Likely same content with processing diffs · offset "+(offsetSec*1000).toFixed(0)+" ms";
    else if(corrCoef>=0.3)verdict="Possibly related (low correlation)";
    else verdict="Unrelated content";
    var matchScore;
    if(corrCoef<0.3)matchScore=0;
    else if(corrCoef<0.6)matchScore=Math.round((corrCoef-0.3)*100/0.3);
    else if(corrCoef<0.9)matchScore=Math.round(50+(corrCoef-0.6)*100/0.6);
    else matchScore=Math.round(80+(corrCoef-0.9)*200);
    if(matchScore>100)matchScore=100;
    var lipSyncOk=corrCoef>=0.6&&Math.abs(offsetSec)<=0.04;
    return {
      sampleRate:sr,
      windowLengthSec:maxN/sr,
      lagSamples:lag,
      offsetSec:offsetSec,
      offsetMs:offsetSec*1000,
      correlation:corrCoef,
      loudnessDiffDb:loudnessDiffDb,
      rmsDbA:rmsDbA,
      rmsDbB:rmsDbB,
      verdict:verdict,
      matchScore:matchScore,
      lipSyncOk:lipSyncOk
    };
  }

  /* ---- SAME (Specific Area Message Encoding) decoder ---------------------
     EAS SAME headers are AFSK at 520.83 baud, mark = 2083.33 Hz,
     space = 1562.5 Hz, framed 8N1 LSB-first ASCII. Each header is
     transmitted three times preceded by a 0xAB preamble; we only need
     one good decode. End-of-message is "NNNN" three times. */
  var EAS_EVENT_CODES={
    EAN:"Emergency Action Notification",
    EAT:"Emergency Action Termination",
    NPT:"National Periodic Test",
    NIC:"National Information Center",
    DMO:"Practice / Demo Warning",
    RWT:"Required Weekly Test",
    RMT:"Required Monthly Test",
    ADR:"Administrative Message",
    AVA:"Avalanche Watch",
    AVW:"Avalanche Warning",
    BLU:"Blue Alert",
    BZW:"Blizzard Warning",
    CAE:"Child Abduction Emergency",
    CDW:"Civil Danger Warning",
    CEM:"Civil Emergency Message",
    CFA:"Coastal Flood Watch",
    CFW:"Coastal Flood Warning",
    DSW:"Dust Storm Warning",
    EQW:"Earthquake Warning",
    EVI:"Evacuation Immediate",
    EWW:"Extreme Wind Warning",
    FFA:"Flash Flood Watch",
    FFS:"Flash Flood Statement",
    FFW:"Flash Flood Warning",
    FLA:"Flood Watch",
    FLS:"Flood Statement",
    FLW:"Flood Warning",
    FRW:"Fire Warning",
    HLS:"Hurricane Local Statement",
    HMW:"Hazardous Materials Warning",
    HUA:"Hurricane Watch",
    HUW:"Hurricane Warning",
    HWA:"High Wind Watch",
    HWW:"High Wind Warning",
    LAE:"Local Area Emergency",
    LEW:"Law Enforcement Warning",
    NUW:"Nuclear Power Plant Warning",
    RHW:"Radiological Hazard Warning",
    SMW:"Special Marine Warning",
    SPS:"Special Weather Statement",
    SPW:"Shelter In Place Warning",
    SQW:"Snow Squall Warning",
    SSA:"Storm Surge Watch",
    SSW:"Storm Surge Warning",
    SVA:"Severe Thunderstorm Watch",
    SVR:"Severe Thunderstorm Warning",
    SVS:"Severe Weather Statement",
    TOA:"Tornado Watch",
    TOE:"911 Telephone Outage Emergency",
    TOR:"Tornado Warning",
    TRA:"Tropical Storm Watch",
    TRW:"Tropical Storm Warning",
    TSA:"Tsunami Watch",
    TSW:"Tsunami Warning",
    VOW:"Volcano Warning",
    WSA:"Winter Storm Watch",
    WSW:"Winter Storm Warning"
  };
  var EAS_ORIGINATOR_NAMES={
    EAS:"Broadcast station / cable operator",
    CIV:"Civil authorities",
    WXR:"NOAA / National Weather Service",
    PEP:"Primary Entry Point (FEMA)",
    EAN:"Emergency Action Notification network"
  };
  var EAS_STATE_FIPS={
    "01":"AL","02":"AK","04":"AZ","05":"AR","06":"CA","08":"CO","09":"CT",
    "10":"DE","11":"DC","12":"FL","13":"GA","15":"HI","16":"ID","17":"IL",
    "18":"IN","19":"IA","20":"KS","21":"KY","22":"LA","23":"ME","24":"MD",
    "25":"MA","26":"MI","27":"MN","28":"MS","29":"MO","30":"MT","31":"NE",
    "32":"NV","33":"NH","34":"NJ","35":"NM","36":"NY","37":"NC","38":"ND",
    "39":"OH","40":"OK","41":"OR","42":"PA","44":"RI","45":"SC","46":"SD",
    "47":"TN","48":"TX","49":"UT","50":"VT","51":"VA","53":"WA","54":"WV",
    "55":"WI","56":"WY","60":"AS","66":"GU","69":"MP","72":"PR","78":"VI"
  };
  var SAME_MARK_HZ=2083.333;
  var SAME_SPACE_HZ=1562.5;
  var SAME_BAUD=520.833;

  function decodeSameAfsk(samples,sampleRate){
    if(!samples||!samples.length)return {bytes:[],bits:[]};
    if(sampleRate<4500)return {bytes:[],bits:[],note:"sample rate too low for SAME (need >= 4500 Hz)"};
    var samplesPerBit=sampleRate/SAME_BAUD;
    var bitWindow=Math.max(8,Math.floor(samplesPerBit*0.6));
    var totalBits=Math.floor((samples.length-bitWindow)/samplesPerBit);
    if(totalBits<200)return {bytes:[],bits:[]};
    function goertzelMag(start,N,freq){
      var k=Math.round(0.5+(N*freq)/sampleRate);
      var w=2*Math.PI*k/N;
      var coeff=2*Math.cos(w);
      var s0=0,s1=0,s2=0;
      for(var i=0;i<N;i++){
        s0=samples[start+i]+coeff*s1-s2;
        s2=s1;s1=s0;
      }
      return s1*s1+s2*s2-coeff*s1*s2;
    }
    var bestPhase=0,bestEnergy=-Infinity;
    for(var phaseTry=0;phaseTry<Math.min(samplesPerBit,32);phaseTry+=2){
      var energy=0,sampled=0;
      for(var b=0;b<Math.min(totalBits,400);b+=4){
        var st=Math.floor(phaseTry+b*samplesPerBit);
        if(st+bitWindow>samples.length)break;
        var m=goertzelMag(st,bitWindow,SAME_MARK_HZ);
        var sp=goertzelMag(st,bitWindow,SAME_SPACE_HZ);
        energy+=Math.abs(m-sp);
        sampled++;
      }
      if(sampled>0&&energy>bestEnergy){bestEnergy=energy;bestPhase=phaseTry;}
    }
    var bits=[];
    var confidences=[];
    for(var bi=0;bi<totalBits;bi++){
      var pos=Math.floor(bestPhase+bi*samplesPerBit);
      if(pos+bitWindow>samples.length)break;
      var markE=goertzelMag(pos,bitWindow,SAME_MARK_HZ);
      var spaceE=goertzelMag(pos,bitWindow,SAME_SPACE_HZ);
      var bit=markE>spaceE?1:0;
      bits.push(bit);
      var sum=markE+spaceE;
      confidences.push(sum>0?Math.abs(markE-spaceE)/sum:0);
    }
    return {bits:bits,bestPhase:bestPhase,confidences:confidences};
  }

  function frameSameBytes(bits){
    var bytes=[];
    var i=0;
    while(i<bits.length-9){
      if(bits[i]!==0){i++;continue;}
      var startedAt=i;
      var byteVal=0;
      for(var b=0;b<8;b++){
        if(bits[startedAt+1+b])byteVal|=(1<<b);
      }
      var stop=bits[startedAt+9];
      if(stop===1){
        bytes.push(byteVal);
        i=startedAt+10;
      }else{
        i=startedAt+1;
      }
    }
    return bytes;
  }

  function bytesToString(bytes,start,end){
    var s="";
    for(var i=start;i<end&&i<bytes.length;i++){
      var c=bytes[i]&0x7F;
      if(c>=32&&c<=126)s+=String.fromCharCode(c);
      else if(c===0)s+=" ";
      else s+=".";
    }
    return s;
  }

  function findSameHeaders(bytes){
    var asText=bytesToString(bytes,0,bytes.length);
    var headers=[];
    var idx=0;
    while(true){
      var found=asText.indexOf("ZCZC",idx);
      if(found<0)break;
      var endDash=asText.indexOf("-",found+30);
      var stop=found+268;
      var endChar=Math.min(stop,asText.length);
      var sliceEnd=endChar;
      var trailingDash=asText.indexOf("- ",found+50);
      if(trailingDash>0&&trailingDash<sliceEnd)sliceEnd=trailingDash+1;
      var raw=asText.slice(found,sliceEnd).replace(/[\s ]+$/,"");
      headers.push({raw:raw,start:found});
      idx=found+raw.length;
    }
    var endOfMessage=asText.indexOf("NNNN")>=0;
    return {headers:headers,endOfMessage:endOfMessage,decodedText:asText};
  }

  function parseSameHeader(raw){
    if(!raw||raw.indexOf("ZCZC")!==0)return null;
    var body=raw.slice(5);
    var plusIdx=body.lastIndexOf("+");
    if(plusIdx<0)return {raw:raw,error:"missing +duration delimiter"};
    var head=body.slice(0,plusIdx);
    var tail=body.slice(plusIdx+1);
    var headParts=head.split("-");
    if(headParts.length<3)return {raw:raw,error:"missing originator/event/location"};
    var originator=headParts[0];
    var event=headParts[1];
    var locations=[];
    for(var i=2;i<headParts.length;i++){
      var loc=headParts[i];
      if(!loc)continue;
      if(/^\d{6}$/.test(loc)){
        var p=loc[0];
        var ss=loc.substr(1,2);
        var ccc=loc.substr(3,3);
        locations.push({raw:loc,subdivision:p,stateFips:ss,stateAbbr:EAS_STATE_FIPS[ss]||null,countyFips:ccc});
      }
    }
    var durationMin=null,issuedRaw=null,stationId=null;
    var tailParts=tail.split("-");
    if(tailParts[0]&&/^\d{4}$/.test(tailParts[0])){
      var hh=parseInt(tailParts[0].substr(0,2),10);
      var mm=parseInt(tailParts[0].substr(2,2),10);
      durationMin=hh*60+mm;
    }
    if(tailParts[1]&&/^\d{7}$/.test(tailParts[1]))issuedRaw=tailParts[1];
    if(tailParts[2])stationId=tailParts[2].replace(/\s/g,"");
    var issued=null;
    if(issuedRaw){
      issued={
        julianDay:parseInt(issuedRaw.substr(0,3),10),
        hour:parseInt(issuedRaw.substr(3,2),10),
        minute:parseInt(issuedRaw.substr(5,2),10),
        raw:issuedRaw
      };
    }
    return {
      raw:raw,
      originator:originator,
      originatorName:EAS_ORIGINATOR_NAMES[originator]||null,
      event:event,
      eventName:EAS_EVENT_CODES[event]||null,
      locations:locations,
      durationMin:durationMin,
      issued:issued,
      stationId:stationId
    };
  }

  function decodeEasSameMessage(samples,sampleRate){
    var afsk=decodeSameAfsk(samples,sampleRate);
    if(!afsk||!afsk.bits||!afsk.bits.length)return null;
    var bytes=frameSameBytes(afsk.bits);
    if(!bytes.length)return null;
    var found=findSameHeaders(bytes);
    if(!found.headers.length&&!found.endOfMessage)return null;
    var parsed=found.headers.map(parseSameHeader).filter(Boolean);
    return {
      headers:parsed,
      rawHeaders:found.headers.map(function(h){return h.raw;}),
      endOfMessage:found.endOfMessage,
      bitCount:afsk.bits.length,
      decodedBytes:bytes.length
    };
  }

  function computeHdRadioMetrics(traceData,centerFreqHz){
    if(!Array.isArray(traceData)||!traceData.length||!isFinite(centerFreqHz))return null;
    var spec=[];
    for(var k=0;k<traceData.length;k++){
      var pt=traceData[k];
      var f=Number(pt.freq),db=Number(pt.amp);
      if(!isFinite(f)||!isFinite(db))continue;
      spec.push({freq:f,db:db});
    }
    if(spec.length<128)return null;
    function bandStats(loHz,hiHz){
      var sumPwr=0,count=0,maxDb=-Infinity;
      for(var i=0;i<spec.length;i++){
        if(spec[i].freq>=loHz&&spec[i].freq<=hiHz){
          var lin=Math.pow(10,spec[i].db/20);
          sumPwr+=lin*lin;
          count++;
          if(spec[i].db>maxDb)maxDb=spec[i].db;
        }
      }
      if(!count||sumPwr<=0)return null;
      return {avgDb:10*Math.log10(sumPwr/count),peakDb:maxDb,bins:count};
    }
    var carrier=bandStats(centerFreqHz-5000,centerFreqHz+5000);
    if(!carrier)return null;
    var carrierPeak=carrier.peakDb;
    var lowerOuter=bandStats(centerFreqHz-200000,centerFreqHz-129000);
    var upperOuter=bandStats(centerFreqHz+129000,centerFreqHz+200000);
    var lowerNoise=bandStats(centerFreqHz-260000,centerFreqHz-240000);
    var upperNoise=bandStats(centerFreqHz+240000,centerFreqHz+260000);
    var hasLowerWindow=lowerOuter!=null;
    var hasUpperWindow=upperOuter!=null;
    if(!hasLowerWindow&&!hasUpperWindow)return null;
    var lowerRel=lowerOuter?lowerOuter.avgDb-carrierPeak:null;
    var upperRel=upperOuter?upperOuter.avgDb-carrierPeak:null;
    var lowerNoiseRel=lowerNoise?lowerNoise.avgDb-carrierPeak:null;
    var upperNoiseRel=upperNoise?upperNoise.avgDb-carrierPeak:null;
    var symmetryDb=null;
    if(lowerRel!=null&&upperRel!=null)symmetryDb=Math.abs(upperRel-lowerRel);
    function aboveNoise(rel,noiseRel){
      if(rel==null)return false;
      var floor=noiseRel!=null?noiseRel:-60;
      return rel>floor+6;
    }
    var lowerActive=aboveNoise(lowerRel,lowerNoiseRel);
    var upperActive=aboveNoise(upperRel,upperNoiseRel);
    var hdDetected=lowerActive&&upperActive&&symmetryDb!=null&&symmetryDb<=6;
    var maxRel=null;
    if(lowerRel!=null)maxRel=lowerRel;
    if(upperRel!=null&&(maxRel==null||upperRel>maxRel))maxRel=upperRel;
    var maskCategory=null;
    var maskCompliance=null;
    if(hdDetected&&maxRel!=null){
      if(maxRel<=-19){maskCategory="-20 dBc hybrid";maskCompliance="PASS";}
      else if(maxRel<=-13.5){maskCategory="-14 dBc upgrade";maskCompliance="PASS";}
      else if(maxRel<=-9.5){maskCategory="-10 dBc all-digital";maskCompliance="PASS";}
      else {maskCategory="exceeds -10 dBc";maskCompliance="FAIL";}
    }
    function clamp(x,lo,hi){return Math.max(lo,Math.min(hi,x));}
    var detectScore=hdDetected?30:0;
    var symScore=null;
    if(symmetryDb==null)symScore=0;
    else if(symmetryDb<=1)symScore=25;
    else if(symmetryDb<=3)symScore=20;
    else if(symmetryDb<=6)symScore=10;
    else symScore=Math.max(0,10-(symmetryDb-6)*1.5);
    var maskScore;
    if(!hdDetected)maskScore=0;
    else if(maskCompliance==="PASS")maskScore=30;
    else maskScore=Math.max(0,30-(maxRel-(-9.5))*4);
    var levelScore;
    if(!hdDetected||maxRel==null)levelScore=0;
    else if(maxRel>=-22&&maxRel<=-13)levelScore=15;
    else if(maxRel<-22)levelScore=clamp(15+(maxRel+22)*1.5,0,15);
    else levelScore=clamp(15-(maxRel+13)*1.2,0,15);
    var hdScore=Math.round(detectScore+symScore+maskScore+levelScore);
    hdScore=clamp(hdScore,0,100);
    return {
      detected:hdDetected,
      lowerSidebandRelDb:lowerRel,
      upperSidebandRelDb:upperRel,
      lowerNoiseRelDb:lowerNoiseRel,
      upperNoiseRelDb:upperNoiseRel,
      symmetryDb:symmetryDb,
      maxSidebandRelDb:maxRel,
      maskCategory:maskCategory,
      maskCompliance:maskCompliance,
      hdScore:hdScore,
      subScores:{
        detection:Math.round(detectScore),
        symmetry:Math.round(symScore),
        mask:Math.round(maskScore),
        level:Math.round(levelScore)
      }
    };
  }

  function computeIqSpectrogram(I,Q,sampleRate,centerFreqHz,opts,maxFrames){
    var settings=normalizeAudioFftOptions(opts);
    var len=I.length;
    if(!len)throw new Error("IQ stream has no samples for spectrogram.");
    var N=settings.fftSize;
    while(N>len)N>>=1;
    if(N<256)throw new Error("IQ stream too short for spectrogram.");
    var hop=Math.max(1,Math.floor(N*(1-settings.overlap)));
    var winFn=(AUDIO_WINDOWS[settings.window]||AUDIO_WINDOWS.hann).fn;
    var win=winFn(N);
    var winSum=0;for(var w=0;w<N;w++)winSum+=win[w];
    var maxF=Math.max(8,Math.min(maxFrames||300,Math.floor((len-N)/hop)+1));
    var totalFrames=Math.max(1,Math.floor((len-N)/hop)+1);
    var stride=Math.max(1,Math.floor(totalFrames/maxF));
    var binCount=N;
    var keptFrames=Math.floor(totalFrames/stride);
    if(keptFrames<1)keptFrames=1;
    var data=new Float32Array(keptFrames*binCount);
    var frameTimes=new Float32Array(keptFrames);
    var re=new Float64Array(N),im=new Float64Array(N);
    var minDb=Infinity,maxDb=-Infinity;
    var half=N>>1;
    for(var fi=0;fi<keptFrames;fi++){
      var start=fi*stride*hop;
      if(start+N>len)start=len-N;
      for(var s=0;s<N;s++){re[s]=I[start+s]*win[s];im[s]=Q[start+s]*win[s];}
      radix2FFT(re,im);
      var rowOffset=fi*binCount;
      for(var b=0;b<binCount;b++){
        var binIdx=(b+half)%N;
        var mag=Math.sqrt(re[binIdx]*re[binIdx]+im[binIdx]*im[binIdx]);
        var amp=mag/winSum;
        var db=20*Math.log10(amp+1e-12);
        if(db<-160)db=-160;
        if(db<minDb)minDb=db;
        if(db>maxDb)maxDb=db;
        data[rowOffset+b]=db;
      }
      frameTimes[fi]=start/sampleRate;
    }
    if(!isFinite(minDb))minDb=-120;
    if(!isFinite(maxDb))maxDb=0;
    return {
      data:data,frameTimes:frameTimes,frameCount:keptFrames,binCount:binCount,
      sampleRate:sampleRate,fftSize:N,hopSize:hop,stride:stride,
      window:settings.window,minDb:minDb,maxDb:maxDb,
      durationSec:len/sampleRate,
      centerFreqHz:isFinite(centerFreqHz)?centerFreqHz:0,
      isIq:true
    };
  }

  function demodulateIqAm(I,Q,sampleRate,opts){
    var n=I.length;
    var decim=Math.max(1,Math.floor(sampleRate/48000));
    var audioRate=sampleRate/decim;
    var nOut=Math.floor(n/decim);
    if(nOut<256)throw new Error("IQ capture too short for AM demodulation.");
    var env=new Float32Array(nOut);
    var mean=0;
    for(var i=0;i<nOut;i++){
      var si=i*decim;
      env[i]=Math.sqrt(I[si]*I[si]+Q[si]*Q[si]);
      mean+=env[i];
    }
    mean/=nOut;
    for(var k=0;k<nOut;k++)env[k]-=mean;
    var result=computeAudioFftTrace(env,audioRate,opts);
    result.pcmSamples=env;
    result.audioRate=audioRate;
    return result;
  }

  function demodulateIqFm(I,Q,sampleRate,opts){
    var n=I.length;
    var decim=Math.max(1,Math.floor(sampleRate/48000));
    var audioRate=sampleRate/decim;
    var nOut=Math.floor(n/decim);
    if(nOut<256)throw new Error("IQ capture too short for FM demodulation.");
    var demod=new Float32Array(nOut);
    for(var i=1;i<nOut;i++){
      var si=i*decim,sj=si-decim;
      var denom=I[si]*I[si]+Q[si]*Q[si];
      demod[i]=denom<1e-20?0:(Q[si]*I[sj]-I[si]*Q[sj])/denom;
    }
    if(nOut>0)demod[0]=nOut>1?demod[1]:0;
    var result=computeAudioFftTrace(demod,audioRate,opts);
    result.pcmSamples=demod;
    result.audioRate=audioRate;
    return result;
  }

  function demodulateIqFmAtOffset(I,Q,sampleRate,offsetHz,opts){
    var n=I.length;
    var shiftedI=new Float32Array(n);
    var shiftedQ=new Float32Array(n);
    var phase=0;
    var dphase=2*Math.PI*offsetHz/sampleRate;
    for(var i=0;i<n;i++){
      var cos=Math.cos(phase),sin=Math.sin(phase);
      shiftedI[i]=I[i]*cos+Q[i]*sin;
      shiftedQ[i]=Q[i]*cos-I[i]*sin;
      phase+=dphase;
      if(phase>Math.PI)phase-=2*Math.PI;
      else if(phase<-Math.PI)phase+=2*Math.PI;
    }
    return demodulateIqFm(shiftedI,shiftedQ,sampleRate,opts);
  }

  function buildIqResult(arrayBuffer,fileName,format,sampleRate,centerFreqHz,opts,extraMeta){
    _fc++;
    var fc=_fc;
    var iq=decodeIqBuffer(arrayBuffer,format);
    if(!iq.I.length)throw new Error("IQ file produced zero samples.");
    var result=computeIqFftTrace(iq.I,iq.Q,sampleRate,centerFreqHz,opts);
    var prefix=String(fileName||"iq").replace(/^.*[\\/]/,"").replace(/\.[^.]+$/,"")+" ";
    var trace=makeTrace(prefix,fileName,"IQ_FFT",fc);
    trace.data=normalizeTraceData(result.data);
    trace.units={x:"Hz",y:"dBFS"};
    trace.kind="raw";
    var meta={
      "Format":"IQ",
      "Sample Format":format,
      "Sample Rate":{value:sampleRate,unit:"Hz"},
      "Center Frequency":{value:centerFreqHz,unit:"Hz"},
      "Sample Count":iq.I.length,
      "FFT Size":result.fftSize,
      "Window":(AUDIO_WINDOWS[opts.window]&&AUDIO_WINDOWS[opts.window].label)||opts.window,
      "Overlap":Math.round(opts.overlap*100)+"%",
      "Frames Averaged":result.frames
    };
    if(extraMeta&&typeof extraMeta==="object"){
      Object.keys(extraMeta).forEach(function(k){meta[k]=extraMeta[k];});
    }
    var hd=null;
    try{
      if(sampleRate>=500000)hd=computeHdRadioMetrics(trace.data,centerFreqHz);
    }catch(_){hd=null;}
    if(hd){
      meta["HD Radio"]=hd.detected?"IBOC sidebands detected":"No IBOC sidebands";
      if(hd.lowerSidebandRelDb!=null)meta["HD Lower Sideband"]=(hd.lowerSidebandRelDb>=0?"+":"")+hd.lowerSidebandRelDb.toFixed(1)+" dBc";
      if(hd.upperSidebandRelDb!=null)meta["HD Upper Sideband"]=(hd.upperSidebandRelDb>=0?"+":"")+hd.upperSidebandRelDb.toFixed(1)+" dBc";
      if(hd.symmetryDb!=null)meta["HD Sideband Symmetry"]=hd.symmetryDb.toFixed(2)+" dB";
      if(hd.maskCategory){
        meta["HD Mask"]=hd.maskCompliance+" · "+hd.maskCategory+(hd.maxSidebandRelDb!=null?(" · max "+hd.maxSidebandRelDb.toFixed(1)+" dBc"):"");
      }
      if(hd.detected){
        var hs=hd.subScores||{};
        meta["HD Radio Score"]=hd.hdScore+" / 100 · detect "+hs.detection+" · sym "+hs.symmetry+" · mask "+hs.mask+" · level "+hs.level;
      }
    }
    var traces=[trace];
    var amTrace=null;
    var amPcm=null,amAudioRate=0;
    try{
      var amResult=demodulateIqAm(iq.I,iq.Q,sampleRate,opts);
      amTrace=makeTrace(prefix+"(AM demod)",fileName,"IQ_AM",fc);
      amTrace.data=normalizeTraceData(amResult.data);
      amTrace.units={x:"Hz",y:"dBFS"};
      amTrace.kind="derived";
      meta["AM Audio Rate"]={value:Math.round(sampleRate/Math.max(1,Math.floor(sampleRate/48000))),unit:"Hz"};
      amPcm=amResult.pcmSamples||null;
      amAudioRate=amResult.audioRate||0;
    }catch(_){amTrace=null;}
    if(amTrace)traces.push(amTrace);
    var fmTrace=null;
    var fmPcm=null;
    try{
      var fmResult=demodulateIqFm(iq.I,iq.Q,sampleRate,opts);
      fmTrace=makeTrace(prefix+"(FM demod)",fileName,"IQ_FM",fc);
      fmTrace.data=normalizeTraceData(fmResult.data);
      fmTrace.units={x:"Hz",y:"dBFS"};
      fmTrace.kind="derived";
      fmPcm=fmResult.pcmSamples||null;
    }catch(_){fmTrace=null;}
    if(fmTrace)traces.push(fmTrace);
    var iqDemodPcm=(amPcm||fmPcm)?{amSamples:amPcm,fmSamples:fmPcm,rate:amAudioRate||48000}:null;
    var spectrogram=null;
    try{spectrogram=computeIqSpectrogram(iq.I,iq.Q,sampleRate,centerFreqHz,opts,300);}catch(_){spectrogram=null;}
    var iqRaw={I:iq.I,Q:iq.Q,sampleRate:sampleRate,centerFreqHz:isFinite(centerFreqHz)?centerFreqHz:0};
    return {format:"iq",meta:meta,traces:traces,spectrogram:spectrogram,iqDemodPcm:iqDemodPcm,iqRaw:iqRaw};
  }

  function parseIqFile(arrayBuffer,fileName,options){
    var defaults=Object.assign({},IQ_DEFAULT_OPTIONS,AUDIO_DEFAULT_OPTIONS);
    var merged=Object.assign({},defaults,options||{});
    var format=merged.iqSampleFormat||guessIqFormatFromName(fileName)||"cf32_le";
    var sr=Number(merged.iqSampleRateHz);
    if(!isFinite(sr)||sr<=0)throw new Error("IQ sample rate must be a positive number.");
    var cf=Number(merged.iqCenterFreqHz);
    if(!isFinite(cf))cf=0;
    return buildIqResult(arrayBuffer,fileName,format,sr,cf,normalizeAudioFftOptions(merged),null);
  }

  function parseSigmfPair(metaText,dataArrayBuffer,baseName,options){
    var meta;
    try{meta=JSON.parse(String(metaText||""));}
    catch(e){throw new Error("SigMF metadata is not valid JSON: "+(e&&e.message||e));}
    var globalMeta=meta&&meta.global?meta.global:{};
    var captures=Array.isArray(meta&&meta.captures)?meta.captures:[];
    var annotations=Array.isArray(meta&&meta.annotations)?meta.annotations:[];
    var firstCapture=captures[0]||{};
    var datatype=String(globalMeta["core:datatype"]||"cf32_le").toLowerCase();
    var sr=Number(globalMeta["core:sample_rate"]);
    if(!isFinite(sr)||sr<=0){
      sr=Number(options&&options.iqSampleRateHz)||IQ_DEFAULT_OPTIONS.iqSampleRateHz;
    }
    var cf=Number(firstCapture["core:frequency"]);
    if(!isFinite(cf))cf=Number(options&&options.iqCenterFreqHz)||0;
    var fmt=datatype.replace(/-/g,"_");
    var defaults=Object.assign({},IQ_DEFAULT_OPTIONS,AUDIO_DEFAULT_OPTIONS);
    var merged=normalizeAudioFftOptions(Object.assign({},defaults,options||{}));
    var extra={};
    if(globalMeta["core:hw"])extra["Hardware"]=String(globalMeta["core:hw"]);
    if(globalMeta["core:author"])extra["Author"]=String(globalMeta["core:author"]);
    if(globalMeta["core:description"])extra["Description"]=String(globalMeta["core:description"]);
    if(firstCapture["core:datetime"])extra["Capture Time"]=String(firstCapture["core:datetime"]);
    if(globalMeta["core:version"])extra["SigMF Version"]=String(globalMeta["core:version"]);
    if(captures.length>1){
      extra["Capture Segments"]=captures.length+" segments";
      var cfList=captures.map(function(c,i){
        var f=Number(c["core:frequency"]);
        return isFinite(f)?(f>=1e6?(f/1e6).toFixed(3)+" MHz":f>=1e3?(f/1e3).toFixed(1)+" kHz":f.toFixed(0)+" Hz"):"seg "+(i+1);
      }).join(", ");
      extra["Segment Frequencies"]=cfList;
    }
    if(annotations.length){
      extra["Annotations"]=annotations.length+" annotation"+(annotations.length!==1?"s":"");
      var annLimit=Math.min(annotations.length,8);
      for(var ai=0;ai<annLimit;ai++){
        var ann=annotations[ai];
        var annLabel=String(ann["core:label"]||ann["core:comment"]||("Ann "+(ai+1)));
        var annParts=[];
        var fLo=Number(ann["core:freq_lower_edge"]);
        var fHi=Number(ann["core:freq_upper_edge"]);
        function fmtAnnotHz(hz){
          return hz>=1e9?(hz/1e9).toFixed(4)+" GHz":hz>=1e6?(hz/1e6).toFixed(4)+" MHz":hz>=1e3?(hz/1e3).toFixed(2)+" kHz":hz.toFixed(0)+" Hz";
        }
        if(isFinite(fLo)&&isFinite(fHi))annParts.push(fmtAnnotHz(fLo)+" – "+fmtAnnotHz(fHi));
        else if(isFinite(fLo))annParts.push("from "+fmtAnnotHz(fLo));
        else if(isFinite(fHi))annParts.push("to "+fmtAnnotHz(fHi));
        var sSt=Number(ann["core:sample_start"]);
        var sCt=Number(ann["core:sample_count"]);
        if(isFinite(sSt)&&sr>0){
          var tStart=(sSt/sr).toFixed(3)+"s";
          var tEnd=isFinite(sCt)?(" – "+(((sSt+sCt)/sr).toFixed(3))+"s"):"";
          annParts.push("t="+tStart+tEnd);
        }
        if(ann["core:comment"]&&ann["core:label"])annParts.push('"'+String(ann["core:comment"])+'"');
        extra["Ann "+(ai+1)+": "+annLabel]=annParts.join(" · ")||"(no range)";
      }
      if(annotations.length>annLimit)extra["..."]=((annotations.length-annLimit)+" more annotations");
    }
    return buildIqResult(dataArrayBuffer,baseName+".sigmf-data",fmt,sr,cf,merged,extra);
  }

  global.ParserHelpers={
    resetParserFileCounter:resetParserFileCounter,
    syncParserFileCounter:syncParserFileCounter,
    nearestPoint:nearestPoint,
    parseRSDat:parseRSDat,
    getFirstNonCommentLine:getFirstNonCommentLine,
    isTouchstoneFileName:isTouchstoneFileName,
    getTouchstonePortCountFromFileName:getTouchstonePortCountFromFileName,
    looksLikeTouchstoneText:looksLikeTouchstoneText,
    detectImportedFileFormat:detectImportedFileFormat,
    parseTouchstone:parseTouchstone,
    parseImportedFile:parseImportedFile,
    parseMeasurementFile:parseMeasurementFile,
    isAudioFileName:isAudioFileName,
    parseAudioFile:parseAudioFile,
    parseAudioFromChannels:parseAudioFromChannels,
    computeAudioSpectrogram:computeAudioSpectrogram,
    compareTwoAudioSources:compareTwoAudioSources,
    decodeEasSameMessage:decodeEasSameMessage,
    EAS_EVENT_CODES:EAS_EVENT_CODES,
    EAS_ORIGINATOR_NAMES:EAS_ORIGINATOR_NAMES,
    EAS_STATE_FIPS:EAS_STATE_FIPS,
    AUDIO_WINDOWS:AUDIO_WINDOWS,
    AUDIO_FFT_SIZES:AUDIO_FFT_SIZES,
    AUDIO_DEFAULT_OPTIONS:AUDIO_DEFAULT_OPTIONS,
    normalizeAudioFftOptions:normalizeAudioFftOptions,
    isSpecMaskFileName:isSpecMaskFileName,
    parseSpecMaskJson:parseSpecMaskJson,
    buildMaskComplianceReport:buildMaskComplianceReport,
    isIqFileName:isIqFileName,
    isSigmfMetaFileName:isSigmfMetaFileName,
    isSigmfDataFileName:isSigmfDataFileName,
    getSigmfBasename:getSigmfBasename,
    parseIqFile:parseIqFile,
    parseSigmfPair:parseSigmfPair,
    IQ_DEFAULT_OPTIONS:IQ_DEFAULT_OPTIONS,
    computeIqSpectrogram:computeIqSpectrogram,
    demodulateIqAm:demodulateIqAm,
    demodulateIqFm:demodulateIqFm,
    demodulateIqFmAtOffset:demodulateIqFmAtOffset
  };
})(window);
