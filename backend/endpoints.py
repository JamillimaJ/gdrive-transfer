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

@router.post("/api/transfer")
def start_transfer(req: TransferRequest):
    task = transfer_file_task.delay(
        req.source_account_id, 
        req.dest_account_id, 
        req.file_id, 
        req.dest_folder_id
    )
    return {"task_id": task.id, "status": "started"}

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
