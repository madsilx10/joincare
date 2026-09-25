"""
tg_bind.py — Dipanggil dari joincare.js via child_process
Usage: python tg_bind.py <session_string> <bot_start_url>
"""

import sys
import asyncio
import re
from pyrogram import Client
from pyrogram.errors import UserAlreadyParticipant, FloodWait

# ---- CONFIG ----
API_ID   = 12345678        # ganti dengan api_id lo
API_HASH = "your_api_hash" # ganti dengan api_hash lo
# ----------------

SESSION_STRING = sys.argv[1]
BOT_URL        = sys.argv[2]

m = re.match(r'https://t\.me/([^?]+)\?start=(.+)', BOT_URL)
if not m:
    print(f"ERROR Invalid bot URL: {BOT_URL}")
    sys.exit(1)

BOT_USERNAME = m.group(1)
START_TOKEN  = m.group(2)

async def main():
    async with Client(
        "tg_bind_session",
        api_id=API_ID,
        api_hash=API_HASH,
        session_string=SESSION_STRING,
        in_memory=True
    ) as app:

        # Kirim /start ke bot dengan token
        try:
            await app.send_message(BOT_USERNAME, f"/start {START_TOKEN}")
        except Exception as e:
            print(f"ERROR send_message: {e}")
            sys.exit(1)

        # Tunggu reply dari bot (max 15 detik)
        group_link = None
        for _ in range(15):
            await asyncio.sleep(1)
            async for msg in app.get_chat_history(BOT_USERNAME, limit=5):
                if msg.from_user and msg.from_user.is_bot:
                    text = msg.text or msg.caption or ""
                    links = re.findall(r'https://t\.me/[^\s\)\"]+', text)
                    for lnk in links:
                        if 'start=' not in lnk and BOT_USERNAME not in lnk:
                            group_link = lnk
                            break
                    if not group_link and msg.reply_markup:
                        try:
                            for row in msg.reply_markup.inline_keyboard:
                                for btn in row:
                                    if btn.url and 't.me/' in btn.url and 'start=' not in btn.url:
                                        group_link = btn.url
                                        break
                        except Exception:
                            pass
                if group_link:
                    break
            if group_link:
                break

        if not group_link:
            print("ALREADY_JOINED")
            sys.exit(0)

        # Join group
        try:
            if '/joinchat/' in group_link or '/+' in group_link:
                invite = group_link.split('t.me/')[-1]
                await app.join_chat(invite)
            else:
                username = group_link.rstrip('/').split('/')[-1]
                await app.join_chat(username)
            print(f"SUCCESS {group_link}")
        except UserAlreadyParticipant:
            print("ALREADY_JOINED")
        except FloodWait as e:
            print(f"ERROR FloodWait {e.value}s")
            sys.exit(1)
        except Exception as e:
            print(f"ERROR join_chat: {e}")
            sys.exit(1)

asyncio.run(main())
