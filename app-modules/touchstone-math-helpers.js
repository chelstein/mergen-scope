(function(global){
  function cx(re,im){
    return {
      re:isFinite(re)?Number(re):0,
      im:isFinite(im)?Number(im):0
    };
  }

  function cloneComplex(z){
    return cx(z&&z.re,z&&z.im);
  }

  function add(a,b){
    return cx((a?a.re:0)+(b?b.re:0),(a?a.im:0)+(b?b.im:0));
  }

  function sub(a,b){
    return cx((a?a.re:0)-(b?b.re:0),(a?a.im:0)-(b?b.im:0));
  }

  function mul(a,b){
    a=a||cx(0,0);
    b=b||cx(0,0);
    return cx(a.re*b.re-a.im*b.im,a.re*b.im+a.im*b.re);
  }

  function div(a,b){
    a=a||cx(0,0);
    b=b||cx(0,0);
    var denom=b.re*b.re+b.im*b.im;
    if(!isFinite(denom)||denom===0)return null;
    return cx((a.re*b.re+a.im*b.im)/denom,(a.im*b.re-a.re*b.im)/denom);
  }

  function conj(a){
    a=a||cx(0,0);
    return cx(a.re,-a.im);
  }

  function abs(a){
    a=a||cx(0,0);
    return Math.hypot(a.re,a.im);
  }

  function abs2(a){
    a=a||cx(0,0);
    return a.re*a.re+a.im*a.im;
  }

  function fromPolar(magnitude,angleDeg){
    var mag=isFinite(magnitude)?Number(magnitude):0;
    var theta=(isFinite(angleDeg)?Number(angleDeg):0)*Math.PI/180;
    return cx(mag*Math.cos(theta),mag*Math.sin(theta));
  }

  function fromDbAngle(db,angleDeg){
    var mag=Math.pow(10,Number(db)/20);
    if(!isFinite(mag))mag=0;
    return fromPolar(mag,angleDeg);
  }

  function normalizeMatrixFormat(matrixFormat){
    var fmt=String(matrixFormat||"full").trim().toLowerCase();
    if(fmt==="lower"||fmt==="upper"||fmt==="full")return fmt;
    return "full";
  }

  function buildMatrixOrder(portCount,matrixFormat){
    var n=Math.max(1,Math.floor(Number(portCount)||0));
    var fmt=normalizeMatrixFormat(matrixFormat);
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
  }

  function makeComplexMatrix(portCount){
    var n=Math.max(1,Math.floor(Number(portCount)||0));
    var matrix=[];
    for(var row=0;row<n;row++){
      var line=[];
      for(var col=0;col<n;col++)line.push(cx(0,0));
      matrix.push(line);
    }
    return matrix;
  }

  function cloneComplexMatrix(matrix){
    return (Array.isArray(matrix)?matrix:[]).map(function(row){
      return (Array.isArray(row)?row:[]).map(cloneComplex);
    });
  }

  function matrixIdentity(portCount){
    var n=Math.max(1,Math.floor(Number(portCount)||0));
    var matrix=makeComplexMatrix(n);
    for(var i=0;i<n;i++)matrix[i][i]=cx(1,0);
    return matrix;
  }

  function matrixAdd(a,b){
    var n=(a&&a.length)||0;
    var out=makeComplexMatrix(n);
    for(var row=0;row<n;row++){
      for(var col=0;col<n;col++)out[row][col]=add(a[row][col],b[row][col]);
    }
    return out;
  }

  function matrixSubtract(a,b){
    var n=(a&&a.length)||0;
    var out=makeComplexMatrix(n);
    for(var row=0;row<n;row++){
      for(var col=0;col<n;col++)out[row][col]=sub(a[row][col],b[row][col]);
    }
    return out;
  }

  function matrixMultiply(a,b){
    var n=(a&&a.length)||0;
    var out=makeComplexMatrix(n);
    for(var row=0;row<n;row++){
      for(var col=0;col<n;col++){
        var sum=cx(0,0);
        for(var k=0;k<n;k++){
          sum=add(sum,mul(a[row][k],b[k][col]));
        }
        out[row][col]=sum;
      }
    }
    return out;
  }

  function matrixScaleDiagonal(referenceOhms,transform){
    var refs=Array.isArray(referenceOhms)?referenceOhms.map(Number):normalizeReferenceArray(referenceOhms,1);
    if(!refs||!refs.length)return null;
    for(var i=0;i<refs.length;i++){
      if(!isFinite(refs[i])||refs[i]<=0)return null;
    }
    var matrix=makeComplexMatrix(refs.length);
    for(var i=0;i<refs.length;i++){
      var value=transform(refs[i],i);
      if(value==null)return null;
      matrix[i][i]=value;
    }
    return matrix;
  }

  function matrixInverse(matrix){
    var n=(matrix&&matrix.length)||0;
    if(!n)return null;
    var aug=[];
    for(var row=0;row<n;row++){
      var line=[];
      for(var col=0;col<n;col++)line.push(cloneComplex(matrix[row][col]));
      for(var j=0;j<n;j++)line.push(j===row?cx(1,0):cx(0,0));
      aug.push(line);
    }
    for(var pivotCol=0;pivotCol<n;pivotCol++){
      var pivotRow=pivotCol;
      var pivotMag=abs(aug[pivotRow][pivotCol]);
      for(var row2=pivotCol+1;row2<n;row2++){
        var mag=abs(aug[row2][pivotCol]);
        if(mag>pivotMag){
          pivotMag=mag;
          pivotRow=row2;
        }
      }
      if(!isFinite(pivotMag)||pivotMag<=1e-15)return null;
      if(pivotRow!==pivotCol){
        var tmp=aug[pivotCol];
        aug[pivotCol]=aug[pivotRow];
        aug[pivotRow]=tmp;
      }
      var pivot=aug[pivotCol][pivotCol];
      for(var col2=0;col2<2*n;col2++){
        var normalized=div(aug[pivotCol][col2],pivot);
        if(normalized==null)return null;
        aug[pivotCol][col2]=normalized;
      }
      for(var row3=0;row3<n;row3++){
        if(row3===pivotCol)continue;
        var factor=aug[row3][pivotCol];
        if(abs(factor)<=1e-15){
          aug[row3][pivotCol]=cx(0,0);
          continue;
        }
        for(var col3=0;col3<2*n;col3++){
          aug[row3][col3]=sub(aug[row3][col3],mul(factor,aug[pivotCol][col3]));
        }
      }
    }
    var inverse=[];
    for(var row4=0;row4<n;row4++){
      inverse.push(aug[row4].slice(n,2*n).map(cloneComplex));
    }
    return inverse;
  }

  function normalizeReferenceArray(referenceOhms,portCount){
    var hasPortCount=portCount!=null&&isFinite(Number(portCount))&&Number(portCount)>0;
    var n=hasPortCount?Math.max(1,Math.floor(Number(portCount)||0)):0;
    if(Array.isArray(referenceOhms)){
      var refs=referenceOhms.map(Number);
      if(!refs.length)return null;
      for(var idx=0;idx<refs.length;idx++){
        if(!isFinite(refs[idx])||refs[idx]<=0)return null;
      }
      if(hasPortCount&&refs.length===1){
        var rep=[];
        for(var j=0;j<n;j++)rep.push(refs[0]);
        return rep;
      }
      if(hasPortCount&&refs.length!==n)return null;
      return refs;
    }
    var scalar=Number(referenceOhms);
    if(!isFinite(scalar)||scalar<=0)return null;
    if(!hasPortCount)return [scalar];
    var out=[];
    for(var j=0;j<n;j++)out.push(scalar);
    return out;
  }

  function expandOrderedValuesToMatrix(portCount,matrixFormat,values){
    var n=Math.max(1,Math.floor(Number(portCount)||0));
    var fmt=normalizeMatrixFormat(matrixFormat);
    var order=buildMatrixOrder(n,fmt);
    if(!Array.isArray(values)||values.length!==order.length)return null;
    var matrix=makeComplexMatrix(n);
    for(var i=0;i<order.length;i++){
      var entry=order[i];
      var value=cloneComplex(values[i]);
      matrix[entry.row][entry.col]=value;
      if(fmt!=="full"&&entry.row!==entry.col)matrix[entry.col][entry.row]=cloneComplex(value);
    }
    return matrix;
  }

  function touchstonePairToComplex(dataFormat,a,b){
    var fmt=String(dataFormat||"MA").trim().toUpperCase();
    if(fmt==="RI")return cx(a,b);
    if(fmt==="DB")return fromDbAngle(a,b);
    return fromPolar(a,b);
  }

  function convertSMatrixToZMatrix(sMatrix,referenceOhms){
    var n=(sMatrix&&sMatrix.length)||0;
    if(!n)return null;
    var refs=normalizeReferenceArray(referenceOhms,n);
    if(!refs)return null;
    var identity=matrixIdentity(n);
    var plus=matrixAdd(identity,sMatrix);
    var minus=matrixSubtract(identity,sMatrix);
    var minusInv=matrixInverse(minus);
    if(!minusInv)return null;
    var left=matrixScaleDiagonal(refs,function(value){
      return cx(Math.sqrt(value),0);
    });
    if(!left)return null;
    return matrixMultiply(matrixMultiply(left,matrixMultiply(plus,minusInv)),left);
  }

  function convertSMatrixToYMatrix(sMatrix,referenceOhms){
    var n=(sMatrix&&sMatrix.length)||0;
    if(!n)return null;
    var refs=normalizeReferenceArray(referenceOhms,n);
    if(!refs)return null;
    var identity=matrixIdentity(n);
    var minus=matrixSubtract(identity,sMatrix);
    var plus=matrixAdd(identity,sMatrix);
    var plusInv=matrixInverse(plus);
    if(!plusInv)return null;
    var invLeft=matrixScaleDiagonal(refs,function(value){
      return cx(1/Math.sqrt(value),0);
    });
    if(!invLeft)return null;
    return matrixMultiply(matrixMultiply(invLeft,matrixMultiply(minus,plusInv)),invLeft);
  }

  function convertYMatrixToSMatrix(yMatrix,referenceOhms){
    var n=(yMatrix&&yMatrix.length)||0;
    if(!n)return null;
    var refs=normalizeReferenceArray(referenceOhms,n);
    if(!refs)return null;
    var sqrtZ=matrixScaleDiagonal(refs,function(value){return cx(Math.sqrt(value),0);});
    if(!sqrtZ)return null;
    var G=matrixMultiply(matrixMultiply(sqrtZ,yMatrix),sqrtZ);
    if(!G)return null;
    var I=matrixIdentity(n);
    var IPlusG=matrixAdd(I,G);
    var IMinusG=matrixSubtract(I,G);
    var inv=matrixInverse(IPlusG);
    if(!inv)return null;
    return matrixMultiply(inv,IMinusG);
  }

  function computeTwoPortStability(sMatrix){
    if(!Array.isArray(sMatrix)||sMatrix.length!==2||!Array.isArray(sMatrix[0])||!Array.isArray(sMatrix[1]))return null;
    var s11=sMatrix[0][0]||cx(0,0);
    var s12=sMatrix[0][1]||cx(0,0);
    var s21=sMatrix[1][0]||cx(0,0);
    var s22=sMatrix[1][1]||cx(0,0);
    var delta=sub(mul(s11,s22),mul(s12,s21));
    var deltaAbs=abs(delta);
    var s12s21=mul(s12,s21);
    var s12s21Abs=abs(s12s21);
    var kNumerator=1-abs2(s11)-abs2(s22)+deltaAbs*deltaAbs;
    var kDenominator=2*s12s21Abs;
    var kFactor;
    if(kDenominator===0)kFactor=kNumerator>=0?Infinity:-Infinity;
    else kFactor=kNumerator/kDenominator;
    var deltaConj=conj(delta);
    var mu1Numerator=1-abs2(s11);
    var mu1Denominator=abs(sub(s22,mul(deltaConj,s11)))+s12s21Abs;
    var mu1=mu1Denominator===0?((mu1Numerator>=0)?Infinity:-Infinity):(mu1Numerator/mu1Denominator);
    var mu2Numerator=1-abs2(s22);
    var mu2Denominator=abs(sub(s11,mul(deltaConj,s22)))+s12s21Abs;
    var mu2=mu2Denominator===0?((mu2Numerator>=0)?Infinity:-Infinity):(mu2Numerator/mu2Denominator);
    return {
      delta:delta,
      deltaAbs:deltaAbs,
      kFactor:kFactor,
      mu1:mu1,
      mu2:mu2,
      unconditional:!!(kFactor>1&&deltaAbs<1)
    };
  }

  function getTouchstoneFileBaseName(fileName){
    var name=String(fileName||"").replace(/^.*[\\/]/,"");
    return name.replace(/\.[^.]+$/,"")||name||"touchstone";
  }

  function buildTouchstoneTraceLabel(fileName,family,row,col,view){
    var base=getTouchstoneFileBaseName(fileName);
    var cell=String(family||"").toUpperCase()+(isFinite(row)?String(row):"")+(isFinite(col)?String(col):"");
    var suffix=String(view||"").trim();
    return [base,cell,suffix].filter(function(part){return !!String(part).trim();}).join(" ");
  }

  /* Mixed-mode S-parameter conversion for 4-port balanced networks.
     Default port pairing assumes ports (1,2) form differential pair 1
     and ports (3,4) form differential pair 2 (Touchstone 1-indexed
     becomes 0-indexed [0,1] and [2,3] internally). The conversion
     matrix M is orthogonal (M * M^T = I) so M^-1 = M^T.
     S_mm = M * S * M^T
     The output 4x4 has rows/cols ordered as [Dpair1, Dpair2, Cpair1, Cpair2]. */
  function makeMixedModeConversionMatrix(){
    var s=1/Math.sqrt(2);
    return [
      [s,-s,0,0],
      [0,0,s,-s],
      [s,s,0,0],
      [0,0,s,s]
    ];
  }
  function complexMatrixMultiplyReal(M,S){
    var n=M.length;
    var out=[];
    for(var i=0;i<n;i++){
      var row=[];
      for(var j=0;j<n;j++){
        var re=0,im=0;
        for(var k=0;k<n;k++){
          re+=M[i][k]*S[k][j].re;
          im+=M[i][k]*S[k][j].im;
        }
        row.push({re:re,im:im});
      }
      out.push(row);
    }
    return out;
  }
  function complexMatrixMultiplyByRealTranspose(S,M){
    var n=M.length;
    var out=[];
    for(var i=0;i<n;i++){
      var row=[];
      for(var j=0;j<n;j++){
        var re=0,im=0;
        for(var k=0;k<n;k++){
          re+=S[i][k].re*M[j][k];
          im+=S[i][k].im*M[j][k];
        }
        row.push({re:re,im:im});
      }
      out.push(row);
    }
    return out;
  }
  function computeMixedModeMatrix(sMatrix4x4){
    if(!Array.isArray(sMatrix4x4)||sMatrix4x4.length!==4)return null;
    for(var r=0;r<4;r++){
      if(!Array.isArray(sMatrix4x4[r])||sMatrix4x4[r].length!==4)return null;
    }
    var M=makeMixedModeConversionMatrix();
    var temp=complexMatrixMultiplyReal(M,sMatrix4x4);
    return complexMatrixMultiplyByRealTranspose(temp,M);
  }
  /* Mixed-mode entry layout (i,j with 0-based index):
       (0,0) Sdd11   (0,1) Sdd12   (0,2) Sdc11   (0,3) Sdc12
       (1,0) Sdd21   (1,1) Sdd22   (1,2) Sdc21   (1,3) Sdc22
       (2,0) Scd11   (2,1) Scd12   (2,2) Scc11   (2,3) Scc12
       (3,0) Scd21   (3,1) Scd22   (3,2) Scc21   (3,3) Scc22
     Helper to extract a frequency series for one entry name. */
  var MIXED_MODE_ENTRY_INDEX={
    "Sdd11":[0,0],"Sdd12":[0,1],"Sdd21":[1,0],"Sdd22":[1,1],
    "Sdc11":[0,2],"Sdc12":[0,3],"Sdc21":[1,2],"Sdc22":[1,3],
    "Scd11":[2,0],"Scd12":[2,1],"Scd21":[3,0],"Scd22":[3,1],
    "Scc11":[2,2],"Scc12":[2,3],"Scc21":[3,2],"Scc22":[3,3]
  };
  function buildMixedModeSeries(samples,entryName){
    var idx=MIXED_MODE_ENTRY_INDEX[entryName];
    if(!idx||!Array.isArray(samples))return [];
    var out=[];
    for(var i=0;i<samples.length;i++){
      var s=samples[i];
      if(!s||!Array.isArray(s.sMatrix))continue;
      var mm=computeMixedModeMatrix(s.sMatrix);
      if(!mm)continue;
      var c=mm[idx[0]][idx[1]];
      var mag=Math.sqrt(c.re*c.re+c.im*c.im);
      out.push({freq:s.freq,amp:20*Math.log10(mag+1e-30)});
    }
    return out;
  }

  /* ------------ 2-port S <-> ABCD conversion + 2x-thru de-embedding ------------
     ABCD layout: [[A,B],[C,D]] with complex entries. Z0 is the (real, equal)
     reference impedance at both ports. Standard formulas (Pozar Microwave
     Engineering, common 2-port). */
  function sToAbcd2Port(sMatrix,z0){
    if(!Array.isArray(sMatrix)||sMatrix.length!==2||sMatrix[0].length!==2)return null;
    var Z=isFinite(Number(z0))?Number(z0):50;
    var s11=sMatrix[0][0],s12=sMatrix[0][1],s21=sMatrix[1][0],s22=sMatrix[1][1];
    var two=cx(2,0);
    var one=cx(1,0);
    var twoS21=mul(two,s21);
    if(abs(twoS21)<1e-30)return null;
    var s12s21=mul(s12,s21);
    var oneM=function(s){return sub(one,s);};
    var oneP=function(s){return add(one,s);};
    var A=div(add(mul(oneP(s11),oneM(s22)),s12s21),twoS21);
    var B=div(mul(cx(Z,0),add(mul(oneP(s11),oneP(s22)),mul(cx(-1,0),s12s21))),twoS21);
    var C=div(mul(cx(1/Z,0),add(mul(oneM(s11),oneM(s22)),mul(cx(-1,0),s12s21))),twoS21);
    var D=div(add(mul(oneM(s11),oneP(s22)),s12s21),twoS21);
    if(!A||!B||!C||!D)return null;
    return [[A,B],[C,D]];
  }
  function abcdToS2Port(abcd,z0){
    if(!Array.isArray(abcd)||abcd.length!==2||abcd[0].length!==2)return null;
    var Z=isFinite(Number(z0))?Number(z0):50;
    var A=abcd[0][0],B=abcd[0][1],C=abcd[1][0],D=abcd[1][1];
    var BoZ=div(B,cx(Z,0));
    var Cz=mul(C,cx(Z,0));
    var denom=add(add(A,BoZ),add(Cz,D));
    if(abs(denom)<1e-30)return null;
    var s11=div(sub(add(A,BoZ),add(Cz,D)),denom);
    var s12=div(mul(cx(2,0),sub(mul(A,D),mul(B,C))),denom);
    var s21=div(cx(2,0),denom);
    var s22=div(sub(add(BoZ,D),add(A,Cz)),denom);
    return [[s11,s12],[s21,s22]];
  }
  function complexSqrt(z){
    var r=Math.sqrt(z.re*z.re+z.im*z.im);
    if(r===0)return cx(0,0);
    var ang=Math.atan2(z.im,z.re)/2;
    var rsr=Math.sqrt(r);
    return cx(rsr*Math.cos(ang),rsr*Math.sin(ang));
  }
  function matrixSquareRoot2x2(M){
    if(!Array.isArray(M)||M.length!==2)return null;
    var det=sub(mul(M[0][0],M[1][1]),mul(M[0][1],M[1][0]));
    var tr=add(M[0][0],M[1][1]);
    var sqrtDet=complexSqrt(det);
    var tauSq=add(tr,mul(cx(2,0),sqrtDet));
    var tau=complexSqrt(tauSq);
    if(abs(tau)<1e-15)return null;
    var Msd=[
      [add(M[0][0],sqrtDet),M[0][1]],
      [M[1][0],add(M[1][1],sqrtDet)]
    ];
    return [
      [div(Msd[0][0],tau),div(Msd[0][1],tau)],
      [div(Msd[1][0],tau),div(Msd[1][1],tau)]
    ];
  }
  function deembed2xThruAtSample(measSMatrix,thruSMatrix,z0){
    var abcdMeas=sToAbcd2Port(measSMatrix,z0);
    var abcdThru=sToAbcd2Port(thruSMatrix,z0);
    if(!abcdMeas||!abcdThru)return null;
    var abcdHalf=matrixSquareRoot2x2(abcdThru);
    if(!abcdHalf)return null;
    var inv=matrixInverse(abcdHalf);
    if(!inv)return null;
    var step1=matrixMultiply(inv,abcdMeas);
    if(!step1)return null;
    var abcdDut=matrixMultiply(step1,inv);
    if(!abcdDut)return null;
    return abcdToS2Port(abcdDut,z0);
  }
  function buildDeembedded2xThruSamples(measSamples,thruSamples,z0,opts){
    if(!Array.isArray(measSamples)||!Array.isArray(thruSamples))return null;
    opts=opts||{};
    var freqTolerance=Number(opts.freqTolerance)||1e-3;
    var thruByFreq={};
    thruSamples.forEach(function(s){if(s&&isFinite(s.freq))thruByFreq[Math.round(s.freq*1e6)/1e6]=s;});
    var out=[];
    var skipped=0;
    for(var i=0;i<measSamples.length;i++){
      var ms=measSamples[i];
      if(!ms||!isFinite(ms.freq)||!Array.isArray(ms.sMatrix))continue;
      var key=Math.round(ms.freq*1e6)/1e6;
      var thru=thruByFreq[key];
      if(!thru){
        var bestDelta=Infinity,bestMatch=null;
        for(var j=0;j<thruSamples.length;j++){
          var ts=thruSamples[j];
          if(!ts||!isFinite(ts.freq))continue;
          var delta=Math.abs(ts.freq-ms.freq)/Math.max(ms.freq,1);
          if(delta<bestDelta){bestDelta=delta;bestMatch=ts;}
        }
        if(bestMatch&&bestDelta<=freqTolerance)thru=bestMatch;
      }
      if(!thru||!Array.isArray(thru.sMatrix)){skipped++;continue;}
      var deembed=deembed2xThruAtSample(ms.sMatrix,thru.sMatrix,z0);
      if(!deembed){skipped++;continue;}
      out.push({freq:ms.freq,sMatrix:deembed});
    }
    return {samples:out,skipped:skipped,total:measSamples.length};
  }

  /* ------------ Open/Short de-embedding (Koolen et al, 1991) ------------
     Three-step removal of pad parasitics for on-wafer or in-fixture
     measurements when separate Open and Short structures have been
     measured alongside the DUT.
       Y_DUT = inv( inv(Y_meas - Y_open) - inv(Y_short - Y_open) )
     Two-step open-only is also supported when no short structure is
     available: Y_DUT = Y_meas - Y_open. Refs assumed equal across
     Y_meas / Y_open / Y_short and the DUT extraction. */
  function deembedOpenShortAtSample(measSMatrix,openSMatrix,shortSMatrix,refOhms){
    var Ymeas=convertSMatrixToYMatrix(measSMatrix,refOhms);
    var Yopen=convertSMatrixToYMatrix(openSMatrix,refOhms);
    if(!Ymeas||!Yopen)return null;
    var Y1=matrixSubtract(Ymeas,Yopen);
    if(!Y1)return null;
    var Ydut;
    if(shortSMatrix){
      var Yshort=convertSMatrixToYMatrix(shortSMatrix,refOhms);
      if(!Yshort)return null;
      var Y2=matrixSubtract(Yshort,Yopen);
      if(!Y2)return null;
      var Z1=matrixInverse(Y1);
      var Z2=matrixInverse(Y2);
      if(!Z1||!Z2)return null;
      var Zdut=matrixSubtract(Z1,Z2);
      if(!Zdut)return null;
      Ydut=matrixInverse(Zdut);
    }else{
      Ydut=Y1;
    }
    if(!Ydut)return null;
    return convertYMatrixToSMatrix(Ydut,refOhms);
  }
  function buildDeembeddedOpenShortSamples(measSamples,openSamples,shortSamples,refOhms,opts){
    if(!Array.isArray(measSamples)||!Array.isArray(openSamples))return null;
    opts=opts||{};
    var freqTolerance=Number(opts.freqTolerance)||1e-3;
    function indexByFreq(samples){
      var map={};
      (samples||[]).forEach(function(s){if(s&&isFinite(s.freq))map[Math.round(s.freq*1e6)/1e6]=s;});
      return map;
    }
    var openByFreq=indexByFreq(openSamples);
    var shortByFreq=shortSamples?indexByFreq(shortSamples):null;
    function findClosest(samples,target){
      var bestDelta=Infinity,best=null;
      for(var j=0;j<samples.length;j++){
        var s=samples[j];
        if(!s||!isFinite(s.freq))continue;
        var delta=Math.abs(s.freq-target)/Math.max(target,1);
        if(delta<bestDelta){bestDelta=delta;best=s;}
      }
      if(best&&bestDelta<=freqTolerance)return best;
      return null;
    }
    var out=[],skipped=0;
    for(var i=0;i<measSamples.length;i++){
      var ms=measSamples[i];
      if(!ms||!isFinite(ms.freq)||!Array.isArray(ms.sMatrix))continue;
      var key=Math.round(ms.freq*1e6)/1e6;
      var openS=openByFreq[key]||findClosest(openSamples,ms.freq);
      if(!openS||!Array.isArray(openS.sMatrix)){skipped++;continue;}
      var shortS=null;
      if(shortByFreq){
        shortS=shortByFreq[key]||findClosest(shortSamples,ms.freq);
        if(!shortS||!Array.isArray(shortS.sMatrix)){skipped++;continue;}
      }
      var deembed=deembedOpenShortAtSample(ms.sMatrix,openS.sMatrix,shortS?shortS.sMatrix:null,refOhms);
      if(!deembed){skipped++;continue;}
      out.push({freq:ms.freq,sMatrix:deembed});
    }
    return {samples:out,skipped:skipped,total:measSamples.length};
  }

  global.TouchstoneMathHelpers={
    cx:cx,
    cloneComplex:cloneComplex,
    add:add,
    sub:sub,
    mul:mul,
    div:div,
    conj:conj,
    abs:abs,
    abs2:abs2,
    fromPolar:fromPolar,
    fromDbAngle:fromDbAngle,
    normalizeMatrixFormat:normalizeMatrixFormat,
    buildMatrixOrder:buildMatrixOrder,
    makeComplexMatrix:makeComplexMatrix,
    cloneComplexMatrix:cloneComplexMatrix,
    matrixIdentity:matrixIdentity,
    matrixAdd:matrixAdd,
    matrixSubtract:matrixSubtract,
    matrixMultiply:matrixMultiply,
    matrixScaleDiagonal:matrixScaleDiagonal,
    matrixInverse:matrixInverse,
    normalizeReferenceArray:normalizeReferenceArray,
    expandOrderedValuesToMatrix:expandOrderedValuesToMatrix,
    touchstonePairToComplex:touchstonePairToComplex,
    convertSMatrixToZMatrix:convertSMatrixToZMatrix,
    convertSMatrixToYMatrix:convertSMatrixToYMatrix,
    computeTwoPortStability:computeTwoPortStability,
    getTouchstoneFileBaseName:getTouchstoneFileBaseName,
    buildTouchstoneTraceLabel:buildTouchstoneTraceLabel,
    computeMixedModeMatrix:computeMixedModeMatrix,
    buildMixedModeSeries:buildMixedModeSeries,
    MIXED_MODE_ENTRY_INDEX:MIXED_MODE_ENTRY_INDEX,
    sToAbcd2Port:sToAbcd2Port,
    abcdToS2Port:abcdToS2Port,
    matrixSquareRoot2x2:matrixSquareRoot2x2,
    deembed2xThruAtSample:deembed2xThruAtSample,
    buildDeembedded2xThruSamples:buildDeembedded2xThruSamples,
    convertYMatrixToSMatrix:convertYMatrixToSMatrix,
    deembedOpenShortAtSample:deembedOpenShortAtSample,
    buildDeembeddedOpenShortSamples:buildDeembeddedOpenShortSamples
  };
})(window);
