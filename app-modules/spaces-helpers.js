/* spaces-helpers.js — AWS Signature V4 + S3 XML API for DigitalOcean Spaces */
(function(global){
  "use strict";

  function toHex(buf){
    return Array.from(new Uint8Array(buf)).map(function(b){return b.toString(16).padStart(2,"0");}).join("");
  }

  function enc(str){return new TextEncoder().encode(str);}

  function sha256(str){
    return crypto.subtle.digest("SHA-256",enc(str)).then(toHex);
  }

  function hmac(key,data){
    var keyBuf=typeof key==="string"?enc(key):key;
    return crypto.subtle.importKey("raw",keyBuf,{name:"HMAC",hash:"SHA-256"},false,["sign"]).then(function(k){
      return crypto.subtle.sign("HMAC",k,enc(data));
    });
  }

  function hmacHex(key,data){return hmac(key,data).then(toHex);}

  function isoDate(){
    return new Date().toISOString().replace(/[:\-]|\.\d{3}/g,"").slice(0,15)+"Z";
  }

  /* uri-encode per AWS rules (uppercase hex, preserve / when keepSlash=true) */
  function uriEncode(str,keepSlash){
    return encodeURIComponent(str).replace(/[!'()*]/g,function(c){
      return "%"+c.charCodeAt(0).toString(16).toUpperCase();
    }).replace(keepSlash?/%2F/gi:"",keepSlash?"/":"");
  }

  function signRequest(method,url,accessKey,secretKey,region){
    var parsed=new URL(url);
    var service="s3";
    var dateTime=isoDate();
    var dateShort=dateTime.slice(0,8);
    var host=parsed.host;
    var payloadHash="e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"; /* sha256("") */

    var canonHeaders="host:"+host+"\nx-amz-content-sha256:"+payloadHash+"\nx-amz-date:"+dateTime+"\n";
    var signedHeaders="host;x-amz-content-sha256;x-amz-date";

    /* canonical query string — sort by encoded key */
    var params=[];
    parsed.searchParams.forEach(function(v,k){params.push([k,v]);});
    params.sort(function(a,b){var ek=uriEncode(a[0]),fk=uriEncode(b[0]);return ek<fk?-1:ek>fk?1:0;});
    var canonQuery=params.map(function(p){return uriEncode(p[0])+"="+uriEncode(p[1]);}).join("&");

    var canonUri=parsed.pathname||"/";
    var canonRequest=[method,canonUri,canonQuery,canonHeaders,signedHeaders,payloadHash].join("\n");
    var credScope=dateShort+"/"+region+"/"+service+"/aws4_request";

    return sha256(canonRequest).then(function(crHash){
      var stringToSign=["AWS4-HMAC-SHA256",dateTime,credScope,crHash].join("\n");
      return hmac(enc("AWS4"+secretKey),dateShort)
        .then(function(kDate){return hmac(kDate,region);})
        .then(function(kReg){return hmac(kReg,service);})
        .then(function(kSvc){return hmac(kSvc,"aws4_request");})
        .then(function(kSign){return hmacHex(kSign,stringToSign);})
        .then(function(sig){
          return {
            "host":host,
            "x-amz-content-sha256":payloadHash,
            "x-amz-date":dateTime,
            "authorization":"AWS4-HMAC-SHA256 Credential="+accessKey+"/"+credScope+", SignedHeaders="+signedHeaders+", Signature="+sig
          };
        });
    });
  }

  function buildEndpoint(bucket,region){
    return "https://"+bucket+"."+region+".digitaloceanspaces.com";
  }

  function listObjects(creds,prefix,delimiter,continuationToken){
    var base=buildEndpoint(creds.bucket,creds.region)+"/";
    var p=new URLSearchParams({"list-type":"2","max-keys":"500"});
    if(delimiter!=null)p.set("delimiter",delimiter);
    if(prefix)p.set("prefix",prefix);
    if(continuationToken)p.set("continuation-token",continuationToken);
    var url=base+"?"+p.toString();
    return signRequest("GET",url,creds.accessKey,creds.secretKey,creds.region).then(function(headers){
      return fetch(url,{headers:headers});
    }).then(function(res){
      if(!res.ok)return res.text().then(function(t){throw new Error("List failed ("+res.status+"): "+t.slice(0,200));});
      return res.text();
    }).then(parseListXml);
  }

  function fetchFile(creds,key){
    var url=buildEndpoint(creds.bucket,creds.region)+"/"+key.split("/").map(function(s){return encodeURIComponent(s);}).join("/");
    return signRequest("GET",url,creds.accessKey,creds.secretKey,creds.region).then(function(headers){
      return fetch(url,{headers:headers});
    }).then(function(res){
      if(!res.ok)return res.text().then(function(t){throw new Error("Fetch failed ("+res.status+"): "+t.slice(0,200));});
      return res.arrayBuffer();
    });
  }

  function parseListXml(xml){
    var parser=new DOMParser();
    var doc=parser.parseFromString(xml,"application/xml");
    if(doc.querySelector("Error")){
      var code=doc.querySelector("Code");
      throw new Error("Spaces error: "+(code?code.textContent:"unknown"));
    }
    function txt(el,tag){var n=el.querySelector(tag);return n?n.textContent:"";}
    var prefixes=Array.from(doc.querySelectorAll("CommonPrefixes > Prefix")).map(function(n){return n.textContent;});
    var contents=Array.from(doc.querySelectorAll("Contents")).map(function(el){
      return {key:txt(el,"Key"),size:parseInt(txt(el,"Size"),10)||0,lastModified:txt(el,"LastModified")};
    });
    var nextToken=txt(doc.documentElement,"NextContinuationToken");
    var truncated=txt(doc.documentElement,"IsTruncated")==="true";
    return {prefixes:prefixes,contents:contents,nextToken:nextToken,truncated:truncated};
  }

  function fmtSize(bytes){
    if(bytes>=1073741824)return (bytes/1073741824).toFixed(1)+" GB";
    if(bytes>=1048576)return (bytes/1048576).toFixed(1)+" MB";
    if(bytes>=1024)return (bytes/1024).toFixed(0)+" KB";
    return bytes+" B";
  }

  global.SpacesHelpers={listObjects:listObjects,fetchFile:fetchFile,parseListXml:parseListXml,buildEndpoint:buildEndpoint,fmtSize:fmtSize};
})(window);
