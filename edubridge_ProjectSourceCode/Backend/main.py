import os
import io
from datetime import datetime
from typing import List, Optional
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi import UploadFile, File, Form
from fastapi.responses import StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel
from dotenv import load_dotenv
from pymongo import MongoClient
import gridfs

from bson import ObjectId

load_dotenv()

MONGODB_URI = os.getenv("MONGODB_URI", "mongodb://localhost:27017")
DB_NAME = os.getenv("DB_NAME", "edubridge_db")

client = MongoClient(MONGODB_URI)
db = client[DB_NAME]
lessons_collection = db["lessons"]
progress_collection = db["progress"]
users_collection = db["users"]
# GridFS for large files (lesson materials)
fs = gridfs.GridFS(db)


class LessonIn(BaseModel):
    title: str
    language: str = "en"
    level: str = "beginner"
    description: Optional[str] = None
    content: str 
    materials: Optional[List[str]] = [] # store file ids  
    video_url: Optional[str] = None        #store video url
    video_file_id: Optional[str] = None

class LessonOut(LessonIn):
    id: str


class LessonUpdate(BaseModel):
    title: Optional[str] = None
    language: Optional[str] = None
    level: Optional[str] = None
    description: Optional[str] = None
    content: Optional[str] = None


class ProgressIn(BaseModel):
    user_id: str
    lesson_id: str
    completed_at: Optional[datetime] = None


class ProgressOut(ProgressIn):
    id: str


class UserIn(BaseModel):
    name: str
    role: str = "student"
    locale: str = "en"


class UserOut(UserIn):
    id: str


class LessonStats(BaseModel):
    lesson_id: str
    completions: int


# Get the parent directory (project root)
STATIC_DIR = Path(__file__).parent.parent / "static"

app = FastAPI(title="EduBridge Backend", version="0.2.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# static website
app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")

@app.get("/", include_in_schema=False)
def root():
    return FileResponse(str(STATIC_DIR / "dashboard.html"))
#   return FileResponse("static/index.html")

def lesson_doc_to_out(doc) -> LessonOut:
    return LessonOut(
        id=str(doc["_id"]),
        title=doc["title"],
        language=doc.get("language", "en"),
        level=doc.get("level", "beginner"),
        description=doc.get("description"),
        content=doc.get("content", ""),
        materials=doc.get("materials", []),
        video_url=doc.get("video_url"),
        video_file_id=doc.get("video_file_id") 
    )


def progress_doc_to_out(doc) -> ProgressOut:
    return ProgressOut(
        id=str(doc["_id"]),
        user_id=str(doc["user_id"]),
        lesson_id=str(doc["lesson_id"]),
        completed_at=doc.get("completed_at"),
    )


def user_doc_to_out(doc) -> UserOut:
    return UserOut(
        id=str(doc["_id"]),
        name=doc["name"],
        role=doc.get("role", "student"),
        locale=doc.get("locale", "en"),
    )


# ------------ stuts check

@app.get("/health")
def health_check():
    return {"status": "ok"}

@app.post("/users", response_model=UserOut)
def create_user(user: UserIn):
    result = users_collection.insert_one(user.dict())
    doc = users_collection.find_one({"_id": result.inserted_id})
    return user_doc_to_out(doc)


@app.get("/users", response_model=List[UserOut])
def list_users():
    docs = list(users_collection.find())
    return [user_doc_to_out(doc) for doc in docs]


@app.post("/lessons", response_model=LessonOut)
def create_lesson(lesson: LessonIn):
    result = lessons_collection.insert_one(lesson.dict())
    doc = lessons_collection.find_one({"_id": result.inserted_id})
    return lesson_doc_to_out(doc)


@app.get("/lessons", response_model=List[LessonOut])
def list_lessons():
    docs = list(lessons_collection.find())
    return [lesson_doc_to_out(doc) for doc in docs]


@app.get("/lessons/{lesson_id}", response_model=LessonOut)
def get_lesson(lesson_id: str):
    try:
        oid = ObjectId(lesson_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid lesson id")
    doc = lessons_collection.find_one({"_id": oid})
    if not doc:
        raise HTTPException(status_code=404, detail="Lesson not found")
    return lesson_doc_to_out(doc)

@app.get("/lessons/{lesson_id}/full")
def get_full_lesson_with_materials(lesson_id: str):
    """
    Returns lesson details + downloadable materials
    """
    try:
        oid = ObjectId(lesson_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid lesson id")

    lesson = lessons_collection.find_one({"_id": oid})
    
    if not lesson:
        raise HTTPException(status_code=404, detail="Lesson not found")

    materials = []

    for fid in lesson.get("materials", []):
        try:
            file = fs.get(ObjectId(fid))
            materials.append({
                "file_id": fid,
                "filename": file.filename,
                "download_url": f"/materials/{fid}"
            })
        except:
            pass

    return {
        "lesson": lesson_doc_to_out(lesson),
        "materials": materials
    }

@app.put("/lessons/{lesson_id}", response_model=LessonOut)
def update_lesson(lesson_id: str, lesson: LessonUpdate):
    try:
        oid = ObjectId(lesson_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid lesson id")

    update_data = {k: v for k, v in lesson.dict().items() if v is not None}
    if not update_data:
        raise HTTPException(status_code=400, detail="No data to update")

    result = lessons_collection.update_one({"_id": oid}, {"$set": update_data})
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Lesson not found")

    doc = lessons_collection.find_one({"_id": oid})
    return lesson_doc_to_out(doc)

@app.post("/lessons/{lesson_id}/upload")
async def upload_lesson_material(
    lesson_id: str,
    file: UploadFile = File(...)
):
    """
    Upload lesson material to MongoDB GridFS
    and store file reference in the lesson document
    """
    try:
        oid = ObjectId(lesson_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid lesson id")

    # Read file content
    file_content = await file.read()

    # Save into GridFS
    file_id = fs.put(
        file_content,
        filename=file.filename,
        content_type=file.content_type,
        upload_date=datetime.utcnow()
    )

    # Attach file id to lesson document
    result = lessons_collection.update_one(
        {"_id": oid},
        {"$push": {"materials": str(file_id)}}
    )

    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Lesson not found")

    return {
        "message": "File uploaded successfully",
        "file_id": str(file_id),
        "filename": file.filename
    }


@app.get("/materials/{file_id}") # for offline access
def download_material(file_id: str):
    """
    Download lesson material from MongoDB GridFS
    and allow browser/device to save file for offline use
    """
    try:
        grid_out = fs.get(ObjectId(file_id))
    except Exception:
        raise HTTPException(status_code=404, detail="File not found")

    return StreamingResponse(
        io.BytesIO(grid_out.read()),
        media_type=grid_out.content_type,
        headers={
            "Content-Disposition": f"attachment; filename={grid_out.filename}"
        },
    )

@app.post("/lessons/{lesson_id}/upload_video")
async def upload_lesson_video(lesson_id: str, file: UploadFile = File(...)):
    """
    Upload a VIDEO file using GridFS.
    Store reference in lesson.video_file_id
    """
    try:
        oid = ObjectId(lesson_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid lesson id")

    content = await file.read()

    file_id = fs.put(
        content,
        filename=file.filename,
        content_type=file.content_type
    )

    lessons_collection.update_one(
        {"_id": oid},
        {"$set": {"video_file_id": str(file_id)}}
    )

    return {"video_file_id": str(file_id), "filename": file.filename}


# ------------ progress api for sync

@app.post("/progress", response_model=ProgressOut)
def add_progress(progress: ProgressIn):
    data = progress.dict()
    if data.get("completed_at") is None:
        data["completed_at"] = datetime.utcnow()

    result = progress_collection.insert_one(data)
    doc = progress_collection.find_one({"_id": result.inserted_id})
    return progress_doc_to_out(doc)


@app.get("/progress", response_model=List[ProgressOut])
def list_progress():
    docs = list(progress_collection.find())
    return [progress_doc_to_out(doc) for doc in docs]

@app.post("/progress/sync", response_model=List[ProgressOut])
def sync_offline_progress(progress_list: List[ProgressIn]):
    """
    Sync locally saved offline progress when user comes back online
    """
    inserted = []

    for progress in progress_list:
        data = progress.dict()

        if data.get("completed_at") is None:
            data["completed_at"] = datetime.utcnow()

        result = progress_collection.insert_one(data)
        doc = progress_collection.find_one({"_id": result.inserted_id})

        inserted.append(progress_doc_to_out(doc))

    return inserted

@app.get("/users/{user_id}/progress", response_model=List[ProgressOut])
def get_user_progress(user_id: str):
    docs = list(progress_collection.find({"user_id": user_id}))
    return [progress_doc_to_out(doc) for doc in docs]


@app.get("/stats/lessons", response_model=List[LessonStats])
def lesson_stats():
    pipeline = [
        {"$group": {"_id": "$lesson_id", "count": {"$sum": 1}}}
    ]
    stats = []
    for doc in progress_collection.aggregate(pipeline):
        stats.append(LessonStats(
            lesson_id=doc["_id"],
            completions=doc["count"]
        ))
    return stats


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="127.0.0.1", port=8000, reload=True)
