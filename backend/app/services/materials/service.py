from uuid import UUID

from fastapi import HTTPException, UploadFile
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.config import Settings
from app.models import User
from app.models.material import Material, MaterialStatus
from app.models.material_chunk import MaterialChunk
from app.models.material_section import MaterialSection
from app.schemas.material import MaterialDetail, MaterialResponse, SectionResponse
from app.services.courses import get_member_course
from app.services.materials import extraction
from app.services.materials.chunking import chunk_sections, detect_sections
from app.services.materials.storage import MaterialStorage, validate_filename


def get_material(db: Session, user: User, material_id: UUID) -> Material:
    material = db.get(Material, material_id)
    if material is None:
        raise HTTPException(404, "Material not found")
    get_member_course(db, user, material.course_id)
    return material


def list_materials(db: Session, user: User, course_id: UUID) -> list[Material]:
    get_member_course(db, user, course_id)
    return list(
        db.scalars(
            select(Material)
            .where(Material.course_id == course_id)
            .order_by(Material.created_at, Material.id)
        )
    )


def material_detail(db: Session, user: User, material_id: UUID) -> MaterialDetail:
    material = get_material(db, user, material_id)
    sections = db.scalars(
        select(MaterialSection)
        .where(MaterialSection.material_id == material_id)
        .order_by(MaterialSection.ordinal)
    )
    count = db.scalar(
        select(func.count())
        .select_from(MaterialChunk)
        .where(MaterialChunk.material_id == material_id)
    )
    return MaterialDetail(
        **MaterialResponse.model_validate(material).model_dump(),
        extracted_markdown=material.extracted_markdown,
        sections=[SectionResponse.model_validate(section) for section in sections],
        chunk_count=count or 0,
    )


def list_chunks(db: Session, user: User, material_id: UUID) -> list[MaterialChunk]:
    get_material(db, user, material_id)
    return list(
        db.scalars(
            select(MaterialChunk)
            .where(MaterialChunk.material_id == material_id)
            .order_by(MaterialChunk.ordinal)
        )
    )


def delete_material(db: Session, user: User, material_id: UUID, storage: MaterialStorage) -> None:
    material = db.scalar(
        select(Material).where(Material.id == material_id).with_for_update()
    )
    if material is None:
        raise HTTPException(404, "Material not found")
    get_member_course(db, user, material.course_id)
    if material.uploaded_by_user_id != user.id:
        raise HTTPException(403, "You can only delete your own failed upload")
    if material.status != MaterialStatus.FAILED.value:
        raise HTTPException(409, "Only failed uploads can be deleted")
    try:
        storage.delete(material.storage_key)
    except (OSError, ValueError) as exc:
        raise HTTPException(503, "Could not remove failed upload") from exc
    try:
        db.delete(material)
        db.commit()
    except Exception:
        db.rollback()
        raise HTTPException(503, "Could not remove failed upload") from None


def process_material(
    db: Session, material: Material, storage: MaterialStorage, settings: Settings
) -> Material:
    # Completed uploads are not parsed twice. No public reprocess API in this phase.
    if material.status != MaterialStatus.UPLOADED.value:
        return material
    material.status = MaterialStatus.PROCESSING.value
    db.commit()
    try:
        extracted = extraction.extract_document(storage.path(material.storage_key))
        sections = detect_sections(extracted.markdown)
        chunks = chunk_sections(
            sections, settings.material_chunk_target_chars, settings.material_chunk_overlap_chars
        )
        if not chunks:
            raise ValueError("No usable chunks")
        section_ids: dict[int, UUID] = {}
        for section in sections:
            row = MaterialSection(
                material_id=material.id,
                ordinal=section.ordinal,
                title=section.title,
                level=section.level,
                content=section.content,
            )
            db.add(row)
            db.flush()
            section_ids[section.ordinal] = row.id
        for chunk in chunks:
            db.add(
                MaterialChunk(
                    material_id=material.id,
                    section_id=section_ids[chunk.section_ordinal],
                    ordinal=chunk.ordinal,
                    content=chunk.content,
                    char_count=len(chunk.content),
                )
            )
        material.extracted_markdown = extracted.markdown
        material.status = MaterialStatus.READY.value
        material.processing_error = None
        db.commit()
    except Exception:
        # Rollback includes all derived rows; retain the original source and safe failure state.
        db.rollback()
        material.status = MaterialStatus.FAILED.value
        material.processing_error = (
            "Could not extract text from this PDF. "
            "It may be damaged, encrypted, or contain no readable text."
        )
        db.commit()
    db.refresh(material)
    return material


def upload_material(
    db: Session,
    user: User,
    course_id: UUID,
    upload: UploadFile,
    storage: MaterialStorage,
    settings: Settings,
) -> Material:
    get_member_course(db, user, course_id)
    filename = validate_filename(upload.filename, upload.content_type)
    try:
        stored = storage.save(upload.file, settings.material_max_upload_bytes)
    except OSError as exc:
        raise HTTPException(503, "Material storage is unavailable") from exc
    material = Material(
        course_id=course_id,
        uploaded_by_user_id=user.id,
        original_filename=filename,
        media_type="application/pdf",
        file_size_bytes=stored.size,
        storage_key=stored.key,
        status=MaterialStatus.UPLOADED.value,
    )
    try:
        db.add(material)
        db.commit()
    except Exception:
        db.rollback()
        storage.delete(stored.key)
        raise HTTPException(503, "Could not save material") from None
    return process_material(db, material, storage, settings)
