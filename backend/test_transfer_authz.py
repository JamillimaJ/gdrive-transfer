import asyncio
import os
from unittest import mock

os.environ.setdefault("SECRET_KEY", "test-only-secret-key-for-pytest-0123456789")
os.environ.setdefault("DATABASE_URL", "sqlite+aiosqlite:///:memory:")

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.future import select
from sqlalchemy.pool import NullPool

import endpoints
import models
from app_auth import get_current_user
from database import Base, get_db


@pytest.fixture
def env(tmp_path):
    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path / 'test.db'}", poolclass=NullPool)

    async def setup():
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        async with AsyncSession(engine, expire_on_commit=False) as s:
            user_a = models.User(email="a@example.com", hashed_password="x")
            user_b = models.User(email="b@example.com", hashed_password="x")
            s.add_all([user_a, user_b])
            await s.commit()
            acc_a = models.DriveAccount(user_id=user_a.id, email="a@g.com", name="A", credentials="{}")
            acc_b = models.DriveAccount(user_id=user_b.id, email="b@g.com", name="B", credentials="{}")
            acc_b2 = models.DriveAccount(user_id=user_b.id, email="b2@g.com", name="B2", credentials="{}")
            s.add_all([acc_a, acc_b, acc_b2])
            await s.commit()
            return user_a.id, user_b.id, acc_a.id, acc_b.id, acc_b2.id

    ids = asyncio.run(setup())

    async def override_db():
        async with AsyncSession(engine, expire_on_commit=False) as s:
            yield s

    def make_client(user_id):
        app = FastAPI()
        app.include_router(endpoints.router)

        async def override_user():
            async with AsyncSession(engine) as s:
                return (await s.execute(select(models.User).where(models.User.id == user_id))).scalars().first()

        app.dependency_overrides[get_db] = override_db
        app.dependency_overrides[get_current_user] = override_user
        return TestClient(app)

    def log_count():
        async def count():
            async with AsyncSession(engine) as s:
                return len((await s.execute(select(models.TransferLog))).scalars().all())
        return asyncio.run(count())

    yield ids, make_client, log_count
    asyncio.run(engine.dispose())


def payload(source_id, dest_id):
    return {
        "source_account_id": source_id,
        "dest_account_id": dest_id,
        "file_id": "file1",
        "file_name": "f.txt",
        "dest_folder_id": "root",
    }


def test_cross_user_source_is_rejected(env):
    (user_a, user_b, acc_a, acc_b, acc_b2), make_client, log_count = env
    with mock.patch.object(endpoints.transfer_file_task, "apply_async") as apply_async:
        res = make_client(user_b).post("/api/transfer", json=payload(acc_a, acc_b))
    assert res.status_code == 404
    assert log_count() == 0
    apply_async.assert_not_called()


def test_cross_user_dest_is_rejected(env):
    (user_a, user_b, acc_a, acc_b, acc_b2), make_client, log_count = env
    with mock.patch.object(endpoints.transfer_file_task, "apply_async") as apply_async:
        res = make_client(user_b).post("/api/transfer", json=payload(acc_b, acc_a))
    assert res.status_code == 404
    assert log_count() == 0
    apply_async.assert_not_called()


def test_owner_transfer_succeeds(env):
    (user_a, user_b, acc_a, acc_b, acc_b2), make_client, log_count = env
    with mock.patch.object(endpoints.transfer_file_task, "apply_async") as apply_async:
        res = make_client(user_b).post("/api/transfer", json=payload(acc_b, acc_b2))
    assert res.status_code == 200
    assert log_count() == 1
    apply_async.assert_called_once()
