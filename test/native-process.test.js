import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync,writeFileSync,rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
test('native process probe bounds noisy, hung, nonzero and inherited-output children',{skip:process.platform!=='darwin'},()=>{
 const root=mkdtempSync(join(tmpdir(),'maclawd-native-probe-'));
 try{
  writeFileSync(join(root,'main.swift'),`import Foundation
let shell=URL(fileURLWithPath:"/bin/sh")
precondition(BoundedProcess.output(executable:shell,arguments:["-c","printf /fixture/node"]) == "/fixture/node")
precondition(BoundedProcess.output(executable:shell,arguments:["-c","exit 3"]) == nil)
let start=ProcessInfo.processInfo.systemUptime
precondition(BoundedProcess.output(executable:shell,arguments:["-c","trap '' TERM; sleep 2"],timeout:0.1) == nil)
precondition(ProcessInfo.processInfo.systemUptime-start < 1.8)
precondition(BoundedProcess.output(executable:shell,arguments:["-c","yes x"],timeout:0.5,limit:1024) == nil)
precondition(BoundedProcess.output(executable:shell,arguments:["-c","sleep 1 & printf ok"],timeout:0.2) == "ok")
`);
  const binary=join(root,'probe');execFileSync('swiftc',['mac/Sources/Maclawd/BoundedProcess.swift',join(root,'main.swift'),'-o',binary]);execFileSync(binary,[],{timeout:10000});
 }finally{rmSync(root,{recursive:true,force:true});}
});
