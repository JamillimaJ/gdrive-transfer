import os
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import RedirectResponse
from google_auth_oauthlib.flow import Flow
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from database import get_db
import models

router = APIRouter()

def get_client_config():
    return {
        "web": {
            "client_id": os.environ.get("GOOGLE_CLIENT_ID"),
            "project_id": "multi-drive-manager",
            "auth_uri": "https://accounts.google.com/o/oauth2/auth",
            "token_uri": "https://oauth2.googleapis.com/token",
            "auth_provider_x509_cert_url": "https://www.googleapis.com/oauth2/v1/certs",
            "client_secret": os.environ.get("GOOGLE_CLIENT_SECRET"),
            "redirect_uris": [os.environ.get("GOOGLE_REDIRECT_URI")]
        }
    }

SCOPES = ['https://www.googleapis.com/auth/drive', 'openid', 'email', 'profile']

from app_auth import get_current_user, create_access_token
from sqlalchemy.future import select

@router.get("/api/auth/google/login")
def login(token: str = None):
    import urllib.parse
    
    client_id = os.environ.get("GOOGLE_CLIENT_ID")
    redirect_uri = os.environ.get("GOOGLE_REDIRECT_URI")
    
    params = {
        "client_id": client_id,
        "redirect_uri": redirect_uri,
        "response_type": "code",
        "scope": " ".join(SCOPES),
        "access_type": "offline",
        "prompt": "consent"
    }
    
    if token:
        params["state"] = token
        
    url = "https://accounts.google.com/o/oauth2/v2/auth?" + urllib.parse.urlencode(params)
    return RedirectResponse(url=url)

@router.get("/api/auth/google/callback")
async def callback(request: Request, db: AsyncSession = Depends(get_db)):
    code = request.query_params.get("code")
    token = request.query_params.get("state")
    
    if not code:
        raise HTTPException(status_code=400, detail="Authorization code not found")

    try:
        import httpx
        from google.oauth2.credentials import Credentials
        from googleapiclient.discovery import build

        token_url = "https://oauth2.googleapis.com/token"
        data = {
            "code": code,
            "client_id": os.environ.get("GOOGLE_CLIENT_ID"),
            "client_secret": os.environ.get("GOOGLE_CLIENT_SECRET"),
            "redirect_uri": os.environ.get("GOOGLE_REDIRECT_URI"),
            "grant_type": "authorization_code"
        }
        
        async with httpx.AsyncClient() as client:
            response = await client.post(token_url, data=data)
            token_data = response.json()
            
        if "error" in token_data:
            raise Exception(f"Google Token Error: {token_data.get('error_description', token_data['error'])}")

        credentials = Credentials(
            token=token_data['access_token'],
            refresh_token=token_data.get('refresh_token'),
            token_uri=token_url,
            client_id=os.environ.get("GOOGLE_CLIENT_ID"),
            client_secret=os.environ.get("GOOGLE_CLIENT_SECRET"),
            scopes=SCOPES
        )
        
        # Get the email of the authenticated user
        drive_service = build('drive', 'v3', credentials=credentials)
        about = drive_service.about().get(fields="user").execute()
        email = about['user']['emailAddress']
        
        creds_json = credentials.to_json()
        
        # Determine User
        user = None
        is_app_login = False
        
        if token:
            try:
                user = await get_current_user(token=token, db=db)
            except HTTPException:
                pass
                
        if not user:
            is_app_login = True
            user_result = await db.execute(select(models.User).where(models.User.email == email))
            user = user_result.scalars().first()
            if not user:
                user = models.User(email=email, hashed_password="")
                db.add(user)
                await db.commit()
                await db.refresh(user)

        # Check existing drive accounts
        acc_result = await db.execute(select(models.DriveAccount).where(models.DriveAccount.user_id == user.id))
        all_accounts = acc_result.scalars().all()
        
        existing_account = next((acc for acc in all_accounts if acc.email == email), None)
        
        # Account Naming Logic
        account_name = "Sub Account"
        if is_app_login:
            account_name = "Personal Account"
        elif len(all_accounts) == 0:
            account_name = "Primary Account"
            
        if existing_account:
            existing_account.credentials = creds_json
            # Force rename if they logged in directly through Google OAuth
            if is_app_login:
                existing_account.name = "Personal Account"
        else:
            new_account = models.DriveAccount(
                user_id=user.id,
                email=email,
                name=account_name,
                credentials=creds_json
            )
            db.add(new_account)
            
        await db.commit()
        
        # Redirect back to frontend
        if is_app_login:
            jwt_token = create_access_token(data={"sub": str(user.id)})
            return RedirectResponse(url=f"http://localhost:3000/?token={jwt_token}")
        else:
            return RedirectResponse(url="http://localhost:3000/?auth=success")
        
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))
