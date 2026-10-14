import {useTranslation} from 'react-i18next';
export function Logo({variant='full',size=36}:{variant?:'full'|'icon';size?:number}){
 if(variant==='icon')return <img src="/brand/zyvora-icon.svg" alt="ZYVORA" style={{height:size,width:size,minHeight:28}}/>
 return <img src="/brand/zyvora-logo.svg" alt="ZYVORA" style={{height:size,minHeight:28}}/>
}
export function LangSwitcher(){const{i18n}=useTranslation();return <select aria-label="Language" data-testid="lang-switcher" value={i18n.language} onChange={e=>{i18n.changeLanguage(e.target.value);localStorage.setItem('zyvora_lang',e.target.value)}}><option value="uz">UZ</option><option value="en">EN</option><option value="ru">RU</option></select>}
export function Spinner(){return <div style={{display:'grid',placeItems:'center',minHeight:200}}><div data-testid="spinner" style={{width:38,height:38,borderRadius:'50%',border:'3px solid var(--border)',borderTopColor:'var(--primary)',animation:'spin 0.8s linear infinite'}}/><style>{'@keyframes spin{to{transform:rotate(360deg)}}'}</style></div>}
export function ComingSoon({label='Coming soon'}:{label?:string}){return <span className="badge" style={{color:'var(--warning)'}}>{label}</span>}
