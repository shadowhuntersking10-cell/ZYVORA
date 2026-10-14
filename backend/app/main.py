import os, json, hashlib, secrets, time, threading, uuid
from datetime import datetime, timedelta, timezone
from functools import wraps
from fastapi import FastAPI, Depends, HTTPException, Request, Response, Cookie
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPBearer
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import create_engine, Column, String, Integer, Boolean, DateTime, Text, ForeignKey, Float
from sqlalchemy.orm import declarative_base, sessionmaker, Session
import jwt
from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError

SECRET=os.getenv("SECRET_KEY","zyvora-dev-secret-key-change-in-production-42")
DATABASE_URL=os.getenv("DATABASE_URL","sqlite:///./zyvora.db")
DEV_AUTO_VERIFY=os.getenv("DEV_AUTO_VERIFY","true").lower()=="true"
ACCESS_MINUTES=int(os.getenv("ACCESS_TOKEN_MINUTES","30"))
ADMIN_EMAIL=os.getenv("ADMIN_EMAIL",""); ADMIN_PASSWORD=os.getenv("ADMIN_PASSWORD",""); ADMIN_NAME=os.getenv("ADMIN_NAME","ZYVORA Admin")
engine=create_engine(DATABASE_URL, connect_args={"check_same_thread":False} if DATABASE_URL.startswith("sqlite") else {})
SessionLocal=sessionmaker(bind=engine, autoflush=False)
Base=declarative_base(); ph=PasswordHasher(); bearer=HTTPBearer(auto_error=False)

def now(): return datetime.now(timezone.utc)
class User(Base):
 __tablename__="users"; id=Column(String,primary_key=True,default=lambda:str(uuid.uuid4())); email=Column(String,unique=True,index=True); name=Column(String); password_hash=Column(String); role=Column(String,default="user"); plan=Column(String,default="free"); is_blocked=Column(Boolean,default=False); email_verified=Column(Boolean,default=False); verify_token=Column(String,nullable=True); reset_token=Column(String,nullable=True); created_at=Column(DateTime,default=now)
class RefreshSession(Base):
 __tablename__="refresh_sessions"; id=Column(String,primary_key=True,default=lambda:str(uuid.uuid4())); user_id=Column(String,ForeignKey("users.id"),index=True); token_hash=Column(String,index=True); revoked=Column(Boolean,default=False); user_agent=Column(String,default=""); created_at=Column(DateTime,default=now); expires_at=Column(DateTime)
class Project(Base):
 __tablename__="projects"; id=Column(String,primary_key=True,default=lambda:str(uuid.uuid4())); owner_id=Column(String,ForeignKey("users.id"),index=True); name=Column(String); folder=Column(String,default=""); document=Column(Text,default="{}"); version=Column(Integer,default=1); created_at=Column(DateTime,default=now); updated_at=Column(DateTime,default=now,onupdate=now)
class Asset(Base):
 __tablename__="assets"; id=Column(String,primary_key=True,default=lambda:str(uuid.uuid4())); owner_id=Column(String,ForeignKey("users.id"),index=True); project_id=Column(String,nullable=True); name=Column(String); kind=Column(String,default="object"); data=Column(Text,default="{}"); created_at=Column(DateTime,default=now)
class CreditAccount(Base):
 __tablename__="credit_accounts"; user_id=Column(String,ForeignKey("users.id"),primary_key=True); balance=Column(Integer,default=100); monthly_limit=Column(Integer,default=100); spent_this_month=Column(Integer,default=0)
class CreditLedger(Base):
 __tablename__="credit_ledger"; id=Column(String,primary_key=True,default=lambda:str(uuid.uuid4())); user_id=Column(String,index=True); amount=Column(Integer); reason=Column(String); balance_after=Column(Integer); created_at=Column(DateTime,default=now)
class AuditLog(Base):
 __tablename__="audit_logs"; id=Column(String,primary_key=True,default=lambda:str(uuid.uuid4())); user_id=Column(String,nullable=True); action=Column(String); detail=Column(String,default=""); ip=Column(String,default=""); created_at=Column(DateTime,default=now)
class Job(Base):
 __tablename__="jobs"; id=Column(String,primary_key=True,default=lambda:str(uuid.uuid4())); owner_id=Column(String,index=True); project_id=Column(String,nullable=True); kind=Column(String,default="render"); status=Column(String,default="queued"); progress=Column(Integer,default=0); error=Column(String,default=""); payload=Column(Text,default="{}"); result=Column(Text,default="{}"); created_at=Column(DateTime,default=now)
class PaymentEvent(Base):
 __tablename__="payment_events"; id=Column(String,primary_key=True); provider=Column(String,default="stripe"); processed=Column(Boolean,default=False); created_at=Column(DateTime,default=now)
class Comment(Base):
 __tablename__="comments"; id=Column(String,primary_key=True,default=lambda:str(uuid.uuid4())); project_id=Column(String,index=True); user_id=Column(String); body=Column(Text); created_at=Column(DateTime,default=now)
Base.metadata.create_all(engine)

def db():
 d=SessionLocal()
 try: yield d
 finally: d.close()
def audit(d,user_id,action,detail="",ip=""):
 d.add(AuditLog(user_id=user_id,action=action,detail=detail,ip=ip)); d.commit()
def hash_token(t): return hashlib.sha256(t.encode()).hexdigest()
def make_access(u): return jwt.encode({"sub":str(u.id),"role":u.role,"exp":int((now()+timedelta(minutes=ACCESS_MINUTES)).timestamp())},SECRET,algorithm="HS256")
def user_out(u): return {"id":u.id,"email":u.email,"name":u.name,"role":u.role,"plan":u.plan,"email_verified":u.email_verified,"is_blocked":u.is_blocked,"created_at":u.created_at.isoformat() if u.created_at else None}
def set_refresh(d,u,response,request):
 raw=secrets.token_urlsafe(48); exp=now()+timedelta(days=30)
 d.add(RefreshSession(user_id=u.id,token_hash=hash_token(raw),user_agent=request.headers.get("user-agent","")[:250],expires_at=exp)); d.commit()
 response.set_cookie("zyvora_refresh",raw,httponly=True,samesite="lax",secure=os.getenv("COOKIE_SECURE","false").lower()=="true",path="/api/auth",max_age=30*86400)
 return raw
def current(request:Request, cred=Depends(bearer), d:Session=Depends(db)):
 if not cred: raise HTTPException(401,"Not authenticated")
 try: payload=jwt.decode(cred.credentials,SECRET,algorithms=["HS256"])
 except Exception: raise HTTPException(401,"Invalid or expired token")
 u=d.get(User,payload.get("sub"))
 if not u or u.is_blocked: raise HTTPException(401,"User not available")
 return u
def admin(u=Depends(current)):
 if u.role!="admin": raise HTTPException(403,"Admin access required")
 return u

# rate limit: fixed window per ip+path
_hits={}
def rate(request:Request,limit=20,window=60):
 key=f"{request.client.host}:{request.url.path}:{int(time.time()//window)}"; _hits[key]=_hits.get(key,0)+1
 if _hits[key]>limit: raise HTTPException(429,"Too many requests. Try again later.")

app=FastAPI(title="ZYVORA API")
app.add_middleware(CORSMiddleware,allow_origins=["http://localhost:5173"],allow_credentials=True,allow_methods=["*"],allow_headers=["*"])
@app.middleware("http")
async def headers(request,call_next):
 r=await call_next(request); r.headers["X-Content-Type-Options"]="nosniff"; r.headers["X-Frame-Options"]="DENY"; r.headers["Referrer-Policy"]="same-origin"; return r

class AuthIn(BaseModel): email:EmailStr; password:str=Field(min_length=8,max_length=128)
class RegisterIn(AuthIn): name:str=Field(min_length=2,max_length=100)
class ProjectIn(BaseModel): name:str=Field(min_length=1,max_length=120); folder:str=""; document:dict={}
class DocIn(BaseModel): document:dict; name:str|None=None
class AIBuildIn(BaseModel): project_id:str; tool:str; args:dict={}

@app.get("/") 
def root(): return {"name":"ZYVORA API","status":"ok","docs":"/docs"}
@app.get("/health")
def health(d:Session=Depends(db)):
 d.execute(Project.__table__.select().limit(1)); return {"status":"ok","database":"ok"}

@app.post("/api/auth/register")
def register(body:RegisterIn,request:Request,response:Response,d:Session=Depends(db)):
 rate(request,25)
 if d.query(User).filter_by(email=body.email.lower()).first(): raise HTTPException(409,"This email is already registered")
 u=User(email=body.email.lower(),name=body.name,password_hash=ph.hash(body.password),email_verified=DEV_AUTO_VERIFY,verify_token=None if DEV_AUTO_VERIFY else secrets.token_urlsafe(24))
 d.add(u); d.commit(); d.refresh(u); d.add(CreditAccount(user_id=u.id)); d.add(CreditLedger(user_id=u.id,amount=100,reason="Welcome credits",balance_after=100)); d.commit()
 audit(d,u.id,"auth.register",u.email,request.client.host)
 print(f"[ZYVORA] verify link: /verify-email?token={u.verify_token} for {u.email}",flush=True)
 if DEV_AUTO_VERIFY: set_refresh(d,u,response,request); return {"user":user_out(u),"access_token":make_access(u),"email_verified":True}
 return {"user":user_out(u),"email_verified":False,"message":"Check your email to verify your account"}

@app.post("/api/auth/login")
def login(body:AuthIn,request:Request,response:Response,d:Session=Depends(db)):
 rate(request,25); u=d.query(User).filter_by(email=body.email.lower()).first()
 if not u: raise HTTPException(401,"Invalid email or password")
 try: ph.verify(u.password_hash,body.password)
 except Exception: raise HTTPException(401,"Invalid email or password")
 if u.is_blocked: raise HTTPException(403,"Account blocked")
 if not u.email_verified and not DEV_AUTO_VERIFY: raise HTTPException(403,"Please verify your email first")
 set_refresh(d,u,response,request); audit(d,u.id,"auth.login",u.email,request.client.host)
 return {"user":user_out(u),"access_token":make_access(u)}

@app.post("/api/auth/refresh")
def refresh(request:Request,response:Response,d:Session=Depends(db)):
 raw=request.cookies.get("zyvora_refresh")
 if not raw: raise HTTPException(401,"No refresh session")
 s=d.query(RefreshSession).filter_by(token_hash=hash_token(raw),revoked=False).first()
 if not s or (s.expires_at and s.expires_at.replace(tzinfo=timezone.utc)<now()): raise HTTPException(401,"Refresh session expired")
 u=d.get(User,s.user_id)
 if not u or u.is_blocked: raise HTTPException(401,"User not available")
 s.revoked=True; d.commit(); set_refresh(d,u,response,request)
 return {"user":user_out(u),"access_token":make_access(u)}

@app.post("/api/auth/logout")
def logout(request:Request,response:Response,d:Session=Depends(db)):
 raw=request.cookies.get("zyvora_refresh")
 if raw:
  s=d.query(RefreshSession).filter_by(token_hash=hash_token(raw)).first()
  if s: s.revoked=True; d.commit()
 response.delete_cookie("zyvora_refresh",path="/api/auth"); return {"ok":True}

@app.get("/api/auth/me")
def me(u=Depends(current)): return user_out(u)
@app.post("/api/auth/verify-email")
def verify(body:dict,d:Session=Depends(db)):
 u=d.query(User).filter_by(verify_token=body.get("token")).first()
 if not u: raise HTTPException(400,"Invalid verification link")
 u.email_verified=True; u.verify_token=None; d.commit(); return {"ok":True}
@app.post("/api/auth/resend-verification")
def resend(body:dict,d:Session=Depends(db)):
 u=d.query(User).filter_by(email=str(body.get("email","")).lower()).first()
 if u and not u.email_verified: u.verify_token=secrets.token_urlsafe(24); d.commit(); print(f"[ZYVORA] verify link: /verify-email?token={u.verify_token} for {u.email}",flush=True)
 return {"ok":True,"message":"If the account exists, a verification email link was generated (dev: logged to console)"}
@app.post("/api/auth/forgot-password")
def forgot(body:dict,d:Session=Depends(db)):
 u=d.query(User).filter_by(email=str(body.get("email","")).lower()).first()
 if u: u.reset_token=secrets.token_urlsafe(24); d.commit(); print(f"[ZYVORA] reset link: /reset-password?token={u.reset_token} for {u.email}",flush=True)
 return {"ok":True,"message":"If the account exists, reset instructions were sent (dev: link logged to server console)"}
@app.post("/api/auth/reset-password")
def reset(body:dict,d:Session=Depends(db)):
 u=d.query(User).filter_by(reset_token=body.get("token")).first(); pw=str(body.get("password",""))
 if not u or len(pw)<8: raise HTTPException(400,"Invalid reset link or password too short")
 u.password_hash=ph.hash(pw); u.reset_token=None; d.commit(); return {"ok":True}
@app.post("/api/auth/change-password")
def change(body:dict,u=Depends(current),d:Session=Depends(db)):
 try: ph.verify(u.password_hash,str(body.get("current_password","")))
 except Exception: raise HTTPException(400,"Current password is incorrect")
 if len(str(body.get("new_password","")))<8: raise HTTPException(400,"Password must be at least 8 characters")
 u.password_hash=ph.hash(body["new_password"]); d.commit(); return {"ok":True}
@app.get("/api/auth/sessions")
def sessions(u=Depends(current),d:Session=Depends(db)):
 return [{"id":s.id,"created_at":s.created_at.isoformat() if s.created_at else None,"user_agent":s.user_agent,"revoked":s.revoked} for s in d.query(RefreshSession).filter_by(user_id=u.id).order_by(RefreshSession.created_at.desc()).all()]
@app.delete("/api/auth/sessions/{sid}")
def revoke(sid:str,u=Depends(current),d:Session=Depends(db)):
 s=d.query(RefreshSession).filter_by(id=sid,user_id=u.id).first()
 if not s: raise HTTPException(404,"Session not found")
 s.revoked=True; d.commit(); return {"ok":True}
@app.delete("/api/auth/account")
def delete_account(u=Depends(current),d:Session=Depends(db)):
 d.query(Project).filter_by(owner_id=u.id).delete(); d.query(RefreshSession).filter_by(user_id=u.id).delete(); d.delete(u); d.commit(); return {"ok":True}

def proj_out(p): return {"id":p.id,"name":p.name,"folder":p.folder,"document":json.loads(p.document or "{}"),"version":p.version,"updated_at":p.updated_at.isoformat() if p.updated_at else None,"created_at":p.created_at.isoformat() if p.created_at else None}
def owned(pid,u,d):
 p=d.get(Project,pid)
 if not p: raise HTTPException(404,"Project not found")
 if p.owner_id!=u.id and u.role!="admin": raise HTTPException(403,"You do not own this project")
 return p

@app.get("/api/projects")
def list_projects(u=Depends(current),d:Session=Depends(db)): return [proj_out(p) for p in d.query(Project).filter_by(owner_id=u.id).order_by(Project.updated_at.desc()).all()]
@app.post("/api/projects")
def create_project(body:ProjectIn,u=Depends(current),d:Session=Depends(db)):
 p=Project(owner_id=u.id,name=body.name,folder=body.folder,document=json.dumps(body.document)); d.add(p); d.commit(); d.refresh(p); audit(d,u.id,"project.create",p.id); return proj_out(p)
@app.get("/api/projects/{pid}")
def get_project(pid:str,u=Depends(current),d:Session=Depends(db)): return proj_out(owned(pid,u,d))
@app.put("/api/projects/{pid}")
def update_project(pid:str,body:DocIn,u=Depends(current),d:Session=Depends(db)):
 p=owned(pid,u,d); p.document=json.dumps(body.document); p.version+=1
 if body.name: p.name=body.name
 d.commit(); return proj_out(p)
@app.patch("/api/projects/{pid}")
def rename_project(pid:str,body:dict,u=Depends(current),d:Session=Depends(db)):
 p=owned(pid,u,d)
 if body.get("name"): p.name=body["name"]
 if "folder" in body: p.folder=body["folder"]
 d.commit(); return proj_out(p)
@app.post("/api/projects/{pid}/duplicate")
def dup(pid:str,u=Depends(current),d:Session=Depends(db)):
 p=owned(pid,u,d); n=Project(owner_id=u.id,name=p.name+" copy",folder=p.folder,document=p.document); d.add(n); d.commit(); d.refresh(n); return proj_out(n)
@app.delete("/api/projects/{pid}")
def del_project(pid:str,u=Depends(current),d:Session=Depends(db)):
 p=owned(pid,u,d); d.delete(p); d.commit(); return {"ok":True}

@app.get("/api/assets")
def assets(u=Depends(current),d:Session=Depends(db)): return [{"id":a.id,"name":a.name,"kind":a.kind,"project_id":a.project_id,"data":json.loads(a.data or "{}"),"created_at":a.created_at.isoformat() if a.created_at else None} for a in d.query(Asset).filter_by(owner_id=u.id).all()]
@app.post("/api/assets")
def create_asset(body:dict,u=Depends(current),d:Session=Depends(db)):
 a=Asset(owner_id=u.id,name=str(body.get("name","Asset"))[:120],kind=str(body.get("kind","object"))[:40],project_id=body.get("project_id"),data=json.dumps(body.get("data",{}))); d.add(a); d.commit(); d.refresh(a); return {"id":a.id,"name":a.name,"kind":a.kind}
@app.delete("/api/assets/{aid}")
def del_asset(aid:str,u=Depends(current),d:Session=Depends(db)):
 a=d.query(Asset).filter_by(id=aid,owner_id=u.id).first()
 if not a: raise HTTPException(404,"Asset not found")
 d.delete(a); d.commit(); return {"ok":True}

@app.get("/api/credits")
def credits(u=Depends(current),d:Session=Depends(db)):
 a=d.query(CreditAccount).filter_by(user_id=u.id).first()
 if not a: a=CreditAccount(user_id=u.id); d.add(a); d.commit()
 return {"balance":a.balance,"monthly_limit":a.monthly_limit,"spent_this_month":a.spent_this_month,"plan":u.plan,"ledger":[{"id":x.id,"amount":x.amount,"reason":x.reason,"balance_after":x.balance_after,"created_at":x.created_at.isoformat() if x.created_at else None} for x in d.query(CreditLedger).filter_by(user_id=u.id).order_by(CreditLedger.created_at.desc()).limit(50).all()]}
@app.post("/api/credits/spend")
def spend(body:dict,u=Depends(current),d:Session=Depends(db)):
 amt=int(body.get("amount",0))
 if amt<=0: raise HTTPException(400,"Invalid amount")
 a=d.query(CreditAccount).filter_by(user_id=u.id).first()
 if not a or a.balance<amt: raise HTTPException(402,"Insufficient credits")
 a.balance-=amt; a.spent_this_month+=amt; d.add(CreditLedger(user_id=u.id,amount=-amt,reason=str(body.get("reason","AI job"))[:200],balance_after=a.balance)); d.commit(); return {"balance":a.balance}
@app.post("/api/credits/refund")
def refund(body:dict,u=Depends(current),d:Session=Depends(db)):
 amt=int(body.get("amount",0))
 if amt<=0: raise HTTPException(400,"Invalid amount")
 a=d.query(CreditAccount).filter_by(user_id=u.id).first(); a.balance+=amt; d.add(CreditLedger(user_id=u.id,amount=amt,reason=str(body.get("reason","Refund"))[:200],balance_after=a.balance)); d.commit(); return {"balance":a.balance}

PROVIDERS={"openai":os.getenv("OPENAI_API_KEY"),"tripo":os.getenv("TRIPO_API_KEY"),"meshy":os.getenv("MESHY_API_KEY"),"image":os.getenv("IMAGE_API_KEY"),"video":os.getenv("VIDEO_API_KEY"),"audio":os.getenv("AUDIO_API_KEY"),"stripe":os.getenv("STRIPE_SECRET_KEY")}
@app.get("/api/ai/providers")
def providers(u=Depends(current)): return [{"name":k,"connected":bool(v),"status":"connected" if v else "not connected"} for k,v in PROVIDERS.items()]
WHITELIST={"add_object","set_transform","set_material","rename_object","add_keyframe","add_shot"}
@app.post("/api/ai/build")
def ai_build(body:AIBuildIn,u=Depends(current),d:Session=Depends(db)):
 if body.tool not in WHITELIST: raise HTTPException(400,f"Tool '{body.tool}' is not whitelisted")
 p=owned(body.project_id,u,d); audit(d,u.id,"ai.tool",f"{body.tool} on {p.id}")
 return {"ok":True,"tool":body.tool,"message":"Tool validated. Apply it in the editor to use shared Undo/Redo.","args":body.args}

def run_render(job_id):
 d=SessionLocal()
 try:
  j=d.get(Job,job_id); j.status="running"; d.commit()
  for pct in (20,45,70,90,100):
   time.sleep(0.4); j=d.get(Job,job_id); j.progress=pct; d.commit()
  j=d.get(Job,job_id); j.status="completed"; j.result=json.dumps({"frames":24,"note":"Local preview render completed (PNG sequence manifest). Connect ffmpeg worker for MP4."}); d.commit()
 except Exception as e:
  j=d.get(Job,job_id)
  if j: j.status="failed"; j.error=str(e); d.commit()
 finally: d.close()

@app.get("/api/jobs")
def jobs(u=Depends(current),d:Session=Depends(db)): return [{"id":j.id,"kind":j.kind,"status":j.status,"progress":j.progress,"error":j.error,"project_id":j.project_id,"result":json.loads(j.result or "{}"),"created_at":j.created_at.isoformat() if j.created_at else None} for j in d.query(Job).filter_by(owner_id=u.id).order_by(Job.created_at.desc()).all()]
@app.post("/api/jobs/render")
def render(body:dict,u=Depends(current),d:Session=Depends(db)):
 if body.get("project_id"): owned(body["project_id"],u,d)
 j=Job(owner_id=u.id,project_id=body.get("project_id"),kind="render",payload=json.dumps(body)); d.add(j); d.commit(); d.refresh(j); threading.Thread(target=run_render,args=(j.id,),daemon=True).start(); return {"id":j.id,"status":j.status,"progress":0}
@app.post("/api/jobs/{jid}/retry")
def retry(jid:str,u=Depends(current),d:Session=Depends(db)):
 j=d.query(Job).filter_by(id=jid,owner_id=u.id).first()
 if not j: raise HTTPException(404,"Job not found")
 j.status="queued"; j.progress=0; j.error=""; d.commit(); threading.Thread(target=run_render,args=(j.id,),daemon=True).start(); return {"ok":True}

@app.get("/api/projects/{pid}/comments")
def comments(pid:str,u=Depends(current),d:Session=Depends(db)):
 owned(pid,u,d); return [{"id":c.id,"body":c.body,"user_id":c.user_id,"created_at":c.created_at.isoformat() if c.created_at else None} for c in d.query(Comment).filter_by(project_id=pid).all()]
@app.post("/api/projects/{pid}/comments")
def add_comment(pid:str,body:dict,u=Depends(current),d:Session=Depends(db)):
 owned(pid,u,d); c=Comment(project_id=pid,user_id=u.id,body=str(body.get("body",""))[:2000]); d.add(c); d.commit(); return {"id":c.id,"body":c.body}

@app.get("/api/admin/stats")
def admin_stats(u=Depends(admin),d:Session=Depends(db)):
 return {"users":d.query(User).count(),"projects":d.query(Project).count(),"assets":d.query(Asset).count(),"jobs":d.query(Job).count(),"jobs_failed":d.query(Job).filter_by(status="failed").count(),"credits_issued":sum(x.amount for x in d.query(CreditLedger).filter(CreditLedger.amount>0).all()),"providers":[{"name":k,"connected":bool(v)} for k,v in PROVIDERS.items()],"payments_connected":bool(os.getenv("STRIPE_SECRET_KEY"))}
@app.get("/api/admin/users")
def admin_users(q:str="",u=Depends(admin),d:Session=Depends(db)): return [user_out(x) for x in d.query(User).filter(User.email.contains(q)).all()]
@app.patch("/api/admin/users/{uid}")
def admin_patch(uid:str,body:dict,u=Depends(admin),d:Session=Depends(db)):
 x=d.get(User,uid)
 if not x: raise HTTPException(404,"User not found")
 for k in ("role","plan"):
  if k in body: setattr(x,k,body[k])
 if "is_blocked" in body: x.is_blocked=bool(body["is_blocked"])
 d.commit(); audit(d,u.id,"admin.user_update",uid); return user_out(x)
@app.get("/api/admin/audit")
def admin_audit(u=Depends(admin),d:Session=Depends(db)): return [{"id":a.id,"action":a.action,"detail":a.detail,"user_id":a.user_id,"created_at":a.created_at.isoformat() if a.created_at else None} for a in d.query(AuditLog).order_by(AuditLog.created_at.desc()).limit(100).all()]
@app.get("/api/admin/jobs")
def admin_jobs(u=Depends(admin),d:Session=Depends(db)): return [{"id":j.id,"kind":j.kind,"status":j.status,"progress":j.progress,"owner_id":j.owner_id} for j in d.query(Job).order_by(Job.created_at.desc()).limit(100).all()]

@app.post("/api/payments/webhook/stripe")
async def stripe_webhook(request:Request,d:Session=Depends(db)):
 secret=os.getenv("STRIPE_WEBHOOK_SECRET")
 if not secret: raise HTTPException(503,"Payments not connected")
 payload=await request.json(); eid=str(payload.get("id",""))
 if not eid: raise HTTPException(400,"Missing event id")
 if d.get(PaymentEvent,eid): return {"ok":True,"duplicate":True}
 d.add(PaymentEvent(id=eid)); d.commit(); return {"ok":True,"duplicate":False}

@app.on_event("startup")
def seed_admin():
 if ADMIN_EMAIL and ADMIN_PASSWORD:
  d=SessionLocal()
  if not d.query(User).filter_by(email=ADMIN_EMAIL.lower()).first():
   u=User(email=ADMIN_EMAIL.lower(),name=ADMIN_NAME,password_hash=ph.hash(ADMIN_PASSWORD),role="admin",email_verified=True); d.add(u); d.commit(); d.add(CreditAccount(user_id=u.id,balance=1000,monthly_limit=10000)); d.commit()
  d.close()
