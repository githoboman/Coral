# Frontend Setup Guide

## Getting Started

Follow these steps to run the frontend locally:

### 1. Navigate to the Frontend Directory

From the root of the project, move into the frontend folder:

```bash
cd frontend
```

### 2. Install Dependencies

Install all required packages:

```bash
npm install
```

### 3. Start the Development Server

Run the app in development mode:

```bash
npm run dev
```

### 4. Open the App in Your Browser

Once the dev server starts, open:

```
http://localhost:5173/c
```

> ⚠️ If your setup uses a different port, check your terminal output for the correct local URL.

---

## 🧩 Environment Variables

Before running the app, make sure to create a `.env` file in the **frontend** directory based on `.env.example`.
Example:

```bash
VITE_API_BASE_URL=https://tovira-server.onrender.com
```

---

## 💡 Tips

* If you run into build or dependency issues, try clearing your `node_modules` and lock file:

  ```bash
  rm -rf node_modules package-lock.json
  npm install
  ```
* The app automatically reloads when you make file changes.