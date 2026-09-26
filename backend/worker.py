import os
import json
import asyncio
from celery import Celery
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.future import select
from sqlalchemy.pool import NullPool
from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build
import models

REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379/0")
DATABASE_URL = os.getenv(
    "DATABASE_URL", 
    "postgresql+asyncpg://admin:adminpassword@localhost:5433/gdrive_manager"
)

celery_app = Celery("worker", broker=REDIS_URL, backend=REDIS_URL)

celery_app.conf.update(
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    timezone="UTC",
    enable_utc=True,
)


async def update_transfer_log(task_id: str, status: str, error_message: str = None):
    engine = create_async_engine(DATABASE_URL, echo=False, poolclass=NullPool)
    try:
        async with AsyncSession(engine) as session:
            result = await session.execute(select(models.TransferLog).where(models.TransferLog.id == task_id))
            log = result.scalars().first()
            if log:
                log.status = status
                if error_message:
                    log.error_message = error_message
                await session.commit()
    except Exception as e:
        print(f"Failed to update transfer log: {e}")
    finally:
        await engine.dispose()

async def get_credentials(account_id: int):
    # Create the engine INSIDE the function with NullPool so Celery worker forks don't share broken sockets
    engine = create_async_engine(DATABASE_URL, echo=False, poolclass=NullPool)
    try:
        async with AsyncSession(engine) as session:
            result = await session.execute(select(models.DriveAccount).where(models.DriveAccount.id == account_id))
            account = result.scalars().first()
            if not account:
                raise Exception(f"Account {account_id} not found")
            return json.loads(account.credentials), account.email
    finally:
        await engine.dispose()

def _copy_item(source_service, dest_service, dest_email, file_id, dest_folder_id, file_name=None, mime_type=None):
    # If meta wasn't provided, fetch it
    if not file_name or not mime_type:
        meta = source_service.files().get(fileId=file_id, fields='name, mimeType').execute()
        file_name = meta.get('name')
        mime_type = meta.get('mimeType')

    # Determine parent ID
    parents = ['root']
    if dest_folder_id and dest_folder_id not in ["root", "my-drive-virtual"]:
        parents = [dest_folder_id]

    is_folder = mime_type == 'application/vnd.google-apps.folder'

    # Try to share the item so the destination account can see it
    try:
        source_service.permissions().create(
            fileId=file_id,
            body={'type': 'user', 'role': 'reader', 'emailAddress': dest_email},
            sendNotificationEmail=False
        ).execute()
    except Exception as e:
        print(f"Sharing failed or already shared: {e}")

    if is_folder:
        # Create a new folder in the destination
        folder_body = {
            'name': file_name,
            'mimeType': 'application/vnd.google-apps.folder',
            'parents': parents
        }
        new_folder = dest_service.files().create(body=folder_body, fields='id').execute()
        new_folder_id = new_folder.get('id')

        # List all children of the source folder
        query = f"'{file_id}' in parents and trashed=false"
        page_token = None
        while True:
            results = source_service.files().list(
                q=query, spaces='drive', fields='nextPageToken, files(id, name, mimeType)',
                pageToken=page_token
            ).execute()
            
            for child in results.get('files', []):
                # Recursively copy children
                _copy_item(source_service, dest_service, dest_email, child['id'], new_folder_id, child['name'], child['mimeType'])
                
            page_token = results.get('nextPageToken', None)
            if page_token is None:
                break
        
        return new_folder_id
    else:
        # Standard File Copy
        file_body = {
            'name': file_name,
            'parents': parents
        }
        try:
            copied_file = dest_service.files().copy(
                fileId=file_id,
                body=file_body
            ).execute()
            return copied_file.get('id')
        except Exception as direct_e:
            print(f"Direct copy failed for {file_name}: {direct_e}")
            print("Falling back to Owner-Copy Proxy strategy...")
            # 1. Source account makes a local copy (Source becomes the absolute owner of the copy)
            proxy_file = source_service.files().copy(
                fileId=file_id,
                body={'name': f"PROXY_{file_name}"}
            ).execute()
            proxy_id = proxy_file.get('id')
            
            try:
                # 2. Source shares the new proxy file with Destination
                source_service.permissions().create(
                    fileId=proxy_id,
                    body={'type': 'user', 'role': 'reader', 'emailAddress': dest_email},
                    sendNotificationEmail=False
                ).execute()
                
                # 3. Destination securely copies the proxy file into its final destination
                final_file = dest_service.files().copy(
                    fileId=proxy_id,
                    body=file_body
                ).execute()
                return final_file.get('id')
            finally:
                # 4. Clean up proxy file from the Source account's root drive
                try:
                    source_service.files().delete(fileId=proxy_id).execute()
                except Exception as cleanup_e:
                    print(f"Failed to clean up proxy file {proxy_id}: {cleanup_e}")

def _sync_transfer(self, source_account_id, dest_account_id, file_id, dest_folder_id):
    # 1. Fetch credentials
    source_creds_data, source_email = asyncio.run(get_credentials(source_account_id))
    dest_creds_data, dest_email = asyncio.run(get_credentials(dest_account_id))
    
    source_creds = Credentials.from_authorized_user_info(source_creds_data)
    dest_creds = Credentials.from_authorized_user_info(dest_creds_data)
    
    source_service = build('drive', 'v3', credentials=source_creds)
    dest_service = build('drive', 'v3', credentials=dest_creds)

    self.update_state(state='PROGRESS', meta={'current': 20, 'total': 100})

    try:
        new_id = _copy_item(source_service, dest_service, dest_email, file_id, dest_folder_id)
        self.update_state(state='PROGRESS', meta={'current': 100, 'total': 100})
        asyncio.run(update_transfer_log(self.request.id, 'SUCCESS'))
        return {"status": "completed", "file_id": file_id, "new_file_id": new_id}
    except Exception as e:
        import traceback
        traceback.print_exc()
        asyncio.run(update_transfer_log(self.request.id, 'FAILURE', str(e)))
        raise Exception(f"Transfer failed: {str(e)}")

@celery_app.task(bind=True)
def transfer_file_task(self, source_account_id: int, dest_account_id: int, file_id: str, dest_folder_id: str):
    print(f"Starting transfer for file {file_id} from {source_account_id} to {dest_account_id}")
    return _sync_transfer(self, source_account_id, dest_account_id, file_id, dest_folder_id)
