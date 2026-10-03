import asyncio
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker
from sqlalchemy.future import select
import models
import httpx
import uuid

async def main():
    engine = create_async_engine("postgresql+asyncpg://admin:adminpassword@postgres:5432/gdrive_manager")
    async_session = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    
    unique_id = str(uuid.uuid4())[:8]
    email_a = f"usera_{unique_id}@test.com"
    email_b = f"userb_{unique_id}@test.com"

    async with async_session() as session:
        # Create user A
        user_a = models.User(email=email_a, hashed_password="pw")
        session.add(user_a)
        
        # Create user B (attacker)
        user_b = models.User(email=email_b, hashed_password="pw")
        session.add(user_b)
        await session.commit()

        # User A's accounts
        acc_a1 = models.DriveAccount(user_id=user_a.id, email=f"acc_a1_{unique_id}@test.com", name="A1", credentials="{}")
        acc_a2 = models.DriveAccount(user_id=user_a.id, email=f"acc_a2_{unique_id}@test.com", name="A2", credentials="{}")
        session.add(acc_a1)
        session.add(acc_a2)
        
        # User B's account
        acc_b1 = models.DriveAccount(user_id=user_b.id, email=f"acc_b1_{unique_id}@test.com", name="B1", credentials="{}")
        session.add(acc_b1)
        
        await session.commit()
        await session.refresh(user_a)
        await session.refresh(user_b)
        await session.refresh(acc_a1)
        await session.refresh(acc_a2)
        await session.refresh(acc_b1)
        
        task_id = str(uuid.uuid4())
        log = models.TransferLog(
            id=task_id,
            user_id=user_a.id,
            source_account_id=acc_a1.id,
            dest_account_id=acc_a2.id,
            file_id="123",
            file_name="test.txt",
            dest_folder_id="dst",
            status="PENDING"
        )
        session.add(log)
        await session.commit()

    print(f"User A ID: {user_a.id}, User B ID: {user_b.id}")
    print(f"Acc A1 ID: {acc_a1.id}, Acc A2 ID: {acc_a2.id}, Acc B1 ID: {acc_b1.id}")
    
    from app_auth import create_access_token
    token_a = create_access_token({"sub": str(user_a.id)})
    token_b = create_access_token({"sub": str(user_b.id)})
    
    async with httpx.AsyncClient() as client:
        print("Scenario 1: Adversarial path - User B attempts to start transfer using User A's accounts")
        res = await client.post(
            "http://backend:8000/api/transfer",
            headers={"Authorization": f"Bearer {token_b}"},
            json={
                "source_account_id": acc_a1.id,
                "dest_account_id": acc_a2.id,
                "file_id": "123",
                "file_name": "test.txt",
                "dest_folder_id": "root"
            }
        )
        print("Status code:", res.status_code)
        print("Response:", res.text)
        if res.status_code == 404:
            print("Scenario 1 PASS")
        else:
            print("Scenario 1 FAIL")
            
        print("\nScenario 2: Happy path - User A deletes acc_a1, revokes task, deletes logs, deletes account")
        res = await client.delete(
            f"http://backend:8000/api/accounts/{acc_a1.id}",
            headers={"Authorization": f"Bearer {token_a}"}
        )
        print("Status code:", res.status_code)
        print("Response:", res.text)
        if res.status_code == 200:
            print("Scenario 2 PASS")
        else:
            print("Scenario 2 FAIL")
            
    # Verify DB state for Scenario 2
    async with async_session() as session:
        # Check account deleted
        res_acc = await session.execute(select(models.DriveAccount).where(models.DriveAccount.id == acc_a1.id))
        if not res_acc.scalars().first():
            print("Account successfully deleted from DB.")
        else:
            print("Account NOT deleted from DB.")
            
        # Check logs deleted
        res_logs = await session.execute(select(models.TransferLog).where(models.TransferLog.id == task_id))
        if not res_logs.scalars().first():
            print("TransferLogs successfully deleted from DB.")
        else:
            print("TransferLogs NOT deleted from DB.")

if __name__ == "__main__":
    asyncio.run(main())
