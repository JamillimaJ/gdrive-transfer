from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from database import get_db
import models
from app_auth import get_current_user

router = APIRouter()

class TransferRequest(BaseModel):
    source_account_id: int
    dest_account_id: int
    file_id: str
    file_name: str
    dest_folder_id: str

@router.get("/api/accounts")
async def get_accounts(user: models.User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(models.DriveAccount).where(models.DriveAccount.user_id == user.id))
    accounts = result.scalars().all()
    return [{"id": acc.id, "name": acc.name, "email": acc.email} for acc in accounts]

import json
from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build
from fastapi import HTTPException

@router.get("/api/accounts/{account_id}/files")
async def get_files(
    account_id: int, 
    folder_id: str = "root", 
    user: models.User = Depends(get_current_user), 
    db: AsyncSession = Depends(get_db)
):
    result = await db.execute(
        select(models.DriveAccount)
        .where(models.DriveAccount.id == account_id, models.DriveAccount.user_id == user.id)
    )
    account = result.scalars().first()
    
    if not account:
        raise HTTPException(status_code=404, detail="Account not found")
        
    # Virtual Root handling
    if folder_id == "root":
        return [
            {"id": "my-drive-virtual", "name": "My Drive", "type": "folder", "owner": "Me"},
            {"id": "shared-with-me-virtual", "name": "Shared with me", "type": "folder", "owner": "System"}
        ]
        
    try:
        creds_data = json.loads(account.credentials)
        creds = Credentials.from_authorized_user_info(creds_data)
        
        drive_service = build('drive', 'v3', credentials=creds)
        
        if folder_id == "my-drive-virtual":
            query = "'root' in parents and trashed=false"
        elif folder_id == "shared-with-me-virtual":
            query = "sharedWithMe=true and trashed=false"
        else:
            query = f"'{folder_id}' in parents and trashed=false"
            
        results = drive_service.files().list(
            q=query,
            pageSize=1000,
            fields="files(id, name, mimeType, owners)",
            orderBy="folder, name"
        ).execute()
        
        items = results.get('files', [])
        
        formatted_files = []
        seen_ids = set()
        
        for item in items:
            if item['id'] in seen_ids:
                continue
            seen_ids.add(item['id'])
            
            is_folder = item['mimeType'] == 'application/vnd.google-apps.folder'
            owner_name = "Unknown"
            if 'owners' in item and len(item['owners']) > 0:
                owner_name = item['owners'][0].get('displayName', 'Unknown')
                if item['owners'][0].get('me'):
                    owner_name = "Me"

            formatted_files.append({
                "id": item['id'],
                "name": item['name'],
                "type": "folder" if is_folder else "file",
                "owner": owner_name
            })
            
        return formatted_files
        
    except Exception as e:
        print(f"Error fetching files: {e}")
        raise HTTPException(status_code=400, detail="Failed to fetch files from Google Drive")

@router.get("/api/accounts/{account_id}/publishers")
async def get_publishers(
    account_id: int, 
    user: models.User = Depends(get_current_user), 
    db: AsyncSession = Depends(get_db)
):
    result = await db.execute(
        select(models.DriveAccount)
        .where(models.DriveAccount.id == account_id, models.DriveAccount.user_id == user.id)
    )
    account = result.scalars().first()
    
    if not account:
        raise HTTPException(status_code=404, detail="Account not found")
        
    try:
        creds_data = json.loads(account.credentials)
        creds = Credentials.from_authorized_user_info(creds_data)
        drive_service = build('drive', 'v3', credentials=creds)
        
        # Scan shared files to extract all unique publishers
        results = drive_service.files().list(
            q="sharedWithMe=true and trashed=false",
            pageSize=1000,
            fields="files(owners)"
        ).execute()
        
        items = results.get('files', [])
        publishers = set(["Me", "System"])
        
        for item in items:
            if 'owners' in item and len(item['owners']) > 0:
                name = item['owners'][0].get('displayName', 'Unknown')
                if not item['owners'][0].get('me') and name != 'Unknown':
                    publishers.add(name)
                    
        return sorted(list(publishers))
        
    except Exception as e:
        print(f"Error fetching publishers: {e}")
        return ["Me", "System"]

from worker import transfer_file_task

import uuid
@router.post("/api/transfer")
async def start_transfer(req: TransferRequest, user: models.User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(models.DriveAccount.id).where(
            models.DriveAccount.user_id == user.id,
            models.DriveAccount.id.in_([req.source_account_id, req.dest_account_id])
        )
    )
    owned_accounts = set(result.scalars().all())
    required_accounts = {req.source_account_id, req.dest_account_id}
    
    if not required_accounts.issubset(owned_accounts):
        raise HTTPException(status_code=404, detail="Account not found")

    task_id = str(uuid.uuid4())
    log = models.TransferLog(
        id=task_id,
        user_id=user.id,
        source_account_id=req.source_account_id,
        dest_account_id=req.dest_account_id,
        file_id=req.file_id,
        file_name=req.file_name,
        dest_folder_id=req.dest_folder_id,
        status="PENDING"
    )
    db.add(log)
    await db.commit()
    
    task = transfer_file_task.apply_async(
        args=[req.source_account_id, req.dest_account_id, req.file_id, req.dest_folder_id],
        task_id=task_id
    )
    return {"task_id": task_id, "status": "started"}

@router.get("/api/transfer/{task_id}")
def get_transfer_status(task_id: str):
    from celery.result import AsyncResult
    from worker import celery_app
    task_result = AsyncResult(task_id, app=celery_app)
    
    if task_result.state == 'PENDING':
        response = {'state': task_result.state, 'progress': 0}
    elif task_result.state != 'FAILURE':
        response = {
            'state': task_result.state,
            'progress': task_result.info.get('current', 0) if isinstance(task_result.info, dict) else 100
        }
    else:
        response = {'state': task_result.state, 'error': str(task_result.info)}
    return response


@router.get("/api/transfers/history")
async def get_transfer_history(user: models.User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    from sqlalchemy import desc
    result = await db.execute(
        select(models.TransferLog)
        .where(models.TransferLog.user_id == user.id)
        .order_by(desc(models.TransferLog.created_at))
        .limit(100)
    )
    logs = result.scalars().all()
    return [{
        "taskId": log.id,
        "fileName": log.file_name,
        "progress": 100 if log.status == "SUCCESS" else 0,
        "status": log.status,
        "timestamp": int(log.created_at.timestamp() * 1000) if log.created_at else 0,
        "payload": {
            "source_account_id": log.source_account_id,
            "dest_account_id": log.dest_account_id,
            "file_id": log.file_id,
            "file_name": log.file_name,
            "dest_folder_id": log.dest_folder_id
        }
    } for log in logs]


@router.get("/api/transfers/active")
async def get_active_transfers(user: models.User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(models.TransferLog)
        .where(models.TransferLog.user_id == user.id)
        .where(models.TransferLog.status == "PENDING")
    )
    logs = result.scalars().all()
    return [{
        "taskId": log.id,
        "fileName": log.file_name,
        "progress": 0,
        "status": "PENDING",
        "timestamp": int(log.created_at.timestamp() * 1000) if log.created_at else 0,
        "payload": {
            "source_account_id": log.source_account_id,
            "dest_account_id": log.dest_account_id,
            "file_id": log.file_id,
            "file_name": log.file_name,
            "dest_folder_id": log.dest_folder_id
        }
    } for log in logs]


@router.delete("/api/transfers/history/{task_id}")
async def delete_transfer_log(task_id: str, user: models.User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(models.TransferLog)
        .where(models.TransferLog.id == task_id, models.TransferLog.user_id == user.id)
    )
    log = result.scalars().first()
    if log:
        await db.delete(log)
        await db.commit()
    return {"status": "deleted"}


@router.post("/api/transfer/{task_id}/cancel")
async def cancel_transfer(task_id: str, user: models.User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    from worker import celery_app
    # 1. Tell Celery to instantly kill the background task
    celery_app.control.revoke(task_id, terminate=True, signal='SIGTERM')
    
    # 2. Update the database to reflect it was cancelled
    result = await db.execute(
        select(models.TransferLog)
        .where(models.TransferLog.id == task_id, models.TransferLog.user_id == user.id)
    )
    log = result.scalars().first()
    if log:
        log.status = "CANCELLED"
        log.error_message = "Cancelled by user"
        await db.commit()
        
    return {"status": "cancelled"}


@router.delete("/api/accounts/{account_id}")
async def delete_account(account_id: int, user: models.User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    from sqlalchemy import delete
    result = await db.execute(select(models.DriveAccount).where(
        models.DriveAccount.id == account_id, 
        models.DriveAccount.user_id == user.id
    ))
    account = result.scalars().first()
    
    if not account:
        raise HTTPException(status_code=404, detail="Account not found")

    from worker import celery_app
    active_result = await db.execute(
        select(models.TransferLog).where(
            models.TransferLog.user_id == user.id,
            models.TransferLog.status.in_(["PENDING", "PROGRESS"]),
            (models.TransferLog.source_account_id == account_id) |
            (models.TransferLog.dest_account_id == account_id)
        )
    )
    for log in active_result.scalars().all():
        celery_app.control.revoke(log.id, terminate=True, signal='SIGTERM')

    await db.execute(delete(models.TransferLog).where(
        models.TransferLog.user_id == user.id,
        (models.TransferLog.source_account_id == account_id) |
        (models.TransferLog.dest_account_id == account_id)
    ))

    await db.delete(account)
    await db.commit()
    return {"status": "success"}
