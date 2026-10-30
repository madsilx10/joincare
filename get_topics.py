import asyncio
from pyrogram import Client
from pyrogram.raw import functions

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
        peer = await app.resolve_peer(GROUP)
        result = await app.invoke(
            functions.channels.GetForumTopics(
                channel=peer,
                offset_date=0,
                offset_id=0,
                offset_topic=0,
                limit=100,
                q=""
            )
        )
        for t in result.topics:
            print(f"ID: {t.id} | {t.title}")

if __name__ == "__main__":
    asyncio.run(main())
