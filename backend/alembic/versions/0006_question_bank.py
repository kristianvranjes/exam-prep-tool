"""Add curated question bank, versions, and generation concept audit."""

from alembic import op

revision = "0006"
down_revision = "0005"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        "ALTER TABLE ai_jobs ADD COLUMN input_concept_ids JSONB NOT NULL DEFAULT '[]'::jsonb"
    )
    op.execute("""
CREATE TABLE questions (
id UUID NOT NULL,
course_id UUID NOT NULL,
created_by_user_id UUID NOT NULL,
ai_job_id UUID,
type VARCHAR(20) NOT NULL,
status VARCHAR(20) NOT NULL,
source VARCHAR(10) NOT NULL,
stem TEXT NOT NULL,
normalized_stem TEXT NOT NULL,
explanation TEXT,
difficulty SMALLINT,
correct_boolean BOOLEAN,
reference_answer TEXT,
reviewed_by_user_id UUID,
reviewed_at TIMESTAMP WITH TIME ZONE,
rejection_reason TEXT,
created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
PRIMARY KEY (id),
CONSTRAINT ck_question_type CHECK (type IN
('MULTIPLE_CHOICE','TRUE_FALSE','SHORT_ANSWER')),
CONSTRAINT ck_question_status CHECK (status IN
('DRAFT','PENDING_REVIEW','APPROVED','REJECTED','ARCHIVED')),
CONSTRAINT ck_question_source CHECK (source IN ('AI','USER')),
CONSTRAINT ck_question_difficulty CHECK (difficulty IS NULL OR difficulty BETWEEN 1 AND
5),
CONSTRAINT ck_question_stem CHECK (length(btrim(stem)) > 0 AND char_length(stem) <=
400),
CONSTRAINT ck_question_answer CHECK ((type = 'MULTIPLE_CHOICE' AND correct_boolean IS
NULL AND reference_answer IS NULL) OR (type = 'TRUE_FALSE' AND correct_boolean IS NOT
NULL AND reference_answer IS NULL) OR (type = 'SHORT_ANSWER' AND correct_boolean IS NULL
AND reference_answer IS NOT NULL AND length(btrim(reference_answer)) > 0)),
FOREIGN KEY(course_id) REFERENCES courses (id) ON DELETE CASCADE,
FOREIGN KEY(created_by_user_id) REFERENCES users (id) ON DELETE RESTRICT,
FOREIGN KEY(ai_job_id) REFERENCES ai_jobs (id) ON DELETE SET NULL,
FOREIGN KEY(reviewed_by_user_id) REFERENCES users (id) ON DELETE SET NULL
)
""")
    op.execute("CREATE INDEX ix_question_course_status ON questions (course_id, status)")
    op.execute("CREATE INDEX ix_question_course_type ON questions (course_id, type)")
    op.execute("CREATE INDEX ix_questions_ai_job_id ON questions (ai_job_id)")
    op.execute("""
CREATE UNIQUE INDEX uq_question_active_stem ON questions (course_id, normalized_stem)
WHERE status != 'ARCHIVED'
""")
    op.execute("""
CREATE TABLE question_options (
id UUID NOT NULL,
question_id UUID NOT NULL,
position INTEGER NOT NULL,
text TEXT NOT NULL,
is_correct BOOLEAN NOT NULL,
PRIMARY KEY (id),
CONSTRAINT uq_question_option_position UNIQUE (question_id, position),
CONSTRAINT ck_question_option_position CHECK (position >= 0),
FOREIGN KEY(question_id) REFERENCES questions (id) ON DELETE CASCADE
)
""")
    op.execute("""
CREATE TABLE question_concepts (
question_id UUID NOT NULL,
concept_id UUID NOT NULL,
PRIMARY KEY (question_id, concept_id),
FOREIGN KEY(question_id) REFERENCES questions (id) ON DELETE CASCADE,
FOREIGN KEY(concept_id) REFERENCES concepts (id) ON DELETE CASCADE
)
""")
    op.execute("CREATE INDEX ix_question_concepts_concept_id ON question_concepts (concept_id)")
    op.execute("""
CREATE TABLE question_chunks (
question_id UUID NOT NULL,
chunk_id UUID NOT NULL,
PRIMARY KEY (question_id, chunk_id),
FOREIGN KEY(question_id) REFERENCES questions (id) ON DELETE CASCADE,
FOREIGN KEY(chunk_id) REFERENCES material_chunks (id) ON DELETE CASCADE
)
""")
    op.execute("CREATE INDEX ix_question_chunks_chunk_id ON question_chunks (chunk_id)")
    op.execute("""
CREATE TABLE question_versions (
id UUID NOT NULL,
question_id UUID NOT NULL,
version_number INTEGER NOT NULL,
snapshot JSONB NOT NULL,
changed_by_user_id UUID NOT NULL,
reason VARCHAR(20) NOT NULL,
created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
PRIMARY KEY (id),
CONSTRAINT uq_question_version UNIQUE (question_id, version_number),
CONSTRAINT ck_question_version_number CHECK (version_number >= 1),
CONSTRAINT ck_question_version_reason CHECK (reason IN
('CREATED','EDITED','SUBMITTED','APPROVED','REJECTED','ARCHIVED')),
FOREIGN KEY(question_id) REFERENCES questions (id) ON DELETE CASCADE,
FOREIGN KEY(changed_by_user_id) REFERENCES users (id) ON DELETE RESTRICT
)
""")


def downgrade() -> None:
    op.drop_table("question_versions")
    op.drop_table("question_chunks")
    op.drop_table("question_concepts")
    op.drop_table("question_options")
    op.drop_table("questions")
    op.drop_column("ai_jobs", "input_concept_ids")
