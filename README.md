# Multi-Drive Manager 🗞️

A brutalist, high-performance web application designed to manage, browse, and seamlessly transfer massive files across multiple Google Drive accounts.

## ✨ Key Features

* **Zero-Bandwidth Transfers**: Transfers are handled entirely server-side natively within Google's datacenters. Moving a 50GB file between accounts takes milliseconds and uses absolutely zero of your local bandwidth or server memory.
* **Recursive Folder Copy**: Native support for dragging and dropping entire directory trees across accounts.
* **The "Newsprint" Aesthetic**: A striking, high-contrast UI inspired by the golden age of print journalism. Sharp geometry, massive typography, and high information density.
* **Live Transmission Log**: Real-time polling and progress bars keep you informed on background Celery tasks.

## 🛠️ Tech Stack

* **Frontend**: Next.js 15, React, Tailwind CSS v4
* **Backend**: FastAPI (Python 3.13), SQLAlchemy, PostgreSQL
* **Background Workers**: Celery, Redis
* **Infrastructure**: Fully Dockerized (docker-compose)

## 🚀 Getting Started

You can spin up the entire architecture with a single command. 

1. **Clone the repository:**
   ```bash
   git clone https://github.com/JamillimaJ/gdrive-transfer.git
   cd gdrive-transfer
   ```

2. **Start the Docker cluster:**
   ```bash
   docker compose up --build
   ```

3. **Access the application:**
   * Frontend (UI): [http://localhost:3000](http://localhost:3000)
   * Backend (API): [http://localhost:8000](http://localhost:8000)

## 🔒 Environment Variables

To enable Google Drive authentication, create a `.env` file in the `backend/` directory with your Google Cloud Console credentials:

```env
GOOGLE_CLIENT_ID=your_client_id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your_client_secret
SECRET_KEY=your_jwt_secret_key
```

*(Note: Never commit your `.env` file to version control. It is explicitly ignored in this repository.)*
