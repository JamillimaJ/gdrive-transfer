import asyncio
from celery import Celery

app = Celery()
print(asyncio.iscoroutinefunction(app.control.revoke))
