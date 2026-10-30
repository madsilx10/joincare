import sys
import asyncio
from pyrogram import Client

# Samain sama yg di tg_bind.py
API_ID   = 0    # isi
API_HASH = ''   # isi

GROUP = "@JoinCareOfficial"
THREAD_ID = 20723  # Daily check-in
MESSAGE = "BuildWithJoinCare"

async def main(session_string):
    async with Client(
        name=":memory:",
        api_id=API_ID,
        api_hash=API_HASH,
        session_string=session_string
    ) as app:
        await app.send_message(GROUP, MESSAGE, message_thread_id=THREAD_ID)
        print(f"OK: {MESSAGE}")

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("ERROR: session_string required")
        sys.exit(1)
    asyncio.run(main(sys.argv[1]))
