"""aiogram v3 handlers. DB access is wrapped in asyncio.to_thread (sync sessions)."""
from __future__ import annotations

import asyncio
import logging

from aiogram import F, Router
from aiogram.filters import Command, CommandStart
from aiogram.types import (
    CallbackQuery,
    InlineKeyboardButton,
    InlineKeyboardMarkup,
    KeyboardButton,
    Message,
    ReplyKeyboardMarkup,
    WebAppInfo,
)

from ..config import get_settings
from ..i18n import LANGS, t
from ..models import GenJob, Project, User, utcnow
from .runner import bot_state

router = Router(name="main")
log = logging.getLogger("zyvora.bot")


# ------------------------------------------------------------------ db utils --

def _ensure_user(tg_id: int, tg_username: str | None, first_name: str | None, last_name: str | None, lang_code: str | None) -> User:
    from ..db import session_factory
    from ..services import credits as credits_svc

    settings = get_settings()
    db = session_factory()()
    try:
        user = db.query(User).filter_by(telegram_id=tg_id).first()
        lang_map = {"uz": "uz", "ru": "ru", "en": "en"}
        lang = lang_map.get((lang_code or "uz")[:2], "uz")
        if user is None:
            name = " ".join(filter(None, [first_name, last_name])).strip() or tg_username or f"tg{tg_id}"
            user = User(telegram_id=tg_id, username=tg_username, full_name=name[:120], lang=lang, bot_started=True)
            db.add(user)
            db.commit()
            credits_svc.grant(db, user, settings.welcome_credits, "welcome", ref_id="signup", notify_user=False)
        else:
            user.bot_started = True
            user.last_seen_at = utcnow()
            if tg_username != user.username:
                user.username = tg_username
            db.commit()
        if tg_id in settings.admin_ids and user.role != "admin":
            user.role = "admin"
            db.commit()
        db.expunge(user)
        return user
    finally:
        db.close()


def _set_lang(tg_id: int, lang: str) -> None:
    from ..db import session_factory
    from ..models import User as U

    db = session_factory()()
    try:
        u = db.query(U).filter_by(telegram_id=tg_id).first()
        if u:
            u.lang = lang
            db.commit()
    finally:
        db.close()


def _stats_snapshot() -> dict:
    from ..db import session_factory

    db = session_factory()()
    try:
        return {
            "users": db.query(User).count(),
            "projects": db.query(Project).filter(Project.archived == False).count(),  # noqa: E712
            "jobs": db.query(GenJob).count(),
        }
    finally:
        db.close()


# ---------------------------------------------------------------- keyboards --

def _webapp_keyboard(lang: str) -> ReplyKeyboardMarkup | None:
    from .runner import _webapp_url

    url, warning = _webapp_url()
    if url:
        return ReplyKeyboardMarkup(
            keyboard=[[KeyboardButton(text=t(lang, "bot.start.webapp_btn"), web_app=WebAppInfo(url=url))]],
            resize_keyboard=True,
        )
    return None


def _lang_keyboard() -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(text="🇺🇿 O'zbekcha", callback_data="lang:uz"),
         InlineKeyboardButton(text="🇬🇧 English", callback_data="lang:en"),
         InlineKeyboardButton(text="🇷🇺 Русский", callback_data="lang:ru")],
    ])


# ----------------------------------------------------------------- handlers --

@router.message(CommandStart())
async def cmd_start(message: Message) -> None:
    settings = get_settings()
    tg = message.from_user
    user = await asyncio.to_thread(_ensure_user, tg.id, tg.username, tg.first_name, tg.last_name, tg.language_code)
    lang = user.lang
    kb = _webapp_keyboard(lang)
    url, warning = (None, None)
    from .runner import _webapp_url

    url, warning = _webapp_url()
    if kb is not None:
        await message.answer(t(lang, "bot.start", name=user.full_name), reply_markup=kb)
    else:
        rows = [[InlineKeyboardButton(text=t(lang, "bot.start.webapp_btn"), url=url)]] if url else []
        await message.answer(
            t(lang, "bot.start", name=user.full_name)
            + (f"\n\n⚠️ {t(lang, 'bot.link_warning')}" if warning else ""),
            reply_markup=InlineKeyboardMarkup(inline_keyboard=rows) if rows else None,
        )
    if user.role == "admin":
        await message.answer(f"🛡 Admin panel: {settings.public_url}/app")


@router.message(Command("help"))
async def cmd_help(message: Message) -> None:
    user = await asyncio.to_thread(_ensure_user, message.from_user.id, message.from_user.username, message.from_user.first_name, message.from_user.last_name, message.from_user.language_code)
    await message.answer(t(user.lang, "bot.help"))


@router.message(Command("id"))
async def cmd_id(message: Message) -> None:
    user = await asyncio.to_thread(_ensure_user, message.from_user.id, message.from_user.username, message.from_user.first_name, message.from_user.last_name, message.from_user.language_code)
    await message.answer(t(user.lang, "bot.your_id", id=message.from_user.id))


@router.message(Command("lang"))
async def cmd_lang(message: Message) -> None:
    user = await asyncio.to_thread(_ensure_user, message.from_user.id, message.from_user.username, message.from_user.first_name, message.from_user.last_name, message.from_user.language_code)
    await message.answer(t(user.lang, "bot.lang_choose"), reply_markup=_lang_keyboard())


@router.message(Command("app"))
async def cmd_app(message: Message) -> None:
    user = await asyncio.to_thread(_ensure_user, message.from_user.id, message.from_user.username, message.from_user.first_name, message.from_user.last_name, message.from_user.language_code)
    from .runner import _webapp_url

    url, warning = _webapp_url()
    if url:
        await message.answer(t(user.lang, "bot.webapp_link", url=url))
    else:
        await message.answer(t(user.lang, "bot.link_warning"))


@router.callback_query(F.data.startswith("lang:"))
async def cb_lang(callback: CallbackQuery) -> None:
    lang = callback.data.split(":")[1]
    if lang in LANGS:
        await asyncio.to_thread(_set_lang, callback.from_user.id, lang)
        await callback.message.answer(t(lang, "bot.lang_done"))
    await callback.answer()


@router.message(Command("stats"))
async def cmd_stats(message: Message) -> None:
    settings = get_settings()
    if message.from_user.id not in settings.admin_ids:
        user = await asyncio.to_thread(_ensure_user, message.from_user.id, message.from_user.username, message.from_user.first_name, message.from_user.last_name, message.from_user.language_code)
        await message.answer(t(user.lang, "bot.admin_not"))
        return
    stats = await asyncio.to_thread(_stats_snapshot)
    user = await asyncio.to_thread(_ensure_user, message.from_user.id, message.from_user.username, message.from_user.first_name, message.from_user.last_name, message.from_user.language_code)
    await message.answer(t(user.lang, "bot.stats", **stats))


@router.message(Command("broadcast"))
async def cmd_broadcast(message: Message) -> None:
    settings = get_settings()
    if message.from_user.id not in settings.admin_ids:
        return
    bot_state.pending_broadcast[message.from_user.id] = "awaiting_text"
    user = await asyncio.to_thread(_ensure_user, message.from_user.id, message.from_user.username, message.from_user.first_name, message.from_user.last_name, message.from_user.language_code)
    await message.answer(t(user.lang, "bot.broadcast_prompt"))


@router.message(Command("cancel"))
async def cmd_cancel(message: Message) -> None:
    bot_state.pending_broadcast.pop(message.from_user.id, None)
    user = await asyncio.to_thread(_ensure_user, message.from_user.id, message.from_user.username, message.from_user.first_name, message.from_user.last_name, message.from_user.language_code)
    await message.answer(t(user.lang, "bot.canceled"))


@router.callback_query(F.data.startswith("bcast:"))
async def cb_broadcast_confirm(callback: CallbackQuery) -> None:
    choice = callback.data.split(":")[1]
    admin_id = callback.from_user.id
    if choice == "yes" and admin_id in bot_state.pending_broadcast:
        text = bot_state.pending_broadcast[admin_id]
        bot_state.pending_broadcast.pop(admin_id, None)
        from .runner import broadcast_message

        sent, failed, note = await asyncio.to_thread(broadcast_message, text, None)
        await callback.message.edit_text(t("uz", "admin.broadcast_sent", sent=sent, failed=failed))
    else:
        bot_state.pending_broadcast.pop(admin_id, None)
        await callback.message.edit_text(t("uz", "bot.canceled"))
    await callback.answer()


@router.message(F.text)
async def fallback(message: Message) -> None:
    """Plain text: pending broadcast capture, otherwise help hint."""
    settings = get_settings()
    admin_id = message.from_user.id
    if admin_id in settings.admin_ids and bot_state.pending_broadcast.get(admin_id) == "awaiting_text":
        bot_state.pending_broadcast[admin_id] = message.text or ""
        user = await asyncio.to_thread(_ensure_user, message.from_user.id, message.from_user.username, message.from_user.first_name, message.from_user.last_name, message.from_user.language_code)
        await message.answer(
            t(user.lang, "bot.broadcast_confirm", text=(message.text or "")[:1500]),
            reply_markup=InlineKeyboardMarkup(inline_keyboard=[
                [InlineKeyboardButton(text=t(user.lang, "bot.yes"), callback_data="bcast:yes"),
                 InlineKeyboardButton(text=t(user.lang, "bot.no"), callback_data="bcast:no")],
            ]),
        )
        return
    kb = _webapp_keyboard("uz")
    if kb is not None:
        await message.answer(t("uz", "bot.help"), reply_markup=kb)
    else:
        await message.answer(t("uz", "bot.help"))
