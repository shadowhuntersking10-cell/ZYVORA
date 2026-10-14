"""Bot lifecycle: background polling task with reconnect backoff + broadcast bridge."""
from __future__ import annotations

import asyncio
import logging
import threading
from dataclasses import dataclass, field

log = logging.getLogger("zyvora.bot")


@dataclass
class BotState:
    online: bool = False
    last_error: str | None = None
    username: str | None = None
    bot: object | None = None
    loop: asyncio.AbstractEventLoop | None = None
    pending_broadcast: dict[int, str] = field(default_factory=dict)  # admin_id -> stage


bot_state = BotState()


def _webapp_url() -> tuple[str | None, str | None]:
    """Returns (https_url, warning) — Telegram requires https for WebApp buttons."""
    from ..config import get_settings  # relative within package

    settings = get_settings()
    url = settings.public_url
    if url.startswith("https://"):
        return f"{url}/app", None
    return None, "not https"


def broadcast_message(text: str, lang: str | None) -> tuple[int, int, str | None]:
    """Called from sync admin route thread; schedules sends on the bot loop."""
    if not bot_state.online or bot_state.bot is None or bot_state.loop is None:
        return 0, 0, "bot is offline — message not sent"
    from ..db import session_factory
    from ..models import User

    future = asyncio.run_coroutine_threadsafe(_do_broadcast(text, lang), bot_state.loop)
    try:
        return future.result(timeout=120)
    except Exception as exc:  # noqa: BLE001
        return 0, 0, f"broadcast failed: {exc}"


async def _do_broadcast(text: str, lang: str | None) -> tuple[int, int, str | None]:
    from ..db import session_factory
    from ..models import User

    def _targets():
        db = session_factory()()
        try:
            q = db.query(User).filter(User.bot_started == True, User.is_banned == False)  # noqa: E712
            if lang:
                q = q.filter(User.lang == lang)
            return [u.telegram_id for u in q.all() if u.telegram_id]
        finally:
            db.close()

    targets = await asyncio.to_thread(_targets)
    sent = failed = 0
    for tg_id in targets:
        try:
            await bot_state.bot.send_message(tg_id, text)
            sent += 1
        except Exception:  # noqa: BLE001
            failed += 1
        await asyncio.sleep(0.05)  # stay well under Telegram rate limits
    return sent, failed, None


async def run_bot(token: str) -> None:
    """Polling loop with automatic reconnect. Never crashes the app."""
    from aiogram import Bot, Dispatcher
    from aiogram.client.default import DefaultBotProperties
    from aiogram.enums import ParseMode

    from .handlers import router

    bot = Bot(token=token, default=DefaultBotProperties(parse_mode=ParseMode.HTML))
    dp = Dispatcher()
    dp.include_router(router)
    bot_state.bot = bot
    bot_state.loop = asyncio.get_running_loop()

    while True:
        try:
            me = await bot.get_me()
            bot_state.username = me.username
            bot_state.online = True
            bot_state.last_error = None
            log.info("Bot connected as @%s", me.username)
            from aiogram.types import BotCommand

            await bot.set_my_commands([
                BotCommand(command="start", description="Open ZYVORA / Boshlash"),
                BotCommand(command="app", description="WebApp"),
                BotCommand(command="lang", description="Til / Language / Язык"),
                BotCommand(command="id", description="Telegram ID"),
                BotCommand(command="help", description="Help"),
            ])
            await dp.start_polling(bot, handle_signals=False)
        except asyncio.CancelledError:
            bot_state.online = False
            try:
                await bot.session.close()
            except Exception:  # noqa: BLE001
                pass
            return
        except Exception as exc:  # noqa: BLE001
            bot_state.online = False
            bot_state.last_error = str(exc)[:300]
            log.warning("Bot polling error (%s) — retrying in 15s", exc)
            await asyncio.sleep(15)
