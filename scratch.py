from sqlalchemy import select, delete, Column, Integer, String
from sqlalchemy.orm import declarative_base

Base = declarative_base()

class TransferLog(Base):
    __tablename__ = "transfer_logs"
    id = Column(String, primary_key=True)
    user_id = Column(Integer)
    source_account_id = Column(Integer)
    dest_account_id = Column(Integer)
    status = Column(String)

stmt = delete(TransferLog).where(
    TransferLog.user_id == 1,
    (TransferLog.source_account_id == 2) |
    (TransferLog.dest_account_id == 2)
)

print(stmt)
