from uuid import UUID

from fastapi import APIRouter, Depends, UploadFile
from sqlalchemy.orm import Session

from app.config import Settings
from app.dependencies import get_current_user, get_db
from app.models import User
from app.models.material import Material
from app.models.material_chunk import MaterialChunk
from app.schemas.material import ChunkResponse, MaterialDetail, MaterialResponse
from app.services.materials import service
from app.services.materials.storage import LocalMaterialStorage

router = APIRouter(tags=["materials"])


@router.post("/courses/{course_id}/materials", response_model=MaterialResponse, status_code=201)
def upload_material(
    course_id: UUID,
    file: UploadFile,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Material:
    settings = Settings()
    return service.upload_material(
        db, user, course_id, file, LocalMaterialStorage(settings.material_storage_dir), settings
    )


@router.get("/courses/{course_id}/materials", response_model=list[MaterialResponse])
def list_materials(
    course_id: UUID, user: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> list[Material]:
    return service.list_materials(db, user, course_id)


@router.get("/materials/{material_id}", response_model=MaterialDetail)
def get_material(
    material_id: UUID, user: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> MaterialDetail:
    return service.material_detail(db, user, material_id)


@router.get("/materials/{material_id}/chunks", response_model=list[ChunkResponse])
def get_chunks(
    material_id: UUID, user: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> list[MaterialChunk]:
    return service.list_chunks(db, user, material_id)
