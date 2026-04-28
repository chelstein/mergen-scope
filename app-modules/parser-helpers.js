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
      data.push({freq:b3*sampleRate/N,amp:20*Math.log10(amp+1e-12)});
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
    var fund=null,fundIdx=-1;
    for(var b=1;b<spec.length;b++){
      if(!fund||spec[b].pwr>fund.pwr){fund=spec[b];fundIdx=b;}
    }
    var fundamentalHz=fund?fund.freq:null;
    var thdNPercent=null;
    if(fund&&totalPwr>0){
      var notch=Math.max(30,fundamentalHz*0.02);
      var resid=0;
      for(var c=0;c<spec.length;c++){
        if(Math.abs(spec[c].freq-fundamentalHz)>notch)resid+=spec[c].pwr;
      }
      thdNPercent=Math.sqrt(resid/totalPwr)*100;
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
      fundIdx:fundIdx
    };
  }

  function formatHz(hz){
    if(hz==null||!isFinite(hz))return null;
    if(hz>=1e6)return (hz/1e6).toFixed(3)+" MHz";
    if(hz>=1e3)return (hz/1e3).toFixed(3)+" kHz";
    return hz.toFixed(1)+" Hz";
  }

  function parseAudioFile(arrayBuffer,fileName,options){
    _fc++;
    var fc=_fc;
    var ACtor=global.AudioContext||global.webkitAudioContext;
    if(!ACtor)return Promise.reject(new Error("Web Audio API is not available in this browser."));
    var opts=normalizeAudioFftOptions(options);
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
      var sr=buffer.sampleRate;
      var ch=buffer.numberOfChannels||1;
      var channels=[];
      for(var c=0;c<ch;c++)channels.push(buffer.getChannelData(c).slice(0));
      var samples=selectAudioChannelSamples(channels,opts.channel);
      var result=computeAudioFftTrace(samples,sr,opts);
      var prefix=String(fileName||"audio").replace(/^.*[\\/]/,"").replace(/\.[^.]+$/,"")+" ";
      var label="FFT";
      if(opts.channel!=="auto")label="FFT_ch"+(parseInt(opts.channel,10)||0);
      var trace=makeTrace(prefix,fileName,label,fc);
      trace.data=normalizeTraceData(result.data);
      trace.units={x:"Hz",y:"dBFS"};
      var metrics=null;
      try{metrics=computeAudioMetrics(samples,sr,result);}catch(_){metrics=null;}
      var meta={
        "Format":"Audio",
        "Sample Rate":{value:sr,unit:"Hz"},
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
        if(metrics.thdNPercent!=null)meta["THD+N"]=metrics.thdNPercent.toFixed(3)+" %";
        if(metrics.snrDb!=null)meta["SNR (est.)"]=metrics.snrDb.toFixed(1)+" dB";
      }
      return {format:"audio",meta:meta,traces:[trace]};
    });
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
    AUDIO_WINDOWS:AUDIO_WINDOWS,
    AUDIO_FFT_SIZES:AUDIO_FFT_SIZES,
    AUDIO_DEFAULT_OPTIONS:AUDIO_DEFAULT_OPTIONS,
    normalizeAudioFftOptions:normalizeAudioFftOptions,
    isSpecMaskFileName:isSpecMaskFileName,
    parseSpecMaskJson:parseSpecMaskJson,
    buildMaskComplianceReport:buildMaskComplianceReport
  };
})(window);
