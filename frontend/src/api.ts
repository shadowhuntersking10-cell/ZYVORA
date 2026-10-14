import axios from 'axios'; import {useAuth} from './store';
export const api=axios.create({baseURL:'',withCredentials:true});
let refreshPromise:Promise<string>|null=null;
// Auth is ONE httpOnly session cookie (zyvora_session, Path=/api) sent automatically withCredentials — no Authorization header, no tokens in JS.
async function doRefresh():Promise<string>{
 // ONE shared in-flight refresh for the whole tab (bootstrap + interceptor alike).
 if(!refreshPromise){refreshPromise=axios.post('/api/auth/refresh',{},{withCredentials:true}).then(r=>{useAuth.getState().setSession('session',r.data.user);return 'session'}).finally(()=>{refreshPromise=null})}
 return refreshPromise;
}
export function inIframe():boolean{try{return window.self!==window.top}catch{return true}}
api.interceptors.response.use(r=>r,async err=>{
 const cfg=err.config;
 if(err.response?.status!==401||!cfg||cfg._retried||String(cfg.url||'').includes('/api/auth/'))return Promise.reject(err);
 cfg._retried=true;
 try{await doRefresh();return api(cfg)} // session cookie is sent automatically; clear ONLY if the shared session check itself failed (below)
 catch{useAuth.getState().clear();if(location.pathname!=='/login')location.href='/login';return Promise.reject(err)}
});
let bootstrapPromise:Promise<void>|null=null;
export function bootstrapAuth(){ if(!bootstrapPromise)bootstrapPromise=bootstrapAuthInner(); return bootstrapPromise }
async function bootstrapAuthInner(){
 const st=useAuth.getState();
 if(!localStorage.getItem('zyvora_session_hint')){st.setGuest();return}
 const version=st.sessionVersion; const ctrl=new AbortController(); (window as any).__zyvoraAbort=ctrl;
 try{await doRefresh(); // shared single-flight; setSession happens inside, version bump makes stale checks below authoritative
  if(useAuth.getState().sessionVersion===version){/* doRefresh already replaced the session */}
 }catch{ if(useAuth.getState().sessionVersion===version){localStorage.removeItem('zyvora_session_hint');useAuth.getState().setGuest();
   // In an iframe (third-party cookies blocked) this is expected — warn loudly instead of silently logging out.
   if(inIframe())useAuth.getState().setCookieWarning(true);} }
}
export function loginSuccess(data:any){localStorage.setItem('zyvora_session_hint','1');useAuth.getState().setSession('session',data.user)} // hint + session set BEFORE navigation
/** Extract the REAL server error message (FastAPI: string detail, or array detail on 422) — never a generic string when the server said something. Logs the failing request. */
export function serverError(e:any,context:string,fallback:string):string{
 const status=e?.response?.status; const data=e?.response?.data;
 console.error(`[ZYVORA] ${context} failed`,{method:e?.config?.method,url:e?.config?.url,status:status??'no response (network/backend down)',data:data??e?.message});
 if(!e?.response)return `Could not reach the ZYVORA API (${e?.message||'network error'}). Is the backend running on port 8000?`;
 const d=data?.detail;
 if(typeof d==='string')return d;
 if(Array.isArray(d))return d.map((v:any)=>{const field=Array.isArray(v.loc)?v.loc.filter((x:any)=>x!=='body').join('.'):'';return field?`${field}: ${v.msg}`:v.msg}).join(' · ');
 if(typeof data==='string'&&data)return data.slice(0,300);
 return `${fallback} (HTTP ${status})`;
}
