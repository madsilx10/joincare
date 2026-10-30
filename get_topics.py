import asyncio
from pyrogram import Client

API_ID   = 0    # samain sama tg_bind.py
API_HASH = ''   # samain sama tg_bind.py

GROUP = "@JoinCareOfficial"

async def main():
    with open("sessions.txt") as f:
        session_string = f.read().split('\n')[0].strip()

    async with Client(
        name=":memory:",
        api_id=API_ID,
        api_hash=API_HASH,
        session_string=session_string
    ) as app:
        topics = await app.get_forum_topics(GROUP)
        for t in topics.topics:
            print(f"ID: {t.id} | {t.title}")

if __name__ == "__main__":
    asyncio.run(main())
