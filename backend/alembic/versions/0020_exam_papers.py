"""Past exam papers and their ordered, pointed items."""

from alembic import op

revision = "0020"
down_revision = "0019"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
CREATE TABLE exam_papers (
    id UUID PRIMARY KEY,
    course_id UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    academic_year VARCHAR(7) NOT NULL,
    kind VARCHAR(10) NOT NULL,
    title VARCHAR(100) NOT NULL,
    normalized_title VARCHAR(400) NOT NULL,
    term_label VARCHAR(100),
    exam_date DATE,
    exam_scope_id UUID REFERENCES exam_scopes(id) ON DELETE SET NULL,
    duration_minutes INTEGER,
    wrong_answer_penalty NUMERIC(4, 3) NOT NULL DEFAULT 0,
    pass_threshold NUMERIC(7, 2),
    status VARCHAR(10) NOT NULL DEFAULT 'DRAFT',
    published_at TIMESTAMPTZ,
    created_by_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_exam_paper_year_title UNIQUE (course_id, academic_year, normalized_title),
    CONSTRAINT ck_exam_paper_kind CHECK (kind IN ('MIDTERM','FINAL','FULL_EXAM','LAB','QUIZ')),
    CONSTRAINT ck_exam_paper_academic_year CHECK (academic_year ~ '^[0-9]{4}/[0-9]{2}$'),
    CONSTRAINT ck_exam_paper_title CHECK (length(btrim(title)) > 0 AND char_length(title) <= 100),
    CONSTRAINT ck_exam_paper_term_label CHECK (
        term_label IS NULL OR (length(btrim(term_label)) > 0 AND char_length(term_label) <= 100)
    ),
    CONSTRAINT ck_exam_paper_duration CHECK (
        duration_minutes IS NULL OR duration_minutes BETWEEN 1 AND 600
    ),
    CONSTRAINT ck_exam_paper_penalty CHECK (
        wrong_answer_penalty >= 0 AND wrong_answer_penalty <= 1
    ),
    CONSTRAINT ck_exam_paper_threshold CHECK (pass_threshold IS NULL OR pass_threshold >= 0),
    CONSTRAINT ck_exam_paper_status CHECK (status IN ('DRAFT','PUBLISHED')),
    CONSTRAINT ck_exam_paper_published CHECK (
        (status = 'DRAFT' AND published_at IS NULL)
        OR (status = 'PUBLISHED' AND published_at IS NOT NULL)
    )
);
CREATE INDEX ix_exam_papers_course_id ON exam_papers(course_id);
CREATE INDEX ix_exam_papers_exam_scope_id ON exam_papers(exam_scope_id);
CREATE TABLE exam_paper_items (
    id UUID PRIMARY KEY,
    paper_id UUID NOT NULL REFERENCES exam_papers(id) ON DELETE CASCADE,
    position INTEGER NOT NULL,
    question_id UUID NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
    points NUMERIC(6, 2) NOT NULL,
    label VARCHAR(40),
    CONSTRAINT uq_exam_paper_item_position UNIQUE (paper_id, position),
    CONSTRAINT uq_exam_paper_item_question UNIQUE (paper_id, question_id),
    CONSTRAINT ck_exam_paper_item_position CHECK (position >= 0),
    CONSTRAINT ck_exam_paper_item_points CHECK (points > 0),
    CONSTRAINT ck_exam_paper_item_label CHECK (
        label IS NULL OR (length(btrim(label)) > 0 AND char_length(label) <= 40)
    )
);
CREATE INDEX ix_exam_paper_items_question_id ON exam_paper_items(question_id);
""")


def downgrade() -> None:
    op.execute("""
DROP TABLE exam_paper_items;
DROP TABLE exam_papers;
""")
