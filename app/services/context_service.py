from __future__ import annotations

import json
from datetime import UTC, datetime

from app.core.database import get_db_connection
from app.models.schemas import ContextRequest


class ContextService:
    def save_context(self, payload: ContextRequest) -> ContextRequest:
        serialized = json.dumps(payload.model_dump(mode="json"), ensure_ascii=True)
        updated_at = datetime.now(UTC).isoformat()
        with get_db_connection() as connection:
            connection.execute(
                """
                INSERT INTO user_contexts (user_id, payload, updated_at)
                VALUES (?, ?, ?)
                ON CONFLICT(user_id) DO UPDATE SET
                    payload = excluded.payload,
                    updated_at = excluded.updated_at
                """,
                (payload.user_id, serialized, updated_at),
            )
            connection.commit()
        return payload

    def get_context(self, user_id: str) -> ContextRequest | None:
        with get_db_connection() as connection:
            row = connection.execute(
                "SELECT payload FROM user_contexts WHERE user_id = ?",
                (user_id,),
            ).fetchone()
        if row is None:
            return None
        return ContextRequest.model_validate(json.loads(row["payload"]))


context_service = ContextService()
