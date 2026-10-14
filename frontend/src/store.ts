import {create} from 'zustand';
export type V3=[number,number,number];
export interface Obj3{id:string;name:string;kind:string;color:string;position:V3;rotation:V3;scale:V3;roughness:number;metalness:number;visible:boolean}
export interface Character{id:string;name:string;description:string;seed:number;stylePrompt:string;hairColor:string;outfitColor:string;expression:string;outfit:string}
export interface Keyframe{id:string;time:number;y:number;rotY:number}
export interface Clip{id:string;name:string;objectId:string;keyframes:Keyframe[]}
export interface Shot{id:string;name:string;camera:string;duration:number;notes:string}
export interface Layer{id:string;name:string;opacity:number;visible:boolean;blend:string;image:string}
export interface ProjectDoc{objects:Obj3[];characters:Character[];layers:Layer[];clips:Clip[];shots:Shot[];story:{logline:string;scenes:string[]};selectedObjectId:string|null;selectedCharacterId:string|null}
export const emptyDoc=():ProjectDoc=>({objects:[],characters:[],layers:[{id:'layer-1',name:'Layer 1',opacity:1,visible:true,blend:'normal',image:''}],clips:[],shots:[],story:{logline:'',scenes:[]},selectedObjectId:null,selectedCharacterId:null});
export const uid=()=>Math.random().toString(36).slice(2,10);
interface ProjectState{doc:ProjectDoc;past:ProjectDoc[];future:ProjectDoc[];projectId:string|null;projectName:string;dirty:boolean;setProject:(id:string|null,name:string,doc:ProjectDoc)=>void;apply:(fn:(d:ProjectDoc)=>ProjectDoc,record?:boolean)=>void;undo:()=>void;redo:()=>void;markSaved:()=>void}
export const useProject=create<ProjectState>((set,get)=>({
 doc:emptyDoc(),past:[],future:[],projectId:null,projectName:'Untitled project',dirty:false,
 setProject:(id,name,doc)=>set({projectId:id,projectName:name,doc:{...emptyDoc(),...doc},past:[],future:[],dirty:false}),
 apply:(fn,record=true)=>{const s=get();const next=fn(structuredClone(s.doc));set({doc:next,past:record?[...s.past.slice(-49),s.doc]:s.past,future:record?[]:s.future,dirty:true})},
 undo:()=>{const s=get();if(!s.past.length)return;const prev=s.past[s.past.length-1];set({doc:prev,past:s.past.slice(0,-1),future:[s.doc,...s.future],dirty:true})},
 redo:()=>{const s=get();if(!s.future.length)return;set({doc:s.future[0],past:[...s.past,s.doc],future:s.future.slice(1),dirty:true})},
 markSaved:()=>set({dirty:false})
}));
export type SessionStatus='initializing'|'authenticated'|'guest';
interface AuthState{status:SessionStatus;token:string|null;user:any|null;sessionVersion:number;cookieWarning:boolean;setCookieWarning:(v:boolean)=>void;setSession:(token:string,user:any)=>void;clear:()=>void;setGuest:()=>void}
export const useAuth=create<AuthState>((set,get)=>({
 status:localStorage.getItem('zyvora_session_hint')?'initializing':'guest',token:null,user:null,sessionVersion:0,cookieWarning:false,setCookieWarning:(v)=>set({cookieWarning:v}),
 setSession:(token,user)=>set({token,user,status:'authenticated',sessionVersion:get().sessionVersion+1}),
 clear:()=>{localStorage.removeItem('zyvora_session_hint');set({token:null,user:null,status:'guest',sessionVersion:get().sessionVersion+1})},
 setGuest:()=>set({status:'guest',token:null,user:null})
}));
