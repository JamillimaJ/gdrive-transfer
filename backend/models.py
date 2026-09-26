from sqlalchemy import Column, Integer, String, ForeignKey, DateTime
from sqlalchemy.sql import func
from sqlalchemy.orm import relationship
from database import Base

class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    email = Column(String, unique=True, index=True)
    hashed_password = Column(String)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    
    drive_accounts = relationship("DriveAccount", back_populates="owner")

class DriveAccount(Base):
    __tablename__ = "drive_accounts"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"))
    email = Column(String) # Google account email
    name = Column(String) # Custom name
    credentials = Column(String) # Encrypted JSON string of google auth credentials
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    owner = relationship("User", back_populates="drive_accounts")

class TransferLog(Base):
    __tablename__ = "transfer_logs"

    id = Column(String, primary_key=True, index=True) # Celery task ID
    user_id = Column(Integer, ForeignKey("users.id"))
    source_account_id = Column(Integer, ForeignKey("drive_accounts.id"))
    dest_account_id = Column(Integer, ForeignKey("drive_accounts.id"))
    file_id = Column(String)
    file_name = Column(String)
    dest_folder_id = Column(String)
    status = Column(String, default="PENDING")
    error_message = Column(String, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
