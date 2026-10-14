import axios from 'axios'; import {useAuth} from './store';
export const api=axios.create({baseURL:'',withCredentials:true});
let refreshPromise:Promise<string>|null=null;
api.interceptors.request.use(c=>{const t=useAuth.getState().token;if(t)c.headers.Authorization=`Bearer ${t}`;return c});
async function doRefresh():Promise<string>{
 if(!refreshPromise){refreshPromise=axios.post('/api/auth/refresh',{},{withCredentials:true}).then(r=>{useAuth.getState().setSession(r.data.access_token,r.data.user);return r.data.access_token as string}).finally(()=>{refreshPromise=null})}
 return refreshPromise;
}
api.interceptors.response.use(r=>r,async err=>{
 const cfg=err.config;
 if(err.response?.status!==401||!cfg||cfg._retried||String(cfg.url||'').includes('/api/auth/'))return Promise.reject(err);
 cfg._retried=true;
 try{const t=await doRefresh();cfg.headers.Authorization=`Bearer ${t}`;return api(cfg)}
 catch{useAuth.getState().clear();if(location.pathname!=='/login')location.href='/login';return Promise.reject(err)}
});
let bootstrapPromise:Promise<void>|null=null;
export function bootstrapAuth(){ if(!bootstrapPromise)bootstrapPromise=bootstrapAuthInner(); return bootstrapPromise }
async function bootstrapAuthInner(){
 const st=useAuth.getState();
 if(!localStorage.getItem('zyvora_session_hint')){st.setGuest();return}
 const version=st.sessionVersion; const ctrl=new AbortController(); (window as any).__zyvoraAbort=ctrl;
 try{const r=await axios.post('/api/auth/refresh',{},{withCredentials:true,signal:ctrl.signal});
  if(useAuth.getState().sessionVersion!==version)return; // stale response must not overwrite newer login
  useAuth.getState().setSession(r.data.access_token,r.data.user);
 }catch{ if(useAuth.getState().sessionVersion===version){localStorage.removeItem('zyvora_session_hint');useAuth.getState().setGuest()} }
}
export function loginSuccess(data:any){localStorage.setItem('zyvora_session_hint','1');useAuth.getState().setSession(data.access_token,data.user)}
