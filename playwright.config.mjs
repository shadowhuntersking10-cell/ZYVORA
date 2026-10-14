import {defineConfig} from '@playwright/test';
import chromium from '@sparticuz/chromium';
import fs from 'node:fs'; import zlib from 'node:zlib'; import {execSync} from 'node:child_process';
// @sparticuz/chromium ships Amazon Linux libs (libnspr/libnss) in bin/al2023.tar.br — extract them so Chromium runs on Debian.
const libDir='/tmp/al2023/lib';
if(!fs.existsSync(libDir+'/libnspr4.so')){
 fs.mkdirSync('/tmp/al2023',{recursive:true});
 const tar=zlib.brotliDecompressSync(fs.readFileSync(new URL('./node_modules/@sparticuz/chromium/bin/al2023.tar.br',import.meta.url)));
 fs.writeFileSync('/tmp/al2023.tar',tar); execSync('tar -xf /tmp/al2023.tar -C /tmp/al2023');
}
const exe=await chromium.executablePath();
const safeArgs=chromium.args.filter(a=>!a.includes('single-process')&&!a.includes('no-zygote'));
export default defineConfig({testDir:'./e2e',timeout:90000,retries:0,workers:1,reporter:[['list']],use:{baseURL:process.env.BASE_URL||'http://localhost:5173',launchOptions:{executablePath:exe,args:[...safeArgs,'--no-sandbox'],env:{...process.env,LD_LIBRARY_PATH:libDir+':'+(process.env.LD_LIBRARY_PATH||'')}}}});
