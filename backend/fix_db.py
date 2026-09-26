import asyncio
from database import engine
from sqlalchemy import text

async def fix_sequence():
    async with engine.begin() as conn:
        try:
            await conn.execute(text("SELECT setval('users_id_seq', (SELECT MAX(id) FROM users));"))
            print("Fixed users sequence.")
        except Exception as e:
            print("Error fixing users:", e)
            
        try:
            await conn.execute(text("SELECT setval('drive_accounts_id_seq', (SELECT MAX(id) FROM drive_accounts));"))
            print("Fixed drive_accounts sequence.")
        except Exception as e:
            print("Error fixing drive_accounts:", e)

if __name__ == "__main__":
    asyncio.run(fix_sequence())
